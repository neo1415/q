"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { QVoiceChoice, QVoiceTurnState } from "@capital-q/contracts";
import { ICON_SIZE, MessageSquare, Mic, Upload, X } from "@capital-q/ui/icons";

import type { VoiceSessionClient, VoiceState } from "./session";
import { VOICE_STATE_LABELS } from "./session";

/**
 * The voice stage (CQ-Q-VOICE-001 rework): when the person talks with Q,
 * the screen is Q. A dark, quiet field; Q's mark breathing with the sound
 * of its own voice and of the person's; what was just said, in words,
 * beneath it; the few controls a hand needs; and options only when Q is
 * genuinely asking a choice — to tap, or simply to say.
 *
 * Nothing here decides anything. The words are the interview's; the
 * options are the step's own; a tap and a spoken answer take the same
 * path.
 */

export type VoiceStageProps = {
  readonly client: VoiceSessionClient;
  readonly voice: QVoiceChoice;
  readonly voices: readonly QVoiceChoice[];
  readonly onChooseVoice: (voice: QVoiceChoice) => void;
  readonly onEnd: () => void;
  readonly notice: string | null;
  readonly onDismissNotice: () => void;
  /** What Q is asking after its latest turn; options are offered only when Q chose to show them. */
  readonly asking: QVoiceTurnState["asking"];
  /** A tapped option, a set of them, or typed words: said to Q, the same path as speaking. */
  readonly onSay: (text: string) => void;
  readonly onUseForm: (() => void) | undefined;
  /** Drop a deck or profile in while talking; Q reads it back next. */
  readonly onUpload?: ((file: File) => Promise<void>) | undefined;
  /** What the surface says about a document in flight, if any. */
  readonly uploadNote?: string | null | undefined;
  readonly progress: readonly {
    readonly label: string;
    readonly done: number;
    readonly total: number;
  }[];
};

const VOICE_LABELS: Readonly<Record<QVoiceChoice, string>> = {
  FEMALE: "Female",
  MALE: "Male",
};

/** Q's mark on the stage: breathes with the audio it hears and speaks. */
function StagePresence({
  state,
  inputLevel,
  outputLevel,
}: {
  readonly state: VoiceState;
  readonly inputLevel: () => number;
  readonly outputLevel: () => number;
}) {
  const haloRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const halo = haloRef.current;
    const core = coreRef.current;
    if (halo === null || core === null) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      halo.style.transform = "scale(1)";
      core.style.transform = "scale(1)";
      return;
    }
    let frame = 0;
    let haloScale = 1;
    let coreScale = 1;
    const tick = () => {
      const speaking = state === "Q_SPEAKING";
      const level = speaking
        ? outputLevel()
        : state === "LISTENING" || state === "USER_SPEAKING"
          ? inputLevel()
          : 0;
      const target = 1 + Math.min(1, level * 1.8) * (speaking ? 0.35 : 0.2);
      haloScale += (target - haloScale) * 0.18;
      coreScale += (1 + (target - 1) * 0.3 - coreScale) * 0.2;
      halo.style.transform = `scale(${haloScale.toFixed(3)})`;
      core.style.transform = `scale(${coreScale.toFixed(3)})`;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [state, inputLevel, outputLevel]);

  return (
    <div
      className="relative flex h-44 w-44 items-center justify-center sm:h-56 sm:w-56"
      data-q-stage-presence={state}
    >
      <div
        ref={haloRef}
        aria-hidden="true"
        className={[
          "absolute inset-0 rounded-full blur-2xl transition-opacity duration-500",
          state === "Q_SPEAKING"
            ? "cq-stage-halo-speaking opacity-90"
            : state === "THINKING"
              ? "cq-stage-halo-thinking opacity-70"
              : state === "ERROR"
                ? "cq-stage-halo-error opacity-60"
                : "cq-stage-halo-listening opacity-60",
        ].join(" ")}
      />
      <div
        ref={coreRef}
        aria-hidden="true"
        className="cq-stage-core relative flex h-28 w-28 items-center justify-center rounded-full sm:h-36 sm:w-36"
      >
        <span className="cq-stage-mark select-none text-5xl font-semibold tracking-tight sm:text-6xl">
          Q
        </span>
      </div>
    </div>
  );
}

export function VoiceStage({
  client,
  voice,
  voices,
  onChooseVoice,
  onEnd,
  notice,
  onDismissNotice,
  asking,
  onSay,
  onUseForm,
  onUpload,
  uploadNote,
  progress,
}: VoiceStageProps) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [picks, setPicks] = useState<readonly string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const inputId = useId();
  const fileId = useId();
  const [uploading, setUploading] = useState(false);
  // How long Q has been thinking, so a long turn reads as work, not a hang.
  // Counted by a clock while the state lasts; read only while it lasts.
  const [thinking, setThinking] = useState<{
    readonly startedAt: number;
    readonly now: number;
  } | null>(null);
  useEffect(() => {
    if (client.state !== "THINKING") return;
    const startedAt = Date.now();
    const tick = () => setThinking({ startedAt, now: Date.now() });
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [client.state]);
  const thinkingFor =
    client.state === "THINKING" && thinking !== null
      ? thinking.now - thinking.startedAt
      : 0;
  const thinkingNote =
    client.state !== "THINKING"
      ? null
      : thinkingFor > 14_000
        ? "Still on it. This one takes a moment."
        : thinkingFor > 5_000
          ? "Working on it"
          : null;
  const listRef = useRef<HTMLOListElement>(null);

  const lines = client.transcript;
  const lastQ = [...lines].reverse().find((line) => line.role === "q");
  const lastPerson = [...lines].reverse().find((line) => line.role === "user");

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines.length]);

  // A new step means fresh picks.
  const stepKey = asking?.stepKey ?? null;
  const [picksFor, setPicksFor] = useState<string | null>(stepKey);
  if (picksFor !== stepKey) {
    setPicksFor(stepKey);
    setPicks([]);
  }

  const showOptions =
    asking !== null &&
    asking.options.length > 0 &&
    client.state !== "CONNECTING";
  const multi = asking?.kind === "MANY_OF";
  const done = progress.reduce((n, line) => n + line.done, 0);
  const total = progress.reduce((n, line) => n + line.total, 0);

  const submitTyped = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0) {
      return;
    }
    onSay(text);
    setDraft("");
    setTyping(false);
  };

  return (
    <div
      className="cq-stage fixed inset-0 z-50 flex flex-col text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Talking with Q"
      data-q-voice-stage={client.state}
    >
      {/* Top bar: who you're with, progress, the way out to the form. */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-8">
        <span className="cq-label text-white/60">Capital Q</span>
        <span className="cq-caption text-white/45">
          {total > 0 ? `${String(done)} of ${String(total)} covered` : ""}
        </span>
        <div className="flex items-center gap-2">
          {onUseForm !== undefined ? (
            <button
              type="button"
              className="cq-stage-quiet"
              onClick={onUseForm}
            >
              Use the form
            </button>
          ) : null}
          <button type="button" className="cq-stage-quiet" onClick={onEnd}>
            <X size={ICON_SIZE.compact} aria-hidden="true" />
            End
          </button>
        </div>
      </div>

      {/* The stage: presence, state, and what was just said. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 sm:px-8">
        <StagePresence
          state={client.state}
          inputLevel={client.inputLevel}
          outputLevel={client.outputLevel}
        />
        <div className="flex flex-col items-center gap-1" role="status">
          <span className="cq-label text-white/70">
            {client.muted ? "Muted" : VOICE_STATE_LABELS[client.state]}
          </span>
          {thinkingNote !== null ? (
            <span className="cq-caption text-white/45">{thinkingNote}</span>
          ) : null}
        </div>

        <div className="flex w-full max-w-2xl flex-col items-center gap-3 text-center">
          {lastQ !== undefined ? (
            <p className="cq-stage-said text-balance text-lg leading-relaxed text-white sm:text-xl">
              {lastQ.text}
            </p>
          ) : null}
          {lastPerson !== undefined ? (
            <p className="cq-body text-white/55">“{lastPerson.text}”</p>
          ) : null}
          {lines.length > 2 ? (
            <button
              type="button"
              className="cq-stage-quiet"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? "Hide what we said" : "Everything we’ve said"}
            </button>
          ) : null}
        </div>

        {showAll ? (
          <ol
            ref={listRef}
            className="cq-stage-scroll w-full max-w-2xl flex-none space-y-3 overflow-y-auto rounded-2xl bg-white/5 p-4"
            style={{ maxHeight: "32vh" }}
            aria-label="Everything we've said"
          >
            {lines.map((line) => (
              <li
                key={line.id}
                className={
                  line.role === "user"
                    ? "cq-body text-right text-white/60"
                    : "cq-body text-white/90"
                }
              >
                {line.text}
              </li>
            ))}
          </ol>
        ) : null}

        {uploadNote !== null && uploadNote !== undefined ? (
          <span className="cq-caption text-white/55">{uploadNote}</span>
        ) : null}
        {notice !== null ? (
          <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3">
            <span className="cq-body text-white/85">{notice}</span>
            <button
              type="button"
              className="cq-stage-quiet"
              onClick={onDismissNotice}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {showOptions && asking !== null ? (
          <div
            className="flex w-full max-w-2xl flex-col items-center gap-3"
            data-q-stage-options
          >
            <div
              className="flex flex-wrap justify-center gap-2"
              role="group"
              aria-label="Options"
            >
              {asking.options.map((option) => {
                const key = option.key;
                const selected = multi && picks.includes(key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    title={option.description}
                    aria-pressed={multi ? selected : undefined}
                    className={
                      selected
                        ? "cq-stage-option is-selected"
                        : "cq-stage-option"
                    }
                    onClick={() => {
                      if (!multi) {
                        onSay(option.label);
                        return;
                      }
                      setPicks((current) =>
                        current.includes(key)
                          ? current.filter((item) => item !== key)
                          : [...current, key],
                      );
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {multi && picks.length > 0 ? (
              <button
                type="button"
                className="cq-stage-primary"
                onClick={() => {
                  onSay(
                    asking.options
                      .filter((option) => picks.includes(option.key))
                      .map((option) => option.label)
                      .join(", "),
                  );
                  setPicks([]);
                }}
              >
                That’s all of them
              </button>
            ) : null}
            <span className="cq-caption text-white/40">
              Tap one, or just say it.
            </span>
          </div>
        ) : null}
      </div>

      {/* Controls. */}
      <div className="flex flex-col items-center gap-4 px-5 pb-6 sm:px-8">
        {typing ? (
          <form
            onSubmit={submitTyped}
            className="flex w-full max-w-2xl items-center gap-2"
          >
            <label htmlFor={inputId} className="sr-only">
              Type to Q
            </label>
            <input
              id={inputId}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type instead"
              autoComplete="off"
              className="cq-stage-input"
            />
            <button type="submit" className="cq-stage-primary">
              Send
            </button>
            <button
              type="button"
              className="cq-stage-quiet"
              onClick={() => setTyping(false)}
            >
              Cancel
            </button>
          </form>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className={
              client.muted ? "cq-stage-control is-active" : "cq-stage-control"
            }
            aria-pressed={client.muted}
            disabled={!client.connected}
            onClick={() => client.setMuted(!client.muted)}
          >
            <Mic size={ICON_SIZE.compact} aria-hidden="true" />
            {client.muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            className={
              typing ? "cq-stage-control is-active" : "cq-stage-control"
            }
            aria-pressed={typing}
            onClick={() => setTyping((current) => !current)}
          >
            <MessageSquare size={ICON_SIZE.compact} aria-hidden="true" />
            Type
          </button>
          {onUpload !== undefined ? (
            <>
              <input
                id={fileId}
                type="file"
                accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,application/pdf"
                className="sr-only"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file === undefined) return;
                  setUploading(true);
                  void onUpload(file).finally(() => setUploading(false));
                }}
              />
              <label
                htmlFor={fileId}
                className={
                  uploading ? "cq-stage-control is-active" : "cq-stage-control"
                }
                aria-busy={uploading}
              >
                <Upload size={ICON_SIZE.compact} aria-hidden="true" />
                {uploading ? "Reading" : "Upload"}
              </label>
            </>
          ) : null}
          {voices.length > 1 ? (
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Q's voice"
            >
              {voices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={
                    choice === voice
                      ? "cq-stage-control is-active"
                      : "cq-stage-control"
                  }
                  aria-pressed={choice === voice}
                  onClick={() => onChooseVoice(choice)}
                >
                  {VOICE_LABELS[choice]}
                </button>
              ))}
            </div>
          ) : null}
          <label className="flex items-center gap-2 cq-caption text-white/50">
            Volume
            <input
              type="range"
              min={0}
              max={100}
              defaultValue={100}
              disabled={!client.connected}
              className="w-24 accent-white"
              onChange={(event) =>
                client.setVolume(Number(event.target.value) / 100)
              }
            />
          </label>
        </div>
      </div>
    </div>
  );
}
