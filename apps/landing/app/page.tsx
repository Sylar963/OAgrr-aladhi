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
import { faqItems } from "@/lib/demo-data";
import { getMarketSnapshot } from "@/lib/market-snapshot";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oggregator.xyz";

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Oggregator",
  url: siteUrl,
};

export default async function HomePage() {
  const snapshot = await getMarketSnapshot();

  return (
    <main className="landing-page min-h-screen bg-[var(--landing-bg)] text-[var(--landing-text)]">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from local constants
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from local constants
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
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
