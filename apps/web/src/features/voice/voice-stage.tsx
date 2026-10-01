"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { QVoiceChoice, QVoiceTurnState } from "@capital-q/contracts";
import { ICON_SIZE, MessageSquare, Mic, Upload, X } from "@capital-q/ui/icons";

import { apertureStateFromVoice, QAperture } from "../q-aperture";
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
  /** What leaving the stage is called where it is used: "End", "Go to chat". */
  readonly endLabel?: string | undefined;
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

/** Q's presence on the stage: the one living presence, in the stage's tones. */
function StagePresence({
  state,
  inputLevel,
  outputLevel,
}: {
  readonly state: VoiceState;
  readonly inputLevel: () => number;
  readonly outputLevel: () => number;
}) {
  return (
    <div data-q-stage-presence={state}>
      <QAperture
        state={apertureStateFromVoice(state)}
        size="stage"
        inputLevel={inputLevel}
        outputLevel={outputLevel}
      />
    </div>
  );
}

export function VoiceStage({
  client,
  voice,
  voices,
  onChooseVoice,
  onEnd,
  endLabel = "End",
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
      className="cq-stage fixed inset-0 z-(--cq-z-modal) flex flex-col text-(--cq-text-primary)"
      role="dialog"
      aria-modal="true"
      aria-label="Talking with Q"
      data-q-voice-stage={client.state}
    >
      {/* Top bar: who you're with, progress, the way out to the form. */}
      <div className="flex flex-none items-center justify-between gap-3 px-5 pt-[calc(20px+var(--cq-safe-top))] sm:px-8">
        <span className="cq-label text-(--cq-text-secondary)">Capital Q</span>
        <span className="cq-caption text-(--cq-text-tertiary)">
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
            {endLabel}
          </button>
        </div>
      </div>

      {/*
        The stage: presence, state, and what was just said. The one part
        of the screen that grows -- a long answer, the options, the whole
        transcript -- so it is the part that scrolls, between a top bar and
        controls that never leave the screen. It used to be a fixed box
        with nothing scrollable in it: a long answer pushed Mute, Type and
        the volume below the bottom edge with no way to reach them. The
        inner column centres while there is room and starts at the top
        once there is not (a centred flex box would clip its own top).
      */}
      <div
        className="cq-stage-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8"
        data-q-voice-stage-body
      >
        <div className="flex min-h-full flex-col items-center justify-center gap-6 py-4">
          <StagePresence
            state={client.state}
            inputLevel={client.inputLevel}
            outputLevel={client.outputLevel}
          />
          <div className="flex flex-col items-center gap-1" role="status">
            <span className="cq-label text-(--cq-text-primary)">
              {client.pausedAway === true
                ? "Paused while you were away"
                : client.muted
                  ? "Muted"
                  : VOICE_STATE_LABELS[client.state]}
            </span>
            {client.pausedAway === true ? (
              <span className="cq-caption text-(--cq-text-secondary)">
                Q isn&apos;t listening. Tap Unmute when you want to talk.
              </span>
            ) : null}
            {thinkingNote !== null ? (
              <span className="cq-caption text-(--cq-text-secondary)">
                {thinkingNote}
              </span>
            ) : null}
          </div>

          <div className="flex w-full max-w-2xl flex-col items-center gap-3 text-center">
            {lastQ !== undefined ? (
              <p className="cq-stage-said cq-prose text-balance text-lg leading-relaxed text-(--cq-text-primary) sm:text-xl">
                {lastQ.text}
              </p>
            ) : null}
            {lastPerson !== undefined ? (
              <p className="cq-body text-(--cq-text-secondary)">
                “{lastPerson.text}”
              </p>
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
              className="cq-stage-scroll w-full max-w-2xl flex-none space-y-3 overflow-y-auto rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) p-4"
              style={{ maxHeight: "32vh" }}
              aria-label="Everything we've said"
            >
              {lines.map((line) => (
                <li
                  key={line.id}
                  className={
                    line.role === "user"
                      ? "cq-body text-right text-(--cq-text-secondary)"
                      : "cq-body text-(--cq-text-primary)"
                  }
                >
                  {line.text}
                </li>
              ))}
            </ol>
          ) : null}

          {uploadNote !== null && uploadNote !== undefined ? (
            <span className="cq-caption text-(--cq-text-secondary)">
              {uploadNote}
            </span>
          ) : null}
          {notice !== null ? (
            <div className="flex items-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-3">
              <span className="cq-body text-(--cq-text-primary)">{notice}</span>
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
              <span className="cq-caption text-(--cq-text-tertiary)">
                Tap one, or just say it.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Controls: always on screen, clear of the home indicator. */}
      <div
        className="flex flex-none flex-col items-center gap-4 border-t border-(--cq-border-subtle) px-5 pt-4 pb-[calc(24px+var(--cq-safe-bottom))] sm:px-8"
        data-q-voice-stage-controls
      >
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
              // min-w-0: an input's intrinsic width otherwise pushed Cancel
              // off the right edge of a phone.
              className="cq-stage-input min-w-0"
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
          <label className="flex items-center gap-2 cq-caption text-(--cq-text-secondary)">
            Volume
            <input
              type="range"
              min={0}
              max={100}
              defaultValue={100}
              disabled={!client.connected}
              className="w-24 accent-(--cq-accent)"
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
