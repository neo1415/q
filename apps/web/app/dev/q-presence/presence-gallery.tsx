"use client";

import { useCallback, useEffect, useState } from "react";

import { ThemeToggle } from "@/features/appearance/theme-toggle";
import {
  QAperture,
  QLumen,
  QMotionToggle,
  type QApertureState,
} from "@/features/q-aperture";

/** A synthetic voice: syllables of energy, so the reactive states move. */
function useSyntheticLevel(rate: number, on: boolean): () => number {
  return useCallback(() => {
    if (!on) return 0;
    const t = performance.now() / 1000;
    const syllable = Math.max(0, Math.sin(t * rate)) ** 2;
    const breath = 0.5 + 0.5 * Math.sin(t * 0.7);
    return Math.min(1, syllable * (0.4 + breath * 0.6));
  }, [rate, on]);
}

type Stats = {
  readonly contexts: number;
  readonly frames: number;
  readonly draws: number;
  readonly running: boolean;
  readonly slots: number;
};

/** The shared renderer's counters, read twice a second (no animation frame). */
function useRendererStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = window.setInterval(() => {
      void import("@/features/q-aperture/renderer").then((renderer) => {
        if (alive) setStats(renderer.apertureStats());
      });
    }, 500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return stats;
}

function Row({
  title,
  states,
  size,
  input,
  output,
  progress,
}: {
  readonly title: string;
  readonly states: readonly QApertureState[];
  readonly size: "stage" | "dock";
  readonly input: () => number;
  readonly output: () => number;
  readonly progress: number | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="cq-label text-(--cq-text-secondary)">{title}</h3>
      <ul
        className={
          size === "stage"
            ? "grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 xl:grid-cols-5"
            : "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
        }
      >
        {states.map((state) =>
          size === "stage" ? (
            <li key={state} className="flex flex-col items-center">
              <QAperture
                state={state}
                size="stage"
                inputLevel={input}
                outputLevel={output}
                progress={state === "WORKING" ? progress : null}
                label
                detail={state}
              />
            </li>
          ) : (
            <li key={state} className="flex items-center gap-3">
              <QAperture
                state={state}
                size="dock"
                inputLevel={input}
                outputLevel={output}
                progress={state === "WORKING" ? progress : null}
              />
              <span className="flex flex-col">
                <span className="cq-label text-(--cq-text-primary)">
                  {state === "IDLE"
                    ? "Q"
                    : state.replace("_", " ").toLowerCase()}
                </span>
                <span className="cq-caption font-mono text-(--cq-text-tertiary)">
                  {state}
                </span>
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export function ApertureGallery({
  states,
  showStage,
  showDock,
}: {
  readonly states: readonly QApertureState[];
  readonly showStage: boolean;
  readonly showDock: boolean;
}) {
  const [audio, setAudio] = useState(true);
  const [known, setKnown] = useState(true);
  const [percent, setPercent] = useState(40);
  const [lumen, setLumen] = useState(false);
  const input = useSyntheticLevel(5.2, audio);
  const output = useSyntheticLevel(3.8, audio);
  const progress = known ? percent / 100 : null;
  const stats = useRendererStats();
  const [cost, setCost] = useState<{
    readonly dock: number | null;
    readonly stage: number | null;
  } | null>(null);

  const rows = (
    <>
      {showStage ? (
        <Row
          title="Stage size"
          states={states}
          size="stage"
          input={input}
          output={output}
          progress={progress}
        />
      ) : null}
      {showDock ? (
        <Row
          title="Dock size"
          states={states}
          size="dock"
          input={input}
          output={output}
          progress={progress}
        />
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-8" data-aperture-gallery>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-(--cq-border-subtle) pb-6">
        <label className="flex items-center gap-2 cq-body-sm">
          Theme <ThemeToggle display="icons" />
        </label>
        <div className="flex items-center gap-2 cq-body-sm">
          Q motion <QMotionToggle />
        </div>
        <label className="flex items-center gap-2 cq-body-sm">
          <input
            type="checkbox"
            checked={audio}
            onChange={(event) => setAudio(event.target.checked)}
          />
          Synthetic audio
        </label>
        <label className="flex items-center gap-2 cq-body-sm">
          <input
            type="checkbox"
            checked={known}
            onChange={(event) => setKnown(event.target.checked)}
          />
          Progress known
          <input
            type="range"
            min={0}
            max={100}
            value={percent}
            disabled={!known}
            onChange={(event) => setPercent(Number(event.target.value))}
            aria-label="Progress"
          />
        </label>
        <label className="flex items-center gap-2 cq-body-sm">
          <input
            type="checkbox"
            checked={lumen}
            onChange={(event) => setLumen(event.target.checked)}
          />
          Q Lumen
        </label>
        <button
          type="button"
          className="cq-appearance-option"
          onClick={() => {
            void import("@/features/q-aperture/renderer").then((renderer) => {
              const dpr = Math.min(2, window.devicePixelRatio || 1);
              setCost({
                dock: renderer.measureDraw(Math.round(40 * dpr)),
                stage: renderer.measureDraw(Math.round(224 * dpr)),
              });
            });
          }}
          data-aperture-measure
        >
          Measure draw cost
        </button>
        {cost === null ? null : (
          <p
            className="cq-caption cq-numeric font-mono text-(--cq-text-tertiary)"
            data-aperture-cost={JSON.stringify(cost)}
          >
            {`ms/frame incl. gl.finish · dock ${cost.dock?.toFixed(3) ?? "n/a"} · stage ${cost.stage?.toFixed(3) ?? "n/a"}`}
          </p>
        )}
        <p
          className="cq-caption cq-numeric font-mono text-(--cq-text-tertiary)"
          data-aperture-stats={
            stats === null ? undefined : JSON.stringify(stats)
          }
        >
          {stats === null
            ? "renderer not loaded"
            : `contexts ${String(stats.contexts)} · slots ${String(stats.slots)} · frames ${String(stats.frames)} · draws ${String(stats.draws)} · ${stats.running ? "running" : "at rest"}`}
        </p>
      </div>

      <section aria-label="App surface" className="flex flex-col gap-8">
        <h2 className="cq-title-sm">App surface</h2>
        {rows}
      </section>

      <section
        aria-label="Stage surface"
        className="cq-stage flex flex-col gap-8 rounded-lg p-6"
        data-gallery-stage
      >
        <h2 className="cq-title-sm">Stage</h2>
        {rows}
      </section>

      <QLumen active={lumen} input={input} output={output} />
    </div>
  );
}
