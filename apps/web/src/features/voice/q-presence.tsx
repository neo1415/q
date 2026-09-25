"use client";

import { apertureStateFromVoice, QAperture } from "../q-aperture";
import { VOICE_STATE_LABELS, type VoiceState } from "./session";

/**
 * Q's presence while speaking and listening, as the voice panel names it:
 * the Q Aperture (`features/q-aperture`), driven by the session's own
 * state and levels, with the voice state's public label beneath. The
 * label is the meaning; the light never carries it alone.
 */

export type QPresenceProps = {
  readonly state: VoiceState;
  /** Public stage text while Q works ("Searching public sources"). */
  readonly detail?: string | undefined;
  readonly inputLevel: () => number;
  readonly outputLevel: () => number;
  readonly className?: string | undefined;
};

export function QPresence({
  state,
  detail,
  inputLevel,
  outputLevel,
  className,
}: QPresenceProps) {
  return (
    <QAperture
      state={apertureStateFromVoice(state)}
      size={96}
      inputLevel={inputLevel}
      outputLevel={outputLevel}
      label={VOICE_STATE_LABELS[state]}
      detail={detail}
      className={className}
    />
  );
}
