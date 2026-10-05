"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Q_PRESENCE_GESTURES,
  type QPresenceGesture,
  type QSentenceGesture,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { ThemeToggle } from "@/features/appearance/theme-toggle";
import {
  Q_APERTURE_STATES,
  QAperture,
  QMotionToggle,
  type QApertureState,
} from "@/features/q-aperture";
import { presenceStats } from "@/features/q-swarm/presence-gl";
import { announceQGestures } from "@/features/q-swarm/q-gestures";

/** A synthetic voice: syllables of energy with breaths between phrases. */
function useSyntheticLevel(rate: number, on: boolean): () => number {
  return useCallback(() => {
    if (!on) return 0;
    const t = performance.now() / 1000;
    const syllable = Math.max(0, Math.sin(t * rate)) ** 2;
    const phrase = Math.max(0, Math.sin(t * 0.9)) ** 0.5;
    return Math.min(1, syllable * phrase);
  }, [rate, on]);
}

const SPOKEN_ANSWER = {
  text: "Revenue doubled to 2.4 million last year. They now run offices in three cities. Honestly, that is impressive.",
  gestures: [
    { sentence: 0, gesture: "MONEY" },
    { sentence: 1, gesture: "BUILDINGS" },
    { sentence: 2, gesture: "CLAP" },
  ] satisfies QSentenceGesture[],
};

const GESTURE_LABELS: Readonly<Record<QPresenceGesture, string>> = {
  QUESTION: "Question",
  EXCLAIM: "Exclaim",
  MONEY: "Money",
  BUILDINGS: "Buildings",
  CHART_UP: "Growth",
  CLAP: "Clap",
  LAUGH: "Laugh",
  THINK_TILT: "Think tilt",
  NOD: "Nod",
  HANDS_EXPLAIN: "Hands explain",
};

function isState(value: string | null): value is QApertureState {
  return (
    value !== null && (Q_APERTURE_STATES as readonly string[]).includes(value)
  );
}

function isGesture(value: string | null): value is QPresenceGesture {
  return (
    value !== null && (Q_PRESENCE_GESTURES as readonly string[]).includes(value)
  );
}

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `playground-${String(sequence)}-${String(Date.now())}`;
};

export function PresencePlayground({
  initialState,
  initialGesture,
}: {
  readonly initialState: string | null;
  readonly initialGesture: string | null;
}) {
  const [state, setState] = useState<QApertureState>(
    isState(initialState) ? initialState : "IDLE",
  );
  const [figure, setFigure] = useState("CLOUD");
  const [renderer, setRenderer] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const input = useSyntheticLevel(5.2, state === "LISTENING");
  const output = useSyntheticLevel(
    7.4,
    state === "SPEAKING" || state === "COMPLETE",
  );

  const clearScenario = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };
  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  const gesture = useCallback((value: QPresenceGesture) => {
    announceQGestures({
      answerId: nextId(),
      gestures: [{ sentence: 0, gesture: value }],
      spoken: false,
    });
  }, []);

  // `?gesture=` plays one when the page is up, and again every few seconds
  // so a screenshot can be taken mid-gesture at any time.
  useEffect(() => {
    if (!isGesture(initialGesture)) return;
    const play = () => gesture(initialGesture);
    const first = window.setTimeout(play, 400);
    const again = window.setInterval(play, 3_400);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, [initialGesture, gesture]);

  // What the stage is forming, and whether WebGL2 draws it.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const canvas = stageRef.current?.querySelector("canvas");
      setFigure(canvas?.dataset["qFigure"] ?? "");
      setRenderer(presenceStats().renderer);
    }, 250);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => clearScenario, []);

  const heyQ = () => {
    clearScenario();
    setState("IDLE");
    later(300, () => setState("LISTENING"));
  };
  const spokenAnswer = () => {
    clearScenario();
    setState("LISTENING");
    later(1_800, () => setState("THINKING"));
    later(3_600, () => {
      setState("SPEAKING");
      announceQGestures({
        answerId: nextId(),
        gestures: SPOKEN_ANSWER.gestures,
        spoken: true,
        text: SPOKEN_ANSWER.text,
      });
    });
    later(3_600 + SPOKEN_ANSWER.text.length * 70 + 800, () =>
      setState("LISTENING"),
    );
  };

  return (
    <div className="flex flex-col gap-8" data-presence-playground>
      <div className="flex flex-wrap items-center gap-3 border-b border-(--cq-border-subtle) pb-6">
        <ThemeToggle />
        <QMotionToggle />
        <span
          className="cq-caption cq-numeric font-mono text-(--cq-text-tertiary)"
          data-presence-figure={figure}
        >
          forming {figure} ·{" "}
          {renderer === null
            ? "…"
            : renderer === "3d"
              ? "WebGL2 3D"
              : renderer === "2d"
                ? "Canvas2D"
                : "…"}
        </span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <div
          ref={stageRef}
          className="flex min-h-96 items-center justify-center rounded-(--cq-radius-lg) bg-(--cq-surface-raised) p-6"
        >
          <QAperture
            state={state}
            size="stage"
            inputLevel={input}
            outputLevel={output}
            label
          />
        </div>

        <div className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-2">
            <legend className="cq-label pb-2 text-(--cq-text-secondary)">
              Scenarios
            </legend>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={spokenAnswer}>
                A spoken answer
              </Button>
              <Button onClick={heyQ}>“Hey Q”</Button>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="cq-label pb-2 text-(--cq-text-secondary)">
              State
            </legend>
            <div className="flex flex-wrap gap-2">
              {Q_APERTURE_STATES.map((value) => (
                <Button
                  key={value}
                  variant={value === state ? "primary" : "secondary"}
                  aria-pressed={value === state}
                  onClick={() => {
                    clearScenario();
                    setState(value);
                  }}
                >
                  {value.replace("_", " ").toLowerCase()}
                </Button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="cq-label pb-2 text-(--cq-text-secondary)">
              Gestures an answer can ask for
            </legend>
            <div className="flex flex-wrap gap-2">
              {Q_PRESENCE_GESTURES.map((value) => (
                <Button
                  key={value}
                  onClick={() => gesture(value)}
                  data-gesture={value}
                >
                  {GESTURE_LABELS[value]}
                </Button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <section aria-label="Smaller surfaces" className="flex flex-col gap-3">
        <h3 className="cq-label text-(--cq-text-secondary)">
          Panel and dock sizes
        </h3>
        <div className="flex flex-wrap items-center gap-8">
          <QAperture
            state={state}
            size={96}
            inputLevel={input}
            outputLevel={output}
          />
          <QAperture
            state={state}
            size="dock"
            inputLevel={input}
            outputLevel={output}
          />
        </div>
      </section>
    </div>
  );
}
