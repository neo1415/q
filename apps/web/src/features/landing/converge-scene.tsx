"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { CONVERGE } from "./landing-content";
import { isSmallViewport, prefersReducedMotion } from "./scene";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Problem to guide, pinned: the scattered versions converge into one
 * relationship record as the visitor scrolls. Scroll-linked state change,
 * not parallax: what moves is the story. Transform and opacity only, once
 * per frame at most; reduced motion jumps between the two states.
 */
export function ConvergeScene({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = ref.current;
    if (section === null) return;
    const reduce = prefersReducedMotion();
    const small = isSmallViewport();
    const frags = [...section.querySelectorAll<HTMLElement>(".frag")];
    const record = section.querySelector<HTMLElement>(".record");
    const a = section.querySelector<HTMLElement>("[data-conv=a]");
    const b = section.querySelector<HTMLElement>("[data-conv=b]");
    const lede = section.querySelector<HTMLElement>("[data-conv=lede]");
    const homes = frags.map((f) => ({
      x: Number(f.dataset["x"]) * (small ? 0.42 : 1),
      y: Number(f.dataset["y"]) * (small ? 0.42 : 1),
      r: Number(f.dataset["r"]),
    }));
    let flipped: boolean | null = null;
    let raf = 0;
    let onScreen = true;

    const update = () => {
      raf = 0;
      const box = section.getBoundingClientRect();
      const total = box.height - innerHeight;
      // A section no taller than the screen (or not laid out) has not begun.
      const prog =
        total <= 0
          ? 0
          : reduce
            ? box.top < -total / 2
              ? 1
              : 0
            : clamp(-box.top / total, 0, 1);
      const t = easeInOut(clamp((prog - 0.18) / 0.5, 0, 1));
      frags.forEach((f, i) => {
        const h = homes[i];
        if (h === undefined) return;
        const drift = (1 - t) * Math.sin(prog * 6 + i) * 6;
        f.style.transform = `translate(-50%,-50%) translate(${h.x * (1 - t)}px,${h.y * (1 - t) + drift}px) rotate(${h.r * (1 - t)}deg) scale(${1 - t * 0.25})`;
        f.style.opacity = String(1 - clamp((t - 0.55) / 0.35, 0, 1));
      });
      const rt = clamp((t - 0.7) / 0.3, 0, 1);
      if (record !== null) {
        record.style.opacity = String(rt);
        record.style.transform = `translate(-50%,-50%) scale(${0.94 + rt * 0.06})`;
      }
      const flip = t > 0.75;
      if (flip !== flipped) {
        flipped = flip;
        a?.classList.toggle("off", flip);
        b?.classList.toggle("off", !flip);
        a?.setAttribute("aria-hidden", String(flip));
        b?.setAttribute("aria-hidden", String(!flip));
        if (lede !== null) {
          lede.textContent = flip ? CONVERGE.after.lede : CONVERGE.before.lede;
        }
      }
    };
    const onScroll = () => {
      if (onScreen && raf === 0) raf = requestAnimationFrame(update);
    };
    // Off screen, scrolling elsewhere costs nothing. (No observer: always on.)
    const seen =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              onScreen = entries.some((e) => e.isIntersecting);
              if (onScreen) onScroll();
            },
            { rootMargin: "200px 0px" },
          );
    seen?.observe(section);
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      seen?.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section
      ref={ref}
      className="converge"
      id="converge"
      aria-label="The problem"
    >
      {children}
    </section>
  );
}
