"use client";

import "@/features/q/answer-canvas.css";

import { useEffect, useMemo, useState } from "react";

import { QAperture } from "@/features/q-aperture";
import { demoTop } from "@/features/q/answer-canvas-fixtures";
import type { QTurn } from "@/features/q/conversation";
import { QCurrentExchange } from "@/features/q/q-current-exchange";
import { QPresenceStage } from "@/features/q/q-presence-stage";
import { VoiceRoom, VoiceRoomPresence } from "@/features/q/voice-room-layout";

/**
 * The voice room over a simulated line (see page.tsx). The layout pieces
 * are the Q page's own; only the line is fake: a speaker level from a
 * deterministic syllable rhythm, and a caption that grows word by word.
 */

const ASKED = "Find me founders raising in fintech";
const SAID =
  "I found five founders raising now. The first two match your mandate on stage and cheque size; the third is earlier than you usually go, so I have marked what is unknown.";

function turnsFor(result: boolean): readonly QTurn[] {
  const person: QTurn = {
    kind: "PERSON",
    id: "p-1",
    text: ASKED,
    unconfirmed: false,
  };
  if (!result) return [person];
  return [
    person,
    {
      kind: "Q",
      id: "q-1",
      text: "I found **five** founders raising now.",
      streaming: false,
      sourceCount: 0,
      publicSources: [],
      findings: [],
      uncertainties: [],
      blocks: [{ ...demoTop(5), kind: "ANSWER_CARDS" as const }],
    },
  ];
}

/** A speaker meter's shape: syllables of a clipped, noisy level. */
function fakeLevel(): number {
  const t = performance.now() / 1000;
  const syllable = Math.max(0, Math.sin(t * Math.PI * 6.5));
  const jitter = 0.5 + 0.5 * Math.sin(t * 37.1) * Math.sin(t * 11.3);
  return Math.min(1, syllable * (0.6 + 0.8 * jitter) * 1.4);
}

function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return wide;
}

export function VoiceRoomHarness({
  initialResult,
  initialSpeaking,
}: {
  readonly initialResult: boolean;
  readonly initialSpeaking: boolean;
}) {
  const [result, setResult] = useState(initialResult);
  const [speaking, setSpeaking] = useState(initialSpeaking);
  const [words, setWords] = useState(0);
  const [objectShown, setObjectShown] = useState(false);
  const [stageObject, setStageObject] = useState<string | null>(null);
  const wide = useWide();
  // The caption grows as Q speaks, as a live line's does.
  useEffect(() => {
    if (!speaking) return;
    const all = SAID.split(" ").length;
    const timer = window.setInterval(() => {
      setWords((n) => (n >= all ? 1 : n + 1));
    }, 160);
    return () => window.clearInterval(timer);
  }, [speaking]);
  const turns = useMemo(() => turnsFor(result), [result]);
  const qSaying = speaking
    ? SAID.split(" ").slice(0, Math.max(1, words)).join(" ")
    : null;
  const compact = objectShown;
  const pixels = wide ? 280 : 200;
  const shown = compact ? (wide ? 72 : 48) : pixels;
  const state = speaking ? "SPEAKING" : "LISTENING";
  return (
    <div
      className="fixed inset-0 flex flex-col bg-(--cq-stage-canvas)"
      data-q-voice-harness
    >
      <div className="flex min-h-14 flex-none items-center px-5 cq-label text-(--cq-text-secondary)">
        Voice room harness
      </div>
      <div
        className="cq-stage-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8"
        data-q-voice-stage-body
      >
        <div
          className={`mx-auto flex w-full flex-col gap-5 py-6 ${objectShown ? "min-h-full max-w-[1180px]" : "max-w-3xl"}`}
        >
          <VoiceRoom
            compact={compact}
            resultKey={stageObject}
            aside={
              <>
                <div
                  className="cq-voice-room-presence"
                  aria-hidden="true"
                  data-q-presence="stage"
                >
                  <VoiceRoomPresence
                    compact={compact}
                    pixels={pixels}
                    shown={shown}
                    speaking={speaking}
                    outputLevel={fakeLevel}
                  >
                    <QAperture
                      state={state}
                      size={pixels}
                      outputLevel={fakeLevel}
                      stage
                      showing={compact}
                    />
                  </VoiceRoomPresence>
                </div>
                <div className="cq-voice-caption" data-q-voice-caption>
                  <div
                    className={
                      compact
                        ? "flex min-h-6 min-w-0 flex-col items-start gap-1"
                        : "flex min-h-6 flex-col items-center gap-2"
                    }
                    data-q-voice-status
                  >
                    <span
                      className="inline-flex items-center gap-2 cq-label text-(--cq-text-secondary)"
                      role="status"
                    >
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full bg-(--cq-accent)"
                      />
                      {speaking ? "Speaking" : "Listening"}
                    </span>
                  </div>
                  <QCurrentExchange
                    lines={[{ id: "p-1", role: "person", text: ASKED }]}
                    live={null}
                    qSaying={qSaying}
                    captions
                    earlier
                    onOpenChat={() => undefined}
                    cardLines={false}
                    compact={compact}
                  />
                </div>
              </>
            }
          >
            <QPresenceStage
              live
              presence={() => null}
              onShowingChange={setObjectShown}
              onStageObjectChange={setStageObject}
              turns={turns}
              captions={false}
              caption={null}
            />
          </VoiceRoom>
        </div>
      </div>
      <div className="flex flex-none flex-wrap items-center justify-center gap-2 border-t border-(--cq-border-subtle) px-5 py-3">
        <button
          type="button"
          className="cq-stage-control min-h-11"
          onClick={() => setResult(true)}
          data-harness="result"
        >
          Show result
        </button>
        <button
          type="button"
          className="cq-stage-control min-h-11"
          onClick={() => setSpeaking((on) => !on)}
          aria-pressed={speaking}
          data-harness="speak"
        >
          {speaking ? "Stop speaking" : "Speak"}
        </button>
      </div>
    </div>
  );
}
