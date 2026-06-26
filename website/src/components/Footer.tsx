import icon from "../../../build/icon.png";

const GITHUB_URL = "https://github.com/JunAkerBuilds/CorosLink";

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <img src={icon} alt="" />
          CorosLink
        </div>
        <div className="footer-links">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href="#features">Features</a>
          <a href="#download">Download</a>
        </div>
        <p className="footer-disclaimer">
          CorosLink is an unofficial app for COROS Pace Pro owners. Not
          affiliated with or endorsed by COROS. COROS is a trademark of COROS
          Wearables Inc.
        </p>
      </div>
    </footer>
  );
}
