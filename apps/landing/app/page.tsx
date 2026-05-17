import { Footer } from "@/components/Footer";
import { FaqSection } from "@/components/FaqSection";
import { FeatureBentoSection } from "@/components/FeatureBentoSection";
import { HeroTerminalSection } from "@/components/HeroTerminalSection";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import { LandingHeader } from "@/components/LandingHeader";
import { LeadCaptureSection } from "@/components/LeadCaptureSection";
import { SectionReveal } from "@/components/SectionReveal";
import { SurfaceScrollTheater } from "@/components/SurfaceScrollTheater";
import { TopTicker } from "@/components/TopTicker";

export default function HomePage() {
  return (
    <main className="landing-page min-h-screen bg-[var(--landing-bg)] text-[var(--landing-text)]">
      <TopTicker />
      <LandingHeader />
      <SectionReveal>
        <HeroTerminalSection />
      </SectionReveal>
      <SectionReveal>
        <HowItWorksSection />
      </SectionReveal>
      <SectionReveal>
        <FeatureBentoSection />
      </SectionReveal>
      <SurfaceScrollTheater />
      <FaqSection />
      <LeadCaptureSection />
      <Footer />
    </main>
  );
}
