"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { EASE, Eyebrow, Reveal } from "./motion";
import { CARD_RATE, CASH_RATE } from "./pos-mock";
import { CountUp, RevealLines } from "./anim";

/**
 * Punjab PRA's split rate, shown rather than described.
 *
 * "Handles local tax correctly" is a line every competitor can also write. What nobody else does is
 * put the two rates side by side on the same bill and let you watch the total move — 16% on cash,
 * 8% on card, which is a real difference on a real order and the kind of thing an owner here
 * recognises instantly as evidence that whoever built this has actually filed a return.
 *
 * The figures are the seeded demo tenant's, not invented for the page.
 */

const BILL = [
  { name: "Chicken Karahi", qty: 1, priceRs: 1400 },
  { name: "Chicken Seekh Kebab", qty: 2, priceRs: 450 },
  { name: "Naan", qty: 4, priceRs: 60 },
];

const SUBTOTAL = BILL.reduce((a, l) => a + l.priceRs * l.qty, 0);

const METHODS = [
  { key: "CASH", label: "Cash", rate: CASH_RATE },
  { key: "CARD", label: "Card", rate: CARD_RATE },
] as const;

function rs(n: number) {
  return new Intl.NumberFormat("en-PK").format(Math.round(n));
}

const POINTS = [
  {
    k: "Paisa, not decimals",
    v: "Every amount is a whole number of paisa. Nothing drifts, so the total on the receipt is the total in the report — exactly, not nearly.",
  },
  {
    k: "Your day, not UTC",
    v: "A restaurant's day ends when it closes. Reports run on the branch's own timezone and closing time, so last night's late orders land on last night.",
  },
  {
    k: "Split bills, split correctly",
    v: "Half cash and half card on one bill means two different rates. The taxable amount is apportioned between them, not applied at whichever rate is convenient.",
  },
];

export function TaxScene() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "0px 0px -25% 0px" });
  const [idx, setIdx] = useState(0);
  const [pinned, setPinned] = useState(false);

  // Cycles gently while on screen, and stops for good the moment a visitor picks a side themselves.
  useEffect(() => {
    if (reduced || pinned || !inView) return;
    const t = setInterval(() => setIdx((n) => (n + 1) % METHODS.length), 2600);
    return () => clearInterval(t);
  }, [reduced, pinned, inView]);

  const method = METHODS[idx];
  const tax = Math.round(SUBTOTAL * method.rate);
  const total = SUBTOTAL + tax;

  return (
    <section className="border-t border-[color:var(--rule)] py-24 sm:py-32">
      <div ref={ref} className="mx-auto grid max-w-6xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-2 lg:gap-20">
        <div>
          <Reveal>
            <Eyebrow className="text-[color:var(--ink-3)]">Built here, not translated</Eyebrow>
            <RevealLines
              lines={["Cash is taxed at 16%.", "Card at 8%."]}
              accentIndex={1}
              accentClassName="italic text-[color:var(--accent)]"
              className="font-display mt-5 text-[clamp(2.1rem,4.8vw,3.5rem)] leading-[1.02] tracking-[-0.018em] text-[color:var(--ink)]"
            />
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[color:var(--ink-2)]">
              Punjab charges different rates depending on how the customer pays. Software written
              somewhere else charges one rate and leaves you to fix it at filing. Tap between them —
              it is the same bill.
            </p>
          </Reveal>

          <dl className="mt-12 space-y-7">
            {POINTS.map((p, n) => (
              <Reveal key={p.k} delay={0.08 * n}>
                <div className="border-t border-[color:var(--rule)] pt-5">
                  <dt className="text-sm font-semibold text-[color:var(--ink)]">{p.k}</dt>
                  <dd className="mt-2 max-w-md text-[14px] leading-relaxed text-[color:var(--ink-2)]">{p.v}</dd>
                </div>
              </Reveal>
            ))}
          </dl>
        </div>

        {/* the bill */}
        <Reveal delay={0.1}>
          <div className="rounded-2xl border border-[color:var(--rule)] bg-white p-6 sm:p-8">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium tracking-[0.18em] text-[color:var(--ink-3)] uppercase">Table 7</span>
              <span className="text-[11px] text-[color:var(--ink-3)]">Order #1482</span>
            </div>

            <div className="mt-6 space-y-2.5">
              {BILL.map((l) => (
                <div key={l.name} className="flex items-baseline gap-3 text-sm">
                  <span className="text-[color:var(--ink-3)] tabular-nums">{l.qty}×</span>
                  <span className="text-[color:var(--ink)]">{l.name}</span>
                  <span className="ml-auto text-[color:var(--ink-2)] tabular-nums">{rs(l.priceRs * l.qty)}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-2.5 border-t border-dashed border-[color:var(--rule)] pt-5 text-sm">
              <div className="flex justify-between text-[color:var(--ink-2)]">
                <span>Subtotal</span>
                <span className="tabular-nums">Rs {rs(SUBTOTAL)}</span>
              </div>
              <div className="flex justify-between text-[color:var(--ink-2)]">
                <span className="flex items-center gap-2">
                  Tax
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={method.key}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.28, ease: EASE }}
                      className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800 tabular-nums"
                    >
                      {Math.round(method.rate * 100)}%
                    </motion.span>
                  </AnimatePresence>
                </span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={tax}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.28, ease: EASE }}
                    className="tabular-nums"
                  >
                    Rs {rs(tax)}
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>

            <div className="mt-5 flex items-baseline justify-between border-t border-dashed border-[color:var(--rule)] pt-5">
              <span className="text-[11px] font-semibold tracking-[0.18em] text-[color:var(--ink-3)] uppercase">Total</span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={total}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.32, ease: EASE }}
                  className="font-display text-[clamp(1.9rem,3.4vw,2.5rem)] text-[color:var(--ink)] tabular-nums"
                >
                  Rs <CountUp value={total} duration={0.5} />
                </motion.span>
              </AnimatePresence>
            </div>

            {/* real buttons, so the claim is checkable rather than a loop you watch */}
            <div className="mt-7 grid grid-cols-2 gap-2" role="group" aria-label="Payment method">
              {METHODS.map((m, n) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    setIdx(n);
                    setPinned(true);
                  }}
                  aria-pressed={idx === n}
                  className={`relative h-10 rounded-lg text-[13px] font-medium transition-colors ${
                    idx === n ? "text-[color:var(--ink)]" : "text-[color:var(--ink-2)] hover:text-[color:var(--ink)]"
                  }`}
                >
                  {idx === n && (
                    <motion.span
                      layoutId="tax-method"
                      transition={{ duration: 0.35, ease: EASE }}
                      className="absolute inset-0 rounded-lg border border-[color:var(--ink)] bg-[color:var(--ink)]"
                    />
                  )}
                  <span className="relative">Paid by {m.label}</span>
                </button>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
