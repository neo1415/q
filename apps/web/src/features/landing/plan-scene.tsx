"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { FIRST_READING, PITCHES, STEPS, type Side } from "./landing-content";
import { prefersReducedMotion, runScene } from "./scene";

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * "Three steps": the side toggle, and the phone. An investor sees the
 * Discover feed swipe (Save, then the next pitch); a founder sees Q's
 * first reading of their deck arrive, each figure waiting to be confirmed.
 */
export function PlanScene({
  heading,
  feed,
}: {
  readonly heading: ReactNode;
  readonly feed: ReactNode;
}) {
  const [side, setSide] = useState<Side>("investor");
  const [shown, setShown] = useState<Side>("investor");
  const [swapping, setSwapping] = useState(false);
  const [facts, setFacts] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const segRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const founderRun = useRef(0);

  // The thumb sits under the pressed button: measured, never guessed.
  useIsoLayoutEffect(() => {
    const place = () => {
      const seg = segRef.current;
      const thumb = thumbRef.current;
      const b = seg?.querySelector<HTMLElement>(`[data-side="${side}"]`);
      if (thumb === null || b === null || b === undefined) return;
      thumb.style.width = `${b.offsetWidth}px`;
      thumb.style.transform = `translateX(${b.offsetLeft - 4}px)`;
    };
    place();
    void document.fonts?.ready.then(place);
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [side]);

  // The investor's feed: watch, save, swipe to the next pitch.
  useEffect(() => {
    const feedEl = feedRef.current;
    if (feedEl === null) return;
    const pitch = (i: number) =>
      feedEl.querySelector<HTMLElement>(`[data-pitch="${i}"]`);
    const save = () =>
      feedEl.querySelector<HTMLElement>("[data-pitch='0'] [data-a=save]");
    let current = 0;
    return runScene(
      feedEl,
      async (wait) => {
        await wait(1800);
        if (current === 0) {
          const s = save();
          s?.classList.add("press");
          await wait(140);
          s?.classList.remove("press");
          s?.classList.add("saved");
          const word = s?.querySelector("[data-word]");
          if (word) word.textContent = "Saved";
          await wait(900);
        }
        const next = (current + 1) % PITCHES.length;
        const a = pitch(current);
        const b = pitch(next);
        if (a === null || b === null) return;
        b.classList.remove("anim", "up", "cur");
        b.style.transform = "";
        void b.offsetWidth;
        a.classList.add("anim", "up");
        b.classList.add("anim", "cur");
        await wait(700);
        a.classList.remove("anim", "cur", "up");
        if (next === 0) {
          const s = save();
          s?.classList.remove("saved");
          const word = s?.querySelector("[data-word]");
          if (word) word.textContent = "Save";
        }
        current = next;
        await wait(1400);
      },
      () => undefined,
      { reduce: prefersReducedMotion() },
    );
  }, []);

  const choose = (next: Side) => {
    if (next === side) return;
    setSide(next);
    setSwapping(true);
    window.setTimeout(() => {
      setShown(next);
      setSwapping(false);
    }, 200);
    if (next === "founder") void playFounder();
  };

  const playFounder = async () => {
    const mine = ++founderRun.current;
    const reduce = prefersReducedMotion();
    const wait = (ms: number) =>
      new Promise<void>((r) => window.setTimeout(r, reduce ? 0 : ms));
    setFacts(0);
    setConfirmed(false);
    setUploaded(false);
    // Two frames: the bar paints empty before it fills.
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    setUploaded(true);
    await wait(1300);
    for (let i = 1; i <= FIRST_READING.length; i++) {
      if (mine !== founderRun.current) return;
      setFacts(i);
      await wait(420);
    }
    await wait(600);
    if (mine === founderRun.current) setConfirmed(true);
  };

  return (
    <div className="wrap plan">
      <div>
        {heading}
        <div
          className="seg"
          role="group"
          aria-label="Choose your side"
          ref={segRef}
        >
          <span className="thumb" ref={thumbRef} />
          <button
            type="button"
            aria-pressed={side === "founder"}
            data-side="founder"
            onClick={() => choose("founder")}
          >
            I&apos;m raising
          </button>
          <button
            type="button"
            aria-pressed={side === "investor"}
            data-side="investor"
            onClick={() => choose("investor")}
          >
            I&apos;m investing
          </button>
        </div>
        <div className={swapping ? "steps-set swapping" : "steps-set"}>
          <ol className="steps">
            {STEPS[shown].map(([title, detail], i) => (
              <li key={title}>
                <span className="num">{i + 1}</span>
                <span>
                  <b>{title}</b>
                  <span>{detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="phone" aria-label="Illustration of Capital Q on a phone">
        <div className="screen">
          <div className="notch" />
          <div className={side === "investor" ? "view" : "view hidden"}>
            <div className="phone-top">
              <span>Discover</span>
              <span>For your mandate</span>
            </div>
            <div className="feed" ref={feedRef}>
              {feed}
            </div>
          </div>
          <div
            className={side === "founder" ? "view fview" : "view fview hidden"}
          >
            <h5>What&apos;s known, and how well supported</h5>
            <div className="upload">
              <svg width="16" height="16" aria-hidden="true">
                <use href="#i-file" />
              </svg>
              <span>Fennel Pay deck.pdf</span>
              <span className="bar">
                <i className={uploaded ? "filled" : undefined} />
              </span>
            </div>
            <div className="ffacts">
              {FIRST_READING.slice(0, facts).map((f, i) => (
                <div className="fact" key={f.label}>
                  <div className="k">
                    <span>{f.label}</span>
                    {f.unknown ? (
                      <span className="chip">Unknown</span>
                    ) : (
                      <span
                        className={
                          confirmed && i === 0 ? "confirm ok" : "confirm"
                        }
                      >
                        {confirmed && i === 0 ? "Confirmed" : "Confirm"}
                      </span>
                    )}
                  </div>
                  <span className="how">{f.value}</span>
                </div>
              ))}
            </div>
            <p className="small">
              Q&apos;s readings stay inferences until you confirm them.
            </p>
          </div>
          <div className="tabbar" aria-hidden="true">
            <span>
              <svg>
                <use href="#i-ask" />
              </svg>
              Q
            </span>
            <span className="on">
              <svg>
                <use href="#i-grid" />
              </svg>
              Discover
            </span>
            <span>
              <svg>
                <use href="#i-file" />
              </svg>
              Work
            </span>
            <span>
              <svg>
                <use href="#i-link" />
              </svg>
              Relationships
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
