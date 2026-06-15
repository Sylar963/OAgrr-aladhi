"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
} as const;

const item = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
} as const;

// Rendered hidden from SSR and revealed in view — no mounted-gate, so the old
// post-hydration disappear/reappear flash is gone. All wrapped sections sit
// below the 240svh hero, so nothing visible ever starts hidden.
export function SectionReveal({ children }: Readonly<{ children: ReactNode }>) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
      variants={container}
    >
      <motion.div variants={item}>{children}</motion.div>
    </motion.div>
  );
}
