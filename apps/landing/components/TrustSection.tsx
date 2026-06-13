import { landingCopy } from "@/lib/copy";
import { contactEmail } from "@/lib/links";

// Verifiable engineering claims only — the founder/identity block is a future,
// owner-written addition; never ship placeholder identity copy.
const proofPoints = [
  {
    title: "Degraded shows as degraded",
    detail:
      "Venue health is a first-class surface. A stale feed flags in the UI the moment it degrades — never silent stale state.",
  },
  {
    title: "One schema, venue-tagged",
    detail:
      "Every quote, fill, and greek is normalized once and carries its source venue end-to-end, so risk views reconcile by construction.",
  },
  {
    title: "Counts come from code",
    detail:
      "Venue and coverage numbers on this page are derived from the same data the terminal ships with — they cannot drift from reality.",
  },
] as const;

export function TrustSection() {
  const contactHref = contactEmail ? `mailto:${contactEmail}` : "#access";
  const contactText = contactEmail ?? "request access below";

  return (
    <section
      id="trust"
      className="landing-container scroll-mt-24 px-6 py-20 sm:px-10 sm:py-24"
    >
      <div className="max-w-3xl">
        <p className="landing-kicker">{landingCopy.trust.eyebrow}</p>
        <h2 className="landing-section-title mt-4 max-w-[13ch]">
          {landingCopy.trust.title}
        </h2>
        <p className="landing-section-copy mt-6 max-w-2xl">
          {landingCopy.trust.description}
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {proofPoints.map((point) => (
          <article key={point.title} className="landing-panel rounded-[1.5rem] px-5 py-6">
            <h3 className="landing-display-value text-2xl">{point.title}</h3>
            <p className="mt-3 text-base leading-7 text-[var(--landing-muted-strong)]">
              {point.detail}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-white/8 pt-6 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.28em] text-zinc-400">
        <span>{landingCopy.trust.contactLabel}</span>
        <a
          className="text-[var(--landing-text-strong)] underline decoration-white/30 underline-offset-4 transition hover:decoration-white"
          href={contactHref}
        >
          {contactText}
        </a>
      </div>
    </section>
  );
}
