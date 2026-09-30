"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { QRehearsalDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  finishRehearsalAction,
  sayInRehearsalAction,
  startRehearsalAction,
} from "./rehearsal-actions";

/**
 * The Investor Twin (founder direction 2026-09-30, C12): the founder
 * practises the meeting with the investor, played by Q from what the
 * founder may see of them, then Q coaches them. The investor's lines are
 * read aloud by the browser's own voice when the founder turns sound on;
 * the founder can answer by typing or, where the browser offers it, by
 * speaking.
 */

const RATING_WORDS = {
  STRONG: "Strong",
  SOLID: "Solid",
  NEEDS_WORK: "Needs work",
} as const;

const DIMENSION_WORDS = {
  CLARITY: "Clarity",
  EVIDENCE: "Evidence",
  HANDLING_PUSHBACK: "Handling pushback",
  FIT_TO_THIS_INVESTOR: "Fit to this investor",
  THE_ASK: "The ask",
} as const;

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const host = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

export function RehearsalRoom({
  investorOrganisationId,
  investorName,
}: {
  readonly investorOrganisationId: string;
  readonly investorName: string;
}) {
  const [rehearsal, setRehearsal] = useState<QRehearsalDto | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const [listening, setListening] = useState(false);
  const [pending, startTransition] = useTransition();
  const spoken = useRef(0);
  const recognition = useRef<Recognition | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  // The investor's newest line, read aloud once when sound is on.
  useEffect(() => {
    if (rehearsal === null) return;
    end.current?.scrollIntoView({ block: "end" });
    const lines = rehearsal.turns.filter((turn) => turn.from === "INVESTOR");
    if (!sound || lines.length <= spoken.current) {
      spoken.current = lines.length;
      return;
    }
    spoken.current = lines.length;
    const last = lines.at(-1);
    if (last === undefined || typeof window.speechSynthesis === "undefined") {
      return;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(last.text));
  }, [rehearsal, sound]);

  useEffect(
    () => () => {
      recognition.current?.stop();
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    },
    [],
  );

  function begin() {
    setMessage(null);
    startTransition(async () => {
      const result = await startRehearsalAction(investorOrganisationId);
      if (result.ok) setRehearsal(result.value);
      else setMessage(result.message);
    });
  }

  function send(text: string) {
    if (rehearsal === null || text.trim().length === 0) return;
    setMessage(null);
    setDraft("");
    startTransition(async () => {
      const result = await sayInRehearsalAction(rehearsal.id, text);
      if (result.ok) setRehearsal(result.value);
      else {
        setDraft(text);
        setMessage(result.message);
      }
    });
  }

  function finish() {
    if (rehearsal === null) return;
    setMessage(null);
    startTransition(async () => {
      const result = await finishRehearsalAction(rehearsal.id);
      if (result.ok) setRehearsal(result.value);
      else setMessage(result.message);
    });
  }

  function listen() {
    const Ctor = recognitionCtor();
    if (Ctor === null) {
      setMessage("This browser can't listen. Type your answer instead.");
      return;
    }
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const heard = new Ctor();
    heard.lang = "en";
    heard.interimResults = false;
    heard.onresult = (event) => {
      const words = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (words.length > 0) setDraft((current) => `${current} ${words}`.trim());
    };
    heard.onend = () => setListening(false);
    recognition.current = heard;
    setListening(true);
    heard.start();
  }

  if (rehearsal === null) {
    return (
      <section className="flex flex-col gap-4 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) p-6">
        <h2 className="cq-heading-sm text-(--cq-text-primary)">
          Rehearse your meeting with {investorName}
        </h2>
        <p className="cq-body text-(--cq-text-secondary)">
          Q plays {investorName}, drawn from what you can see of them: their
          profile, what they wrote to you, and calls you were on. It asks the
          questions they are likely to ask, presses where an answer is thin, and
          tells you afterwards what to sharpen. It stays between you and Q.
        </p>
        <div>
          <Button onClick={begin} disabled={pending}>
            {pending ? "Q is getting into character…" : "Start rehearsal"}
          </Button>
        </div>
        {message === null ? null : (
          <p role="alert" className="cq-body-sm text-(--cq-text-secondary)">
            {message}
          </p>
        )}
      </section>
    );
  }

  const finished = rehearsal.status === "FINISHED";
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {rehearsal.persona.summary}
        </p>
        {rehearsal.persona.grounding === "THIN" ? (
          <p className="cq-caption text-(--cq-text-tertiary)">
            Q had little of their own words to go on, so this is how an investor
            like them usually runs a meeting.
          </p>
        ) : null}
      </div>

      <ol className="flex flex-col gap-3" aria-live="polite">
        {rehearsal.turns.map((turn, index) => (
          <li
            key={`${turn.at}-${index}`}
            className={
              turn.from === "INVESTOR"
                ? "cq-body max-w-[85%] self-start rounded-(--cq-radius-lg) bg-(--cq-surface-subtle) px-4 py-3 text-(--cq-text-primary)"
                : "cq-body max-w-[85%] self-end rounded-(--cq-radius-lg) border border-(--cq-border-subtle) px-4 py-3 text-(--cq-text-primary)"
            }
          >
            <span className="cq-caption block text-(--cq-text-tertiary)">
              {turn.from === "INVESTOR" ? rehearsal.investorName : "You"}
            </span>
            {turn.text}
          </li>
        ))}
      </ol>
      <div ref={end} />

      {finished ? null : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <label className="flex flex-col gap-2">
            <span className="cq-label text-(--cq-text-secondary)">
              Your answer
            </span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              maxLength={4000}
              className="cq-body rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-base) px-3 py-2 text-(--cq-text-primary)"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || draft.trim() === ""}>
              {pending ? `${rehearsal.investorName} is thinking…` : "Answer"}
            </Button>
            <Button type="button" variant="secondary" onClick={listen}>
              {listening ? "Stop listening" : "Speak"}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => setSound((on) => !on)}
              aria-pressed={sound}
            >
              {sound ? "Sound on" : "Sound off"}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={finish}
              disabled={pending}
            >
              End and get coaching
            </Button>
          </div>
        </form>
      )}

      {message === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}

      {rehearsal.scorecard === null ? null : (
        <section className="flex flex-col gap-4 border-t border-(--cq-border-subtle) pt-5">
          <h2 className="cq-heading-sm text-(--cq-text-primary)">
            How it went
          </h2>
          <p className="cq-body text-(--cq-text-primary)">
            {rehearsal.scorecard.overall}
          </p>
          <dl className="flex flex-col gap-2">
            {rehearsal.scorecard.dimensions.map((dimension) => (
              <div key={dimension.name} className="flex flex-col gap-0.5">
                <dt className="cq-label text-(--cq-text-primary)">
                  {DIMENSION_WORDS[dimension.name]}:{" "}
                  {RATING_WORDS[dimension.rating]}
                </dt>
                <dd className="cq-body-sm text-(--cq-text-secondary)">
                  {dimension.note}
                </dd>
              </div>
            ))}
          </dl>
          {rehearsal.scorecard.strengths.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              <h3 className="cq-label text-(--cq-text-primary)">What landed</h3>
              <ul className="cq-body-sm list-disc pl-5 text-(--cq-text-secondary)">
                {rehearsal.scorecard.strengths.map((strength) => (
                  <li key={strength}>{strength}</li>
                ))}
              </ul>
            </div>
          )}
          {rehearsal.scorecard.fixes.length === 0 ? null : (
            <div className="flex flex-col gap-3">
              <h3 className="cq-label text-(--cq-text-primary)">
                Before the real meeting
              </h3>
              {rehearsal.scorecard.fixes.map((fix) => (
                <div key={fix.question} className="flex flex-col gap-1">
                  <p className="cq-body-sm font-semibold text-(--cq-text-primary)">
                    {fix.question}
                  </p>
                  <p className="cq-body-sm text-(--cq-text-secondary)">
                    {fix.better}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                spoken.current = 0;
                setRehearsal(null);
              }}
            >
              Rehearse again
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}
