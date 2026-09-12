import type { CSSProperties, ReactNode } from "react";

/**
 * The marketing site's motion vocabulary.
 *
 * These are deliberately server components with no JavaScript at all. An earlier version drove them
 * with motion's initial/animate, which writes opacity:0 into the server HTML and depends on a
 * requestAnimationFrame animation to bring the content back. That makes visibility conditional on
 * JS completing, and rAF is throttled in unfocused and background tabs — which is how a link opened
 * in a new tab from WhatsApp or a search result behaves. Measured on the live site: one rAF tick
 * per 300ms, headline still invisible nine seconds in. The hero was blank.
 *
 * So the reveals are CSS (see the landing-page block in globals.css). The compositor runs them
 * without hydration, `both` fill-mode guarantees they finish visible, and a browser that supports
 * none of it simply shows the content. The worst case is "no animation", never "no content".
 *
 * motion is still used, but only for things that genuinely need JS and only ever on top of content
 * that is already visible: the scroll-scrubbed outage scene, the cart's add/remove transitions, the
 * tax toggle, and the header's background.
 */

/** Expo-out — one curve for the whole page. Nothing bounces. */
export const EASE = [0.16, 1, 0.3, 1] as const;

export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div className={`tos-reveal ${className}`} style={delay ? { animationDelay: `${delay}s` } : undefined}>
      {children}
    </div>
  );
}

/**
 * Headline reveal, word by word.
 *
 * Split on words, not characters: a character-by-character reveal is a signature of the generated
 * landing page, and it turns a long headline into a slot machine. Each word sits in a clipping
 * wrapper so it rises out of the line above rather than fading in from nowhere.
 */
export function RevealWords({
  text,
  className = "",
  delay = 0,
  accentFrom,
  accentClassName = "",
}: {
  text: string;
  className?: string;
  delay?: number;
  /** Index from which the remaining words take the accent colour. */
  accentFrom?: number;
  accentClassName?: string;
}) {
  const words = text.split(" ");
  return (
    <h1 className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <span
            className={`tos-enter inline-block ${accentFrom !== undefined && i >= accentFrom ? accentClassName : ""}`}
            style={{ animationDelay: `${delay + i * 0.055}s`, ["--tos-rise" as keyof CSSProperties]: "0.9em" } as CSSProperties}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        </span>
      ))}
    </h1>
  );
}

/** An on-load entrance for a block of content, staggered after the headline. */
export function Enter({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div className={`tos-enter ${className}`} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

/** A quiet label above a headline, instead of the pill-shaped badge every template opens with. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[0.6875rem] font-medium tracking-[0.22em] uppercase ${className}`}>{children}</p>;
}
