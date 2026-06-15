import "@testing-library/jest-dom/vitest";

// jsdom does not ship IntersectionObserver; framer-motion's whileInView needs it.
// Provide a minimal stub so motion.div renders children without throwing.
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
}
