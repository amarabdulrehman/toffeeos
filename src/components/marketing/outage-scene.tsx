"use client";

import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useReducedMotion } from "motion/react";
import { EASE, Eyebrow } from "./motion";
import { PosMock, type CartLine, type Connection } from "./pos-mock";

/**
 * The outage, told as a scene you scroll through.
 *
 * This is the one section on the page that a competitor cannot lift, because it is not a layout —
 * it is the product's actual claim, performed. Every restaurant system says it is reliable. This
 * one cuts its own connection in front of you and keeps taking orders.
 *
 * Scroll-scrubbed rather than autoplayed on purpose: the visitor controls the pace, can go back,
 * and cannot miss it by looking away. An autoplaying loop would be decoration; this is an argument.
 *
 * With reduced motion on, the whole thing degrades to a plain vertical list of the same five
 * moments — no pinning, no scrubbing, nothing that moves under the reader. The argument survives;
 * only the performance is dropped.
 */

const BASE: CartLine[] = [
  { id: "a", name: "Chicken Karahi", qty: 1, priceRs: 1400 },
  { id: "b", name: "Chicken Seekh Kebab", qty: 2, priceRs: 450 },
  { id: "c", name: "Naan", qty: 4, priceRs: 60 },
];

type Phase = {
  eyebrow: string;
  title: string;
  body: string;
  connection: Connection;
  lines: CartLine[];
  queued: number;
};

const PHASES: Phase[] = [
  {
    eyebrow: "8:40 pm · Friday",
    title: "The restaurant is full.",
    body: "Table 7 orders. It goes to the kitchen, the stock comes down, the sale lands in tonight's numbers. Ordinary.",
    connection: "online",
    lines: BASE,
    queued: 0,
  },
  {
    eyebrow: "8:41 pm",
    title: "The line drops.",
    body: "No warning. On most systems this is the moment the screen goes white and the counter stops — mid-service, with a queue at the till.",
    connection: "offline",
    lines: BASE,
    queued: 0,
  },
  {
    eyebrow: "8:41 pm — 9:12 pm",
    title: "Nobody stops.",
    body: "Orders carry on. The till prices each one on the device — tax, service charge, rounding — so the cashier always knows what to charge. Every order is saved the instant it is punched.",
    connection: "offline",
    lines: [...BASE, { id: "d", name: "Mutton Chops", qty: 1, priceRs: 950 }],
    queued: 6,
  },
  {
    eyebrow: "9:12 pm",
    title: "It comes back.",
    body: "The moment there is a signal, the queue starts emptying. Each order carries a key that lets the server recognise it, so a retry can never turn one order into two.",
    connection: "syncing",
    lines: [...BASE, { id: "d", name: "Mutton Chops", qty: 1, priceRs: 950 }],
    queued: 3,
  },
  {
    eyebrow: "9:12 pm",
    title: "Nothing was lost.",
    body: "Thirty-one minutes of service, every rupee of it in tonight's report. The staff never saw an error. Most of them never noticed.",
    connection: "online",
    lines: [...BASE, { id: "d", name: "Mutton Chops", qty: 1, priceRs: 950 }],
    queued: 0,
  },
];

export function OutageScene() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [i, setI] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    // Clamped so the last phase holds through the tail of the scroll instead of flickering at 1.
    const next = Math.min(PHASES.length - 1, Math.floor(p * PHASES.length));
    setI((cur) => (cur === next ? cur : next));
  });

  if (reduced) return <OutageStatic />;

  const phase = PHASES[i];

  return (
    <section id="outage" ref={ref} className="relative scroll-mt-0 bg-[#08070f]" style={{ height: `${PHASES.length * 90}vh` }}>
      <div className="sticky top-0 flex min-h-svh items-center overflow-hidden py-16">
        {/* the light warms and cools with the story rather than sitting static */}
        <motion.div
          aria-hidden
          animate={{
            background:
              phase.connection === "offline"
                ? "radial-gradient(ellipse at center, rgba(245,158,11,0.20), transparent 62%)"
                : phase.connection === "syncing"
                  ? "radial-gradient(ellipse at center, rgba(139,92,246,0.28), transparent 62%)"
                  : "radial-gradient(ellipse at center, rgba(16,185,129,0.16), transparent 62%)",
          }}
          transition={{ duration: 0.9, ease: EASE }}
          className="pointer-events-none absolute top-1/2 left-1/2 h-[42rem] w-[60rem] -translate-x-1/2 -translate-y-1/2 blur-2xl"
        />

        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1fr] lg:gap-16">
          {/* narrative */}
          <div className="lg:pr-4">
            <div className="min-h-[15rem] sm:min-h-[14rem]">
              {/* y only, never opacity: a phase whose reveal never runs must still be readable,
                  and the status bar and queue count already carry the change clearly enough. */}
              <motion.div key={i} initial={{ y: 18 }} animate={{ y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
                <Eyebrow className="text-white/35">{phase.eyebrow}</Eyebrow>
                <h2 className="mt-4 text-[clamp(1.9rem,4.4vw,3.1rem)] leading-[1.03] font-bold tracking-[-0.03em] text-white">
                  {phase.title}
                </h2>
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/55">{phase.body}</p>
              </motion.div>
            </div>

            {/* progress through the scene, as a row of ticks rather than a scrollbar */}
            <div className="mt-8 flex gap-1.5" aria-hidden>
              {PHASES.map((_, n) => (
                <motion.span
                  key={n}
                  animate={{
                    backgroundColor: n <= i ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.14)",
                    width: n === i ? 28 : 14,
                  }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="h-[3px] rounded-full"
                />
              ))}
            </div>
          </div>

          <PosMock
            lines={phase.lines}
            connection={phase.connection}
            queued={phase.queued}
            className="w-full"
          />
        </div>
      </div>
    </section>
  );
}

/** The reduced-motion path: the same five moments, stacked, nothing pinned or scrubbed. */
function OutageStatic() {
  return (
    <section id="outage" className="scroll-mt-20 bg-[#08070f] py-24">
      <div className="mx-auto max-w-3xl space-y-14 px-5 sm:px-8">
        {PHASES.map((p, n) => (
          <div key={p.title} className="grid gap-6 sm:grid-cols-[1fr_1.1fr] sm:items-center">
            <div>
              <Eyebrow className="text-white/35">{p.eyebrow}</Eyebrow>
              <h2 className="mt-3 text-2xl font-bold tracking-[-0.02em] text-white">{p.title}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-white/55">{p.body}</p>
            </div>
            {n === 2 && <PosMock lines={p.lines} connection={p.connection} queued={p.queued} />}
          </div>
        ))}
      </div>
    </section>
  );
}
