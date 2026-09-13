"use client";

import { AnimatePresence, motion } from "motion/react";

/**
 * The POS, rendered in the page.
 *
 * Rebuilt light-bodied with dark chrome, because that is what the product actually looks like — it
 * uses bg-card and bg-background throughout with only the header bar in navy. The earlier all-dark
 * version was a nicer fit for a dark landing page and a misrepresentation of the software, which is
 * the wrong way round: the page should follow the product.
 *
 * Still a real element rather than a screenshot. It stays sharp at any size, costs a few kilobytes,
 * and — the reason that matters — can be driven by scroll position, which is what lets the outage
 * section show the till working rather than assert that it does.
 *
 * Menu, prices and tax rates are the seeded demo tenant's.
 */

export type CartLine = { id: string; name: string; qty: number; priceRs: number };
export type Connection = "online" | "offline" | "syncing";

const CATEGORIES = ["Starters", "BBQ", "Karahi", "Rice & Biryani", "Bread"];

const MENU = [
  { name: "Chicken Seekh Kebab", priceRs: 450 },
  { name: "Beef Chapli Kebab", priceRs: 480 },
  { name: "Chicken Malai Boti", priceRs: 650 },
  { name: "Chicken Tikka", priceRs: 600 },
  { name: "Beef Bihari Boti", priceRs: 700 },
  { name: "Mutton Chops", priceRs: 950 },
];

/** Cash is 16% under Punjab PRA, card and digital 8% — the seeded rates, not invented ones. */
export const CASH_RATE = 0.16;
export const CARD_RATE = 0.08;

function rs(n: number) {
  return new Intl.NumberFormat("en-PK").format(Math.round(n));
}

export function cartTotals(lines: CartLine[], rate: number) {
  const subtotal = lines.reduce((a, l) => a + l.priceRs * l.qty, 0);
  const tax = Math.round(subtotal * rate);
  return { subtotal, tax, total: subtotal + tax };
}

const STATUS: Record<Connection, { label: string; bar: string; dot: string }> = {
  online: { label: "Online — all orders synced", bar: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  offline: { label: "Offline — orders are being saved on this device", bar: "bg-amber-50 text-amber-900", dot: "bg-amber-500" },
  syncing: { label: "Back online — syncing", bar: "bg-violet-50 text-violet-900", dot: "bg-violet-500" },
};

export function PosMock({
  lines,
  connection = "online",
  queued = 0,
  rate = CASH_RATE,
  activeItem,
  className = "",
}: {
  lines: CartLine[];
  connection?: Connection;
  queued?: number;
  rate?: number;
  activeItem?: string | null;
  className?: string;
}) {
  const { subtotal, tax, total } = cartTotals(lines, rate);
  const s = STATUS[connection];

  return (
    <div
      className={`overflow-hidden rounded-lg bg-white shadow-[0_1px_0_rgba(0,0,0,0.04),0_18px_50px_-18px_rgba(24,22,38,0.30)] ring-1 ring-black/[0.07] ${className}`}
    >
      {/* navy chrome, as in the product */}
      <div className="flex items-center gap-2.5 bg-[#1c1930] px-3.5 py-2.5">
        <span className="grid size-5 place-items-center rounded bg-violet-600 text-[10px] font-bold text-white">T</span>
        <span className="text-[11px] font-semibold text-white/90">ToffeeOS</span>
        <span className="hidden text-[10px] text-white/35 sm:inline">Gulshan-e-Iqbal · Main Branch</span>
        <span className="ml-auto text-[10px] text-white/35">Ahmed Raza</span>
      </div>

      <div className={`flex items-center gap-2 px-3.5 py-2 text-[11px] font-medium transition-colors duration-500 ${s.bar}`}>
        <span className="relative flex size-1.5 shrink-0">
          {connection !== "online" && (
            <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${s.dot}`} />
          )}
          <span className={`relative inline-flex size-1.5 rounded-full ${s.dot}`} />
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={connection} initial={{ y: 4 }} animate={{ y: 0 }} exit={{ y: -4 }} transition={{ duration: 0.3 }} className="truncate">
            {s.label}
          </motion.span>
        </AnimatePresence>
        {queued > 0 && (
          <span className="ml-auto shrink-0 rounded-sm bg-black/8 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
            {queued} queued
          </span>
        )}
      </div>

      <div className="grid sm:grid-cols-[1.3fr_1fr]">
        {/* menu */}
        <div className="hidden border-r border-zinc-200/80 bg-zinc-50/60 p-3.5 sm:block">
          <div className="mb-3 flex flex-wrap gap-1">
            {CATEGORIES.map((c, i) => (
              <span
                key={c}
                className={`rounded px-2 py-0.5 text-[10px] font-medium ${i === 1 ? "bg-[#1c1930] text-white" : "text-zinc-500"}`}
              >
                {c}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {MENU.map((m) => (
              <motion.div
                key={m.name}
                animate={activeItem === m.name ? { scale: [1, 0.95, 1] } : {}}
                transition={{ duration: 0.4 }}
                className="rounded border border-zinc-200 bg-white px-2 py-1.5"
              >
                <p className="truncate text-[10px] leading-tight text-zinc-700">{m.name}</p>
                <p className="mt-0.5 font-mono text-[10px] font-semibold text-zinc-900 tabular-nums">{m.priceRs}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* order */}
        <div className="flex flex-col bg-white">
          <div className="flex items-center gap-1.5 border-b border-zinc-200/80 px-3.5 py-2">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">Dine-in</span>
            <span className="text-[10px] text-zinc-400">Table 7</span>
          </div>

          <div className="min-h-[104px] flex-1 space-y-1 p-3.5 sm:min-h-[132px]">
            <AnimatePresence initial={false}>
              {lines.map((l) => (
                <motion.div
                  key={l.id}
                  layout
                  initial={{ x: 10 }}
                  animate={{ x: 0 }}
                  exit={{ x: -10 }}
                  transition={{ duration: 0.35 }}
                  className="tos-leader text-[11px]"
                  style={{ ["--rule" as string]: "rgb(212 212 216)" }}
                >
                  <span className="text-zinc-700">
                    <span className="font-mono text-zinc-400 tabular-nums">{l.qty}</span> {l.name}
                  </span>
                  <span className="font-mono font-medium text-zinc-900">{rs(l.priceRs * l.qty)}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {lines.length === 0 && <p className="pt-5 text-center text-[11px] text-zinc-300">Tap items to add them.</p>}
          </div>

          <div className="space-y-1 border-t border-zinc-200/80 px-3.5 py-3 text-[11px]">
            <div className="tos-leader text-zinc-500" style={{ ["--rule" as string]: "rgb(228 228 231)" }}>
              <span>Subtotal</span>
              <span className="font-mono">{rs(subtotal)}</span>
            </div>
            <div className="tos-leader text-zinc-500" style={{ ["--rule" as string]: "rgb(228 228 231)" }}>
              <span>Tax {Math.round(rate * 100)}%</span>
              <span className="font-mono">{rs(tax)}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-dashed border-zinc-300 pt-2">
              <span className="text-[9px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">Total</span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={total}
                  initial={{ y: 5 }}
                  animate={{ y: 0 }}
                  exit={{ y: -5 }}
                  transition={{ duration: 0.25 }}
                  className="font-mono text-[15px] font-bold text-zinc-900 tabular-nums"
                >
                  Rs {rs(total)}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="flex gap-1.5 pt-2">
              <span className="flex-1 rounded border border-zinc-300 py-1.5 text-center text-[10px] font-medium text-zinc-600">
                Send to Kitchen
              </span>
              <span className="flex-1 rounded bg-emerald-600 py-1.5 text-center text-[10px] font-semibold text-white">
                Take Payment
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
