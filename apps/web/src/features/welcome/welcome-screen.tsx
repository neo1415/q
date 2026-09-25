"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PersonaCards } from "../persona/persona-cards";
import { destinationPath } from "../voice/destinations";
import { useFollowTurn } from "../voice/use-follow-turn";
import { useQSpeech } from "../voice/use-q-speech";
import { useVoiceInterview } from "../voice/use-voice-interview";
import { VoiceStage } from "../voice/voice-stage";
import { QAperture } from "../q-aperture";

/**
 * The first minute with Q (QX-002 §A1-§A7).
 *
 * Q introduces itself, the person decides when to start, and then Q asks
 * the one question that decides everything after it — with both answers
 * on screen as real options rather than as a hope that somebody types the
 * right sentence.
 *
 * Three things this gets right that the previous arrival did not.
 *
 * **Reading Q never needs a microphone.** The introduction is text on the
 * screen from the moment the page loads. Q also says it aloud, through
 * one-way synthesis on the server, which needs nothing from the browser
 * but a speaker (Q-FIRST-RUN-TTS-001). Talking *with* Q is a two-way
 * session and genuinely needs the microphone, so it is an offer and never
 * a gate: a person who declines, or whose browser blocks it, reads and
 * hears the same introduction and continues to the same onboarding.
 *
 * **Q does not start interrogating anybody.** Nothing is asked until the
 * person presses Start. An introduction that immediately becomes a
 * question is not an introduction.
 *
 * **The choice is visible.** "What do you want to do?" with no options is
 * a prompt, not a product. Both roles are on screen, selectable by
 * keyboard, and remain there while Q is speaking — so answering aloud and
 * answering with a click are the same choice, not two different flows.
 *
 * Nothing here decides identity. Choosing a card navigates to that
 * onboarding path, and the canonical role is established there under the
 * person's own authority, exactly as it was before.
 */

/**
 * What Q says first.
 *
 * Bounded product copy rather than a model call: this is the first thing
 * anybody reads, it must be identical every time, and rendering a page
 * must not wait on a provider. The name is the only thing that varies,
 * and only when Capital Q already has one.
 */
function introduction(knownName: string | null): readonly string[] {
  return [
    knownName === null ? "Hi, I'm Q." : `Hi ${knownName}, I'm Q.`,
    "I'll help you understand where you are, prepare what you need, and move through the capital process without making you repeat yourself.",
    "I work from whatever you already have. You can talk to me or type — whichever you prefer.",
  ];
}

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
  const speech = useQSpeech();
  const [started, setStarted] = useState(false);

  const lines = introduction(knownName);
  const spoken = lines.join(" ");

  /**
   * Q says the introduction once, on arrival.
   *
   * Not for somebody who is back: a greeting replayed on every visit stops
   * being a greeting. Not while the two-way stage is open either, because
   * Q is already talking there. If the browser will not start audio
   * without a gesture, `useQSpeech` says so and the offer below appears —
   * nothing here waits on any of it, and Start is reachable throughout.
   */
  const said = useRef(false);
  const say = speech.say;
  useEffect(() => {
    if (returning || voice.active || said.current) {
      return;
    }
    said.current = true;
    void say(spoken);
  }, [returning, voice.active, say, spoken]);

  // Two Qs talking over each other is worse than either alone: the
  // introduction stops when the two-way stage opens.
  const stopSpeaking = speech.stop;
  useEffect(() => {
    if (voice.active) {
      stopSpeaking();
    }
  }, [voice.active, stopSpeaking]);

  const begin = async () => {
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
        }}
        endLabel="Back"
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
      className="cq-stage fixed inset-0 z-(--cq-z-modal) overflow-y-auto px-6 py-10 text-(--cq-text-primary)"
      data-q-welcome
    >
      <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-8">
        {/* Q's presence: speaking while the introduction is read aloud,
            thinking while it is fetched, otherwise still. */}
        <QAperture
          state={
            speech.status === "speaking"
              ? "SPEAKING"
              : speech.status === "loading"
                ? "THINKING"
                : "IDLE"
          }
          size="stage"
        />

        {/* Q's introduction, readable without a microphone, a provider or
            a permission prompt. */}
        <div
          className="flex flex-col items-center gap-3 text-center"
          data-q-intro
        >
          <span className="cq-label text-(--cq-text-secondary)">
            {returning ? "Capital Q" : "Welcome to Capital Q"}
          </span>
          {lines.map((line, index) => (
            <p
              key={line}
              className={
                index === 0
                  ? "cq-title-lg text-balance text-(--cq-text-primary)"
                  : "cq-body cq-prose text-(--cq-text-secondary)"
              }
            >
              {line}
            </p>
          ))}
        </div>

        {voice.notice !== null ? (
          <div className="flex items-center gap-3 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-3">
            <span className="cq-body text-(--cq-text-primary)">
              {voice.notice}
            </span>
            <button
              type="button"
              className="cq-stage-quiet"
              onClick={voice.clearNotice}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {/*
          Hearing Q, as a control rather than as something that happens to
          you. "Hear Q" appears only when the browser actually refused to
          start audio on its own; the rest of the time this is a mute
          toggle, and a failed synthesis shows nothing at all.
        */}
        <div className="flex items-center gap-3" data-q-speech={speech.status}>
          {speech.status === "blocked" ? (
            <button
              type="button"
              className="cq-stage-quiet"
              onClick={speech.play}
              data-q-speech-play
            >
              Hear Q
            </button>
          ) : null}
          {speech.status === "unavailable" ? null : (
            <button
              type="button"
              className="cq-stage-quiet"
              onClick={speech.toggleMuted}
              aria-pressed={speech.muted}
              data-q-speech-mute
            >
              {speech.muted ? "Unmute Q" : "Mute Q"}
            </button>
          )}
        </div>

        {started ? (
          // Q's first question, with both answers on screen. The cards are
          // the same component Home uses, so the choice reads the same
          // wherever it is offered.
          <div className="flex w-full flex-col gap-5" data-q-role-question>
            <p className="cq-body text-center text-(--cq-text-secondary)">
              Are you here to raise capital, or to invest it?
            </p>
            <div className="rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) p-4">
              <PersonaCards
                autoFocus
                onChoose={() => {
                  // Leaving for onboarding: Q stops talking here rather
                  // than following the person into the next screen.
                  if (voice.active) void voice.end();
                }}
              />
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                className="cq-stage-quiet"
                onClick={() => void begin()}
              >
                Or tell Q in your own words
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              className="cq-stage-primary px-8"
              onClick={() => setStarted(true)}
              data-q-welcome-begin
            >
              Start
            </button>
            {/* Hearing Q is an offer. A two-way conversation needs the
                microphone; reading this page never does. */}
            <button
              type="button"
              className="cq-stage-quiet"
              onClick={() => void begin()}
              data-q-welcome-hear
            >
              Talk with Q instead
            </button>
            <button
              type="button"
              className="cq-stage-quiet"
              onClick={() => router.push("/home")}
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
