import Image from 'next/image';

import { capabilitySignals, featureCards } from '@/lib/demo-data';
import { landingCopy } from '@/lib/copy';

const spanClassByCard = {
  wide: 'md:col-span-2 xl:col-span-6',
  medium: 'md:col-span-1 xl:col-span-3',
  compact: 'md:col-span-1 xl:col-span-3',
} as const;

const accentLineClassByCard = {
  wide: 'from-[var(--landing-accent)] to-[var(--landing-accent-violet)]',
  medium: 'from-[var(--landing-accent)] to-transparent',
  compact: 'from-[var(--landing-accent-violet)] to-transparent',
} as const;

export function FeatureBentoSection() {
  return (
    <section id="features" className="landing-container px-6 py-20 sm:px-10 sm:py-24">
      <div className="max-w-3xl">
        <p className="landing-kicker">{landingCopy.features.eyebrow}</p>
        <h2 className="landing-section-title mt-4 max-w-[13ch]">{landingCopy.features.title}</h2>
        <p className="landing-section-copy mt-6 max-w-2xl">{landingCopy.features.description}</p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        {featureCards.map((card) => (
          <article
            key={card.id}
            className={`landing-panel group relative overflow-hidden rounded-[1.8rem] p-6 transition duration-300 hover:-translate-y-1 hover:border-[rgba(80,210,193,0.24)] ${spanClassByCard[card.span]}`}
          >
            <div
              className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${accentLineClassByCard[card.span]}`}
            />
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                  {card.eyebrow}
                </p>
                <h3 className="landing-display-value mt-4 max-w-[14ch] text-3xl">{card.title}</h3>
              </div>
              <span className="rounded-full border border-[color:var(--landing-border)] bg-[rgba(80,210,193,0.08)] px-3 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-[var(--landing-accent)]">
                {card.metric}
              </span>
            </div>

            <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--landing-muted-strong)]">
              {card.description}
            </p>

            <div className="mt-8 flex flex-wrap gap-2">
              {card.supportingPoints.map((point) => (
                <span
                  key={point}
                  className="rounded-full border border-white/8 bg-black/20 px-3 py-1.5 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-300"
                >
                  {point}
                </span>
              ))}
            </div>

            {card.span === 'wide' && card.id !== 'aggregation' ? (
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {capabilitySignals.map((signal) => (
                  <div
                    key={signal}
                    className="rounded-[1rem] border border-white/6 bg-white/[0.03] px-3 py-3 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-zinc-200"
                  >
                    {signal}
                  </div>
                ))}
              </div>
            ) : null}

            {card.id === 'aggregation' ? (
              <div className="mt-8 overflow-hidden rounded-[1.2rem] border border-white/6 bg-black/30">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/6 px-4 py-3">
                  <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                    Live chain view
                  </p>
                  <span className="rounded-full border border-[rgba(80,210,193,0.2)] bg-[rgba(80,210,193,0.1)] px-3 py-1 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--landing-accent)]">
                    Zoomed chain
                  </span>
                </div>
                <div className="p-3">
                  <div className="relative aspect-[1.32/1] overflow-hidden rounded-[0.9rem] border border-white/6 bg-black sm:aspect-[1.55/1]">
                    <Image
                      src="/chainview.png"
                      alt="Cross-venue options chain view showing bids, asks, IV, and strikes across venues."
                      fill
                      sizes="(min-width: 1280px) 40vw, (min-width: 768px) 50vw, 100vw"
                      className="object-cover object-[52%_20%] scale-[1.16]"
                    />
                  </div>
                  <p className="mt-3 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                    Focused on the live cross-venue book.
                  </p>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
