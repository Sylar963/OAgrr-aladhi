import { landingCopy } from "@/lib/copy";
import { contactEmail, xUrl } from "@/lib/links";

// Privacy/Terms links are added in the same commit as the owner-supplied legal
// text (a later task) — never link to empty routes.
export function Footer() {
  return (
    <footer className="landing-container border-t border-white/6 px-6 py-10 sm:px-10">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-[var(--font-heading)] text-sm font-medium uppercase tracking-[0.3em] text-zinc-300">
            Oggregator
          </p>
          <p className="mt-2 text-sm text-zinc-400">{landingCopy.footer.strapline}</p>
        </div>

        <nav
          aria-label="Footer"
          className="flex flex-wrap gap-4 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-zinc-400"
        >
          {landingCopy.footer.links.map((link) => (
            <a key={link.href} href={link.href} className="transition hover:text-zinc-200">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex flex-col gap-2 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-zinc-400">
          {contactEmail ? (
            <a href={`mailto:${contactEmail}`} className="transition hover:text-zinc-200">
              {contactEmail}
            </a>
          ) : null}
          {xUrl ? (
            <a
              href={xUrl}
              rel="noreferrer"
              target="_blank"
              className="transition hover:text-zinc-200"
            >
              X / Twitter
            </a>
          ) : null}
        </div>
      </div>

      <p className="mt-8 border-t border-white/6 pt-6 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.22em] text-zinc-500">
        © {new Date().getFullYear()} Oggregator. All rights reserved.
      </p>
    </footer>
  );
}
