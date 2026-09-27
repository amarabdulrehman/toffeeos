"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { useReducedMotion } from "motion/react";

/**
 * Smooth scrolling, for the landing page only.
 *
 * Native scrolling arrives in discrete jumps — a mouse wheel delivers ~100px at a time and a
 * trackpad fires bursts — so every scroll-linked animation on the page inherits that steppiness no
 * matter how well it is written. Interpolating the scroll position is what makes the difference
 * between animations that are technically correct and a page that feels expensive; it is the single
 * largest contributor, and it was missing.
 *
 * Deliberately NOT applied to the product. A cashier flicking through a menu mid-service needs the
 * list to stop exactly where they let go; inertia on a POS is an irritation, not a luxury. This
 * component is mounted by the marketing page and nothing else.
 *
 * Its frame loop runs only while a smooth scroll is under way — started by the wheel or an anchor
 * link, stopped when the interpolation settles. It used to run every frame for the whole visit,
 * sixty wake-ups a second on a page nobody was scrolling.
 */
export function SmoothScroll() {
  const reduced = useReducedMotion();

  useEffect(() => {
    // Honouring the OS setting matters more here than anywhere else on the page: hijacked scrolling
    // is a common migraine and motion-sickness trigger, and the native behaviour is the accessible
    // one. Bail out entirely rather than shortening the easing.
    if (reduced) return;

    const lenis = new Lenis({
      // ~0.09 keeps roughly a tenth of the remaining distance per frame: enough to smooth the
      // wheel's staircase without the page feeling like it is sliding on ice, which is the usual
      // failure of this effect.
      lerp: 0.09,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      // Touch devices already interpolate their own scrolling in the compositor. Layering ours on
      // top fights the platform and feels worse than either alone.
      syncTouch: false,
    });

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      // Keep going while Lenis is interpolating; once it settles, sleep until the next wheel.
      frame = lenis.isScrolling === "smooth" ? requestAnimationFrame(raf) : 0;
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(raf);
    };
    // Lenis turns a wheel event into a target to glide to; the loop has to be awake to glide there.
    window.addEventListener("wheel", wake, { passive: true });
    wake();

    // In-page anchors have to go through Lenis, or the browser's instant jump fights the
    // interpolated position and lands somewhere neither of them intended.
    const onAnchorClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.('a[href^="#"]');
      const href = link?.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target as HTMLElement, { offset: -8 });
      wake();
    };
    document.addEventListener("click", onAnchorClick);

    return () => {
      document.removeEventListener("click", onAnchorClick);
      window.removeEventListener("wheel", wake);
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [reduced]);

  return null;
}
