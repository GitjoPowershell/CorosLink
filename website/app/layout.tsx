import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "../src/styles/global.css";

const SITE_URL = "https://coroslink.vercel.app";
const DESCRIPTION =
  "CorosLink is an unofficial COROS Pace Pro companion for music sync, USB watch transfer, and training analytics on macOS, Windows, and Linux.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "CorosLink - Pace Pro companion",
    template: "%s | CorosLink",
  },
  description: DESCRIPTION,
  applicationName: "CorosLink",
  keywords: [
    "CorosLink",
    "COROS Pace Pro",
    "Pace Pro music sync",
    "COROS training analytics",
    "desktop companion app",
  ],
  authors: [{ name: "CorosLink Contributors" }],
  creator: "CorosLink Contributors",
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: "CorosLink - Pace Pro companion",
    description: DESCRIPTION,
    siteName: "CorosLink",
    images: [
      {
        url: "/og-image.png",
        width: 2360,
        height: 1456,
        alt: "CorosLink desktop app showcase",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CorosLink - Pace Pro companion",
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#050806",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
