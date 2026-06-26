import { Nav } from "./components/Nav";
import { ScrollProgress } from "./components/ScrollProgress";
import { Hero } from "./components/Hero";
import { TrustStrip } from "./components/TrustStrip";
import { FeaturePillars } from "./components/FeaturePillars";
import { Stats } from "./components/Stats";
import { ScreenshotShowcase } from "./components/ScreenshotShowcase";
import { HowItWorks } from "./components/HowItWorks";
import { Privacy } from "./components/Privacy";
import { Download } from "./components/Download";
import { Footer } from "./components/Footer";

export default function App() {
  return (
    <div className="site">
      <div className="site-aurora" aria-hidden="true" />
      <div className="site-grain" aria-hidden="true" />
      <ScrollProgress />
      <Nav />
      <main>
        <Hero />
        <TrustStrip />
        <FeaturePillars />
        <Stats />
        <ScreenshotShowcase />
        <HowItWorks />
        <Privacy />
        <Download />
      </main>
      <Footer />
    </div>
  );
}
