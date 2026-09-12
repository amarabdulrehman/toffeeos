"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Enter, RevealWords } from "./motion";
import { PosMock, type CartLine } from "./pos-mock";

/**
 * The hero.
 *
 * The headline, the paragraph and the buttons animate in with CSS (see .tos-enter), not with
 * motion. That is not a stylistic preference — a JS-gated opacity:0 left this hero blank in an
 * unfocused tab, because requestAnimationFrame is throttled there and the animation that was
 * supposed to reveal the text never ran. CSS cannot fail that way.
 *
 * motion is kept for the one thing here that genuinely needs scroll position: the terminal
 * straightening out of perspective. If that never runs, the terminal simply sits flat and readable,
 * because it is never hidden to begin with.
 *
 * No badge above the headline. A pill reading "Built for Pakistan" with a pulsing dot is the single
 * most recognisable tell of a template, and it says nothing the sentence below does not.
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

  // Small numbers on purpose: an 18-degree tilt that resolves is a product shot, a 60-degree one is
  // a gimmick.
  const rotateX = useTransform(scrollYProgress, [0, 0.55], [18, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.55], [0.94, 1.02]);

  /**
   * The order builds itself shortly after load — the software working, unattended.
   *
   * A count rather than a list, so the server renders the *finished* cart and the replay is a pure
   * function of it: a visitor whose JS is slow or throttled sees a complete order rather than an
   * empty till, which is the more honest still frame anyway. Every update is scheduled rather than
   * set synchronously in the effect body, which would cascade a render on mount.
   */
  const [revealed, setRevealed] = useState(OPENING_ORDER.length);
  const [tapped, setTapped] = useState<string | null>(null);

  useEffect(() => {
    if (reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setRevealed(0), 0));
    OPENING_ORDER.forEach((line, i) => {
      timers.push(
        setTimeout(() => {
          setTapped(line.name);
          setRevealed(i + 1);
          timers.push(setTimeout(() => setTapped(null), 450));
        }, 900 + i * 650)
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [reduced]);

  const lines = OPENING_ORDER.slice(0, revealed);

  return (
    <section ref={ref} className="relative overflow-hidden bg-[#08070f] pt-28 pb-16 sm:pt-36 sm:pb-24">
      {/* One light source, off-centre. Not a pair of symmetrical purple blobs. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[28rem] left-1/2 h-[46rem] w-[64rem] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.5),transparent_65%)] blur-2xl"
      />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <RevealWords
            text="The till that keeps selling when the internet stops."
            accentFrom={5}
            accentClassName="text-violet-400"
            delay={0.1}
            className="text-[clamp(2.4rem,6.6vw,5rem)] leading-[0.95] font-bold tracking-[-0.035em] text-white"
          />

          <Enter delay={0.62}>
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
          </Enter>
        </div>

        {/* The product. Visible from the first paint; motion only tilts it. */}
        <Enter delay={0.8} className="mt-16 sm:mt-20">
          <div style={{ perspective: 1400 }}>
            <motion.div
              style={reduced ? undefined : { rotateX, scale, transformOrigin: "50% 0%" }}
              className="mx-auto max-w-4xl"
            >
              <PosMock lines={lines} activeItem={tapped} connection="online" />
            </motion.div>
          </div>
        </Enter>
      </div>
    </section>
  );
}
