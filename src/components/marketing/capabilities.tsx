import type { ReactNode } from "react";
import { Eyebrow, Reveal } from "./motion";

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
    <div className="w-full max-w-xs rounded-xl border border-white/10 bg-[#12111c] p-4 shadow-xl">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-bold text-white">Table 7</span>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
          4:12
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {[
          ["1", "Chicken Karahi", true],
          ["2", "Seekh Kebab", true],
          ["4", "Naan", false],
        ].map(([q, n, done]) => (
          <div key={n as string} className="flex items-center gap-2.5 text-[12px]">
            <span className="grid size-4 place-items-center rounded bg-white/10 text-[9px] font-semibold text-white/70">
              {q as string}
            </span>
            <span className={done ? "text-white/30 line-through" : "text-white/80"}>{n as string}</span>
            {done ? (
              <span className="ml-auto text-[10px] text-emerald-400">ready</span>
            ) : (
              <span className="ml-auto size-3.5 rounded-full border border-white/25" />
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
    <div className="w-full max-w-xs space-y-3.5 rounded-xl border border-white/10 bg-[#12111c] p-4 shadow-xl">
      {rows.map(([name, pct, qty], i) => (
        <div key={name}>
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="text-white/75">{name}</span>
            <span className={pct < 0.2 ? "text-amber-300" : "text-white/40"}>{qty}</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              style={{ width: `${pct * 100}%`, animationDelay: `${0.1 * i}s` }}
              className={`tos-grow-x h-full rounded-full ${pct < 0.2 ? "bg-amber-400" : "bg-violet-400"}`}
            />
          </div>
        </div>
      ))}
      <p className="pt-1 text-[10px] text-amber-300/80">Yoghurt below re-order level</p>
    </div>
  );
}

function RevenueBars() {
  const bars = [0.45, 0.62, 0.38, 0.71, 0.55, 0.88, 1];
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="w-full max-w-xs rounded-xl border border-white/10 bg-[#12111c] p-4 shadow-xl">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-white/40">This week</span>
        <span className="text-sm font-bold text-white tabular-nums">Rs 412,860</span>
      </div>
      <div className="mt-4 flex h-20 items-end gap-1.5">
        {bars.map((h, i) => (
          <div
            key={i}
            style={{ height: `${h * 100}%`, animationDelay: `${0.06 * i}s` }}
            className={`tos-grow-y flex-1 rounded-t-sm ${i === bars.length - 1 ? "bg-violet-400" : "bg-white/15"}`}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {days.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[9px] text-white/25">
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
    <div className="w-full max-w-xs rounded-xl border border-white/10 bg-[#12111c] p-4 shadow-xl">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-full bg-violet-500/20 text-[10px] font-bold text-violet-200">
          FR
        </span>
        <div>
          <p className="text-[12px] font-medium text-white/85">Faisal · Rider</p>
          <p className="text-[10px] text-white/35">2 orders · DHA Phase 6</p>
        </div>
      </div>
      <div className="mt-4 space-y-0">
        {steps.map(([label, done], i) => (
          <div key={label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`size-2 rounded-full ${done ? "bg-emerald-400" : "bg-white/20"}`} />
              {i < steps.length - 1 && <span className="h-6 w-px bg-white/12" />}
            </div>
            <span className={`-mt-0.5 text-[11px] ${done ? "text-white/70" : "text-white/30"}`}>{label}</span>
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
    body: "Sales, items, staff, discounts and voids, profit and loss — each branch with its own menu, tax setup and staff, all rolling up to one view you can actually act on.",
    covers: ["Full report suite", "Multi-branch", "Staff & roles", "Payroll & HR"],
    visual: <RevenueBars />,
  },
  {
    room: "Out the door",
    title: "Follow the order past the counter.",
    body: "Riders assigned and tracked, a QR menu customers order from directly, and WhatsApp to reach them on the app they already have open.",
    covers: ["Delivery & riders", "Online ordering", "WhatsApp", "Customers"],
    visual: <RiderTrack />,
  },
];

export function Capabilities() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-white/[0.06] bg-[#08070f] py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <Eyebrow className="text-white/35">Everything it runs</Eyebrow>
          <h2 className="mt-5 text-[clamp(2rem,4.6vw,3.4rem)] leading-[1.02] font-bold tracking-[-0.032em] text-white">
            One system instead of five apps and a notebook.
          </h2>
        </Reveal>

        <div className="mt-20 space-y-24 sm:space-y-32">
          {PANELS.map((p, i) => (
            <div
              key={p.room}
              className={`grid items-center gap-10 lg:grid-cols-2 lg:gap-20 ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}
            >
              <Reveal>
                <Eyebrow className="text-violet-300/70">{p.room}</Eyebrow>
                <h3 className="mt-4 text-[clamp(1.5rem,3vw,2.15rem)] leading-[1.08] font-bold tracking-[-0.028em] text-white">
                  {p.title}
                </h3>
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/50">{p.body}</p>
                <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5">
                  {p.covers.map((c) => (
                    <li key={c} className="text-[13px] text-white/40">
                      {c}
                    </li>
                  ))}
                </ul>
              </Reveal>

              <Reveal className="flex justify-center lg:justify-start">{p.visual}</Reveal>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
