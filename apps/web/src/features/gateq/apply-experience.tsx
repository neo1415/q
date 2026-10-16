"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";

import { ApplicationContactDtoSchema } from "@capital-q/contracts";
import type {
  ApplicationSummaryDto,
  ApplicationCoverageDto,
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
  contactAction,
  confirmContactAction,
  interviewProgressAction,
  startApplicationAction,
  submitApplicationAction,
} from "./apply-actions";
import { CoveragePanel } from "./coverage-panel";
import { GateqVideoEntry } from "./gateq-video-entry";
import { readRecovery, amendRecovery } from "./form/session-recovery";
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
 * memory in the fit-check preview. The form interview also recovers it from
 * gateway-scoped sessionStorage; embeds need no third-party cookie.
 */

type Line = { readonly from: "Q" | "YOU"; readonly text: string };

export function ChatTranscript({
  lines,
  thinking,
  endRef,
  label = "Conversation with Q",
}: {
  readonly lines: readonly Line[];
  readonly thinking: boolean;
  readonly endRef?: RefObject<HTMLDivElement | null>;
  readonly label?: string;
}) {
  return (
    <ol
      className="flex flex-col gap-3"
      aria-live="polite"
      aria-busy={thinking}
      aria-label={label}
    >
      {lines.map((line, index) => (
        <li
          // The conversation only grows; its order is its identity.
          key={index}
          className={
            line.from === "YOU"
              ? "cq-body max-w-[85%] self-end bg-(--cq-surface-raised) px-4 py-2 text-(--cq-text-primary)"
              : "flex max-w-[92%] items-start gap-2.5 self-start"
          }
        >
          {line.from === "YOU" ? (
            <>
              <span className="sr-only">You: </span>
              {line.text}
            </>
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
      {thinking ? (
        <li className="flex items-center gap-2.5 self-start" role="status">
          <QSwarm state="THINKING" pixels={32} />
          <span className="cq-caption text-(--cq-text-tertiary)">
            Q is thinking
          </span>
        </li>
      ) : null}
      <div ref={endRef} />
    </ol>
  );
}

/** One answer at a time: Enter sends, Shift+Enter is a new line. */
export function ChatComposer({
  inputRef,
  value,
  onChange,
  onSend,
  pending,
  label = "Your answer",
  placeholder = "Answer, or paste a link",
}: {
  readonly inputRef?: RefObject<HTMLTextAreaElement | null>;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly pending: boolean;
  readonly label?: string;
  readonly placeholder?: string;
}) {
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <textarea
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        rows={1}
        maxLength={2000}
        aria-label={label}
        placeholder={placeholder}
        className="cq-body min-h-11 flex-1 resize-none border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-2.5 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
      />
      <Button
        type="submit"
        variant="primary"
        disabled={pending || value.trim() === ""}
      >
        Send
      </Button>
    </form>
  );
}

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

async function applicantRequest<T>(operation: () => Promise<T>): Promise<
  | T
  | {
      readonly ok: false;
      readonly message: string;
      readonly rateLimited?: boolean;
    }
> {
  try {
    return await operation();
  } catch {
    return {
      ok: false,
      message:
        "The connection was interrupted. Your application is still here; please try again.",
    };
  }
}

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
            className="cq-caption flex items-center gap-1 border border-(--cq-border-subtle) px-2.5 py-1 text-(--cq-text-secondary)"
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
  initialSession,
  onCorrectAnswers,
  prepareSubmission,
}: {
  readonly gateway: PublicGatewayDto;
  /** Inside someone else's page: a panel, not a page. */
  readonly compact?: boolean;
  readonly preview?: ApplyPreview;
  readonly initialSession?: {
    readonly token: string;
    readonly application: ApplicationSummaryDto;
    readonly contactName: string;
    readonly contactEmail: string;
    readonly companyName: string;
    readonly materialNames?: readonly string[];
  };
  readonly onCorrectAnswers?: () => void;
  readonly prepareSubmission?: () => Promise<
    { readonly ok: true } | { readonly ok: false; readonly message: string }
  >;
}) {
  const fund = gateway.organisationDisplayName;
  const [token, setToken] = useState<string | null>(
    initialSession?.token ?? null,
  );
  const [stage, setStage] = useState<Stage>(
    preview?.stage ?? (initialSession === undefined ? "INTRO" : "TALKING"),
  );
  const [lines, setLines] = useState<readonly Line[]>(preview?.lines ?? []);
  const [application, setApplication] = useState<ApplicationSummaryDto | null>(
    preview?.application ?? initialSession?.application ?? null,
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
  const resultEnd = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastTurn = useRef<{ id: string; text: string } | null>(null);

  const interview = initialSession !== undefined;
  const [coverage, setCoverage] = useState<ApplicationCoverageDto | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [contactName, setContactName] = useState(
    initialSession?.contactName ?? "",
  );
  const [contactEmail, setContactEmail] = useState(
    initialSession?.contactEmail ?? "",
  );
  const [companyName, setCompanyName] = useState(
    initialSession?.companyName ?? "",
  );
  const [role, setRole] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [loaded, setLoaded] = useState(!interview);
  const submitKey = useRef("");
  const [submissionStarted, setSubmissionStarted] = useState(false);
  const [unconfirmedTurn, setUnconfirmedTurn] = useState(false);

  const loadProgress = async () => {
    if (token === null) return false;
    const result = await applicantRequest(() => interviewProgressAction(token));
    if (!result.ok) {
      setProblem({
        message: result.message,
        rateLimited: result.rateLimited === true,
      });
      return false;
    }
    setApplication(result.application);
    setCoverage(result.coverage);
    setConfirmed(result.coverage.contact.confirmed);
    const contactRead = ApplicationContactDtoSchema.safeParse(
      Reflect.get(result.coverage.contact, "details"),
    );
    const savedContact = contactRead.success ? contactRead.data : null;
    if (savedContact) {
      setContactName(savedContact.name);
      setContactEmail(savedContact.email);
      setCompanyName(savedContact.companyName);
      setRole(savedContact.role);
    }
    setLines(
      result.transcript.turns.map((turn) => ({
        from: turn.role === "Q" ? "Q" : "YOU",
        text: turn.text,
      })),
    );
    if (result.application.submittedAt !== null) setStage("SHARED");
    return true;
  };
  useEffect(() => {
    if (!interview) return;
    const recovered = readRecovery(gateway.publicId);
    lastTurn.current = recovered?.pendingTurn ?? null;
    submitKey.current = recovered?.submitKey ?? "";
    setSubmissionStarted(submitKey.current !== "");
    setUnconfirmedTurn(lastTurn.current !== null);
    startTransition(async () => {
      await loadProgress();
      setLoaded(true);
      if (lastTurn.current !== null)
        setProblem({
          message:
            "Your last answer needs confirmation. Retry it to recover Q's reply.",
          rateLimited: false,
        });
    });
    // One restoration per credential, never a new application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, interview]);

  const scroll = () =>
    requestAnimationFrame(() => end.current?.scrollIntoView({ block: "end" }));

  useEffect(() => {
    if (stage === "TALKING" && !pending && preview === undefined) {
      input.current?.focus();
    }
  }, [stage, pending, preview]);

  const answered = lines.filter((line) => line.from === "YOU").length;
  const verdict =
    interview || stage === "INTRO" || answered === 0 || revising
      ? null
      : verdictOf(application, stage === "STOPPED");
  const criteria = criterionLines(gateway, application);

  // A verdict arriving is the moment the founder came for: bring it into view.
  useEffect(() => {
    if (verdict !== null && preview === undefined) {
      requestAnimationFrame(() =>
        resultEnd.current?.scrollIntoView({ block: "end" }),
      );
    }
  }, [verdict, preview]);

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
      const result = await applicantRequest(() =>
        applicationTurnAction(token, text, turnId),
      );
      if (!result.ok) {
        fail(result);
        return;
      }
      lastTurn.current = null;
      setUnconfirmedTurn(false);
      if (interview) amendRecovery(gateway.publicId, { pendingTurn: null });
      setRevising(false);
      setApplication(result.application);
      if (interview) await loadProgress();
      else if (result.reply !== null) {
        const reply = result.reply;
        setLines((current) => [...current, { from: "Q", text: reply }]);
      }
      scroll();
    });
  };

  const send = () => {
    const text = draft.trim();
    if (token === null || text === "" || pending || lastTurn.current !== null)
      return;
    setDraft("");
    setStage("TALKING");
    setLines((current) => [...current, { from: "YOU", text }]);
    // One id per message, kept for a retry: the API answers a repeated id
    // with the first answer instead of running a second turn.
    const turn = { id: key("turn"), text };
    lastTurn.current = turn;
    setUnconfirmedTurn(true);
    if (interview) amendRecovery(gateway.publicId, { pendingTurn: turn });
    scroll();
    sendText(turn.text, turn.id);
  };

  const retry = () => {
    const turn = lastTurn.current;
    if (turn !== null) sendText(turn.text, turn.id);
    else if (token === null) start();
    else if (interview && stage === "STOPPED" && submitKey.current !== "")
      share();
    else if (interview)
      startTransition(async () => {
        setProblem(null);
        await loadProgress();
      });
    else setProblem(null);
  };

  const share = () =>
    startTransition(async () => {
      if (token === null) return;
      setProblem(null);
      // A lost receipt may mean Submit already succeeded. Recover it before
      // repeating the legacy materials attachment, which locks on submission.
      if (interview && submitKey.current !== "") {
        const restored = await applicantRequest(() =>
          interviewProgressAction(token),
        );
        if (!restored.ok) {
          fail(restored);
          return;
        }
        if (restored.application.submittedAt !== null) {
          setApplication(restored.application);
          setStage("SHARED");
          return;
        }
      }
      if (submitKey.current === "") submitKey.current = key("share");
      setSubmissionStarted(true);
      if (interview)
        amendRecovery(gateway.publicId, { submitKey: submitKey.current });
      if (prepareSubmission !== undefined) {
        const prepared = await applicantRequest(prepareSubmission);
        if (!prepared.ok) {
          fail(prepared);
          return;
        }
      }
      const result = await applicantRequest(() =>
        submitApplicationAction(token, submitKey.current),
      );
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
          ? "flex items-center gap-3 border-b border-(--cq-border-subtle) px-4 py-3 pe-14"
          : "flex flex-col gap-3"
      }
    >
      {compact ? null : typeof gateway.organisationCoverUrl === "string" ? (
        <EntityCover src={gateway.organisationCoverUrl} />
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
            {interview ? "Founder interview with Q" : "Fit check with Q"}
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
              ? "cq-body max-w-[85%] self-end bg-(--cq-surface-raised) px-4 py-2 text-(--cq-text-primary)"
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
          placeholder="Answer, or paste a link"
          className="cq-body min-h-11 flex-1 resize-none border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-2.5 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={pending || draft.trim() === "" || unconfirmedTurn}
        >
          Send
        </Button>
      </form>
      {interview ? (
        <Button
          variant="quiet"
          onClick={() => setStage("DECLINED")}
          disabled={pending}
        >
          Pause interview
        </Button>
      ) : null}
      {answered > 0 ? (
        <button
          type="button"
          onClick={() => {
            setStage("STOPPED");
            if (interview)
              startTransition(async () => {
                setProblem(null);
                await loadProgress();
              });
          }}
          className="cq-caption min-h-11 self-start text-(--cq-text-secondary) underline-offset-4 hover:underline"
        >
          {interview
            ? "Review my application"
            : "That’s all I can share for now"}
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
        className="flex flex-col gap-4 border border-(--cq-border-subtle) bg-(--cq-surface) p-4"
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
        <h2 className="cq-title-sm text-(--cq-text-primary)">Sent to {fund}</h2>
        <p className="cq-body text-(--cq-text-secondary)">
          {fund} has your answers
          {application === null || application.reference === ""
            ? ""
            : ` (reference ${application.reference})`}
          . The investment team may contact you through your confirmed email.
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
        className="flex items-start gap-3 bg-(--cq-surface-subtle) p-3"
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
          {problem.rateLimited && !interview ? null : (
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
    (stage === "TALKING" || (!interview && stage === "STOPPED")) &&
    verdict === null &&
    (!interview || (confirmed && loaded));

  const contactPanel = (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (token === null || pending) return;
        startTransition(async () => {
          setProblem(null);
          const result = await applicantRequest(() =>
            contactAction(token, {
              name: contactName,
              email: contactEmail,
              companyName,
              role,
            }),
          );
          if (!result.ok) {
            fail(result);
            return;
          }
          setConfirmed(result.contact.emailConfirmed);
          setCodeSent(result.codeSent);
          if (!result.codeSent && !result.contact.emailConfirmed)
            fail({
              message:
                "The confirmation email couldn't be sent. Check your address and try again.",
            });
        });
      }}
    >
      <h1 className="cq-title-lg">Confirm your contact details</h1>
      <p className="cq-body text-(--cq-text-secondary)">
        Your application is for {fund}. Nothing is submitted until you review it
        and press Submit.
      </p>
      {(
        [
          ["Full name", contactName, setContactName],
          ["Company", companyName, setCompanyName],
          ["Role", role, setRole],
          ["Email", contactEmail, setContactEmail],
        ] as const
      ).map(([label, value, update]) => (
        <label key={label} className="cq-body-sm flex flex-col gap-1">
          {label}
          <input
            required
            type={label === "Email" ? "email" : "text"}
            value={value}
            maxLength={label === "Email" ? 254 : label === "Role" ? 120 : 200}
            onChange={(event) => {
              update(event.target.value);
              setCodeSent(false);
            }}
            className="min-h-11 border border-(--cq-border-subtle) bg-(--cq-surface) px-3"
          />
        </label>
      ))}
      <Button type="submit" disabled={pending}>
        {pending
          ? "Sending…"
          : codeSent
            ? "Send a new code"
            : "Send confirmation code"}
      </Button>
      {codeSent ? (
        <>
          <label className="cq-body-sm flex flex-col gap-1">
            Email confirmation code
            <input
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="min-h-11 border border-(--cq-border-subtle) bg-(--cq-surface) px-3"
            />
          </label>
          <Button
            type="button"
            disabled={pending || code.length !== 6}
            onClick={() => {
              if (token === null) return;
              startTransition(async () => {
                setProblem(null);
                const result = await applicantRequest(() =>
                  confirmContactAction(token, code),
                );
                if (!result.ok) {
                  fail(result);
                  return;
                }
                if (result.status === "CONFIRMED") {
                  setConfirmed(true);
                  await loadProgress();
                } else
                  fail({
                    message:
                      result.status === "WRONG_CODE"
                        ? "That code didn't match. Please try again."
                        : "That code has expired. Send a new code.",
                  });
              });
            }}
          >
            Confirm email
          </Button>
        </>
      ) : null}
      <Button type="button" variant="quiet" onClick={onCorrectAnswers}>
        Back to my answers
      </Button>
    </form>
  );

  const contactRead =
    coverage === null
      ? null
      : ApplicationContactDtoSchema.safeParse(
          Reflect.get(coverage.contact, "details"),
        );
  const reviewContact = contactRead?.success ? contactRead.data : null;
  const review =
    coverage === null ? null : (
      <section
        className="flex flex-col gap-4"
        aria-label="Review your application"
      >
        <h1 className="cq-title-lg">Review before submitting</h1>
        <p className="cq-body text-(--cq-text-secondary)">
          {fund} will receive your confirmed contact details, form answers, the
          interview transcript and the {coverage.documentCount} documents you
          chose to share. Applicant claims remain unverified unless supporting
          evidence is recorded.
        </p>
        {reviewContact ? (
          <div>
            <h2 className="cq-title-sm">Contact details to share</h2>
            <p className="cq-body-sm">
              {reviewContact.name} · {reviewContact.email}
              <br />
              {reviewContact.role} · {reviewContact.companyName}
            </p>
          </div>
        ) : null}
        {initialSession?.materialNames?.length ? (
          <div>
            <h2 className="cq-title-sm">Documents selected for submission</h2>
            <ul className="cq-body-sm">
              {initialSession.materialNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="cq-body-sm">
            {coverage.documentCount} documents attached to this application.
          </p>
        )}
        <Criteria lines={criteria} />
        <h2 className="cq-title-sm">Answered</h2>
        <ul className="cq-body-sm flex flex-col gap-2">
          {coverage.coverage.answered.map((item) => (
            <li key={item.dimension}>
              <b>{item.label}:</b> {item.summary} ·{" "}
              {item.provenance.replaceAll("_", " ").toLowerCase()}
            </li>
          ))}
        </ul>
        {(
          [
            ["Unknown", coverage.coverage.unknown],
            ["Declined", coverage.coverage.declined],
            ["Still missing", coverage.coverage.missing],
          ] as const
        ).map(([label, items]) =>
          items.length === 0 ? null : (
            <div key={label}>
              <h2 className="cq-title-sm">{label}</h2>
              <ul className="cq-body-sm">
                {items.map((item) => (
                  <li key={item.dimension}>{item.label}</li>
                ))}
              </ul>
            </div>
          ),
        )}
        {coverage.coverage.contradictions.length === 0 ? null : (
          <div>
            <h2 className="cq-title-sm">Answers that disagree</h2>
            <ul>
              {coverage.coverage.contradictions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {coverage.coverage.access !== "MAY_APPLY" ? (
          <p role="status">
            Your application needs corrections before {fund} can receive it:{" "}
            {[
              ...coverage.coverage.unmet,
              ...coverage.coverage.stillNeeded,
            ].join(", ")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={share}
            disabled={
              pending ||
              !coverage.contact.confirmed ||
              coverage.coverage.access !== "MAY_APPLY" ||
              unconfirmedTurn
            }
          >
            {pending ? "Submitting…" : `Submit to ${fund}`}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setStage("TALKING")}
            disabled={pending}
          >
            Keep answering
          </Button>
          <Button
            variant="quiet"
            onClick={onCorrectAnswers}
            disabled={pending || submissionStarted}
          >
            Correct form answers
          </Button>
        </div>
        <p className="cq-caption text-(--cq-text-tertiary)">
          The investment team will review your application and may contact you
          at your confirmed email address.
        </p>
        <details>
          <summary className="min-h-11 cursor-pointer">
            Review full transcript
          </summary>
          {transcript}
        </details>
      </section>
    );

  const body =
    interview && !loaded ? (
      <p role="status">Restoring your application…</p>
    ) : interview && !confirmed && stage !== "SHARED" ? (
      contactPanel
    ) : interview && stage === "STOPPED" ? (
      review
    ) : stage === "INTRO" ? (
      intro
    ) : closing !== null ? (
      closing
    ) : (
      <>
        {criteria.length === 0 || verdict !== null ? null : (
          <Criteria lines={criteria} compact />
        )}
        {interview && lines.length === 0 ? (
          <div className="flex flex-col gap-3">
            <h1 className="cq-title-lg">Let’s understand your company</h1>
            <p className="cq-body text-(--cq-text-secondary)">
              Q uses your answers and shared materials to ask focused
              follow-ups. You can say “I don’t know” or decline any question,
              and pause by closing this tab’s page.
            </p>
            <Button
              disabled={pending || unconfirmedTurn}
              onClick={() => {
                const turn = {
                  id: key("turn"),
                  text: "I'm ready to begin the investment interview.",
                };
                lastTurn.current = turn;
                setUnconfirmedTurn(true);
                amendRecovery(gateway.publicId, { pendingTurn: turn });
                sendText(turn.text, turn.id);
              }}
            >
              Begin interview
            </Button>
          </div>
        ) : null}
        {transcript}
        {result}
        <div ref={resultEnd} />
      </>
    );

  // C2: the durable coverage check, beside the live interview.
  const coveragePanel =
    interview &&
    loaded &&
    confirmed &&
    coverage !== null &&
    stage === "TALKING" &&
    closing === null ? (
      <div className="flex flex-col gap-4">
        <CoveragePanel coverage={coverage} fund={fund} />
        {token === null ? null : (
          <GateqVideoEntry
            token={token}
            fund={fund}
            coverage={coverage}
            participantName={contactName}
            onEnded={async (typed) => {
              await loadProgress();
              if (!typed) setStage("STOPPED");
            }}
          />
        )}
      </div>
    ) : null;

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
          {coveragePanel}
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
      {coveragePanel === null ? (
        <>
          {body}
          {problemNote}
          {showComposer ? composer : null}
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-6">
            {body}
            {problemNote}
            {showComposer ? composer : null}
          </div>
          {coveragePanel}
        </div>
      )}
    </section>
  );
}
