"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { destinationPath } from "../voice/destinations";
import { useFollowTurn } from "../voice/use-follow-turn";
import { useVoiceInterview } from "../voice/use-voice-interview";
import { VoiceStage } from "../voice/voice-stage";

/**
 * Arrival (CQ-Q-VOICE-001 rework): the first minute with Q.
 *
 * A quiet field with the Q mark; one tap (the browser needs a gesture
 * before it will open a microphone or play sound); then Q speaks first,
 * introduces itself, asks what to call the person and works out from
 * whatever they say whether they are here to raise or to invest. When the
 * server's turn state names an interview, the screen goes there with the
 * voice still on. Nothing here decides anything: Q proposes, the server
 * records the name and the setup under the person's own authority.
 */

export function WelcomeScreen({
  knownName,
  knownOrganisation = null,
  returning = false,
}: {
  readonly knownName: string | null;
  /** What they said their organisation was called at sign-up, if they did. */
  readonly knownOrganisation?: string | null | undefined;
  /**
   * Whether Capital Q had this person's name before this visit. A name
   * typed at sign-up a minute ago is known, but the person is not back.
   */
  readonly returning?: boolean | undefined;
}) {
  const router = useRouter();
  const voice = useVoiceInterview();
  const [begun, setBegun] = useState(false);
  const begin = async () => {
    setBegun(true);
    await voice.talk({
      thread: {
        welcome: true,
        ...(knownOrganisation === null
          ? {}
          : { organisationHint: knownOrganisation }),
      },
    });
  };

  const turn = voice.turn;
  const end = voice.end;
  useFollowTurn(turn, voice.client, (followed) => {
    if (followed.handoff === "CHAT") {
      void end();
      return;
    }
    const path = destinationPath(followed.navigate);
    if (path !== null) {
      void end();
      router.push(path);
    }
  });

  if (voice.active) {
    return (
      <VoiceStage
        client={voice.client}
        voice={voice.voice}
        voices={["FEMALE", "MALE"]}
        onChooseVoice={(choice) => void voice.chooseVoice(choice)}
        onEnd={() => {
          void voice.end();
          router.push("/home");
        }}
        notice={voice.notice}
        onDismissNotice={voice.clearNotice}
        asking={turn?.asking ?? null}
        onSay={(text) => voice.client.sendText(text)}
        onUseForm={undefined}
        progress={[]}
      />
    );
  }

  return (
    <div
      className="cq-stage fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 px-6 text-white"
      data-q-welcome
    >
      <div className="relative flex h-56 w-56 items-center justify-center">
        <div
          aria-hidden="true"
          className="cq-stage-halo-listening cq-welcome-breathe absolute inset-0 rounded-full blur-2xl"
        />
        <div className="cq-stage-core relative flex h-36 w-36 items-center justify-center rounded-full">
          <span className="cq-stage-mark select-none text-6xl font-semibold tracking-tight">
            Q
          </span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="cq-label text-white/60">Capital Q</span>
        <h1 className="text-balance text-2xl font-semibold text-white sm:text-3xl">
          {knownName === null
            ? "Let's talk."
            : returning
              ? `Welcome back, ${knownName}.`
              : `Welcome, ${knownName}.`}
        </h1>
        <p className="cq-body max-w-md text-white/60">
          Q will introduce itself and ask a couple of questions. You can talk,
          or type if you’d rather.
        </p>
      </div>
      {voice.notice !== null ? (
        <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3">
          <span className="cq-body text-white/85">{voice.notice}</span>
          <button
            type="button"
            className="cq-stage-quiet"
            onClick={voice.clearNotice}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          className="cq-stage-primary px-8"
          disabled={begun && voice.notice === null}
          onClick={() => void begin()}
          data-q-welcome-begin
        >
          {begun && voice.notice === null ? "Connecting" : "Tap to begin"}
        </button>
        <button
          type="button"
          className="cq-stage-quiet"
          onClick={() => router.push("/home")}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
