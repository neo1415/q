"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { SwarmMode } from "./landing-swarm";
import { REHEARSAL_SCRIPT } from "./landing-content";
import { isSmallViewport, prefersReducedMotion, runScene } from "./scene";
import { SwarmSlot } from "./swarm-slot";
import { useInView } from "./use-in-view";

type Caption = {
  readonly id: number;
  readonly who: "you" | "q";
  readonly text: string;
};

/**
 * The rehearsal room: Q in a call. Listening, it leans in and
 * backchannels ("Mm-hm."); speaking, it pulses with its voice. Captions
 * arrive a phrase at a time, never typed out.
 */
export function CallScene({ side }: { readonly side: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const near = useInView(rootRef, { rootMargin: "600px 0px" });
  const [env, setEnv] = useState<{ reduce: boolean; small: boolean } | null>(
    null,
  );
  const [mode, setMode] = useState<SwarmMode>("listening");
  const [label, setLabel] = useState("Listening");
  const [captions, setCaptions] = useState<readonly Caption[]>([]);
  const [back, setBack] = useState<{ text: string; on: boolean }>({
    text: "Mm-hm.",
    on: false,
  });
  const [pulse, setPulse] = useState(0);
  const talking = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const reduce = prefersReducedMotion();
    setEnv({ reduce, small: isSmallViewport() });
    let next = 0;
    const add = (who: "you" | "q", text: string) =>
      setCaptions((prev) => [...prev.slice(-1), { id: ++next, who, text }]);

    // The visitor's level meter: bars scale, never resize.
    const bars = [...root.querySelectorAll<HTMLElement>("[data-lvl] i")];
    const meter = reduce
      ? 0
      : window.setInterval(() => {
          for (const bar of bars) {
            const h = talking.current ? 4 + Math.random() * 14 : 4;
            bar.style.transform = `scaleY(${h / 18})`;
          }
        }, 110);

    const stop = runScene(
      root,
      async (wait) => {
        setCaptions([]);
        setMode("listening");
        setLabel("Listening");
        await wait(600);
        for (const line of REHEARSAL_SCRIPT) {
          if (line.who === "back") {
            setBack({ text: line.text, on: true });
            setPulse((p) => p + 1);
            await wait(1100);
            setBack((b) => ({ ...b, on: false }));
            continue;
          }
          if (line.who === "you") {
            talking.current = true;
            setMode("listening");
            setLabel("Listening");
            add("you", line.text);
            await wait(2300);
            talking.current = false;
          } else {
            setMode("speaking");
            setLabel("Speaking");
            add("q", line.text);
            await wait(2700);
            setMode("listening");
          }
        }
        setLabel("Rehearsal ended. Review ready");
        await wait(3500);
      },
      () => {
        const you = REHEARSAL_SCRIPT[6];
        const q = REHEARSAL_SCRIPT[7];
        if (you !== undefined && q !== undefined) {
          setCaptions([
            { id: 1, who: "you", text: you.text },
            { id: 2, who: "q", text: q.text },
          ]);
        }
      },
      { reduce },
    );
    return () => {
      stop();
      talking.current = false;
      window.clearInterval(meter);
    };
  }, []);

  return (
    <div className="call" id="call" ref={rootRef}>
      <div className="call-main">
        {env !== null ? (
          <SwarmSlot
            near={near}
            variant="call"
            mode={mode}
            pulse={pulse}
            reducedMotion={env.reduce}
            small={env.small}
          />
        ) : null}
        <div className="stage-state">
          <i />
          <span>{label}</span>
        </div>
        <span className={back.on ? "back in" : "back"}>{back.text}</span>
        <div className="captions" aria-live="off">
          {captions.map((c, i) => (
            <p
              key={c.id}
              className={i < captions.length - 1 ? "cap old" : "cap"}
            >
              <span className="who">{c.who === "q" ? "Q" : "You"}</span>
              {c.text}
            </p>
          ))}
        </div>
      </div>
      {side}
    </div>
  );
}
