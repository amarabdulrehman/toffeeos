import type { ReactNode } from "react";
import { Eyebrow, Reveal } from "./motion";
import { CountUp, RevealLines, TickingTimer, TiltCard } from "./anim";

/**
 * What the software covers, as four rooms of a restaurant rather than twelve equal boxes.
 *
 * A grid of identical icon cards is the least informative way to present a feature set: it flattens
 * "prints the kitchen ticket" and "runs payroll" into the same visual weight, and it is the exact
 * shape every template ships with. Grouping by where the work happens — counter, storeroom, office,
 * customer — lets an owner find their own problem in about two seconds, and gives each group room
 * for a real piece of interface instead of a glyph.
 */

type Panel = {
  room: string;
  title: string;
  body: string;
  covers: string[];
  visual: ReactNode;
};

/* ── small, real-looking fragments of the product ───────────────────────── */

function KdsTicket() {
  return (
    <div className="w-full max-w-xs rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_14px_40px_-16px_rgba(24,22,38,0.24)]">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-bold text-zinc-900">Table 7</span>
        <TickingTimer className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800 tabular-nums" />
      </div>
      <div className="mt-3 space-y-2">
        {[
          ["1", "Chicken Karahi", true],
          ["2", "Seekh Kebab", true],
          ["4", "Naan", false],
        ].map(([q, n, done]) => (
          <div key={n as string} className="flex items-center gap-2.5 text-[12px]">
            <span className="grid size-4 place-items-center rounded bg-zinc-100 text-[9px] font-semibold text-zinc-600">
              {q as string}
            </span>
            <span className={done ? "text-zinc-300 line-through" : "text-zinc-700"}>{n as string}</span>
            {done ? (
              <span className="ml-auto text-[10px] text-emerald-600">ready</span>
            ) : (
              <span className="ml-auto size-3.5 rounded-full border border-zinc-300" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StockRows() {
  const rows: [string, number, string][] = [
    ["Chicken", 0.72, "18.4 kg"],
    ["Beef", 0.34, "6.1 kg"],
    ["Yoghurt", 0.12, "2.0 kg"],
  ];
  return (
    <div className="w-full max-w-xs space-y-3.5 rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_14px_40px_-16px_rgba(24,22,38,0.24)]">
      {rows.map(([name, pct, qty], i) => (
        <div key={name}>
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="text-zinc-700">{name}</span>
            <span className={pct < 0.2 ? "text-amber-700" : "text-zinc-400"}>{qty}</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100">
            <div
              style={{ width: `${pct * 100}%`, animationDelay: `${0.1 * i}s` }}
              className={`tos-grow-x h-full rounded-full ${pct < 0.2 ? "bg-amber-400" : "bg-[color:var(--accent)]"}`}
            />
          </div>
        </div>
      ))}
      <p className="pt-1 text-[10px] text-amber-700">Yoghurt below re-order level</p>
    </div>
  );
}

function RevenueBars() {
  const bars = [0.45, 0.62, 0.38, 0.71, 0.55, 0.88, 1];
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="w-full max-w-xs rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_14px_40px_-16px_rgba(24,22,38,0.24)]">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-zinc-400">This week</span>
        <span className="font-mono text-sm font-bold text-zinc-900 tabular-nums">
          Rs <CountUp value={412860} />
        </span>
      </div>
      <div className="mt-4 flex h-20 items-end gap-1.5">
        {bars.map((h, i) => (
          <div
            key={i}
            style={{ height: `${h * 100}%`, animationDelay: `${0.06 * i}s` }}
            className={`tos-grow-y flex-1 rounded-t-sm ${i === bars.length - 1 ? "bg-[color:var(--accent)]" : "bg-zinc-200"}`}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {days.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[9px] text-zinc-300">
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

function RiderTrack() {
  const steps = [
    ["Order placed", true],
    ["Out for delivery", true],
    ["Delivered", false],
  ] as const;
  return (
    <div className="w-full max-w-xs rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_14px_40px_-16px_rgba(24,22,38,0.24)]">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-full bg-violet-500/20 text-[10px] font-bold text-violet-200">
          FR
        </span>
        <div>
          <p className="text-[12px] font-medium text-zinc-800">Faisal · Rider</p>
          <p className="text-[10px] text-zinc-400">2 orders · DHA Phase 6</p>
        </div>
      </div>
      <div className="mt-4 space-y-0">
        {steps.map(([label, done], i) => (
          <div key={label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`size-2 rounded-full ${done ? "bg-emerald-500" : "bg-zinc-300"}`} />
              {i < steps.length - 1 && <span className="h-6 w-px bg-zinc-200" />}
            </div>
            <span className={`-mt-0.5 text-[11px] ${done ? "text-zinc-600" : "text-zinc-300"}`}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── panels ─────────────────────────────────────────────────────────────── */

const PANELS: Panel[] = [
  {
    room: "At the counter",
    title: "Take the order, feed the kitchen.",
    body: "Dine-in, takeaway and delivery on one screen. What the cashier sends appears in the kitchen immediately — no printer, no shouted ticket, no order lost between the two.",
    covers: ["Point of sale", "Kitchen display", "Tables & floor", "Menu & modifiers"],
    visual: <KdsTicket />,
  },
  {
    room: "In the storeroom",
    title: "Know what a dish actually costs you.",
    body: "Stock comes down as it is used, and a recipe tells you the margin on every plate — so the dish you think is carrying the menu can be checked rather than assumed.",
    covers: ["Inventory", "Recipe & costing", "Expenses", "Low-stock alerts"],
    visual: <StockRows />,
  },
  {
    room: "In the office",
    title: "One branch or six, same numbers.",
    body: "Sales, items, staff, discounts and voids, profit and loss — each branch with its own prices, availability, tax setup and staff, all rolling up to one view you can actually act on.",
    covers: ["Full report suite", "Multi-branch", "Staff & roles", "Payroll & HR"],
    visual: <RevenueBars />,
  },
  {
    room: "Out the door",
    title: "Follow the order past the counter.",
    // No WhatsApp here, and no "tracked": messages wait on Meta's approval and have never been
    // delivered, and riders aren't located on a map. And a photo, not "a photo or a code": the rider
    // app accepts a handoff code, but nothing ever gives the customer that code, so in practice every
    // delivery is proved by the photo. WhatsApp comes back the day a real message is delivered.
    body: "Riders assigned to each order, a QR menu customers order from directly, and every delivery proved with a photo.",
    covers: ["Delivery & riders", "Online ordering", "Customers"],
    visual: <RiderTrack />,
  },
];

export function Capabilities() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-[color:var(--rule)] bg-transparent py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <Eyebrow className="text-zinc-400">Everything it runs</Eyebrow>
          <RevealLines
            lines={["One system instead of", "five apps and a notebook."]}
            className="font-display mt-5 text-[clamp(2.1rem,4.8vw,3.5rem)] leading-[1.02] tracking-[-0.018em] text-[color:var(--ink)]"
          />
        </Reveal>

        <div className="mt-20 space-y-24 sm:space-y-32">
          {PANELS.map((p, i) => (
            <div
              key={p.room}
              className={`grid items-center gap-10 lg:grid-cols-2 lg:gap-20 ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}
            >
              <Reveal>
                <Eyebrow className="text-[color:var(--ink-3)]">{p.room}</Eyebrow>
                <RevealLines
                  as="h3"
                  lines={[p.title]}
                  className="font-display mt-4 text-[clamp(1.7rem,3.2vw,2.35rem)] leading-[1.08] tracking-[-0.015em] text-[color:var(--ink)]"
                />
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[color:var(--ink-2)]">{p.body}</p>
                <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5">
                  {p.covers.map((c) => (
                    <li key={c} className="text-[13px] text-zinc-400">
                      {c}
                    </li>
                  ))}
                </ul>
              </Reveal>

              <Reveal className="flex justify-center lg:justify-start">
                <TiltCard>{p.visual}</TiltCard>
              </Reveal>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
