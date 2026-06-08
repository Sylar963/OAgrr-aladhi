import { Footer } from "@/components/Footer";
import { FaqSection } from "@/components/FaqSection";
import { FeatureBentoSection } from "@/components/FeatureBentoSection";
import { HeroTerminalSection } from "@/components/HeroTerminalSection";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import { LandingHeader } from "@/components/LandingHeader";
import { LeadCaptureSection } from "@/components/LeadCaptureSection";
import { SectionReveal } from "@/components/SectionReveal";
import { TerminalShowcase } from "@/components/TerminalShowcase";
import { TopTicker } from "@/components/TopTicker";
import { VenueStrip } from "@/components/VenueStrip";
import { getMarketSnapshot } from "@/lib/market-snapshot";

export default async function HomePage() {
  const snapshot = await getMarketSnapshot();

  return (
    <main className="landing-page min-h-screen bg-[var(--landing-bg)] text-[var(--landing-text)]">
      <TopTicker spots={snapshot.spots} />
      <LandingHeader />
      <HeroTerminalSection />
      <TerminalShowcase />
      <SectionReveal>
        <HowItWorksSection />
      </SectionReveal>
      <SectionReveal>
        <FeatureBentoSection />
      </SectionReveal>
      <FaqSection />
      <LeadCaptureSection />
      <VenueStrip />
      <Footer />
    </main>
  );
}
