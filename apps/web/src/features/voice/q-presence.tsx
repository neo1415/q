"use client";

import { QPresence as Presence, presenceStateFromVoice } from "../q-presence";
import { VOICE_STATE_LABELS, type VoiceState } from "./session";

/**
 * Q's presence while speaking and listening, as the voice panel names it:
 * the one living presence (`features/q-presence`), driven by the session's
 * own state and levels, with the voice state's public label beneath. The
 * label is the meaning; the visual never carries it alone.
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
    <Presence
      state={presenceStateFromVoice(state)}
      size={96}
      inputLevel={inputLevel}
      outputLevel={outputLevel}
      label={VOICE_STATE_LABELS[state]}
      detail={detail}
      className={className}
    />
  );
}
