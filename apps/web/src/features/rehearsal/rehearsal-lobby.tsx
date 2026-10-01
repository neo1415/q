"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import {
  rehearsalSimulationLabel,
  type QRehearsalDto,
  type QRehearsalPersonaDto,
  type RehearsalCounterpartKind,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { ExternalLink } from "@capital-q/ui/icons";

import { initialsOf } from "./meet";
import {
  rehearsalPersonaAction,
  startRehearsalAction,
} from "./rehearsal-actions";
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
}: {
  readonly kind: RehearsalCounterpartKind;
  readonly counterpartId: string;
  readonly meetingId?: string | undefined;
}) {
  const [persona, setPersona] = useState<QRehearsalPersonaDto | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [voice, setVoice] = useState<"FEMALE" | "MALE">("MALE");
  const [rehearsal, setRehearsal] = useState<QRehearsalDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joining, startJoining] = useTransition();

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

  if (rehearsal !== null) return <RehearsalRoom initial={rehearsal} />;

  function join() {
    setMessage(null);
    startJoining(async () => {
      const result = await startRehearsalAction({
        kind,
        counterpartId,
        meetingId,
        voice,
      });
      if (result.ok) setRehearsal(result.value);
      else setMessage(result.message);
    });
  }

  if (failed !== null) {
    return (
      <section className="flex flex-col items-start gap-4 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) p-6">
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
        className="cq-stage flex min-h-[60vh] flex-col items-center justify-center gap-4 rounded-(--cq-radius-xl) p-8 text-center"
      >
        <div className="size-24 animate-pulse rounded-(--cq-radius-full) bg-(--cq-stage-surface-strong) motion-reduce:animate-none" />
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
      <div className="cq-stage relative flex min-h-80 flex-col items-center justify-center gap-4 rounded-(--cq-radius-xl) p-8">
        <div className="flex size-28 items-center justify-center rounded-(--cq-radius-full) bg-(--cq-stage-surface-strong) text-4xl font-medium">
          {initialsOf(name)}
        </div>
        <p className="cq-title-md text-(--cq-stage-text)">{name}</p>
        <p className="cq-caption max-w-sm text-center text-(--cq-stage-text-muted)">
          {rehearsalSimulationLabel(name)}
        </p>
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
          <p className="cq-caption text-(--cq-text-tertiary)">
            {GROUNDING_WORDS[persona.grounding]}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="cq-label mb-1 text-(--cq-text-primary)">
            Their voice
          </legend>
          <div className="flex gap-2">
            {(["MALE", "FEMALE"] as const).map((choice) => (
              <label
                key={choice}
                className={`cq-body-sm inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-(--cq-radius-md) border px-3 ${
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

        <div className="flex flex-col gap-2">
          <Button size="large" onClick={join} disabled={joining}>
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
