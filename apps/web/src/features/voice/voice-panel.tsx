"use client";

import { useId } from "react";

import type { QVoiceChoice } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { InlineNotice } from "@capital-q/ui/states";

import { QPresence } from "./q-presence";
import type { VoiceSessionClient } from "./session";

/**
 * The voice surface inside the interview (CQ-Q-VOICE-001 D §44-§50,
 * §62-§63): Q's presence and state, the few controls a person needs —
 * mute, end, voice, volume — and one plain notice when something is
 * wrong. Everything else (the live transcript, the contextual controls,
 * the composer, progress) is the interview's own, shared with the typed
 * thread; this panel adds nothing that would make voice a different Q.
 */

export type VoicePanelProps = {
  readonly client: VoiceSessionClient;
  /** Public stage text while Q works ("Searching public sources"). */
  readonly detail?: string | undefined;
  readonly voice: QVoiceChoice;
  readonly voices: readonly QVoiceChoice[];
  readonly onChooseVoice: (voice: QVoiceChoice) => void;
  readonly onEnd: () => void;
  readonly notice: string | null;
  readonly onDismissNotice: () => void;
};

const VOICE_LABELS: Readonly<Record<QVoiceChoice, string>> = {
  FEMALE: "Female",
  MALE: "Male",
};

export function VoicePanel({
  client,
  detail,
  voice,
  voices,
  onChooseVoice,
  onEnd,
  notice,
  onDismissNotice,
}: VoicePanelProps) {
  const volumeId = useId();
  const busy = client.state === "CONNECTING";

  return (
    <section
      aria-label="Talking with Q"
      className="flex flex-col items-center gap-4 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-5"
      data-q-voice-panel={client.state}
    >
      <QPresence
        state={client.state}
        detail={detail}
        inputLevel={client.inputLevel}
        outputLevel={client.outputLevel}
      />

      {notice !== null ? (
        <div className="w-full max-w-(--cq-layout-narrow)">
          <InlineNotice tone="warning" title={notice}>
            <Button size="compact" variant="quiet" onClick={onDismissNotice}>
              Dismiss
            </Button>
          </InlineNotice>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="compact"
          variant={client.muted ? "primary" : "secondary"}
          aria-pressed={client.muted}
          disabled={busy || !client.connected}
          onClick={() => client.setMuted(!client.muted)}
        >
          {client.muted ? "Unmute" : "Mute"}
        </Button>
        <Button
          size="compact"
          variant="secondary"
          disabled={busy}
          onClick={onEnd}
        >
          End voice
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
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
                disabled={busy}
                onClick={() => onChooseVoice(choice)}
              >
                {VOICE_LABELS[choice]}
              </Button>
            ))}
          </div>
        ) : null}
        <label
          htmlFor={volumeId}
          className="flex items-center gap-2 cq-caption text-(--cq-text-secondary)"
        >
          Volume
          <input
            id={volumeId}
            type="range"
            min={0}
            max={100}
            defaultValue={100}
            disabled={!client.connected}
            className="w-28 accent-(--cq-accent)"
            onChange={(event) =>
              client.setVolume(Number(event.target.value) / 100)
            }
          />
        </label>
      </div>
      <p className="cq-caption text-center text-(--cq-text-tertiary)">
        You can keep typing, or tap an option, while we talk.
      </p>
    </section>
  );
}
