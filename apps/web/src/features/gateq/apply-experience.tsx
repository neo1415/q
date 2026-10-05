"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type {
  ApplicationSummaryDto,
  PublicGatewayDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  Check,
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
  RotateCw,
  X,
} from "@capital-q/ui/icons";

import { EntityAvatar, EntityCover } from "@/features/entity/entity-avatar";
import { QSwarm } from "@/features/q-swarm/q-swarm";

import {
  applicationTurnAction,
  startApplicationAction,
  submitApplicationAction,
} from "./apply-actions";
import {
  criterionLines,
  mayShare,
  verdictOf,
  type CriterionLine,
  type FitVerdict,
} from "./fit";

/**
 * "Do we fit? Ask Q" (P7; CQ-GATE-002): Q talks with a founder on an
 * investor's own website or gateway page, then shows the deterministic
 * answer, fits, partial or not a fit, with the investor's published reasons.
 * Sharing is a separate, explicit choice at the end: until the founder
 * presses Share, the investor receives nothing (the API's submission is
 * the disclosure boundary). The session token lives only in this page's
 * memory; the embed is a third-party frame, so there is no cookie to lean on.
 */

type Line = { readonly from: "Q" | "YOU"; readonly text: string };

type Problem = { readonly message: string; readonly rateLimited: boolean };

/** Where the conversation is. Pending (Q thinking) is orthogonal. */
type Stage = "INTRO" | "TALKING" | "STOPPED" | "SHARED" | "DECLINED";

/** For the development preview and screenshots only. */
export type ApplyPreview = {
  readonly stage: Stage;
  readonly lines?: readonly Line[];
  readonly application?: ApplicationSummaryDto | null;
  readonly pending?: boolean;
  readonly problem?: Problem | null;
  readonly consenting?: boolean;
};

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const STANDING_WORDS: Readonly<Record<CriterionLine["standing"], string>> = {
  MET: "matches",
  NOT_MET: "doesn't match",
  UNKNOWN: "not known yet",
};

function StandingIcon({
  standing,
}: {
  readonly standing: CriterionLine["standing"];
}) {
  const common = {
    size: ICON_SIZE.compact,
    strokeWidth: ICON_STROKE,
    "aria-hidden": true,
  } as const;
  if (standing === "MET") {
    return <Check {...common} className="shrink-0 text-(--cq-positive)" />;
  }
  if (standing === "NOT_MET") {
    return <X {...common} className="shrink-0 text-(--cq-text-primary)" />;
  }
  return (
    <CircleAlert {...common} className="shrink-0 text-(--cq-text-tertiary)" />
  );
}

/** The published rules, each with where the founder stands on it. */
function Criteria({
  lines,
  compact = false,
}: {
  readonly lines: readonly CriterionLine[];
  readonly compact?: boolean;
}) {
  if (lines.length === 0) return null;
  if (compact) {
    return (
      <ul className="flex flex-wrap gap-1.5" aria-label="Where you stand">
        {lines.map((line) => (
          <li
            key={line.label}
            className="cq-caption flex items-center gap-1 rounded-full border border-(--cq-border-subtle) px-2.5 py-1 text-(--cq-text-secondary)"
          >
            <StandingIcon standing={line.standing} />
            <span>{line.label}</span>
            <span className="sr-only">: {STANDING_WORDS[line.standing]}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
      {lines.map((line) => (
        <li key={line.label} className="flex items-center gap-3 py-2.5">
          <StandingIcon standing={line.standing} />
          <span className="cq-body-sm flex-1 text-(--cq-text-primary)">
            {line.label}
            {line.required ? null : (
              <span className="text-(--cq-text-tertiary)"> · preferred</span>
            )}
          </span>
          <span className="cq-caption text-(--cq-text-secondary)">
            {STANDING_WORDS[line.standing]}
          </span>
        </li>
      ))}
    </ul>
  );
}

const VERDICT_TITLE: Readonly<Record<FitVerdict, (fund: string) => string>> = {
  FITS: (fund) => `You fit ${fund}'s mandate`,
  PARTIAL: () => "Partly. Q couldn't confirm everything",
  NOT_A_FIT: (fund) => `Not a fit for ${fund} right now`,
};

const VERDICT_NOTE: Readonly<Record<FitVerdict, (fund: string) => string>> = {
  FITS: (fund) =>
    `Your answers meet every rule ${fund} published. Q hasn't verified them yet.`,
  PARTIAL: (fund) =>
    `Unknown isn't a no. ${fund} can only receive applications that meet its rules, so Q needs these answered first.`,
  NOT_A_FIT: (fund) =>
    `This is ${fund}'s published mandate, not a view on your company. If an answer was wrong, change it.`,
};

export function ApplyExperience({
  gateway,
  compact = false,
  preview,
}: {
  readonly gateway: PublicGatewayDto;
  /** Inside someone else's page: a panel, not a page. */
  readonly compact?: boolean;
  readonly preview?: ApplyPreview;
}) {
  const fund = gateway.organisationDisplayName;
  const [token, setToken] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(preview?.stage ?? "INTRO");
  const [lines, setLines] = useState<readonly Line[]>(preview?.lines ?? []);
  const [application, setApplication] = useState<ApplicationSummaryDto | null>(
    preview?.application ?? null,
  );
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<Problem | null>(
    preview?.problem ?? null,
  );
  const [consenting, setConsenting] = useState(preview?.consenting ?? false);
  // "Change an answer": the verdict steps aside until the next answer lands.
  const [revising, setRevising] = useState(false);
  const [transitionPending, startTransition] = useTransition();
  const pending = preview?.pending ?? transitionPending;
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastTurn = useRef<{ id: string; text: string } | null>(null);

  const scroll = () =>
    requestAnimationFrame(() => end.current?.scrollIntoView({ block: "end" }));

  useEffect(() => {
    if (stage === "TALKING" && !pending && preview === undefined) {
      input.current?.focus();
    }
  }, [stage, pending, preview]);

  const answered = lines.filter((line) => line.from === "YOU").length;
  const verdict =
    stage === "INTRO" || answered === 0 || revising
      ? null
      : verdictOf(application, stage === "STOPPED");
  const criteria = criterionLines(gateway, application);

  const fail = (result: { message: string; rateLimited?: boolean }) =>
    setProblem({
      message: result.message,
      rateLimited: result.rateLimited === true,
    });

  const start = () =>
    startTransition(async () => {
      setProblem(null);
      const result = await startApplicationAction(gateway.publicId);
      if (!result.ok) {
        fail(result);
        return;
      }
      setToken(result.sessionToken);
      setApplication(result.application);
      setLines(
        result.reply === null ? [] : [{ from: "Q", text: result.reply }],
      );
      setStage("TALKING");
      scroll();
    });

  const sendText = (text: string, turnId: string) => {
    if (token === null) return;
    startTransition(async () => {
      setProblem(null);
      const result = await applicationTurnAction(token, text, turnId);
      if (!result.ok) {
        fail(result);
        return;
      }
      lastTurn.current = null;
      setRevising(false);
      setApplication(result.application);
      if (result.reply !== null) {
        const reply = result.reply;
        setLines((current) => [...current, { from: "Q", text: reply }]);
      }
      scroll();
    });
  };

  const send = () => {
    const text = draft.trim();
    if (token === null || text === "" || pending) return;
    setDraft("");
    setStage("TALKING");
    setLines((current) => [...current, { from: "YOU", text }]);
    // One id per message, kept for a retry: the API answers a repeated id
    // with the first answer instead of running a second turn.
    const turn = { id: key("turn"), text };
    lastTurn.current = turn;
    scroll();
    sendText(turn.text, turn.id);
  };

  const retry = () => {
    const turn = lastTurn.current;
    if (turn !== null) sendText(turn.text, turn.id);
    else if (token === null) start();
    else setProblem(null);
  };

  const share = () =>
    startTransition(async () => {
      if (token === null) return;
      setProblem(null);
      const result = await submitApplicationAction(token, key("share"));
      if (!result.ok) {
        fail(result);
        return;
      }
      setApplication(result.application);
      setStage("SHARED");
    });

  const header = (
    <header
      className={
        compact
          ? "flex items-center gap-3 border-b border-(--cq-border-subtle) px-4 py-3 pr-14"
          : "flex flex-col gap-3"
      }
    >
      {compact ? null : typeof gateway.organisationCoverUrl === "string" ? (
        <EntityCover
          src={gateway.organisationCoverUrl}
          className="rounded-xl"
        />
      ) : null}
      <div className="flex min-w-0 items-center gap-3">
        <EntityAvatar
          kind="investor"
          name={fund}
          src={gateway.organisationPhotoUrl ?? null}
          size="md"
          decorative
        />
        <div className="flex min-w-0 flex-col">
          <span className="cq-label truncate text-(--cq-text-primary)">
            {fund}
          </span>
          <span className="cq-caption text-(--cq-text-tertiary)">
            Fit check with Q
          </span>
        </div>
      </div>
    </header>
  );

  const intro = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <QSwarm state="IDLE" pixels={compact ? 72 : 96} />
        <div className="flex flex-col gap-2">
          <h1 className="cq-title-lg text-(--cq-text-primary)">Do we fit?</h1>
          <p className="cq-body text-(--cq-text-secondary)">
            Q is {fund}&apos;s analyst. Answer a few questions, or share your
            website, and Q tells you whether you fit {fund}&apos;s published
            mandate. About two minutes.
          </p>
        </div>
      </div>
      {gateway.criteria.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <span className="cq-caption text-(--cq-text-secondary)">
            What {fund} looks at
          </span>
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
            {gateway.criteria.map((criterion) => (
              <li
                key={criterion.label}
                className="cq-body-sm flex items-center justify-between py-2.5 text-(--cq-text-primary)"
              >
                {criterion.label}
                <span className="cq-caption text-(--cq-text-tertiary)">
                  {criterion.requiredness === "REQUIRED"
                    ? "Required"
                    : "Preferred"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {gateway.acceptingApplications ? (
        <div className="flex flex-col items-start gap-3">
          <Button
            variant="primary"
            size="large"
            onClick={start}
            disabled={pending}
          >
            {pending ? "Starting…" : "Start with Q"}
          </Button>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Nothing is shared with {fund} unless you choose to at the end.
          </p>
        </div>
      ) : (
        <p className="cq-body text-(--cq-text-secondary)">
          {fund} isn&apos;t taking new conversations right now.
        </p>
      )}
    </div>
  );

  const transcript = (
    <ol
      className="flex flex-col gap-3"
      aria-live="polite"
      aria-busy={pending}
      aria-label="Conversation with Q"
    >
      {lines.map((line, index) => (
        <li
          // The conversation only grows; its order is its identity.
          key={index}
          className={
            line.from === "YOU"
              ? "cq-body max-w-[85%] self-end rounded-2xl bg-(--cq-surface-raised) px-4 py-2 text-(--cq-text-primary)"
              : "flex max-w-[92%] items-start gap-2.5 self-start"
          }
        >
          {line.from === "YOU" ? (
            line.text
          ) : (
            <>
              <span className="mt-0.5 shrink-0" aria-hidden="true">
                <QSwarm state="IDLE" pixels={24} />
              </span>
              <span className="cq-body whitespace-pre-line text-(--cq-text-primary)">
                <span className="sr-only">Q: </span>
                {line.text}
              </span>
            </>
          )}
        </li>
      ))}
      {pending && stage !== "INTRO" ? (
        <li className="flex items-center gap-2.5 self-start" role="status">
          <QSwarm state="THINKING" pixels={32} />
          <span className="cq-caption text-(--cq-text-tertiary)">
            Q is thinking
          </span>
        </li>
      ) : null}
      <div ref={end} />
    </ol>
  );

  const composer = (
    <div className="flex flex-col gap-1">
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          ref={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={2000}
          aria-label="Your answer"
          placeholder="Answer, or paste your website or deck link"
          className="cq-body min-h-11 flex-1 resize-none rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-2.5 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={pending || draft.trim() === ""}
        >
          Send
        </Button>
      </form>
      {answered > 0 ? (
        <button
          type="button"
          onClick={() => setStage("STOPPED")}
          className="cq-caption min-h-11 self-start text-(--cq-text-secondary) underline-offset-4 hover:underline"
        >
          That&apos;s all I can share for now
        </button>
      ) : null}
    </div>
  );

  const facts = application?.facts ?? [];

  const shareButtons = (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="primary"
        onClick={consenting ? share : () => setConsenting(true)}
        disabled={pending}
      >
        {pending && consenting ? "Sharing…" : `Share with ${fund}`}
      </Button>
      <Button
        variant="quiet"
        onClick={() => setStage("DECLINED")}
        disabled={pending}
      >
        Not now
      </Button>
    </div>
  );

  const result =
    verdict === null ? null : (
      <section
        className="flex flex-col gap-4 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface) p-4"
        aria-labelledby="fit-verdict"
      >
        <div className="flex items-start gap-3">
          <QSwarm
            state={verdict === "FITS" ? "COMPLETE" : "IDLE"}
            pixels={40}
          />
          <div className="flex flex-col gap-1" role="status">
            <h2
              id="fit-verdict"
              className="cq-title-sm text-(--cq-text-primary)"
            >
              {VERDICT_TITLE[verdict](fund)}
            </h2>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {VERDICT_NOTE[verdict](fund)}
            </p>
          </div>
        </div>
        <Criteria lines={criteria} />
        {mayShare(verdict) ? (
          consenting ? (
            <div className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-4">
              <h3 className="cq-label text-(--cq-text-primary)">
                Share with {fund}?
              </h3>
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {fund} will see what you told Q, and nothing else:
              </p>
              {facts.length === 0 ? null : (
                <ul className="cq-body-sm flex flex-col gap-1 text-(--cq-text-primary)">
                  {facts.slice(0, 8).map((fact) => (
                    <li key={`${fact.dimension}-${fact.summary}`}>
                      {fact.summary}
                    </li>
                  ))}
                </ul>
              )}
              {shareButtons}
            </div>
          ) : (
            shareButtons
          )
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={verdict === "PARTIAL" ? "primary" : "secondary"}
              onClick={() => {
                setStage("TALKING");
                if (verdict === "NOT_A_FIT") setRevising(true);
              }}
            >
              {verdict === "PARTIAL" ? "Keep answering" : "Change an answer"}
            </Button>
          </div>
        )}
      </section>
    );

  const closing =
    stage === "SHARED" ? (
      <section className="flex flex-col items-start gap-3" role="status">
        <QSwarm state="COMPLETE" pixels={72} />
        <h2 className="cq-title-sm text-(--cq-text-primary)">
          Sent to {fund}
        </h2>
        <p className="cq-body text-(--cq-text-secondary)">
          {fund} has your answers
          {application === null || application.reference === ""
            ? ""
            : ` (reference ${application.reference})`}
          . They review every one; you don&apos;t need an account.
        </p>
      </section>
    ) : stage === "DECLINED" ? (
      <section className="flex flex-col items-start gap-3" role="status">
        <QSwarm state="IDLE" pixels={72} />
        <h2 className="cq-title-sm text-(--cq-text-primary)">
          Nothing was shared
        </h2>
        <p className="cq-body text-(--cq-text-secondary)">
          {fund} hasn&apos;t received anything. You can close this window.
        </p>
        <Button variant="secondary" onClick={() => setStage("TALKING")}>
          Back to the conversation
        </Button>
      </section>
    ) : null;

  const problemNote =
    problem === null ? null : (
      <div
        className="flex items-start gap-3 rounded-2xl bg-(--cq-surface-subtle) p-3"
        role="alert"
      >
        <CircleAlert
          size={ICON_SIZE.regular}
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-(--cq-text-secondary)"
        />
        <div className="flex flex-1 flex-col gap-2">
          <p className="cq-body-sm text-(--cq-text-primary)">
            {problem.message}
          </p>
          {problem.rateLimited ? null : (
            <div>
              <Button size="compact" variant="secondary" onClick={retry}>
                <RotateCw
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                  aria-hidden="true"
                />
                Try again
              </Button>
            </div>
          )}
        </div>
      </div>
    );

  const showComposer =
    (stage === "TALKING" || stage === "STOPPED") && verdict === null;

  const body =
    stage === "INTRO" ? (
      intro
    ) : closing !== null ? (
      closing
    ) : (
      <>
        {criteria.length === 0 ? null : <Criteria lines={criteria} compact />}
        {transcript}
        {result}
      </>
    );

  if (compact) {
    return (
      <section
        className="flex h-dvh w-full flex-col bg-(--cq-canvas)"
        aria-label={`${fund}: fit check with Q`}
      >
        {header}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {body}
          {problemNote}
        </div>
        {showComposer ? (
          <div className="border-t border-(--cq-border-subtle) px-4 pt-3">
            {composer}
          </div>
        ) : null}
        <p className="cq-caption px-4 pt-1 pb-[max(0.75rem,var(--cq-safe-bottom))] text-center text-(--cq-text-tertiary)">
          Powered by Capital Q
        </p>
      </section>
    );
  }

  return (
    <section
      className="flex min-h-[32rem] flex-col gap-6"
      aria-label={`${fund}: fit check with Q`}
    >
      {header}
      {body}
      {problemNote}
      {showComposer ? composer : null}
    </section>
  );
}
