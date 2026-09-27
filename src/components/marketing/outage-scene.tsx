"use client";

import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, useReducedMotion, type MotionValue } from "motion/react";
import { PosMock, type CartLine, type Connection } from "./pos-mock";

/**
 * The outage, told as a scene you scroll through.
 *
 * This is the one section a competitor cannot lift, because it is not a layout — it is the
 * product's claim, performed. Every restaurant system says it is reliable. This one cuts its own
 * connection in front of you and keeps taking orders.
 *
 * ── On smoothness ──────────────────────────────────────────────────────────
 * The first version switched phases on a rounded scroll position and remounted the text each time,
 * so the centrepiece of the page moved in five hard steps. Correct, and it read as cheap.
 *
 * Every phase is now mounted at once and crossfaded from a *continuous* scroll value, with the
 * ranges overlapping so one moment is always dissolving into the next. Nothing remounts, nothing
 * rounds, and React renders only when the terminal's discrete state genuinely changes — five times
 * across the whole section rather than on every frame.
 *
 * The scroll value is fed through a spring first. Raw scroll arrives in wheel-sized jumps; a spring
 * turns that staircase into a ramp, which is what the crossfades and the queue counter ride on.
 */

const BASE: CartLine[] = [
  { id: "a", name: "Chicken Karahi", qty: 1, priceRs: 1400 },
  { id: "b", name: "Chicken Seekh Kebab", qty: 2, priceRs: 450 },
  { id: "c", name: "Naan", qty: 4, priceRs: 60 },
];
const PLUS: CartLine[] = [...BASE, { id: "d", name: "Mutton Chops", qty: 1, priceRs: 950 }];

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
    body: "Orders carry on. The POS prices each one on the device — tax, service charge, rounding — so the cashier always knows what to charge. Every order is saved the instant it is punched.",
    connection: "offline",
    lines: PLUS,
    queued: 6,
  },
  {
    eyebrow: "9:12 pm",
    title: "It comes back.",
    body: "The moment there is a signal, the queue starts emptying. Each order carries a key that lets the server recognise it, so a retry can never turn one order into two.",
    connection: "syncing",
    lines: PLUS,
    queued: 3,
  },
  {
    eyebrow: "9:12 pm",
    title: "Nothing was lost.",
    body: "Thirty-one minutes of service, every rupee of it in tonight's report. The staff never saw an error. Most of them never noticed.",
    connection: "online",
    lines: PLUS,
    queued: 0,
  },
];

const N = PHASES.length;

export function OutageScene() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });

  // The ramp everything else rides on. Low stiffness and near-critical damping: this should trail
  // the scroll by a beat and settle without ringing, not chase it.
  const p = useSpring(scrollYProgress, { stiffness: 70, damping: 22, restDelta: 0.0008 });

  // The terminal's state is genuinely discrete — a connection is up or down. Only this rounds, and
  // only this causes a React render.
  const [i, setI] = useState(0);
  useMotionValueEvent(p, "change", (v) => {
    const next = Math.min(N - 1, Math.max(0, Math.round(v * (N - 1))));
    setI((cur) => (cur === next ? cur : next));
  });

  if (reduced) return <OutageStatic />;

  const phase = PHASES[i];

  return (
    <section
      id="outage"
      ref={ref}
      className="tos-grain relative scroll-mt-0 bg-[color:var(--night)]"
      style={{ height: `${N * 95}vh` }}
    >
      {/*
        Without JavaScript the crossfade never runs, so only the opening moment is visible and the
        rest of a 475vh section is empty scrolling. This collapses it back into the same plain
        stacked list the reduced-motion path renders. `!important` because the opacity and transform
        are inline styles written by the animation, which a stylesheet cannot otherwise outrank.
      */}
      <noscript>
        <style>{`
          #outage { height: auto !important; }
          #outage .sticky { position: static !important; min-height: 0 !important; }
          #outage [data-phase] {
            position: static !important;
            opacity: 1 !important;
            filter: none !important;
            transform: none !important;
            margin-bottom: 3.5rem;
          }
        `}</style>
      </noscript>
      <div className="sticky top-0 flex min-h-svh items-center overflow-hidden py-16">
        <Glow progress={p} />

        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1fr] lg:gap-16">
          <div className="lg:pr-4">
            {/* All five stacked and crossfaded — nothing mounts or unmounts mid-scroll. */}
            <div className="relative min-h-[16rem] sm:min-h-[15rem]">
              {PHASES.map((ph, n) => (
                <PhaseText key={ph.title} phase={ph} index={n} progress={p} />
              ))}
            </div>
            <Progress progress={p} />
          </div>

          <PosMock lines={phase.lines} connection={phase.connection} queued={phase.queued} className="w-full" />
        </div>
      </div>
    </section>
  );
}

/**
 * One moment of the story.
 *
 * Its window is centred on the phase and deliberately wider than its share of the scroll, so
 * neighbouring phases overlap and the text is always mid-dissolve rather than waiting its turn.
 */
function PhaseText({ phase, index, progress }: { phase: Phase; index: number; progress: MotionValue<number> }) {
  const at = index / (N - 1);
  const span = 1 / (N - 1);

  /**
   * The fade window is exactly one phase-width to each side, so adjacent phases hand over at 50/50
   * and their opacities always sum to about one.
   *
   * This was 0.62 of a width, which left a dead zone halfway between every pair: measured, the
   * brightest phase at the faintest point was 19% opacity. Scrolling slowly through that reads as
   * an empty section rather than a transition — it is how this looked on a phone, and it is why the
   * number matters more than it appears to.
   */
  const a = at - span;
  const b = at + span;

  const opacity = useTransform(progress, [a, at, b], [0, 1, 0]);
  const y = useTransform(progress, [a, at, b], [22, 0, -22]);
  // Blur on the way in and out: a couple of pixels is invisible as an effect but reads as depth of
  // field, which is what stops a crossfade looking like two flat layers sliding past each other.
  const blur = useTransform(progress, [a, at, b], [2.4, 0, 2.4]);
  const filter = useTransform(blur, (v) => `blur(${v.toFixed(2)}px)`);

  return (
    <motion.div
      data-phase
      style={{ opacity, y, filter }}
      className={index === 0 ? "relative" : "absolute inset-x-0 top-0"}
      aria-hidden={index !== 0 || undefined}
    >
      <p className="tos-folio text-white/40">{phase.eyebrow}</p>
      <h2 className="font-display mt-4 text-[clamp(2.1rem,4.8vw,3.4rem)] leading-[1.02] tracking-[-0.015em] text-[color:var(--paper)]">
        {phase.title}
      </h2>
      <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/50">{phase.body}</p>
    </motion.div>
  );
}

/** The light warms and cools across the scene, interpolated rather than switched. */
function Glow({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0, 0.12, 0.5, 0.85, 1], [0.35, 0.75, 0.75, 0.6, 0.35]);
  const hue = useTransform(progress, [0, 0.25, 0.55, 0.78, 1], [155, 42, 42, 285, 155]);
  const background = useTransform(
    hue,
    (h) => `radial-gradient(ellipse at center, oklch(0.62 0.17 ${h.toFixed(1)} / 0.30), transparent 62%)`
  );
  return (
    <motion.div
      aria-hidden
      style={{ background, opacity }}
      className="pointer-events-none absolute top-1/2 left-1/2 h-[42rem] w-[62rem] -translate-x-1/2 -translate-y-1/2 blur-2xl"
    />
  );
}

/** Reading position through the scene, as a row of ticks that fill continuously. */
function Progress({ progress }: { progress: MotionValue<number> }) {
  return (
    <div className="mt-8 flex gap-1.5" aria-hidden>
      {PHASES.map((_, n) => (
        <Tick key={n} index={n} progress={progress} />
      ))}
    </div>
  );
}

function Tick({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const at = index / (N - 1);
  const span = 1 / (N - 1);
  const fill = useTransform(progress, [at - span * 0.5, at], [0, 1]);
  const width = useTransform(progress, [at - span * 0.5, at, at + span * 0.5], [14, 30, 14]);
  return (
    <motion.span style={{ width }} className="relative h-[3px] overflow-hidden rounded-full bg-white/14">
      <motion.span style={{ scaleX: fill, transformOrigin: "0% 50%" }} className="absolute inset-0 rounded-full bg-white/85" />
    </motion.span>
  );
}

/** The reduced-motion path: the same five moments, stacked, nothing pinned or scrubbed. */
function OutageStatic() {
  return (
    <section id="outage" className="scroll-mt-20 bg-[color:var(--night)] py-24">
      <div className="mx-auto max-w-3xl space-y-14 px-5 sm:px-8">
        {PHASES.map((p, n) => (
          <div key={p.title} className="grid gap-6 sm:grid-cols-[1fr_1.1fr] sm:items-center">
            <div>
              <p className="tos-folio text-white/40">{p.eyebrow}</p>
              <h2 className="font-display mt-3 text-3xl tracking-[-0.015em] text-[color:var(--paper)]">{p.title}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-white/50">{p.body}</p>
            </div>
            {n === 2 && <PosMock lines={p.lines} connection={p.connection} queued={p.queued} />}
          </div>
        ))}
      </div>
    </section>
  );
}
