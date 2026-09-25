"use client";

import { useState } from "react";

import type { QVoiceChoice, QVoiceTurnState } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button, IconButton } from "@capital-q/ui/button";
import {
  Download,
  History,
  ICON_SIZE,
  ICON_STROKE,
  Keyboard,
  Mic,
  MicOff,
  SlidersHorizontal,
  Square,
} from "@capital-q/ui/icons";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@capital-q/ui/popover";
import { Tooltip } from "@capital-q/ui/tooltip";

import { ViewTransition } from "@/components/view-transition";

import { QAperture, type QApertureState } from "../q-aperture";

/**
 * The head of the Q surface: Q's presence, one word for what it is doing,
 * and the controls a hand needs — talk, type, history, and while talking,
 * mute, settings and end. Speech is the prominent way in; typing is one
 * key away and never hidden. Every control is an icon with an accessible
 * name and a tooltip; the presence never carries meaning alone.
 *
 * Nothing here decides anything. The words are the conversation's; the
 * options are the turn's own; a tap and a spoken answer take the same
 * path.
 */

export type QStageProps = {
  readonly state: QApertureState;
  readonly inputLevel: () => number;
  readonly outputLevel: () => number;
  /** The word under the presence; the state's own by default. */
  readonly label?: string | undefined;
  /** An approved stage, or the context, under the word. */
  readonly detail?: string | undefined;
  /** False when this build has no Q API: the controls say so and send nothing. */
  readonly connected: boolean;
  readonly voiceActive: boolean;
  readonly muted: boolean;
  readonly voice: QVoiceChoice;
  readonly voices: readonly QVoiceChoice[];
  readonly onTalk: () => void;
  readonly onEnd: () => void;
  readonly onMute: (muted: boolean) => void;
  readonly onVolume: (volume: number) => void;
  readonly onChooseVoice: (voice: QVoiceChoice) => void;
  /** Put the caret in the composer. */
  readonly onType: () => void;
  readonly onHistory: () => void;
  /** Save the conversation as text; absent until there is one. */
  readonly onDownload?: (() => void) | undefined;
  /** What Q is asking while talking; options are offered only when Q chose to. */
  readonly asking: QVoiceTurnState["asking"];
  readonly onSay: (text: string) => void;
  readonly className?: string | undefined;
};

const VOICE_LABELS: Readonly<Record<QVoiceChoice, string>> = {
  FEMALE: "Female",
  MALE: "Male",
};

function Control({
  label,
  onClick,
  pressed,
  disabled,
  children,
  testId,
}: {
  readonly label: string;
  readonly onClick?: (() => void) | undefined;
  readonly pressed?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly children: React.ReactNode;
  readonly testId: string;
}) {
  return (
    <Tooltip content={label}>
      <IconButton
        aria-label={label}
        variant="quiet"
        className={cx(
          "rounded-full text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
          pressed === true ? "bg-(--cq-accent-soft) text-(--cq-accent)" : "",
        )}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        data-q-control={testId}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

export function QStage({
  state,
  inputLevel,
  outputLevel,
  label,
  detail,
  connected,
  voiceActive,
  muted,
  voice,
  voices,
  onTalk,
  onEnd,
  onMute,
  onVolume,
  onChooseVoice,
  onType,
  onHistory,
  onDownload,
  asking,
  onSay,
  className,
}: QStageProps) {
  const [picks, setPicks] = useState<readonly string[]>([]);
  // A new step means fresh picks.
  const stepKey = asking?.stepKey ?? null;
  const [picksFor, setPicksFor] = useState<string | null>(stepKey);
  if (picksFor !== stepKey) {
    setPicksFor(stepKey);
    setPicks([]);
  }
  const showOptions =
    voiceActive && asking !== null && asking.options.length > 0;
  const multi = asking?.kind === "MANY_OF";

  const primaryLabel = !connected
    ? "Q isn't connected on this build"
    : voiceActive
      ? "End voice"
      : "Talk with Q";

  return (
    <section
      aria-label="Q"
      className={cx("flex flex-col items-center gap-5", className)}
      data-q-stage={voiceActive ? "voice" : "ready"}
    >
      {/* The dock's aperture, grown: the same object on the Q page. */}
      <ViewTransition name="q-aperture" share="cq-q-morph" default="none">
        <QAperture
          state={state}
          size="stage"
          inputLevel={inputLevel}
          outputLevel={outputLevel}
          label={label ?? true}
          detail={detail}
        />
      </ViewTransition>

      {showOptions && asking !== null ? (
        <div
          className="flex w-full max-w-(--cq-layout-narrow) flex-col items-center gap-2"
          data-q-stage-options
        >
          <div
            className="flex flex-wrap justify-center gap-2"
            role="group"
            aria-label="Options"
          >
            {asking.options.map((option) => {
              const selected = multi && picks.includes(option.key);
              return (
                <Button
                  key={option.key}
                  size="compact"
                  variant={selected ? "primary" : "secondary"}
                  title={option.description}
                  aria-pressed={multi ? selected : undefined}
                  onClick={() => {
                    if (!multi) {
                      onSay(option.label);
                      return;
                    }
                    setPicks((current) =>
                      current.includes(option.key)
                        ? current.filter((item) => item !== option.key)
                        : [...current, option.key],
                    );
                  }}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          {multi && picks.length > 0 ? (
            <Button
              size="compact"
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
            </Button>
          ) : null}
          <span className="cq-caption text-(--cq-text-tertiary)">
            Tap one, or just say it.
          </span>
        </div>
      ) : null}

      <div
        className="flex items-center justify-center gap-2 sm:gap-3"
        role="toolbar"
        aria-label="Q controls"
      >
        {voiceActive ? (
          <Control
            label={muted ? "Unmute microphone" : "Mute microphone"}
            pressed={muted}
            onClick={() => onMute(!muted)}
            testId="mute"
          >
            {muted ? (
              <MicOff
                aria-hidden="true"
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
              />
            ) : (
              <Mic
                aria-hidden="true"
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
              />
            )}
          </Control>
        ) : (
          <Control
            label="Previous conversations"
            onClick={onHistory}
            testId="history"
          >
            <History
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          </Control>
        )}

        <Control label="Type to Q" onClick={onType} testId="type">
          <Keyboard
            aria-hidden="true"
            size={ICON_SIZE.prominent}
            strokeWidth={ICON_STROKE}
          />
        </Control>

        <Tooltip content={primaryLabel}>
          <button
            type="button"
            aria-label={primaryLabel}
            disabled={!connected}
            onClick={voiceActive ? onEnd : onTalk}
            data-q-control={voiceActive ? "end" : "talk"}
            className={cx(
              "mx-1 inline-flex size-16 items-center justify-center rounded-full transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:pointer-events-none disabled:opacity-50",
              voiceActive
                ? "border border-(--cq-border-strong) bg-(--cq-surface-raised) text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
                : "bg-(--cq-accent) text-(--cq-text-inverse) shadow-(--cq-shadow-xs) hover:bg-(--cq-accent-hover)",
            )}
          >
            {voiceActive ? (
              <Square aria-hidden="true" size={24} strokeWidth={2} />
            ) : (
              <Mic aria-hidden="true" size={26} strokeWidth={2} />
            )}
          </button>
        </Tooltip>

        {voiceActive ? (
          <PopoverRoot>
            <PopoverTrigger>
              <IconButton
                aria-label="Voice settings"
                variant="quiet"
                className="rounded-full text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
                data-q-control="settings"
              >
                <SlidersHorizontal
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent title="Voice">
              <div className="flex flex-col gap-4">
                {voices.length > 1 ? (
                  <div
                    className="flex items-center gap-1"
                    role="group"
                    aria-label="Q's voice"
                  >
                    {voices.map((choice) => (
                      <Button
                        key={choice}
                        size="compact"
                        variant={choice === voice ? "primary" : "quiet"}
                        aria-pressed={choice === voice}
                        onClick={() => onChooseVoice(choice)}
                      >
                        {VOICE_LABELS[choice]}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <label className="flex items-center gap-3 cq-caption text-(--cq-text-secondary)">
                  Volume
                  <input
                    type="range"
                    min={0}
                    max={100}
                    defaultValue={100}
                    className="w-full accent-(--cq-accent)"
                    onChange={(event) =>
                      onVolume(Number(event.target.value) / 100)
                    }
                  />
                </label>
              </div>
            </PopoverContent>
          </PopoverRoot>
        ) : (
          <Control
            label="Save this conversation"
            onClick={onDownload}
            disabled={onDownload === undefined}
            testId="download"
          >
            <Download
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          </Control>
        )}

        {voiceActive ? (
          <Control
            label="Previous conversations"
            onClick={onHistory}
            testId="history"
          >
            <History
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          </Control>
        ) : null}
      </div>
    </section>
  );
}
