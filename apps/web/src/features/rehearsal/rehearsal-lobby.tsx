"use client";

import { primeMeetSounds } from "./meet-sounds";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  rehearsalSimulationLabel,
  type EntitlementProblemExtension,
  type QRehearsalDto,
  type QRehearsalPersonaDto,
  type RehearsalDifficulty,
  type RehearsalInterviewersDto,
  type RehearsalVideoSessionDto,
  type RehearsalCounterpartKind,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { ExternalLink } from "@capital-q/ui/icons";

import { EntitlementNotice } from "@/features/billing/entitlement-notice";

import {
  initialsOf,
  SEE_YOU_CONSENT,
  stanceWords,
  TRAIT_SOURCE_WORDS,
} from "./meet";
import {
  rehearsalInterviewersAction,
  rehearsalPersonaAction,
  startRehearsalAction,
  startRehearsalVideoAction,
} from "./rehearsal-actions";
import {
  videoAllowanceLine,
  videoAllowanceUsedUp,
} from "@/features/video-room/video-allowance";
import { RehearsalVideoStage } from "./rehearsal-video-stage";
import { CounterpartIdentity } from "./counterpart-identity";
import { RehearsalRoom } from "./rehearsal-room";

/**
 * The green room before a rehearsal (REHEARSE): who Q will play, what Q
 * read to play them (with sources), the plain label that this is an AI
 * rehearsal, the voice they speak with, and Join now. Building the persona
 * happens here, before the call, so nothing slow sits in the call itself.
 */

const GROUNDING_WORDS = {
  THIN: "Q had little of their own words, so this leans on how people like them usually run a meeting.",
  SOME: "Built from some of their own words and record.",
  RICH: "Built from plenty of their own words and record.",
} as const;

const DIFFICULTIES: readonly {
  readonly value: RehearsalDifficulty;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: "GENTLE",
    label: "Gentle",
    hint: "Patient and encouraging, with a hint when you're stuck.",
  },
  {
    value: "REALISTIC",
    label: "Realistic",
    hint: "Exactly as Q expects them to be.",
  },
  {
    value: "TOUGH",
    label: "Tough",
    hint: "On a bad day: harder questions, more pushback, slower to win over.",
  },
];

const SOURCE_KIND_WORDS = {
  PROFILE: "Profile",
  MESSAGES: "Messages",
  CALLS: "Calls",
  PUBLIC_WEB: "Public web",
  PUBLIC_KNOWLEDGE: "On Capital Q",
  PITCH_TRANSCRIPT: "Pitch video",
  DECK: "Deck",
  OWN_COMPANY: "Your company",
} as const;

export function RehearsalLobby({
  kind,
  counterpartId,
  meetingId,
  requestedVideo = false,
}: {
  readonly kind: RehearsalCounterpartKind;
  readonly counterpartId: string;
  readonly meetingId?: string | undefined;
  readonly requestedVideo?: boolean;
}) {
  const router = useRouter();
  const [persona, setPersona] = useState<QRehearsalPersonaDto | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [voice, setVoice] = useState<"FEMALE" | "MALE">("MALE");
  // Off by default: Q sees them only when they say so (founder ask 2026-10-01).
  const [seeYou, setSeeYou] = useState(false);
  const [difficulty, setDifficulty] =
    useState<RehearsalDifficulty>("REALISTIC");
  const [rehearsal, setRehearsal] = useState<QRehearsalDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [entitlement, setEntitlement] =
    useState<EntitlementProblemExtension | null>(null);
  const [joining, startJoining] = useTransition();
  // ADR 0066: a founder may meet them by video, with a stock AI interviewer.
  const [interviewers, setInterviewers] =
    useState<RehearsalInterviewersDto | null>(null);
  const [meetBy, setMeetBy] = useState<"VOICE" | "VIDEO">(
    requestedVideo ? "VIDEO" : "VOICE",
  );
  const [interviewerAttempt, setInterviewerAttempt] = useState(0);
  const [interviewerError, setInterviewerError] = useState<string | null>(null);
  const [interviewerId, setInterviewerId] = useState<string | null>(null);
  const [video, setVideo] = useState<{
    readonly rehearsal: QRehearsalDto;
    readonly session: RehearsalVideoSessionDto;
  } | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void rehearsalInterviewersAction()
      .then((result) => {
        if (!live) return;
        if (!result.ok) {
          setInterviewerError(result.message);
          return;
        }
        setInterviewers(result.value);
        const first = result.value.interviewers.find((item) => item.available);
        setInterviewerId(first === undefined ? null : "q-selected");
      })
      .catch(() => {
        if (live)
          setInterviewerError("Couldn’t load meeting options. Please retry.");
      });
    return () => {
      live = false;
    };
  }, [interviewerAttempt]);

  useEffect(() => {
    let live = true;
    void rehearsalPersonaAction(kind, counterpartId).then((result) => {
      if (!live) return;
      if (result.ok) setPersona(result.value);
      else setFailed(result.message);
    });
    return () => {
      live = false;
    };
  }, [kind, counterpartId, attempt]);

  if (video !== null) {
    return (
      <RehearsalVideoStage
        rehearsal={video.rehearsal}
        session={video.session}
        onContinueByVoice={(open) => {
          setVideo(null);
          setRehearsal(open);
        }}
      />
    );
  }

  if (rehearsal !== null) {
    return (
      <div className="flex flex-col gap-3">
        {voiceNote === null ? null : (
          <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
            {voiceNote}
          </p>
        )}
        <RehearsalRoom initial={rehearsal} seeYou={seeYou} />
      </div>
    );
  }

  const meetingModeReady =
    interviewers !== null &&
    (meetBy !== "VIDEO" ||
      (interviewers.videoAvailable && interviewerId !== null));

  function join() {
    if (!meetingModeReady) return;
    // Inside the click: the room's sounds may play later.
    primeMeetSounds();
    setMessage(null);
    setEntitlement(null);
    startJoining(async () => {
      const result = await startRehearsalAction({
        kind,
        counterpartId,
        meetingId,
        voice,
        difficulty,
      });
      if (result.ok && meetBy === "VIDEO" && interviewerId !== null) {
        // The same rehearsal, met by video; if video can't open, the voice
        // room carries on with it, nothing lost.
        // Persist the owned canonical id before asking for any provider
        // allocation. Refresh during allocation must not return to a lobby
        // whose Join button can create another rehearsal and another room.
        const livePath = `/rehearsals/live/${encodeURIComponent(result.value.id)}?video=1`;
        window.history.replaceState(null, "", livePath);
        const opened = await startRehearsalVideoAction(
          result.value.id,
          interviewerId,
        );
        if (opened.ok && opened.value.mode === "VIDEO") {
          setVideo({ rehearsal: result.value, session: opened.value.session });
          // The canonical id survives refresh. The destination reads this
          // existing room only; it cannot create another paid conversation.
          router.replace(livePath);
          return;
        }
        // A confirmed fallback preserves the same canonical rehearsal URL.
        // If allocation remains uncertain, recovery still sees its open
        // row and fails closed rather than blindly entering another room.
        const voicePath = `/rehearsals/live/${encodeURIComponent(result.value.id)}?video=0`;
        window.history.replaceState(null, "", voicePath);
        router.replace(voicePath);
        setVoiceNote(
          opened.ok &&
            opened.value.mode === "VOICE_FALLBACK" &&
            opened.value.reason === "ALLOWANCE_EXHAUSTED"
            ? "Your video sessions are used up for now. You can carry on in the voice room."
            : opened.ok &&
                opened.value.mode === "VOICE_FALLBACK" &&
                opened.value.reason === "CONCURRENCY_LIMIT"
              ? "Video rooms are busy. You can carry on in the voice room."
              : "Video isn’t available just now, so you’re in the voice room instead.",
        );
        setRehearsal(result.value);
      } else if (result.ok) setRehearsal(result.value);
      else if (result.entitlement !== undefined)
        setEntitlement(result.entitlement);
      else setMessage(result.message);
    });
  }

  if (failed !== null) {
    return (
      <section className="flex flex-col items-start gap-4 border border-(--cq-border-subtle) p-6">
        <h2 className="cq-title-md text-(--cq-text-primary)">
          Q couldn’t get ready for this rehearsal
        </h2>
        <p className="cq-body text-(--cq-text-secondary)">{failed}</p>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setFailed(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
          <Link href="/rehearsals" className={buttonClassName("secondary")}>
            Rehearsals
          </Link>
        </div>
      </section>
    );
  }

  if (persona === null) {
    return (
      <section
        aria-busy="true"
        className="cq-stage flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <div className="size-24 animate-pulse rounded-full bg-(--cq-stage-surface-strong) motion-reduce:animate-none" />
        <p className="cq-body text-(--cq-stage-text)">
          Q is reading up on who you’re meeting…
        </p>
        <p className="cq-body-sm text-(--cq-stage-text-muted)">
          The first time takes a few seconds; after that it’s ready at once.
        </p>
      </section>
    );
  }

  const name = persona.counterpart.name;
  return (
    <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="cq-stage relative flex min-h-80 flex-col items-center justify-center gap-4 p-8">
        {persona.simulation !== undefined ? (
          <CounterpartIdentity name={name} simulation={persona.simulation} />
        ) : (
          <>
            <div className="flex size-28 items-center justify-center rounded-full bg-(--cq-stage-surface-strong) text-4xl font-medium">
              {initialsOf(name)}
            </div>
            <p className="cq-title-md text-(--cq-stage-text)">{name}</p>
            <p className="cq-caption max-w-sm text-center text-(--cq-stage-text-muted)">
              {rehearsalSimulationLabel(name)}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="cq-title-lg text-(--cq-text-primary)">
            Ready to rehearse with {name}?
          </h1>
          <p className="cq-body text-(--cq-text-secondary)">
            {persona.summary}
          </p>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {persona.style}
          </p>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {stanceWords(persona.stance, name)}
          </p>
          {persona.traits.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              <h2 className="cq-label text-(--cq-text-primary)">
                What Q knows about how they are
              </h2>
              <ul className="cq-body-sm flex flex-col gap-1 text-(--cq-text-secondary)">
                {persona.traits.map((item, index) => (
                  <li key={`${item.source}-${String(index)}`}>
                    {item.trait}{" "}
                    <span className="text-(--cq-text-tertiary)">
                      (from {TRAIT_SOURCE_WORDS[item.source]})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="cq-caption text-(--cq-text-tertiary)">
            {GROUNDING_WORDS[persona.grounding]}
          </p>
        </div>

        <fieldset hidden={meetBy === "VIDEO"} className="flex flex-col gap-2">
          <legend className="cq-label mb-1 text-(--cq-text-primary)">
            Their voice
          </legend>
          <div className="flex gap-2">
            {(["MALE", "FEMALE"] as const).map((choice) => (
              <label
                key={choice}
                className={`cq-body-sm inline-flex min-h-11 cursor-pointer items-center gap-2 border px-3 ${
                  voice === choice
                    ? "border-(--cq-accent) text-(--cq-text-primary)"
                    : "border-(--cq-border) text-(--cq-text-secondary)"
                }`}
              >
                <input
                  type="radio"
                  name="rehearsal-voice"
                  value={choice}
                  checked={voice === choice}
                  onChange={() => setVoice(choice)}
                  className="accent-(--cq-accent)"
                />
                {choice === "MALE" ? "Male voice" : "Female voice"}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="cq-label mb-1 text-(--cq-text-primary)">
            How hard should they be?
          </legend>
          <div className="flex flex-wrap gap-2">
            {DIFFICULTIES.map((choice) => (
              <label
                key={choice.value}
                title={choice.hint}
                className={`cq-body-sm inline-flex min-h-11 cursor-pointer items-center gap-2 border px-3 ${
                  difficulty === choice.value
                    ? "border-(--cq-accent) text-(--cq-text-primary)"
                    : "border-(--cq-border) text-(--cq-text-secondary)"
                }`}
              >
                <input
                  type="radio"
                  name="rehearsal-difficulty"
                  value={choice.value}
                  checked={difficulty === choice.value}
                  onChange={() => setDifficulty(choice.value)}
                  className="accent-(--cq-accent)"
                />
                {choice.label}
              </label>
            ))}
          </div>
          <p className="cq-caption text-(--cq-text-tertiary)">
            {DIFFICULTIES.find((choice) => choice.value === difficulty)?.hint}
          </p>
        </fieldset>

        {interviewers !== null ? null : (
          <div role="status" className="cq-body-sm text-(--cq-text-secondary)">
            {interviewerError === null ? (
              "Checking how you can meet…"
            ) : (
              <>
                <p>{interviewerError}</p>
                <Button
                  onClick={() => {
                    setInterviewerError(null);
                    setInterviewers(null);
                    setInterviewerAttempt((value) => value + 1);
                  }}
                >
                  Retry meeting options
                </Button>
              </>
            )}
          </div>
        )}
        {!requestedVideo ||
        interviewers === null ||
        interviewers.videoAvailable ? null : (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p>
              {interviewers.allowance?.remaining === 0
                ? `${videoAllowanceUsedUp(interviewers.allowance)} No video room has been started.`
                : "Video interviews aren’t switched on for this account right now. No video room has been started."}
            </p>
            <Button variant="secondary" onClick={() => setMeetBy("VOICE")}>
              Use voice instead
            </Button>
          </div>
        )}
        {interviewers === null || !interviewers.videoAvailable ? null : (
          <fieldset className="flex flex-col gap-2">
            <legend className="cq-label mb-1 text-(--cq-text-primary)">
              How you’ll meet
            </legend>
            <div className="flex flex-wrap gap-2">
              {(["VOICE", "VIDEO"] as const).map((choice) => (
                <label
                  key={choice}
                  className={`cq-body-sm inline-flex min-h-11 cursor-pointer items-center gap-2 border px-3 ${
                    meetBy === choice
                      ? "border-(--cq-accent) text-(--cq-text-primary)"
                      : "border-(--cq-border) text-(--cq-text-secondary)"
                  }`}
                >
                  <input
                    type="radio"
                    name="rehearsal-meet-by"
                    value={choice}
                    checked={meetBy === choice}
                    onChange={() => setMeetBy(choice)}
                    className="accent-(--cq-accent)"
                  />
                  {choice === "VOICE"
                    ? "Voice room"
                    : `Video, up to ${String(interviewers.maxSeconds / 60)} minutes`}
                </label>
              ))}
            </div>
            {videoAllowanceLine(interviewers.allowance) === null ? null : (
              <p className="cq-caption text-(--cq-text-tertiary)">
                {videoAllowanceLine(interviewers.allowance)}
              </p>
            )}
            {meetBy !== "VIDEO" ? null : (
              <div className="flex flex-col gap-2">
                <p className="cq-caption text-(--cq-text-tertiary)">
                  A stock AI face and voice plays {name}; Q decides every word.
                  It is never a likeness of the real person.
                </p>
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  Q chooses an available stock avatar and voice to suit this
                  rehearsal. Two video interviews per account, up to three
                  minutes each; reconnecting keeps the original deadline.
                </p>
              </div>
            )}
          </fieldset>
        )}

        <label className="cq-body-sm flex min-h-11 cursor-pointer items-start gap-3 text-(--cq-text-secondary)">
          <input
            type="checkbox"
            checked={seeYou}
            onChange={(event) => setSeeYou(event.target.checked)}
            className="mt-1 size-4 accent-(--cq-accent)"
          />
          <span>
            <span className="text-(--cq-text-primary)">{SEE_YOU_CONSENT}</span>{" "}
            {name} can then react to how you come across, as on a real call. You
            can turn it off at any time.
          </span>
        </label>

        <div className="flex flex-col gap-2">
          <Button
            size="large"
            onClick={join}
            disabled={joining || !meetingModeReady}
          >
            {joining ? `${name} is joining…` : "Join now"}
          </Button>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Your microphone is used for the rehearsal. Your camera stays on this
            device. It stays between you and Q; {name} never sees it.
          </p>
          {message === null ? null : (
            <p role="alert" className="cq-body-sm text-(--cq-text-secondary)">
              {message}
            </p>
          )}
          {entitlement === null ? null : (
            <EntitlementNotice entitlement={entitlement} />
          )}
        </div>

        {persona.sources.length === 0 ? null : (
          <details className="cq-body-sm text-(--cq-text-secondary)">
            <summary className="cq-label min-h-11 cursor-pointer py-2 text-(--cq-text-primary)">
              What Q read ({persona.sources.length})
            </summary>
            <ul className="flex flex-col gap-1 pt-1">
              {persona.sources.map((source, index) => (
                <li key={`${source.kind}-${String(index)}`}>
                  <span className="text-(--cq-text-tertiary)">
                    {SOURCE_KIND_WORDS[source.kind]}:{" "}
                  </span>
                  {source.url === null ? (
                    source.label
                  ) : (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-2"
                    >
                      {source.label}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
