"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { EASE, RevealWords } from "./motion";
import { PosMock, type CartLine } from "./pos-mock";

/**
 * The hero.
 *
 * Two decisions worth naming, because the obvious alternatives are what make a page look generated:
 *
 * The headline is set in one enormous size with negative tracking and no badge above it. A pill
 * that says "Built for Pakistan" with a pulsing dot is the single most recognisable tell of a
 * template, and it buys nothing a visitor could not read in the sentence itself.
 *
 * The product appears immediately, tilted in perspective and straightening as the page scrolls —
 * the same move a hardware page makes with a device. It is the real terminal, not a screenshot, and
 * it fills itself with an order while you watch, so the first thing a visitor sees is the software
 * doing its job rather than an illustration of it.
 */

const OPENING_ORDER: CartLine[] = [
  { id: "l1", name: "Chicken Karahi", qty: 1, priceRs: 1400 },
  { id: "l2", name: "Chicken Seekh Kebab", qty: 2, priceRs: 450 },
  { id: "l3", name: "Naan", qty: 4, priceRs: 60 },
];

export function Hero() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  // Straightens and settles as you scroll past. Small numbers on purpose: a 20-degree tilt that
  // resolves is a product shot, a 60-degree one is a gimmick.
  const rotateX = useTransform(scrollYProgress, [0, 0.55], [18, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.55], [0.92, 1.02]);
  const glow = useTransform(scrollYProgress, [0, 0.6], [0.45, 0.1]);

  // The order builds itself once, shortly after load — the software working, unattended.
  const [lines, setLines] = useState<CartLine[]>(reduced ? OPENING_ORDER : []);
  const [tapped, setTapped] = useState<string | null>(null);

  useEffect(() => {
    if (reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    OPENING_ORDER.forEach((line, i) => {
      timers.push(
        setTimeout(() => {
          setTapped(line.name);
          setLines((prev) => [...prev, line]);
          setTimeout(() => setTapped(null), 450);
        }, 1400 + i * 700)
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [reduced]);

  return (
    <section
      ref={ref}
      style={{ ["--accent-ink" as string]: "rgb(167 139 250)" }}
      className="relative overflow-hidden bg-[#08070f] pt-28 pb-16 sm:pt-36 sm:pb-24"
    >
      {/* One light source, off-centre and low-opacity. Not a pair of symmetrical purple blobs. */}
      <motion.div
        aria-hidden
        style={{ opacity: reduced ? 0.25 : glow }}
        className="pointer-events-none absolute -top-[28rem] left-1/2 h-[46rem] w-[64rem] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.55),transparent_65%)] blur-2xl"
      />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <RevealWords
            text="The till that keeps selling when the internet stops."
            accentFrom={5}
            delay={0.15}
            className="text-[clamp(2.4rem,6.6vw,5rem)] leading-[0.95] font-bold tracking-[-0.035em] text-white"
          />

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.75, ease: EASE }}
          >
            <p className="mt-7 max-w-xl text-base leading-relaxed text-white/55 sm:text-lg">
              ToffeeOS runs the counter, the kitchen, the storeroom and the books. When the line
              drops, it keeps taking orders — and settles up the moment it is back.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-x-3 gap-y-4">
              <Link
                href="/signup"
                className="group inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold whitespace-nowrap text-black transition-transform duration-200 hover:scale-[1.03] active:scale-[0.99]"
              >
                Start free trial
                <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#outage"
                className="inline-flex h-11 items-center rounded-full border border-white/15 px-6 text-sm font-medium text-white/80 transition-colors hover:border-white/30 hover:text-white"
              >
                Watch it survive an outage
              </a>
            </div>
          </motion.div>
        </div>

        {/* the product */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.95, ease: EASE }}
          className="mt-16 sm:mt-20"
          style={{ perspective: 1400 }}
        >
          <motion.div
            style={reduced ? undefined : { rotateX, scale, transformOrigin: "50% 0%" }}
            className="mx-auto max-w-4xl"
          >
            <PosMock lines={lines} activeItem={tapped} connection="online" />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
