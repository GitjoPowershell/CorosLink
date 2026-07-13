import { app, BrowserWindow, safeStorage, shell } from "electron";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { deleteSettings, getSetting, setSetting } from "./database";
import type { CorosMcpStatus, CorosMcpTool } from "./types";

// COROS official MCP server. Discovery (auth server metadata, DCR, PKCE) is
// handled by the MCP SDK against these URLs; we only implement token storage
// and the interactive redirect via a loopback server.
// COROS advertises this exact protected resource in its OAuth metadata. The
// `mcp.coros.com` alias responds, but OAuth tokens issued for this resource are
// correctly bound to the canonical `mcpus.coros.com` origin.
const MCP_RESOURCE_URL = "https://mcpus.coros.com/mcp";
const MCP_SCOPE = "openid mcp.tools offline_access";
const LOOPBACK_PORT = 1456;
const LOOPBACK_REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/coros-mcp/callback`;

const SETTINGS = {
  clientInfo: "corosMcp.clientInfo",
  resourceUrl: "corosMcp.resourceUrl",
  tokens: "corosMcp.tokens"
} as const;

let client: Client | null = null;
let cachedTools: CorosMcpTool[] = [];
/** Single-flight guard: Connect + Training Hub must not fight over :1456. */
let connectInFlight: Promise<CorosMcpStatus> | null = null;
let connectInFlightInteractive = false;

// ----- OAuth client provider (persists to settings/safeStorage) -----

class CorosOAuthProvider implements OAuthClientProvider {
  private verifier = "";
  private oauthState = "";
  private loopback: http.Server | null = null;
  private codePromise: Promise<string> | null = null;
  private settleCode:
    | ((result: { ok: true; code: string } | { ok: false; error: Error }) => void)
    | null = null;
  private authWindow: BrowserWindow | undefined;
  private closingWindow = false;

  constructor(
    private readonly parentWindow?: BrowserWindow | null,
    private readonly interactive = true
  ) {}

  get redirectUrl(): string {
    return LOOPBACK_REDIRECT_URI;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "CorosLink",
      redirect_uris: [LOOPBACK_REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: MCP_SCOPE
    };
  }

  state(): string {
    if (!this.oauthState) {
      this.oauthState = base64Url(crypto.randomBytes(16));
    }
    return this.oauthState;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    const raw = getSetting(SETTINGS.clientInfo);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as OAuthClientInformationFull;
    } catch {
      return undefined;
    }
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    setSetting(SETTINGS.clientInfo, JSON.stringify(info));
  }

  tokens(): OAuthTokens | undefined {
    return readTokens();
  }

  saveTokens(tokens: OAuthTokens): void {
    writeTokens(tokens);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    return this.verifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Non-interactive (silent reconnect): never pop a browser window.
    if (!this.interactive) return;
    // Bind loopback first; only open the window after :1456 is ours.
    this.startLoopback(authorizationUrl);
  }

  /** Resolves with the authorization code once the loopback callback fires. */
  waitForCode(): Promise<string> {
    if (!this.codePromise) {
      throw new Error("COROS authorization was not started.");
    }
    return this.codePromise;
  }

  authorizationStarted(): boolean {
    return this.codePromise !== null;
  }

  /**
   * Tear down the auth window and loopback. Awaits port release so a
   * subsequent connect can rebind 1456 immediately after cancel/failure.
   */
  async cleanup(): Promise<void> {
    this.finishCode({
      ok: false,
      error: new Error("COROS connection cancelled.")
    });

    const server = this.loopback;
    this.loopback = null;
    if (server) {
      await Promise.race([
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.on("error", () => resolve());
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 1000))
      ]);
    }

    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.closingWindow = true;
      const toClose = this.authWindow;
      // Keep the success/failure page visible briefly, then dismiss.
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!toClose.isDestroyed()) toClose.close();
          resolve();
        }, 300);
      });
    }
  }

  private finishCode(
    result: { ok: true; code: string } | { ok: false; error: Error }
  ): void {
    const settle = this.settleCode;
    if (!settle) return;
    this.settleCode = null;
    settle(result);
  }

  private openAuthWindow(authorizationUrl: URL): void {
    if (this.authWindow && !this.authWindow.isDestroyed()) return;
    this.authWindow = new BrowserWindow({
      width: 520,
      height: 760,
      title: "Connect COROS",
      parent: this.parentWindow ?? undefined,
      modal: Boolean(this.parentWindow),
      closable: true,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    this.authWindow.on("closed", () => {
      this.authWindow = undefined;
      // Ignore closes we triggered from cleanup after a settled flow.
      if (this.closingWindow) return;
      this.finishCode({
        ok: false,
        error: new Error("COROS connection window was closed.")
      });
    });
    this.authWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    // Keep a close control visible even when the COROS login page hangs.
    this.authWindow.webContents.on("dom-ready", () => {
      void this.injectCloseButton();
    });
    void this.authWindow.loadURL(authorizationUrl.toString());
  }

  private async injectCloseButton(): Promise<void> {
    if (!this.authWindow || this.authWindow.isDestroyed()) return;
    try {
      await this.authWindow.webContents.executeJavaScript(
        `(() => {
          if (document.getElementById("coroslink-mcp-close")) return;
          const button = document.createElement("button");
          button.id = "coroslink-mcp-close";
          button.type = "button";
          button.setAttribute("aria-label", "Close");
          button.title = "Close";
          button.textContent = "×";
          button.style.cssText = [
            "position:fixed",
            "top:12px",
            "right:12px",
            "z-index:2147483647",
            "width:36px",
            "height:36px",
            "border:none",
            "border-radius:18px",
            "background:rgba(15,18,24,0.72)",
            "color:#fff",
            "font:600 24px/36px system-ui,sans-serif",
            "cursor:pointer",
            "box-shadow:0 4px 16px rgba(0,0,0,0.28)"
          ].join(";");
          button.addEventListener("click", () => window.close());
          document.documentElement.appendChild(button);
        })();`,
        true
      );
    } catch {
      // Page may block script injection; OS window chrome remains available.
    }
  }

  private startLoopback(authorizationUrl: URL): void {
    if (this.codePromise) return;
    this.codePromise = new Promise<string>((resolve, reject) => {
      this.settleCode = (result) => {
        if (result.ok) resolve(result.code);
        else reject(result.error);
      };
      const server = http.createServer((request, response) => {
        if (!request.url) return;
        const callbackUrl = new URL(request.url, LOOPBACK_REDIRECT_URI);
        if (callbackUrl.pathname !== "/coros-mcp/callback") {
          response.writeHead(404);
          response.end();
          return;
        }
        const error = callbackUrl.searchParams.get("error");
        const code = callbackUrl.searchParams.get("code");
        const returnedState = callbackUrl.searchParams.get("state");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (error) {
          response.end(corosMcpResultPage("COROS connection failed.", true));
          this.finishCode({ ok: false, error: new Error(error) });
          return;
        }
        if (returnedState !== this.oauthState || !code) {
          response.end(corosMcpResultPage("COROS connection failed.", true));
          this.finishCode({
            ok: false,
            error: new Error("COROS OAuth state mismatch.")
          });
          return;
        }
        response.end(corosMcpResultPage("COROS connected.", false));
        this.finishCode({ ok: true, code });
      });
      server.on("error", (error) => {
        const detail =
          error instanceof Error ? error : new Error(String(error));
        if ((detail as NodeJS.ErrnoException).code === "EADDRINUSE") {
          this.finishCode({
            ok: false,
            error: new Error(
              "COROS OAuth callback port 1456 is already in use. " +
                "Close other CorosLink windows, or run: lsof -nP -iTCP:1456 -sTCP:LISTEN"
            )
          });
          return;
        }
        this.finishCode({ ok: false, error: detail });
      });
      this.loopback = server;
      server.listen(LOOPBACK_PORT, "127.0.0.1", () => {
        const address = server.address() as AddressInfo | null;
        if (!address || address.port !== LOOPBACK_PORT) {
          this.finishCode({
            ok: false,
            error: new Error("COROS OAuth callback port did not bind.")
          });
          return;
        }
        this.openAuthWindow(authorizationUrl);
      });
    });
    // Prevent unhandledRejection if cleanup settles before waitForCode().
    void this.codePromise.catch(() => undefined);
  }
}

function corosMcpResultPage(message: string, failed: boolean): string {
  const tone = failed ? "#b42318" : "#027a48";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect COROS</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font: 15px/1.45 system-ui, -apple-system, sans-serif;
      background: #0f1218;
      color: #f4f6f8;
    }
    .card {
      position: relative;
      width: min(360px, calc(100vw - 32px));
      padding: 28px 24px 24px;
      border-radius: 16px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      text-align: center;
    }
    .close {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 18px;
      background: rgba(255,255,255,0.12);
      color: #fff;
      font: 600 24px/36px system-ui, sans-serif;
      cursor: pointer;
    }
    .close:hover { background: rgba(255,255,255,0.2); }
    h1 {
      margin: 8px 0 8px;
      font-size: 18px;
      font-weight: 650;
      color: ${tone};
    }
    p { margin: 0 0 18px; color: rgba(244,246,248,0.72); }
    .action {
      border: none;
      border-radius: 999px;
      padding: 10px 18px;
      background: #f4f6f8;
      color: #0f1218;
      font: 600 13px/1 system-ui, sans-serif;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <button id="coroslink-mcp-close" class="close" type="button" aria-label="Close" title="Close" onclick="window.close()">×</button>
    <h1>${message}</h1>
    <p>You can close this window.</p>
    <button class="action" type="button" onclick="window.close()">Close</button>
  </div>
</body>
</html>`;
}

// ----- Token persistence (encrypted) -----

function readTokens(): OAuthTokens | undefined {
  const encoded = getSetting(SETTINGS.tokens);
  if (!encoded || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    const json = safeStorage.decryptString(Buffer.from(encoded, "base64"));
    return JSON.parse(json) as OAuthTokens;
  } catch {
    return undefined;
  }
}

function writeTokens(tokens: OAuthTokens): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens)).toString("base64");
  setSetting(SETTINGS.tokens, encrypted);
}

function resetCachedMcpClient(): void {
  const staleClient = client;
  client = null;
  cachedTools = [];
  if (staleClient) {
    void staleClient.close().catch(() => {
      // best-effort
    });
  }
}

function clearStoredMcpAuth(): void {
  resetCachedMcpClient();
  deleteSettings([SETTINGS.tokens, SETTINGS.clientInfo]);
  setSetting(SETTINGS.resourceUrl, MCP_RESOURCE_URL);
}

function ensureCurrentMcpResource(): void {
  if (getSetting(SETTINGS.resourceUrl) === MCP_RESOURCE_URL) {
    return;
  }

  clearStoredMcpAuth();
}

// ----- Public API -----

export function getCorosMcpStatus(): CorosMcpStatus {
  ensureCurrentMcpResource();
  return {
    connected: client !== null,
    authorized: Boolean(getSetting(SETTINGS.tokens)),
    tools: cachedTools
  };
}

/** Connects (running the OAuth flow if needed) and caches the tool list. */
export async function connectCorosMcp(
  mainWindow?: BrowserWindow | null,
  interactive = true
): Promise<CorosMcpStatus> {
  ensureCurrentMcpResource();

  for (;;) {
    if (client) {
      return getCorosMcpStatus();
    }

    if (connectInFlight) {
      // Join an in-flight connect when it can satisfy us (same or richer auth).
      if (!interactive || connectInFlightInteractive) {
        return connectInFlight;
      }
      // Silent reconnect is running; wait, then open interactive UI if still needed.
      try {
        await connectInFlight;
      } catch {
        // Fall through and start an interactive attempt.
      }
      continue;
    }

    connectInFlightInteractive = interactive;
    const flight = connectCorosMcpOnce(mainWindow, interactive).finally(() => {
      if (connectInFlight === flight) {
        connectInFlight = null;
        connectInFlightInteractive = false;
      }
    });
    connectInFlight = flight;
    return flight;
  }
}

async function connectCorosMcpOnce(
  mainWindow?: BrowserWindow | null,
  interactive = true
): Promise<CorosMcpStatus> {
  if (client) {
    return getCorosMcpStatus();
  }

  let clearedStaleAuth = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const authProvider = new CorosOAuthProvider(mainWindow, interactive);
    const transport = new StreamableHTTPClientTransport(new URL(MCP_RESOURCE_URL), {
      authProvider
    });
    const mcpClient = new Client(
      { name: "CorosLink", version: app.getVersion() },
      { capabilities: {} }
    );

    try {
      try {
        await mcpClient.connect(transport);
      } catch (error) {
        if (
          error instanceof UnauthorizedError &&
          interactive &&
          authProvider.authorizationStarted()
        ) {
          const code = await authProvider.waitForCode();
          await transport.finishAuth(code);
          // The original transport is already started; reconnect with a fresh one,
          // which picks up the now-saved tokens via the auth provider.
          const retryTransport = new StreamableHTTPClientTransport(
            new URL(MCP_RESOURCE_URL),
            { authProvider }
          );
          await mcpClient.connect(retryTransport);
        } else if (error instanceof UnauthorizedError) {
          clearStoredMcpAuth();
          if (interactive && !clearedStaleAuth) {
            clearedStaleAuth = true;
            continue;
          }

          throw error;
        } else {
          throw error;
        }
      }
    } finally {
      await authProvider.cleanup();
    }

    client = mcpClient;
    setSetting(SETTINGS.resourceUrl, MCP_RESOURCE_URL);
    await refreshTools();
    return getCorosMcpStatus();
  }

  throw new Error("COROS MCP authorization expired. Connect COROS again.");
}

/** Reconnects silently using stored tokens (no browser), if authorized. */
export async function ensureCorosMcpConnected(): Promise<boolean> {
  ensureCurrentMcpResource();
  if (client) return true;
  if (!getSetting(SETTINGS.tokens)) return false;
  try {
    await connectCorosMcp(null, false);
    return client !== null;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      clearStoredMcpAuth();
    }
    return false;
  }
}

export async function disconnectCorosMcp(): Promise<CorosMcpStatus> {
  if (client) {
    try {
      await client.close();
    } catch {
      // best-effort
    }
  }
  client = null;
  cachedTools = [];
  deleteSettings([SETTINGS.tokens, SETTINGS.clientInfo]);
  setSetting(SETTINGS.resourceUrl, MCP_RESOURCE_URL);
  return getCorosMcpStatus();
}

export async function listCorosMcpTools(): Promise<CorosMcpTool[]> {
  if (!client) throw new Error("COROS MCP is not connected.");
  await refreshTools();
  return cachedTools;
}

/** Returns discovered tools in a shape ready to hand to a model as functions. */
export function getCorosMcpTools(): CorosMcpTool[] {
  return cachedTools;
}

export async function callCorosMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (!client) {
    throw new Error(
      "COROS MCP is not connected. Connect it in Coach settings, or use local tools " +
        "like get_activity_detail for lap and activity analysis."
    );
  }

  let result;
  try {
    result = await client.callTool({ name, arguments: args });
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    throw new Error(formatCorosMcpToolFailure(name, detail));
  }

  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((block) => {
      if (block && typeof block === "object" && "text" in block) {
        return String((block as { text: unknown }).text ?? "");
      }
      return JSON.stringify(block);
    })
    .join("\n");

  const structured =
    result.structuredContent && typeof result.structuredContent === "object"
      ? JSON.stringify(result.structuredContent)
      : "";

  const combined = [text.trim(), structured.trim()].filter(Boolean).join("\n");

  if (result.isError) {
    throw new Error(formatCorosMcpToolFailure(name, combined || text || "unknown error"));
  }

  if (/service exceptions?/i.test(combined || text)) {
    throw new Error(formatCorosMcpToolFailure(name, combined || text));
  }

  return combined || text;
}

function formatCorosMcpToolFailure(toolName: string, detail: string): string {
  const trimmed = detail.trim();
  if (/service exceptions?/i.test(trimmed)) {
    if (/recovery|health|fitness|training.?load|daily/i.test(toolName)) {
      return (
        `COROS MCP ${toolName} is temporarily unavailable (COROS server error). ` +
        "Try again later, or use local get_activity_detail / the training snapshot for activity questions."
      );
    }
    return (
      `COROS MCP ${toolName} failed with a COROS server error. Try again later. ` +
      "For lap splits and workout breakdowns, use local get_activity_detail instead."
    );
  }

  if (/lap|split|interval|activity|workout/i.test(toolName)) {
    return (
      `COROS MCP ${toolName} failed: ${trimmed}. ` +
      "For lap and split analysis, prefer local get_activity_detail."
    );
  }

  return `COROS MCP ${toolName} failed: ${trimmed}`;
}

async function refreshTools(): Promise<void> {
  if (!client) return;
  const result = await client.listTools();
  cachedTools = (result.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>
  }));
}

// ----- helpers -----

function base64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
