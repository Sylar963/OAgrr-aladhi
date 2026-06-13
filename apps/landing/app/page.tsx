import { Footer } from "@/components/Footer";
import { FaqSection } from "@/components/FaqSection";
import { FeatureBentoSection } from "@/components/FeatureBentoSection";
import { TrustSection } from "@/components/TrustSection";
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

// JSON.stringify does not escape "<", so a future FAQ string containing "</script>"
// could break out of the script element. Escaping "<" closes that class of bug;
// JSON parsers read < as "<" transparently.
function toJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

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
    <div className="landing-page min-h-screen bg-[var(--landing-bg)] text-[var(--landing-text)]">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from local constants
        dangerouslySetInnerHTML={{ __html: toJsonLd(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from local constants
        dangerouslySetInnerHTML={{ __html: toJsonLd(orgJsonLd) }}
      />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-[var(--landing-border-strong)] focus:bg-[var(--landing-panel-strong)] focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <TopTicker spots={snapshot.spots} />
      <LandingHeader />
      <main id="main">
        <HeroTerminalSection />
        <VenueStrip />
        <TerminalShowcase />
        <SectionReveal>
          <HowItWorksSection />
        </SectionReveal>
        <SectionReveal>
          <FeatureBentoSection />
        </SectionReveal>
        <SectionReveal>
          <TrustSection />
        </SectionReveal>
        <FaqSection />
        <LeadCaptureSection />
      </main>
      <Footer />
    </div>
  );
}
