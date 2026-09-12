"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { Enter, RevealWords } from "./motion";
import { PosMock, type CartLine } from "./pos-mock";

/**
 * The hero.
 *
 * Set like the opening spread of a magazine rather than a product page: the headline runs to a
 * measure and breaks where a person would break it, the supporting text sits in a narrow column
 * beside it instead of centred beneath it, and the terminal is placed off-axis and allowed to run
 * past the right edge of the grid the way a photograph would. Symmetry is what makes a page look
 * automatic — almost nothing here is centred.
 *
 * The headline is a display serif, which is the fastest signal a reader gets that a person chose
 * something. Every generated landing page is a geometric sans on a dark gradient.
 *
 * Entrances are CSS (.tos-enter), never JS-gated opacity: a throttled requestAnimationFrame in an
 * unfocused tab left an earlier version of this hero blank. motion drives only the terminal's tilt,
 * on top of an element that is visible from the first paint.
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
  const rotateY = useTransform(scrollYProgress, [0, 0.6], [-9, 0]);
  const rotateX = useTransform(scrollYProgress, [0, 0.6], [7, 0]);

  /**
   * The tilt is a large-screen flourish only. At phone width the perspective skew crowds the cart
   * lines against the edge and clips them — a product shot that makes the product harder to read is
   * worse than no product shot.
   */
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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
        }, 1000 + i * 700)
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [reduced]);

  const lines = OPENING_ORDER.slice(0, revealed);

  return (
    <section ref={ref} className="tos-grain relative overflow-hidden pt-28 sm:pt-36">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid items-end gap-y-9 lg:grid-cols-12 lg:gap-x-10">
          <div className="lg:col-span-7">
            <p className="tos-folio">01 — THE PROBLEM</p>

            <RevealWords
              text="The till that keeps selling when the internet stops."
              accentFrom={5}
              accentClassName="italic text-[color:var(--accent)]"
              delay={0.1}
              className="font-display mt-6 text-[clamp(2.9rem,7.4vw,5.4rem)] leading-[0.94] tracking-[-0.02em] text-[color:var(--ink)]"
            />
          </div>

          <Enter delay={0.6} className="lg:col-span-5 lg:pb-3">
            <p className="max-w-sm text-[15px] leading-[1.65] text-[color:var(--ink-2)]">
              ToffeeOS runs the counter, the kitchen, the storeroom and the books. When the line
              drops — and in most kitchens here it does — it keeps taking orders, and settles up the
              moment it is back.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link
                href="/signup"
                className="group inline-flex h-11 items-center gap-2 rounded-sm bg-[color:var(--ink)] px-6 text-[13px] font-semibold whitespace-nowrap text-[color:var(--paper)] transition-colors hover:bg-[color:var(--accent)]"
              >
                Start free trial
                <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
              <a
                href="#outage"
                className="border-b border-[color:var(--rule)] pb-0.5 text-[13px] font-medium text-[color:var(--ink-2)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
              >
                Watch it survive an outage
              </a>
            </div>
          </Enter>
        </div>

        {/* The terminal: off-axis, running past the grid's right edge like a placed photograph. */}
        <Enter delay={0.78} className="mt-14 sm:mt-16">
          <div style={{ perspective: 1600 }} className="lg:pl-[12%]">
            <motion.div
              style={reduced || !wide ? undefined : { rotateY, rotateX, transformOrigin: "20% 50%" }}
              className="lg:-mr-20 xl:-mr-32"
            >
              <PosMock lines={lines} activeItem={tapped} connection="online" />
            </motion.div>
          </div>
        </Enter>
      </div>

      {/* the paper ends here, torn against the dark section below */}
      <div aria-hidden className="tos-torn mt-16 h-3 bg-[color:var(--night)] sm:mt-24" />
    </section>
  );
}
