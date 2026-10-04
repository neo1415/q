"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { isSmallViewport, prefersReducedMotion } from "./scene";
import { SwarmSlot } from "./swarm-slot";

/**
 * The hero's stage: Q listening, leaning toward the visitor's pointer. As
 * the hero scrolls away Q gathers into its working ring, because Q is
 * about to show you work. Also owns the nav's hairline, which appears only
 * once content scrolls under it.
 */
export function HeroStage({ children }: { readonly children: ReactNode }) {
  const [env, setEnv] = useState<{ reduce: boolean; small: boolean } | null>(
    null,
  );
  const [gather, setGather] = useState(0);
  const heroRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    heroRef.current = stageRef.current?.closest("section") ?? null;
    const reduce = prefersReducedMotion();
    setEnv({ reduce, small: isSmallViewport() });
    const nav = document.querySelector<HTMLElement>("[data-lp-nav]");
    let raf = 0;
    const update = () => {
      raf = 0;
      nav?.classList.toggle("scrolled", window.scrollY > 8);
      const p = Math.min(1, Math.max(0, window.scrollY / (innerHeight * 0.9)));
      // Quantised: the swarm eases toward it anyway; this keeps renders rare.
      setGather(reduce ? 0 : Math.round(p * 50) / 50);
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="stage" ref={stageRef}>
      {env !== null ? (
        <SwarmSlot
          near
          variant="hero"
          gather={gather}
          pointerArea={heroRef}
          reducedMotion={env.reduce}
          small={env.small}
        />
      ) : null}
      <div className="stage-state">
        <i />
        <span>{gather > 0.45 ? "Working" : "Listening"}</span>
      </div>
      {children}
    </div>
  );
}
