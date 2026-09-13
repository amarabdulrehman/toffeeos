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
  const width = useSpring(scrollYProgress, { stiffness: 180, damping: 30, restDelta: 0.001 });
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
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduced || !inView) return;
    const mv = { n: value * 0.82 };
    const controls = animate(mv.n, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (n) => setShown(n),
      onComplete: () => setShown(value),
    });
    return () => controls.stop();
  }, [inView, reduced, value, duration]);

  return (
    <span ref={ref} className={className}>
      {format(shown)}
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
  const smooth = useSpring(y, { stiffness: 120, damping: 26, restDelta: 0.5 });

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
 * caps at four degrees: enough that the surface feels physical when you move across it, not enough
 * to read as a novelty.
 */
export function TiltCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rx = useSpring(useTransform(py, [-0.5, 0.5], [4, -4]), { stiffness: 260, damping: 24 });
  const ry = useSpring(useTransform(px, [-0.5, 0.5], [-4, 4]), { stiffness: 260, damping: 24 });

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
              transition={{ duration: 0.85, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
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
