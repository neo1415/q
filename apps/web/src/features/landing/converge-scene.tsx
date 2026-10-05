"use client";

import { useEffect, useRef, type ReactNode } from "react";

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
    const ledeA = section.querySelector<HTMLElement>("[data-conv=lede-a]");
    const ledeB = section.querySelector<HTMLElement>("[data-conv=lede-b]");
    const homes = frags.map((f) => ({
      x: Number(f.dataset["x"]) * (small ? 0.42 : 1),
      y: Number(f.dataset["y"]) * (small ? 0.42 : 1),
      r: Number(f.dataset["r"]),
    }));
    const wrap = section.querySelector<HTMLElement>(".wrap");
    const column = ledeA?.closest<HTMLElement>(".swap-lede")?.parentElement;
    const field = section.querySelector<HTMLElement>(".field");
    // Both ledes hold one cell (no layout shift when they swap). The page
    // was approved with the shorter one centred on its own, so the block
    // is nudged by transform to where its own height would centre it:
    // the text column alone beside the field, everything when stacked.
    const centre = (flip: boolean) => {
      if (!ledeA || !ledeB || !wrap || !column || !field) return;
      const hA = ledeA.offsetHeight;
      const hB = ledeB.offsetHeight;
      const nudge = (Math.max(hA, hB) - (flip ? hB : hA)) / 2;
      const stacked = field.offsetTop >= column.offsetTop + column.offsetHeight;
      wrap.style.transform = stacked && nudge ? `translateY(${nudge}px)` : "";
      // Stacked, the field sits right under the shorter lede, as approved.
      field.style.transform =
        stacked && nudge ? `translateY(${-2 * nudge}px)` : "";
      column.style.transform =
        !stacked && nudge ? `translateY(${nudge}px)` : "";
    };
    let flipped: boolean | null = null;
    let last = -1;
    let raf = 0;

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
      // Outside its scroll range nothing changes, so nothing is written.
      if (prog === last) return;
      last = prog;
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
        ledeA?.classList.toggle("off", flip);
        ledeB?.classList.toggle("off", !flip);
        ledeA?.setAttribute("aria-hidden", String(flip));
        ledeB?.setAttribute("aria-hidden", String(!flip));
        centre(flip);
      }
    };
    // One read and a few transform writes per frame at most; outside the
    // section's range the progress is clamped and nothing is written.
    // Applied in the scroll event itself (Chrome sends at most one per
    // frame), so the record moves on the same frame as the scroll; a rAF
    // hop would trail it by one. Resize waits for the next frame.
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      update();
    };
    const onResize = () => {
      flipped = null;
      last = -1;
      if (raf === 0) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
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
