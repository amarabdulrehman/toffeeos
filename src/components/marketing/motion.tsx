"use client";

import { useRef, type ReactNode } from "react";
import { motion, useInView, useReducedMotion, type Variants } from "motion/react";

/**
 * The marketing site's motion vocabulary, in one place so every section moves the same way.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Nothing bounces. Every transition uses the same expo-out curve, which decelerates hard and
 *    settles without overshoot. Springy, elastic motion is what makes a page feel like a template;
 *    restraint is what makes it feel expensive.
 *
 * 2. Reduced motion is honoured everywhere, not as an afterthought. `useReducedMotion()` reads the
 *    OS setting, and when it is on, elements appear at their final state instead of animating. A
 *    visitor who gets motion sickness from parallax should still see a finished page, not a blank
 *    one — which is what happens when a reveal animation is simply skipped without also dropping
 *    its initial opacity: 0.
 */

/** Expo-out. Fast start, long settle, no overshoot. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Distances are small on purpose — a 24px rise reads as considered, an 80px one as a slideshow. */
const RISE = 24;

export function Reveal({
  children,
  delay = 0,
  y = RISE,
  className,
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  // -12% bottom margin so the reveal fires when the element is genuinely in view rather than the
  // instant its first pixel crosses the fold, which reads as jumpy while scrolling fast.
  const inView = useInView(ref, { once, margin: "0px 0px -12% 0px" });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduced ? false : { opacity: 0, y }}
      animate={inView || reduced ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Headline reveal, word by word.
 *
 * Split on words rather than characters: character-by-character reveals are a signature of the
 * generated-landing-page look, and they make a long headline read as a slot machine. Words keep it
 * legible while still giving the line a sense of being written into place.
 */
export function RevealWords({
  text,
  className,
  wordClassName,
  delay = 0,
  accentFrom,
}: {
  text: string;
  className?: string;
  wordClassName?: string;
  delay?: number;
  /** Index from which the remaining words take the accent colour. */
  accentFrom?: number;
}) {
  const reduced = useReducedMotion();
  const words = text.split(" ");

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.055, delayChildren: delay } },
  };
  const word: Variants = {
    hidden: reduced ? { opacity: 1 } : { opacity: 0, y: "0.5em" },
    show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE } },
  };

  return (
    <motion.h1 variants={container} initial="hidden" animate="show" className={className}>
      {words.map((w, i) => (
        // The wrapper clips the rising word so it emerges from the line above rather than floating
        // in from nowhere — the detail that makes a headline feel typeset instead of animated.
        <span key={`${w}-${i}`} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span
            variants={word}
            className={`inline-block ${accentFrom !== undefined && i >= accentFrom ? "text-[var(--accent-ink)]" : ""} ${wordClassName ?? ""}`}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </motion.h1>
  );
}

/** A quiet label that sits above a headline. Used instead of the pill-shaped badge every SaaS
 * template opens with. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[0.6875rem] font-medium tracking-[0.22em] uppercase ${className}`}>{children}</p>
  );
}
