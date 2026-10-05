"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { SwarmMode } from "./landing-swarm";
import { INTRODUCTIONS } from "./landing-content";
import { prefersReducedMotion, runScene, useLandingEnv } from "./scene";
import { SwarmSlot } from "./swarm-slot";
import { useInView } from "./use-in-view";

const SENT_HTML =
  '<svg viewBox="0 0 16 16"><use href="#i-check"/></svg>Sent and recorded';

/**
 * "Handle my seed introductions": the visitor's ask, Q at work, three
 * prepared messages, each approved in turn, then done. An illustration,
 * played on a loop while on screen; reduced motion shows the end state.
 */
export function DemoScene({ children }: { readonly children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const near = useInView(rootRef, { rootMargin: "600px 0px" });
  const env = useLandingEnv();
  const [mode, setMode] = useState<SwarmMode>("listening");
  const [label, setLabel] = useState("Listening");

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const reduce = prefersReducedMotion();
    const q = <T extends Element = HTMLElement>(s: string) =>
      root.querySelector<T & HTMLElement>(s);
    const thread = q(".thread");
    const cursor = q<SVGSVGElement>(".cursor");
    const fixed = ["[data-d1=ask]", "[data-d1=q]", "[data-d1=done]"];
    const card = (i: number) => q(`[data-card="${i}"]`);
    const status = (i: number) => q(`[data-card="${i}"] .status`);
    const approve = (i: number) => q(`[data-card="${i}"] .approve`);

    const moveCursorTo = (el: Element | null, dur = 700) => {
      if (thread === null || cursor === null || el === null) return;
      const tb = thread.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const x = b.left - tb.left + b.width * 0.6;
      const y = b.top - tb.top + b.height * 0.55;
      cursor.style.opacity = "1";
      const from =
        cursor.style.transform || `translate(${x + 80}px,${y + 120}px)`;
      if (typeof cursor.animate === "function") {
        cursor.animate(
          [{ transform: from }, { transform: `translate(${x}px,${y}px)` }],
          {
            duration: dur,
            easing: "cubic-bezier(0.77,0,0.175,1)",
            fill: "forwards",
          },
        );
      }
      cursor.style.transform = `translate(${x}px,${y}px)`;
    };
    const markSent = (i: number) => {
      const s = status(i);
      if (s === null) return;
      s.className = "status sent";
      s.innerHTML = SENT_HTML;
    };
    const reset = () => {
      fixed.forEach((s) => q(s)?.classList.remove("in"));
      INTRODUCTIONS.forEach((_, i) => {
        card(i)?.classList.remove("in");
        setOpen(i, false);
        const s = status(i);
        if (s !== null) {
          s.className = "status";
          s.textContent = "Needs your approval";
        }
        const ap = approve(i);
        if (ap !== null) ap.textContent = "Approve and send";
      });
      if (cursor !== null) cursor.style.opacity = "0";
      setMode("listening");
      setLabel("Listening");
    };

    // Opening a card never moves layout (see landing.css): its box grows
    // behind it and what follows slides by the body's height.
    const bodyHeight = (i: number) =>
      card(i)?.querySelector<HTMLElement>(".acard-body")?.offsetHeight ?? 0;
    const setOpen = (i: number, open: boolean) => {
      const c = card(i);
      if (c === null) return;
      const h = open ? bodyHeight(i) : 0;
      c.style.setProperty("--lp-open-h", `${h}px`);
      c.classList.toggle("open", open);
      const after = [
        ...INTRODUCTIONS.map((_, j) => (j > i ? card(j) : null)),
        q("[data-d1=done]"),
      ];
      for (const el of after) el?.style.setProperty("--lp-push", `${h}px`);
    };
    // The thread holds the tallest the story gets, so the window never
    // resizes while it plays.
    const reserve = () => {
      if (thread === null) return;
      const done = q("[data-d1=done]");
      if (done === null) return;
      const tallest = Math.max(...INTRODUCTIONS.map((_, i) => bodyHeight(i)));
      // The content's own height (the thread itself may be stretched by
      // the window's grid), with no card open, plus the tallest card body.
      const pad = parseFloat(getComputedStyle(thread).paddingBottom) || 0;
      const natural = done.offsetTop + done.offsetHeight + pad;
      thread.style.minHeight = `${Math.ceil(natural + tallest)}px`;
    };
    reserve();
    const onResize = () => reserve();
    window.addEventListener("resize", onResize);

    const stop = runScene(
      root,
      async (wait) => {
        reset();
        await wait(700);
        q("[data-d1=ask]")?.classList.add("in");
        await wait(900);
        setMode("working");
        setLabel("Preparing introductions");
        await wait(2000);
        setMode("cloud");
        setLabel("Waiting for your approval");
        q("[data-d1=q]")?.classList.add("in");
        await wait(400);
        for (let i = 0; i < INTRODUCTIONS.length; i++) {
          card(i)?.classList.add("in");
          await wait(70);
        }
        await wait(500);
        for (let i = 0; i < INTRODUCTIONS.length; i++) {
          setOpen(i, true);
          await wait(i === 0 ? 1700 : 1000);
          const ap = approve(i);
          moveCursorTo(ap);
          await wait(800);
          ap?.classList.add("pressed");
          await wait(140);
          ap?.classList.remove("pressed");
          if (ap !== null) ap.textContent = "Approved";
          await wait(350);
          setOpen(i, false);
          markSent(i);
          await wait(500);
        }
        if (cursor !== null) cursor.style.opacity = "0";
        q("[data-d1=done]")?.classList.add("in");
        setLabel("Done");
        await wait(4200);
      },
      () => {
        fixed.forEach((s) => q(s)?.classList.add("in"));
        INTRODUCTIONS.forEach((_, i) => {
          card(i)?.classList.add("in");
          markSent(i);
        });
        setMode("cloud");
        setLabel("Done");
      },
      { reduce },
    );
    return () => {
      stop();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="qwin" id="demo1" ref={rootRef}>
      <div className="qwin-presence">
        {env !== null ? (
          <SwarmSlot
            near={near}
            variant="demo"
            mode={mode}
            reducedMotion={env.reduce}
            small={env.small}
          />
        ) : null}
        <div className="stage-state">
          <i />
          <span>{label}</span>
        </div>
      </div>
      <div className="thread">{children}</div>
    </div>
  );
}
