import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Calculator,
  ChefHat,
  Check,
  Clock,
  LayoutGrid,
  Mail,
  MessageCircle,
  Receipt,
  ScrollText,
  ShieldCheck,
  Truck,
  Users,
  UtensilsCrossed,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BRAND_NAME,
  COMPANY_EMAIL,
  COMPANY_INSTAGRAM,
  COMPANY_INSTAGRAM_HANDLE,
  COMPANY_NAME,
} from "@/config/brand";
import { GATEABLE_MODULES, TIER_LABEL, TIER_ORDER, tierMeets, type TierKey } from "@/lib/tiers";

export const metadata: Metadata = {
  title: `${BRAND_NAME} — restaurant software that works offline`,
  description: `${BRAND_NAME} runs the counter, kitchen, stock, staff and delivery for restaurants and cafés in Pakistan — and keeps taking orders when the internet goes down.`,
  openGraph: {
    title: `${BRAND_NAME} — restaurant software that works offline`,
    description: `Point of sale, kitchen display, inventory, reports and delivery. Built for Pakistan, by ${COMPANY_NAME}.`,
    type: "website",
  },
};

/**
 * The public landing page.
 *
 * Every capability named here is one the product actually ships, and the plan tables are generated
 * from GATEABLE_MODULES rather than retyped, so this page cannot drift from what a tenant really
 * gets when their tier changes.
 *
 * Deliberately no customer logos, testimonials, counts or ratings: inventing social proof for
 * software that has not shipped to a paying client yet would be a lie printed on the front door,
 * and it is the one claim a prospect can actually check. Add them here once they are real.
 *
 * No prices either — billing is per-branch, per-month and set per tenant (src/lib/billing.ts), so
 * there is no public number to print without making one up.
 */
export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <OfflineSection />
        <Features />
        <BuiltForPakistan />
        <Tiers />
        <TrustSection />
        <ContactSection />
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * Instagram's glyph, inline.
 *
 * lucide-react dropped brand icons, and a brand mark should not be approximated from a generic
 * icon set anyway — a "camera" standing in for Instagram reads as a mistake. Sized and stroked to
 * sit level with the lucide icons beside it.
 */
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37Z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────── */

const NAV = [
  { href: "#offline", label: "Offline" },
  { href: "#features", label: "Features" },
  { href: "#plans", label: "Plans" },
  { href: "#contact", label: "Contact" },
];

function BrandMark() {
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-heading text-base font-bold text-primary-foreground"
      aria-hidden
    >
      T
    </span>
  );
}

/**
 * The KRIMSOL company mark.
 *
 * Two files, not one with a CSS filter: the artwork is near-black ink plus a violet accent, and on
 * the navy footer the original measures 1.02:1 against its background — invisible, not merely dim.
 * krimsol-logo-dark.png lifts the neutral ink to near-white (15.28:1) and raises the violet's
 * lightness while holding its hue (4.42:1), so the K reads as one mark instead of half of one.
 *
 * Both are trimmed from the supplied file, which carried 58% empty margin and would otherwise
 * render the mark at about a third of the space it occupies.
 *
 * Deliberately not paired with the company name in text anywhere: this is a wordmark, and setting
 * it beside the same word spelled out reads as a duplication. That also keeps a known difference
 * out of the reader's eye — the artwork reads KRIMSOL, while COMPANY_NAME is KRIMSOLS, which is the
 * spelling the owner confirmed and the one the @krimsols handle uses. Not a typo on either side;
 * the logo is the thing to re-cut if they are ever brought into line.
 */
function KrimsolLogo({ variant = "dark", className = "" }: { variant?: "dark" | "light"; className?: string }) {
  return (
    <Image
      src={variant === "dark" ? "/krimsol-logo-dark.png" : "/krimsol-logo.png"}
      alt={COMPANY_NAME}
      width={284}
      height={190}
      className={className}
      priority={false}
    />
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark />
          <span className="font-heading text-lg font-bold tracking-tight text-sidebar-foreground">{BRAND_NAME}</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Button
            render={<Link href="/login" />}
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            Sign in
          </Button>
          <Button render={<Link href="/signup" />} nativeButton={false} size="sm">
            Start free trial
          </Button>
        </div>
      </div>
    </header>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-sidebar">
      {/* Two soft violet washes rather than a flat panel — keeps the dark chrome from reading as a
          black box without a gradient that fights the primary colour. */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-primary/25 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-24 -bottom-56 size-[34rem] rounded-full bg-primary/10 blur-3xl"
        aria-hidden
      />

      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-sidebar-foreground/85">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            Built in Pakistan, for Pakistan
          </span>

          <h1 className="mt-6 font-heading text-4xl font-bold tracking-tight text-balance text-sidebar-foreground sm:text-5xl md:text-6xl">
            Your till shouldn&rsquo;t stop because the internet did.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-sidebar-foreground/70">
            {BRAND_NAME} runs the whole restaurant &mdash; counter, kitchen, stock, staff and delivery &mdash; and
            keeps taking orders straight through an outage. Everything syncs the moment you&rsquo;re back.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button render={<Link href="/signup" />} nativeButton={false} size="lg" className="w-full sm:w-auto">
              Start free trial
              <ArrowRight className="size-4" />
            </Button>
            <Button
              render={<a href="#offline" />}
              nativeButton={false}
              variant="outline"
              size="lg"
              className="w-full border-white/20 bg-white/5 text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground sm:w-auto"
            >
              See how offline works
            </Button>
          </div>

          <p className="mt-6 text-sm text-sidebar-foreground/55">
            Dine-in &middot; Takeaway &middot; Delivery &middot; Multi-branch &mdash; one system for all of it.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Offline ────────────────────────────────────────────────────────────── */

const OFFLINE_POINTS = [
  {
    icon: Receipt,
    title: "Orders keep going through",
    body: "Punch orders, take payment, apply a discount, void a line. The till prices everything on the device — tax, service charge and rounding included — so the cashier always knows what to charge.",
  },
  {
    icon: Clock,
    title: "Nothing waits on a reconnect",
    body: "Each action is saved on the device the instant it happens, with an idempotency key, so coming back online can never duplicate an order or a payment.",
  },
  {
    icon: WifiOff,
    title: "Even a refresh survives",
    body: "The app itself is stored on the device, not just the data. Open the till in the morning before the line is back, or reload a slept tablet mid-shift, and it still opens.",
  },
];

function OfflineSection() {
  return (
    <section id="offline" className="scroll-mt-16 border-b bg-background">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
            <WifiOff className="size-3.5" />
            The part most systems get wrong
          </span>
          <h2 className="mt-5 font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            A dropped connection is a bad minute, not a lost shift.
          </h2>
          <p className="mt-4 text-lg text-pretty text-muted-foreground">
            Most restaurant software treats the internet as a given. In a real kitchen it isn&rsquo;t. So{" "}
            {BRAND_NAME} was built the other way round &mdash; working offline is the normal case, and the connection
            is what makes it sync faster.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {OFFLINE_POINTS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-6 shadow-sm">
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 font-heading text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted-foreground">
          Tested the way a café actually fails: the connection cut mid-order, the tablet reloaded, the queued orders
          replayed on reconnect and checked to the paisa.
        </p>
      </div>
    </section>
  );
}

/* ── Features ───────────────────────────────────────────────────────────── */

const FEATURES = [
  {
    icon: Receipt,
    title: "Point of sale",
    body: "Dine-in, takeaway and delivery on one screen. Variants, modifiers, discounts, split payments and receipt reprints.",
  },
  {
    icon: ChefHat,
    title: "Kitchen display",
    body: "Orders land in the kitchen the second they are sent. Mark items ready without a printer or a shouted ticket.",
  },
  {
    icon: LayoutGrid,
    title: "Tables & floor",
    body: "See what is occupied, resume an open order, add items to a running table, and settle it when they leave.",
  },
  {
    icon: UtensilsCrossed,
    title: "Menu & modifiers",
    body: "Categories, variants, add-ons and per-branch availability. Change a price once and every till has it.",
  },
  {
    icon: Boxes,
    title: "Inventory",
    body: "Track stock as it is consumed, get low-stock warnings, and stop guessing what needs ordering this week.",
  },
  {
    icon: Calculator,
    title: "Recipe & costing",
    body: "Cost a dish from its ingredients and see the margin you are actually making, not the one you assumed.",
  },
  {
    icon: BarChart3,
    title: "Reports",
    body: "Sales, items, staff, discounts and voids, P&L — in your branch's own timezone, so a day means your day.",
  },
  {
    icon: Truck,
    title: "Delivery & riders",
    body: "Assign riders, follow orders out the door, and see who is actually delivering on time.",
  },
  {
    icon: MessageCircle,
    title: "Online orders & WhatsApp",
    body: "Take orders from a QR menu and reach customers on the app they already have open.",
  },
  {
    icon: Users,
    title: "Staff, roles & payroll",
    body: "Granular permissions per role, attendance and payslips. A cashier sees the till, not your P&L.",
  },
  {
    icon: ScrollText,
    title: "Expenses",
    body: "Record what the business spends, recurring costs included, so the P&L reflects reality.",
  },
  {
    icon: ShieldCheck,
    title: "Multi-branch",
    body: "Run several locations from one account, each with its own menu, staff, tax setup and reporting.",
  },
];

function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            One system instead of five apps and a notebook.
          </h2>
          <p className="mt-4 text-lg text-pretty text-muted-foreground">
            The counter, the kitchen, the storeroom and the office all read from the same data. No exports, no
            reconciling two systems at midnight.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-5 shadow-xs transition-shadow hover:shadow-md">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-[18px]" />
                </span>
                <h3 className="font-heading text-sm font-semibold">{title}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Built for Pakistan ─────────────────────────────────────────────────── */

const LOCAL_POINTS = [
  {
    title: "Punjab PRA split rates, handled properly",
    body: "Cash and card are taxed at different rates. The till applies the right one for the tender actually used — and when a bill is split across two methods, the taxable amount is apportioned between them rather than guessed at.",
  },
  {
    title: "Rupees and paisa, exactly",
    body: "Every amount is stored in paisa as a whole number, never a decimal that drifts. The total on the receipt is the total in the report, to the paisa.",
  },
  {
    title: "Your business day, not UTC midnight",
    body: "A restaurant's day ends when it closes, not at midnight GMT. Reports run on your branch's own timezone and closing time, so last night's late orders land on last night.",
  },
];

function BuiltForPakistan() {
  return (
    <section className="border-b bg-background">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Written for how restaurants here actually work.
          </h2>
          <p className="mt-4 text-lg text-pretty text-muted-foreground">
            Foreign software makes you bend the business to fit it &mdash; the wrong tax model, the wrong currency
            handling, a reporting day that ends at the wrong hour. These are not settings bolted on afterwards. They
            are how the system was built.
          </p>
          <div className="mt-8">
            <Button render={<Link href="/signup" />} nativeButton={false} size="lg">
              Start free trial
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>

        <ul className="space-y-6">
          {LOCAL_POINTS.map((point) => (
            <li key={point.title} className="flex gap-4">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              <div>
                <h3 className="font-heading text-base font-semibold">{point.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── Plans ──────────────────────────────────────────────────────────────── */

/** Available at every tier — the operational core the tier grid deliberately does not gate. */
const CORE_INCLUDED = [
  "Point of sale & offline mode",
  "Kitchen display",
  "Tables & floor plan",
  "Menu, variants & modifiers",
  "Sales & staff reports",
  "Staff, roles & permissions",
  "Multi-branch",
];

const TIER_PITCH: Record<TierKey, string> = {
  starter: "One counter, running properly. Everything you need to take orders and get paid.",
  growth: "You are watching stock and margins now, not just sales.",
  complete: "Delivery, online orders and payroll — the whole operation in one place.",
};

/** Generated from the real registry, so this table cannot drift from what a tenant actually gets. */
function modulesForTier(tier: TierKey) {
  return GATEABLE_MODULES.filter((m) => tierMeets(tier, m.minTier)).map((m) => m.label);
}

function quoteHref(tier: TierKey) {
  const subject = `${BRAND_NAME} — ${TIER_LABEL[tier]} plan enquiry`;
  return `mailto:${COMPANY_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

function Tiers() {
  return (
    <section id="plans" className="scroll-mt-16 border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Pick the plan that matches the business you have.
          </h2>
          <p className="mt-4 text-lg text-pretty text-muted-foreground">
            Priced per branch, per month. Tell us how many locations you run and what you need, and we will quote you
            properly &mdash; no per-seat surprises.
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {TIER_ORDER.map((tier) => {
            const featured = tier === "growth";
            return (
              <div
                key={tier}
                className={
                  featured
                    ? "relative rounded-2xl border-2 border-primary bg-card p-7 shadow-lg"
                    : "relative rounded-2xl border bg-card p-7 shadow-sm"
                }
              >
                {featured && (
                  <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-1 text-2xs font-semibold tracking-wide text-primary-foreground uppercase">
                    Most restaurants start here
                  </span>
                )}

                <h3 className="font-heading text-xl font-bold">{TIER_LABEL[tier]}</h3>
                <p className="mt-2 min-h-10 text-sm text-muted-foreground">{TIER_PITCH[tier]}</p>

                <Button
                  render={<a href={quoteHref(tier)} />}
                  nativeButton={false}
                  variant={featured ? "default" : "outline"}
                  className="mt-6 w-full"
                >
                  Get a quote
                </Button>

                <div className="mt-7 space-y-3 border-t pt-6">
                  <p className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {tier === "starter" ? "Includes" : "Everything in Starter, plus"}
                  </p>
                  <ul className="space-y-2.5">
                    {(tier === "starter" ? CORE_INCLUDED : modulesForTier(tier)).map((label) => (
                      <li key={label} className="flex items-start gap-2.5 text-sm">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={3} />
                        <span>{label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Trust ──────────────────────────────────────────────────────────────── */

const TRUST = [
  {
    title: "Your data is yours alone",
    body: "Each restaurant's data is isolated at the database level, not only in application code, so one account cannot read another's even if something above it goes wrong.",
  },
  {
    title: "Backed up daily",
    body: "Automatic daily backups, and a restore path that has been tested by actually restoring one rather than assumed to work.",
  },
  {
    title: "Every sensitive action is logged",
    body: "Voids, discounts, refunds and password changes are recorded with who did them and when, so a disputed bill has an answer.",
  },
];

function TrustSection() {
  return (
    <section className="border-b bg-background">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            You are trusting us with the day&rsquo;s takings.
          </h2>
          <p className="mt-4 text-lg text-pretty text-muted-foreground">
            We take that seriously, and we would rather show you how it works than ask you to assume.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {TRUST.map((item) => (
            <div key={item.title} className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-heading text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Contact ────────────────────────────────────────────────────────────── */

function ContactSection() {
  return (
    <section id="contact" className="scroll-mt-16 bg-sidebar">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <KrimsolLogo className="mx-auto h-14 w-auto" />
          <h2 className="mt-6 font-heading text-3xl font-bold tracking-tight text-balance text-sidebar-foreground sm:text-4xl">
            Let&rsquo;s get your restaurant running on it.
          </h2>
          <p className="mt-4 text-lg text-pretty text-sidebar-foreground/70">
            Start the free trial and look around yourself, or talk to us first. We will walk you through setup, your
            menu and your tax rates, and answer anything before you commit.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button render={<Link href="/signup" />} nativeButton={false} size="lg" className="w-full sm:w-auto">
              Start free trial
              <ArrowRight className="size-4" />
            </Button>
            <Button
              render={<a href={`mailto:${COMPANY_EMAIL}`} />}
              nativeButton={false}
              variant="outline"
              size="lg"
              className="w-full border-white/20 bg-white/5 text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground sm:w-auto"
            >
              <Mail className="size-4" />
              Talk to us
            </Button>
          </div>

          <div className="mt-10 flex flex-col items-center justify-center gap-x-8 gap-y-3 text-sm sm:flex-row">
            <a
              href={`mailto:${COMPANY_EMAIL}`}
              className="inline-flex items-center gap-2 text-sidebar-foreground/75 transition-colors hover:text-sidebar-foreground"
            >
              <Mail className="size-4" />
              {COMPANY_EMAIL}
            </a>
            <a
              href={COMPANY_INSTAGRAM}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 text-sidebar-foreground/75 transition-colors hover:text-sidebar-foreground"
            >
              <InstagramIcon className="size-4" />
              {COMPANY_INSTAGRAM_HANDLE}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Footer ─────────────────────────────────────────────────────────────── */

function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-sidebar">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-heading text-base font-bold tracking-tight text-sidebar-foreground">
              {BRAND_NAME}
            </span>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <KrimsolLogo className="h-9 w-auto" />
            <span className="h-8 w-px bg-white/15" aria-hidden />
            <p className="text-sm text-sidebar-foreground/55">
              Restaurant software,
              <br />
              built in Pakistan.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <a href="#features" className="text-sidebar-foreground/65 transition-colors hover:text-sidebar-foreground">
            Features
          </a>
          <a href="#plans" className="text-sidebar-foreground/65 transition-colors hover:text-sidebar-foreground">
            Plans
          </a>
          <Link href="/login" className="text-sidebar-foreground/65 transition-colors hover:text-sidebar-foreground">
            Sign in
          </Link>
          <a
            href={`mailto:${COMPANY_EMAIL}`}
            className="inline-flex items-center gap-1.5 text-sidebar-foreground/65 transition-colors hover:text-sidebar-foreground"
          >
            <Mail className="size-4" />
            Email
          </a>
          <a
            href={COMPANY_INSTAGRAM}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${COMPANY_NAME} on Instagram`}
            className="inline-flex items-center gap-1.5 text-sidebar-foreground/65 transition-colors hover:text-sidebar-foreground"
          >
            <InstagramIcon className="size-4" />
            Instagram
          </a>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-5 text-xs text-sidebar-foreground/45 sm:px-6">
          &copy; {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
