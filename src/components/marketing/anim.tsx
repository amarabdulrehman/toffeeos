"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";

/**
 * The page's interactive motion, kept apart from the CSS entrances in motion.tsx.
 *
 * One rule runs through all of it: motion here only ever *enhances* something already on screen and
 * already correct. A figure renders at its true value and counts toward it; it never starts blank.
 * That is not fussiness — an earlier version of this page gated its content on JavaScript finishing
 * and went blank in an unfocused tab, where requestAnimationFrame is throttled to a crawl.
 */

/** Reading position, as a hairline across the top of the page. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const width = useSpring(scrollYProgress, { stiffness: 90, damping: 26, restDelta: 0.0005 });
  return (
    <motion.div
      aria-hidden
      style={{ scaleX: width, transformOrigin: "0% 50%" }}
      className="fixed inset-x-0 top-0 z-[60] h-[2px] bg-[color:var(--accent)]"
    />
  );
}

/**
 * A figure that counts up the first time it is seen.
 *
 * Renders its real value immediately and animates from a fraction of it once in view, so a visitor
 * whose animations never run reads the correct number rather than a zero.
 */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString("en-PK"),
  className,
  duration = 1.1,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });

  /**
   * Writes each frame straight to the text node instead of through React state.
   *
   * setState per frame puts a full render and reconciliation between the animation and the pixels,
   * which is exactly the kind of cost that turns a count into a stutter — and with several of these
   * on screen it compounds. The element already holds the correct value from the server, so this
   * only ever overwrites a number with another number.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || !inView) return;
    const controls = animate(value * 0.8, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (n) => {
        el.textContent = format(n);
      },
      onComplete: () => {
        el.textContent = format(value);
      },
    });
    return () => controls.stop();
    // `format` is a literal at every call site; including it would restart the animation on each
    // parent render for no behavioural gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced, value, duration]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}

/**
 * Moves an element against the scroll.
 *
 * Deliberately shallow — `distance` is in pixels and the callers pass 30 to 60. Parallax reads as
 * craft at small amplitudes and as a gimmick at large ones, and anything that moves far enough to
 * notice on a phone is usually just making text harder to read.
 */
export function Parallax({
  children,
  distance = 40,
  className,
}: {
  children: ReactNode;
  distance?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  const smooth = useSpring(y, { stiffness: 55, damping: 20, restDelta: 0.2 });

  return (
    <div ref={ref} className={className}>
      <motion.div style={reduced ? undefined : { y: smooth }}>{children}</motion.div>
    </div>
  );
}

/**
 * A card that tilts very slightly toward the cursor.
 *
 * Pointer-driven, so it costs nothing on touch devices, where it simply never fires. The rotation
 * caps at five and a half degrees and is sprung softly enough to keep drifting for a moment after
 * the cursor stops — enough that the surface feels physical, not enough to read as a novelty.
 */
export function TiltCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rx = useSpring(useTransform(py, [-0.5, 0.5], [5.5, -5.5]), { stiffness: 150, damping: 18, mass: 0.6 });
  const ry = useSpring(useTransform(px, [-0.5, 0.5], [-5.5, 5.5]), { stiffness: 150, damping: 18, mass: 0.6 });

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <div style={{ perspective: 900 }} className={className}>
      <motion.div
        ref={ref}
        onPointerMove={(e) => {
          if (e.pointerType === "touch") return;
          const r = e.currentTarget.getBoundingClientRect();
          px.set((e.clientX - r.left) / r.width - 0.5);
          py.set((e.clientY - r.top) / r.height - 0.5);
        }}
        onPointerLeave={() => {
          px.set(0);
          py.set(0);
        }}
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        className="h-full"
      >
        {children}
      </motion.div>
    </div>
  );
}

/**
 * A heading that rises line by line as it comes into view.
 *
 * Takes its lines as separate strings rather than splitting on width, so the breaks are the ones a
 * person chose. Each line is clipped by its wrapper so it appears to rise off the line beneath,
 * which is the difference between typeset and merely animated.
 */
export function RevealLines({
  lines,
  className = "",
  as: Tag = "h2",
  accentIndex,
  accentClassName = "",
}: {
  lines: string[];
  className?: string;
  as?: "h2" | "h3";
  accentIndex?: number;
  accentClassName?: string;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });

  return (
    <div ref={ref}>
      <Tag className={className}>
        {lines.map((line, i) => (
          <span key={line} className="block overflow-hidden pb-[0.06em]">
            <motion.span
              className={`block ${accentIndex === i ? accentClassName : ""}`}
              initial={reduced ? false : { y: "105%" }}
              animate={inView || reduced ? { y: 0 } : undefined}
              transition={{ duration: 1.05, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            >
              {line}
            </motion.span>
          </span>
        ))}
      </Tag>
    </div>
  );
}

/** A live clock for the kitchen ticket — small, but it makes a static card feel switched on. */
export function TickingTimer({ from = 252, className = "" }: { from?: number; className?: string }) {
  const reduced = useReducedMotion();
  const [secs, setSecs] = useState(from);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [reduced]);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return <span className={className}>{`${m}:${String(s).padStart(2, "0")}`}</span>;
}
