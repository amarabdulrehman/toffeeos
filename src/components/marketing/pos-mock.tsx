"use client";

import { AnimatePresence, motion } from "motion/react";
import { EASE } from "./motion";

/**
 * The POS, rendered in the page.
 *
 * Deliberately not a screenshot. A real element stays sharp on any display, resizes with the
 * layout, costs a few kilobytes instead of a few hundred, and — the reason that actually matters —
 * can be driven by scroll position, which is what lets the outage section below show the till
 * working rather than assert that it does.
 *
 * The menu, the prices and the tax rates are the ones from the seeded demo tenant, so what a
 * visitor sees here is what they get when they sign up, down to the 16% cash rate.
 */

export type CartLine = { id: string; name: string; qty: number; priceRs: number };
export type Connection = "online" | "offline" | "syncing";

const CATEGORIES = ["Starters", "BBQ", "Karahi", "Rice & Biryani", "Bread", "Beverages"];

const MENU = [
  { name: "Chicken Seekh Kebab", priceRs: 450 },
  { name: "Beef Chapli Kebab", priceRs: 480 },
  { name: "Chicken Malai Boti", priceRs: 650 },
  { name: "Chicken Tikka", priceRs: 600 },
  { name: "Beef Bihari Boti", priceRs: 700 },
  { name: "Mutton Chops", priceRs: 950 },
  { name: "Chicken Karahi", priceRs: 1400 },
  { name: "Chicken Biryani", priceRs: 380 },
  { name: "Fish Pakora", priceRs: 500 },
];

/** Cash is 16% under Punjab PRA, card and digital 8% — the seeded rates, not invented ones. */
export const CASH_RATE = 0.16;
export const CARD_RATE = 0.08;

function rs(n: number) {
  return `Rs ${new Intl.NumberFormat("en-PK").format(Math.round(n))}`;
}

export function cartTotals(lines: CartLine[], rate: number) {
  const subtotal = lines.reduce((a, l) => a + l.priceRs * l.qty, 0);
  const tax = Math.round(subtotal * rate);
  return { subtotal, tax, total: subtotal + tax };
}

/* ── status strip ───────────────────────────────────────────────────────── */

const STATUS: Record<Connection, { label: string; dot: string; text: string; bg: string }> = {
  online: {
    label: "Online — all orders synced",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    bg: "bg-emerald-500/10",
  },
  offline: {
    label: "Offline — orders are being saved on this device",
    dot: "bg-amber-400",
    text: "text-amber-200",
    bg: "bg-amber-500/15",
  },
  syncing: {
    label: "Back online — syncing",
    dot: "bg-violet-300",
    text: "text-violet-200",
    bg: "bg-violet-500/15",
  },
};

function StatusStrip({ connection, queued }: { connection: Connection; queued: number }) {
  const s = STATUS[connection];
  return (
    <div className={`flex items-center gap-2.5 px-4 py-2.5 text-[11px] font-medium transition-colors duration-500 sm:text-xs ${s.bg} ${s.text}`}>
      <span className="relative flex size-1.5 shrink-0">
        {connection !== "online" && (
          <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${s.dot}`} />
        )}
        <span className={`relative inline-flex size-1.5 rounded-full ${s.dot}`} />
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={connection}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="truncate"
        >
          {s.label}
        </motion.span>
      </AnimatePresence>
      {queued > 0 && (
        <span className="ml-auto shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] tabular-nums">
          {queued} queued
        </span>
      )}
    </div>
  );
}

/* ── the terminal ───────────────────────────────────────────────────────── */

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
  /** Name of the menu tile to show as just-tapped. */
  activeItem?: string | null;
  className?: string;
}) {
  const { subtotal, tax, total } = cartTotals(lines, rate);

  return (
    <div
      className={`overflow-hidden rounded-xl border border-white/10 bg-[#0f0e17] shadow-2xl ring-1 ring-black/40 sm:rounded-2xl ${className}`}
    >
      {/* chrome */}
      <div className="flex items-center gap-2.5 border-b border-white/10 bg-[#17162a] px-3 py-2.5 sm:px-4">
        <span className="grid size-6 place-items-center rounded-md bg-violet-600 text-[11px] font-bold text-white">
          T
        </span>
        <span className="text-xs font-semibold text-white/90">ToffeeOS</span>
        <span className="hidden text-[11px] text-white/40 sm:inline">Gulshan-e-Iqbal · Main Branch</span>
        <span className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="grid size-5 place-items-center rounded-full bg-white/10 text-[9px] font-semibold text-white/70">
            AR
          </span>
          <span className="text-[11px] text-white/50">Ahmed Raza</span>
        </span>
      </div>

      <StatusStrip connection={connection} queued={queued} />

      <div className="grid sm:grid-cols-[1.35fr_1fr]">
        {/* menu — hidden on the narrowest screens so the order panel, which carries the story,
            keeps a readable size instead of both halves being squeezed */}
        <div className="hidden border-r border-white/10 p-3 sm:block sm:p-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {CATEGORIES.map((c, i) => (
              <span
                key={c}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                  i === 1 ? "bg-violet-600 text-white" : "bg-white/5 text-white/45"
                }`}
              >
                {c}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MENU.map((m) => {
              const active = activeItem === m.name;
              return (
                <motion.div
                  key={m.name}
                  animate={
                    active
                      ? { scale: [1, 0.94, 1], borderColor: ["rgba(255,255,255,0.08)", "rgb(124,58,237)", "rgba(255,255,255,0.08)"] }
                      : {}
                  }
                  transition={{ duration: 0.45, ease: EASE }}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2"
                >
                  <p className="truncate text-[10px] leading-tight font-medium text-white/75">{m.name}</p>
                  <p className="mt-1.5 text-[11px] font-bold text-white tabular-nums">Rs {m.priceRs}</p>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* order panel */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5 sm:px-4">
            <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] font-medium text-white/70">Dine-in</span>
            <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-white/45">Table 7</span>
          </div>

          <div className="min-h-[132px] flex-1 space-y-1.5 p-3 sm:min-h-[168px] sm:p-4">
            <AnimatePresence initial={false}>
              {lines.map((l) => (
                <motion.div
                  key={l.id}
                  layout
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <span className="grid size-4 shrink-0 place-items-center rounded bg-white/10 text-[9px] font-semibold text-white/70 tabular-nums">
                    {l.qty}
                  </span>
                  <span className="truncate text-white/75">{l.name}</span>
                  <span className="ml-auto shrink-0 font-medium text-white/90 tabular-nums">
                    {rs(l.priceRs * l.qty)}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
            {lines.length === 0 && (
              <p className="pt-6 text-center text-[11px] text-white/25">Tap items to add them to the order.</p>
            )}
          </div>

          <div className="space-y-1 border-t border-white/10 bg-white/[0.02] p-3 text-[11px] sm:p-4">
            <Row label="Subtotal" value={rs(subtotal)} />
            <Row label={`Tax (${Math.round(rate * 100)}%)`} value={rs(tax)} />
            <div className="mt-2 flex items-center justify-between rounded-lg bg-violet-500/15 px-2.5 py-2">
              <span className="text-[9px] font-semibold tracking-wider text-white/50 uppercase">Total</span>
              {/* keyed on the value so each change counts up rather than swapping silently */}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={total}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="text-sm font-bold text-violet-200 tabular-nums"
                >
                  {rs(total)}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="flex gap-1.5 pt-1.5">
              <span className="flex-1 rounded-md bg-white/8 py-1.5 text-center text-[10px] font-medium text-white/70">
                Send to Kitchen
              </span>
              <span className="flex-1 rounded-md bg-emerald-600 py-1.5 text-center text-[10px] font-semibold text-white">
                Take Payment
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-white/40">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
