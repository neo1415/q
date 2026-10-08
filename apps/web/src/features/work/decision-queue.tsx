"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";

import type {
  ChatThreadDto,
  NamedPicture,
  QWorkDoneItemDto,
  QWorkDonePageDto,
  WorkforceDraftDto,
  WorkforceJobDetailDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button } from "@capital-q/ui/button";
import { ChevronDown, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { Skeleton } from "@capital-q/ui/states";

import { bodyDigest } from "@capital-q/q-core/speech";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import {
  chatThreadAction,
  sendChatMessageAction,
} from "@/features/chat/chat-actions";
import {
  approveQApprovalAction,
  rejectQApprovalAction,
} from "@/features/q/actions";
import { useQSessionOptional } from "@/features/q/q-session";

import {
  decisionTitle,
  doneGroups,
  draftsLabel,
  threadLines,
  withPage,
  type Decision,
  type DecisionGroup,
  type DoneGroup,
  type HeldDecision,
} from "./decisions";
import { retryHeldAction, sendHeldAsIsAction } from "./held-actions";
import { readPlan } from "./plan-words";
import { listDoneAction } from "./work-page-actions";
import { outOfTen } from "./workforce-view";

/**
 * Work around decisions (Zino, 2026-10-08; design
 * docs/design/2026-10-08/work): "Needs you" is a short queue, one card per
 * decision with the exact message and four verbs, grouped per company or
 * person; the writer and reviewer's drafts are one disclosure inside the
 * card; "Done for you" is grouped per relationship; each group opens its
 * thread with what Q sent and why. Approving is the Approval Engine's own
 * action on the exact bound text; an edit is the person's own message,
 * sent by them, and the card it replaces is declined.
 */

/** Groups whose conversation is read as the page opens; others on demand. */
const READ_AHEAD = 6;
/** Groups shown before "Show N more" (the queue stays short). */
const QUEUE_PREVIEW = 5;

const threadCache = new Map<string, Promise<ChatThreadDto | null>>();

function readThread(relationshipId: string): Promise<ChatThreadDto | null> {
  const cached = threadCache.get(relationshipId);
  if (cached !== undefined) return cached;
  const read = chatThreadAction(relationshipId)
    .then((result) => (result.ok ? result.value : null))
    .catch(() => null);
  threadCache.set(relationshipId, read);
  return read;
}

function useThread(
  relationshipId: string | null,
  enabled: boolean,
): ChatThreadDto | null | undefined {
  const [thread, setThread] = useState<ChatThreadDto | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (relationshipId === null || !enabled) return;
    let live = true;
    void readThread(relationshipId).then((value) => {
      if (live) setThread(value);
    });
    return () => {
      live = false;
    };
  }, [relationshipId, enabled]);
  return thread;
}

/** Their words since we last wrote, newest last; null when we wrote last. */
function theirLatest(thread: ChatThreadDto | null | undefined): string | null {
  if (thread === null || thread === undefined) return null;
  const messages = [...thread.messages]
    .filter((message) => !message.unsent)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const last = messages.at(-1);
  if (last === undefined || last.mine) return null;
  return last.body;
}

const NAMED_KIND = {
  PERSON: "person",
  COMPANY: "company",
  INVESTOR_ORGANISATION: "investor",
} as const;

/** Their picture, as the server signed it for this reader, else initials. */
function Mark({
  name,
  named = null,
  size = 32,
}: {
  readonly name: string;
  readonly named?: NamedPicture | null | undefined;
  readonly size?: number;
}) {
  return (
    <EntityAvatar
      kind={named === null ? "company" : NAMED_KIND[named.kind]}
      name={name}
      src={named?.photoUrl ?? null}
      size={size}
      decorative
    />
  );
}

const HELD_KEY = "cq.work.dismissedHeld";

const HELD_EVENT = "cq:work-dismissed-held";

function rawDismissed(): string {
  try {
    return window.localStorage.getItem(HELD_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseDismissed(raw: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((one): one is string => typeof one === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function subscribeDismissed(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(HELD_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(HELD_EVENT, onChange);
  };
}

/**
 * Held drafts the person let go of: a per-browser convenience only (the
 * draft and its record stay on the server). Empty on the server render.
 */
export function useDismissedHeld(): ReadonlySet<string> {
  const raw = useSyncExternalStore(
    subscribeDismissed,
    rawDismissed,
    () => "[]",
  );
  return useMemo(() => parseDismissed(raw), [raw]);
}

export function dismissHeld(draftId: string): void {
  try {
    const next = [...parseDismissed(rawDismissed()), draftId].slice(-200);
    window.localStorage.setItem(HELD_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(HELD_EVENT));
  } catch {
    // Storage blocked: it stays dismissed for this page view only.
  }
}

// ---------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------

export function DecisionQueue({
  groups,
  jobs,
  done,
  renderPlan,
  onDecided,
  extra,
  extraCount = 0,
}: {
  readonly groups: readonly DecisionGroup[];
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly done: readonly QWorkDoneItemDto[];
  /** A card that is not a message (a plan, a grant): its own approval view. */
  readonly renderPlan: (approvalId: string, onDone: () => void) => ReactNode;
  /** An approval decided, or a held draft let go. */
  readonly onDecided: (key: string) => void;
  /** Other things waiting on them (times to pick, notices), as rows. */
  readonly extra?: ReactNode;
  /** How many rows `extra` holds: they wait on them too, so they count. */
  readonly extraCount?: number;
}) {
  const [all, setAll] = useState(false);
  // Live 2026-10-08: "Needs you 0 · Nothing waits on you" above two rows
  // saying an investor was waiting for a reply.
  const count =
    groups.reduce((sum, group) => sum + group.items.length, 0) + extraCount;
  const shown = all ? groups : groups.slice(0, QUEUE_PREVIEW);
  return (
    <section aria-labelledby="work-needs-you" data-work-needs-you>
      <h2
        id="work-needs-you"
        className="flex items-baseline gap-2 cq-title-sm text-(--cq-text-primary)"
      >
        Needs you
        <span className="cq-body font-normal cq-numeric text-(--cq-text-tertiary)">
          {count}
        </span>
      </h2>
      <p className="mt-0.5 mb-3 cq-label font-normal text-(--cq-text-tertiary)">
        {count === 0
          ? "Nothing waits on you. When Q drafts a reply or wants your yes, it shows here first; nothing is sent until you decide."
          : "Nothing below is sent until you decide."}
      </p>
      {shown.map((group, index) => (
        <GroupView
          key={group.key}
          group={group}
          jobs={jobs}
          done={done}
          readAhead={index < READ_AHEAD}
          renderPlan={renderPlan}
          onDecided={onDecided}
        />
      ))}
      {all || groups.length <= QUEUE_PREVIEW ? null : (
        <MoreButton onClick={() => setAll(true)}>
          Show {groups.length - QUEUE_PREVIEW} more
        </MoreButton>
      )}
      {extra}
    </section>
  );
}

function MoreButton({
  onClick,
  disabled,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-1 inline-flex min-h-11 items-center gap-1 cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary) disabled:opacity-60"
    >
      {children}
      <ChevronDown
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
      />
    </button>
  );
}

function GroupView({
  group,
  jobs,
  done,
  readAhead,
  renderPlan,
  onDecided,
}: {
  readonly group: DecisionGroup;
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly done: readonly QWorkDoneItemDto[];
  readonly readAhead: boolean;
  readonly renderPlan: (approvalId: string, onDone: () => void) => ReactNode;
  readonly onDecided: (key: string) => void;
}) {
  const [threadOpen, setThreadOpen] = useState(false);
  const thread = useThread(group.relationshipId, readAhead || threadOpen);
  const name =
    group.name ??
    (group.items[0]?.kind === "APPROVAL" ? group.items[0].summary : "Q");
  const theirs = theirLatest(thread);
  return (
    <div
      className="border-t border-(--cq-border-subtle) pt-3.5 pb-1.5"
      data-decision-group={group.key}
    >
      <div className="mb-2.5 flex min-h-11 items-center gap-2.5">
        <Mark name={name} named={group.named} />
        <div className="min-w-0 flex-1">
          <p className="truncate cq-body font-semibold text-(--cq-text-primary)">
            {name}
          </p>
          <p className="truncate cq-label font-normal text-(--cq-text-tertiary)">
            {group.items.length === 1
              ? "1 decision"
              : `${String(group.items.length)} decisions`}
          </p>
        </div>
        {group.relationshipId === null ? null : (
          <Button
            variant="quiet"
            size="compact"
            aria-expanded={threadOpen}
            onClick={() => setThreadOpen((now) => !now)}
            className="text-(--cq-text-secondary)"
          >
            {threadOpen ? "Hide thread" : "Thread"}
          </Button>
        )}
      </div>
      {threadOpen && group.relationshipId !== null ? (
        <ThreadPanel
          relationshipId={group.relationshipId}
          thread={thread}
          jobs={jobs}
          done={done}
        />
      ) : null}
      {group.items.map((item) =>
        item.kind === "APPROVAL" ? (
          <DecisionCard
            key={item.approvalId}
            item={item}
            name={name}
            theirs={theirs}
            relationshipId={group.relationshipId}
            renderPlan={renderPlan}
            onDecided={() => onDecided(item.approvalId)}
          />
        ) : (
          <HeldCard
            key={item.draftId}
            item={item}
            name={name}
            relationshipId={group.relationshipId}
            onDecided={() => onDecided(item.draftId)}
          />
        ),
      )}
    </div>
  );
}

function Card({ children }: { readonly children: ReactNode }) {
  return (
    <article
      className="mb-2.5 flex flex-col gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-3.5"
      data-decision
    >
      {children}
    </article>
  );
}

function Quote({ children }: { readonly children: ReactNode }) {
  return (
    <blockquote className="m-0 rounded-(--cq-radius-md) bg-(--cq-surface-sunken) px-3 py-2.5 cq-body-sm whitespace-pre-wrap text-(--cq-text-primary)">
      {children}
    </blockquote>
  );
}

function Theirs({ text }: { readonly text: string }) {
  return (
    <p className="m-0 border-l-2 border-(--cq-border) pl-2.5 cq-body-sm text-(--cq-text-secondary)">
      <span className="font-medium text-(--cq-text-tertiary)">They said </span>“
      {text.length > 240 ? `${text.slice(0, 240)}…` : text}”
    </p>
  );
}

function Status({ text }: { readonly text: string | null }) {
  if (text === null) return null;
  return (
    <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
      {text}
    </p>
  );
}

function useAskQ(): ((question: string) => string) | null {
  const session = useQSessionOptional();
  if (session === null) return null;
  return (question) => {
    void session.q.ask(question);
    return "Asked Q. Its answer is in the Q panel.";
  };
}

function DecisionCard({
  item,
  name,
  theirs,
  relationshipId,
  renderPlan,
  onDecided,
}: {
  readonly item: Decision;
  readonly name: string;
  readonly theirs: string | null;
  readonly relationshipId: string | null;
  readonly renderPlan: (approvalId: string, onDone: () => void) => ReactNode;
  readonly onDecided: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const ask = useAskQ();
  const view = item.view;
  const message =
    view?.action.actionType === "chat.message.send"
      ? readPlan(view.action.preview).quote
      : null;

  const approve = () =>
    startTransition(async () => {
      setStatus(null);
      const result = await approveQApprovalAction(item.approvalId).catch(
        () => null,
      );
      if (result?.ok === true) onDecided();
      else
        setStatus(
          result?.message ?? "That didn't go through. Nothing was sent.",
        );
    });
  const dismiss = () =>
    startTransition(async () => {
      setStatus(null);
      const result = await rejectQApprovalAction(item.approvalId).catch(
        () => null,
      );
      if (result?.ok === true) onDecided();
      else setStatus("That didn't go through. Try again.");
    });

  // Not a message (a plan, a grant, an email): its own approval view.
  if (view === null || message === null) {
    return (
      <Card>
        <p className="m-0 cq-body-sm font-medium text-(--cq-text-primary)">
          {decisionTitle(item)}
        </p>
        {renderPlan(item.approvalId, onDecided)}
        <Drafts drafts={item.drafts} />
      </Card>
    );
  }
  const canDecide = view.canDecide;
  return (
    <Card>
      <p className="m-0 cq-body-sm font-medium text-(--cq-text-primary)">
        {decisionTitle(item)}
      </p>
      {theirs === null ? null : <Theirs text={theirs} />}
      {editing && relationshipId !== null ? (
        <EditAndSend
          initial={message}
          relationshipId={relationshipId}
          onSent={() => {
            // Their own message went; the card Q drafted is declined.
            void rejectQApprovalAction(item.approvalId).catch(() => null);
            onDecided();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <Quote>
            <span className="sr-only">What Q will send: </span>
            {message}
          </Quote>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="primary"
              disabled={pending || !canDecide}
              onClick={approve}
            >
              Approve &amp; send
            </Button>
            {relationshipId === null ? null : (
              <Button
                variant="secondary"
                disabled={pending || !canDecide}
                onClick={() => setEditing(true)}
              >
                Edit &amp; send
              </Button>
            )}
            <Button
              variant="quiet"
              disabled={pending}
              onClick={dismiss}
              className="text-(--cq-text-secondary)"
            >
              Dismiss
            </Button>
            {ask === null ? null : (
              <Button
                variant="quiet"
                disabled={pending}
                onClick={() =>
                  setStatus(
                    ask(
                      `Look at the reply to ${name} that waits for my approval. Does it answer what they last said? What would you change?`,
                    ),
                  )
                }
                className="text-(--cq-text-secondary)"
              >
                Ask Q
              </Button>
            )}
          </div>
          {canDecide ? null : (
            <Status text="Already decided or expired. Nothing more is sent from this card." />
          )}
        </>
      )}
      <Status text={status} />
      <Drafts drafts={item.drafts} />
    </Card>
  );
}

function HeldCard({
  item,
  name,
  relationshipId,
  onDecided,
}: {
  readonly item: HeldDecision;
  readonly name: string;
  readonly relationshipId: string | null;
  readonly onDecided: () => void;
}) {
  const [mode, setMode] = useState<"READ" | "EDIT" | "CONFIRM">("READ");
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Zino, 2026-10-08: a held message can be sent as it is, after "Send this
  // exact message?". The text sent is exactly the text on screen, and the
  // send's key is bound to it, so a repeated press is the same send.
  const sendAsIs = () =>
    startTransition(async () => {
      if (relationshipId === null) return;
      setStatus(null);
      const result = await sendHeldAsIsAction({
        relationshipId,
        body: item.body,
        idempotencyKey: `held-${item.draftId.slice(0, 36)}-${bodyDigest(item.body)}`,
      }).catch(() => null);
      if (result?.ok === true) {
        threadCache.delete(relationshipId);
        dismissHeld(item.draftId);
        onDecided();
      } else {
        setStatus(result?.message ?? "That didn't send. Try again.");
      }
    });
  // "Ask Q to try again": written and reviewed again now; a pass comes
  // back as an ordinary approval card in this queue.
  const retry = () =>
    startTransition(async () => {
      setStatus(null);
      const result = await retryHeldAction({
        draftId: item.draftId,
        relationshipId,
        idempotencyKey: `retry-${crypto.randomUUID()}`,
      }).catch(() => null);
      if (result === null) {
        setStatus("Q couldn't try again just now. Try later.");
        return;
      }
      setStatus(result.message);
      if (result.ok) {
        dismissHeld(item.draftId);
        onDecided();
      }
    });
  return (
    <Card>
      <p className="m-0 cq-body-sm font-medium text-(--cq-text-primary)">
        {decisionTitle(item)}
      </p>
      <p className="m-0 flex gap-1.5 cq-body-sm text-(--cq-text-secondary)">
        <span aria-hidden="true" className="font-semibold text-(--cq-warning)">
          !
        </span>
        <span>{item.reason}</span>
      </p>
      {mode === "EDIT" && relationshipId !== null ? (
        <EditAndSend
          initial={item.body}
          relationshipId={relationshipId}
          onSent={() => {
            dismissHeld(item.draftId);
            onDecided();
          }}
          onCancel={() => setMode("READ")}
        />
      ) : mode === "CONFIRM" && relationshipId !== null ? (
        <div className="flex flex-col gap-2" data-held-confirm>
          <p className="m-0 cq-body-sm font-medium text-(--cq-text-primary)">
            Send this exact message to {name}?
          </p>
          <Quote>
            <span className="sr-only">What will be sent: </span>
            {item.body}
          </Quote>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="primary" disabled={pending} onClick={sendAsIs}>
              Yes, send this
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => setMode("EDIT")}
            >
              Edit
            </Button>
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => setMode("READ")}
              className="text-(--cq-text-secondary)"
            >
              Cancel
            </Button>
          </div>
          <p className="m-0 cq-caption text-(--cq-text-tertiary)">
            Nothing is sent until you say yes. It goes exactly as shown.
          </p>
        </div>
      ) : (
        <>
          <Quote>{item.body}</Quote>
          <div className="flex flex-wrap items-center gap-1" data-held-verbs>
            {relationshipId === null ? null : (
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => setMode("CONFIRM")}
              >
                Send as is
              </Button>
            )}
            {relationshipId === null ? null : (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => setMode("EDIT")}
              >
                Edit &amp; send
              </Button>
            )}
            <Button
              variant="quiet"
              disabled={pending}
              onClick={retry}
              className="text-(--cq-text-secondary)"
            >
              {pending ? "Q is trying again…" : "Ask Q to try again"}
            </Button>
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() => {
                dismissHeld(item.draftId);
                onDecided();
              }}
              className="text-(--cq-text-secondary)"
            >
              Dismiss
            </Button>
            <Button
              variant="quiet"
              disabled={pending}
              onClick={() =>
                setStatus(`Later, then. It stays here until you decide.`)
              }
              className="text-(--cq-text-secondary)"
            >
              Later
            </Button>
          </div>
        </>
      )}
      <Status text={status} />
      <Drafts drafts={item.drafts} />
    </Card>
  );
}

/**
 * The person's own message, edited from Q's draft and sent by them: one
 * idempotency key per press of Send, made in the browser.
 */
function EditAndSend({
  initial,
  relationshipId,
  onSent,
  onCancel,
}: {
  readonly initial: string;
  readonly relationshipId: string;
  readonly onSent: () => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const send = () =>
    startTransition(async () => {
      const body = text.trim();
      if (body.length === 0) return;
      setStatus(null);
      const result = await sendChatMessageAction(
        relationshipId,
        { kind: "TEXT", body },
        `work-edit-${crypto.randomUUID()}`,
      ).catch(() => null);
      if (result?.ok === true) {
        threadCache.delete(relationshipId);
        onSent();
      } else {
        setStatus(result?.message ?? "That didn't send. Try again.");
      }
    });
  return (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor={`edit-${relationshipId}`}>
        Your message
      </label>
      <textarea
        id={`edit-${relationshipId}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={Math.min(10, Math.max(4, text.split("\n").length + 1))}
        maxLength={4000}
        className="w-full rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3 py-2.5 cq-body-sm text-(--cq-text-primary) outline-none focus:border-(--cq-border-strong)"
      />
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="primary" disabled={pending} onClick={send}>
          Send as you
        </Button>
        <Button
          variant="quiet"
          disabled={pending}
          onClick={onCancel}
          className="text-(--cq-text-secondary)"
        >
          Cancel
        </Button>
      </div>
      <Status text={status} />
    </div>
  );
}

/** "How Q wrote this (N drafts)": the writer and reviewer, in one place. */
function Drafts({ drafts }: { readonly drafts: readonly WorkforceDraftDto[] }) {
  const [open, setOpen] = useState(false);
  if (drafts.length === 0) return null;
  return (
    <div className="cq-label font-normal text-(--cq-text-secondary)">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className="inline-flex min-h-9 items-center gap-1 text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
        data-drafts-toggle
      >
        <ChevronDown
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
          className={cx(
            "-rotate-90 motion-safe:transition-transform motion-safe:duration-(--cq-motion-fast)",
            open && "rotate-0",
          )}
        />
        {draftsLabel(drafts)}
      </button>
      {open ? (
        <ol className="m-0 mt-1 flex list-none flex-col gap-2.5 border-l border-(--cq-border-subtle) pl-3">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <p className="m-0">
                <span className="font-medium text-(--cq-text-primary)">
                  Draft {draft.attempt}
                </span>
                {draft.grade === null ? null : (
                  <span className="cq-numeric text-(--cq-text-tertiary)">
                    {" "}
                    ·{" "}
                    {draft.grade.passed
                      ? `passed, ${outOfTen(draft.grade.score)} against a bar of ${outOfTen(draft.grade.threshold)}`
                      : `sent back, ${outOfTen(draft.grade.score)} against a bar of ${outOfTen(draft.grade.threshold)}`}
                  </span>
                )}
              </p>
              <p className="m-0 mt-0.5 whitespace-pre-wrap text-(--cq-text-tertiary)">
                {draft.body.length > 280
                  ? `${draft.body.slice(0, 280)}…`
                  : draft.body}
              </p>
              {draft.grade !== null &&
              !draft.grade.passed &&
              draft.grade.feedback.trim() !== "" ? (
                <p className="m-0 mt-1 whitespace-pre-wrap">
                  <span className="font-medium">What to fix: </span>
                  {draft.grade.feedback}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The thread, with what Q sent and why
// ---------------------------------------------------------------------------

export function ThreadPanel({
  relationshipId,
  thread,
  jobs,
  done,
}: {
  readonly relationshipId: string;
  readonly thread: ChatThreadDto | null | undefined;
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly done: readonly QWorkDoneItemDto[];
}) {
  if (thread === undefined) return <Skeleton lines={3} />;
  if (thread === null) {
    return (
      <p className="mb-3 cq-body-sm text-(--cq-text-secondary)" role="status">
        The conversation couldn’t load. Try again in a moment.
      </p>
    );
  }
  const lines = threadLines({
    messages: [...thread.messages].sort((a, b) =>
      a.sentAt.localeCompare(b.sentAt),
    ),
    jobs,
    done,
    relationshipId,
  });
  return (
    <div
      className="mb-3 flex flex-col gap-3 rounded-(--cq-radius-lg) bg-(--cq-surface) p-3"
      data-thread={relationshipId}
    >
      {lines.length === 0 ? (
        <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
          No messages yet. When either side writes, it shows here.
        </p>
      ) : (
        lines.slice(-12).map((line) => (
          <div
            key={line.id}
            className={cx(
              "max-w-[88%]",
              line.side === "US" ? "self-end" : "self-start",
            )}
          >
            <p className="m-0 mb-1 cq-label font-normal text-(--cq-text-tertiary)">
              {line.byQ === null ? line.who : "Sent by Q for you"} ·{" "}
              <time dateTime={line.at} suppressHydrationWarning>
                {new Intl.DateTimeFormat("en-GB", {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(line.at))}
              </time>
            </p>
            <p
              className={cx(
                "m-0 rounded-(--cq-radius-md) border border-(--cq-border-subtle) px-3 py-2 cq-body-sm whitespace-pre-wrap text-(--cq-text-primary)",
                line.side === "US"
                  ? "bg-(--cq-surface-subtle)"
                  : "bg-(--cq-surface-raised)",
              )}
            >
              {line.body}
            </p>
            {line.byQ === null ? null : (
              <div className="mt-1.5 border-l-2 border-(--cq-accent) pl-2.5 cq-label font-normal text-(--cq-text-secondary)">
                {line.byQ.why === null ? null : (
                  <p className="m-0">
                    <span className="font-medium">Why Q sent it: </span>
                    {line.byQ.why}
                  </p>
                )}
                {line.byQ.verdict === null ? null : (
                  <p className="m-0">{line.byQ.verdict}</p>
                )}
                <Drafts drafts={line.byQ.drafts} />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Done for you
// ---------------------------------------------------------------------------

export function DoneForYou({
  initial,
  jobs,
}: {
  readonly initial: QWorkDonePageDto | null;
  readonly jobs: readonly WorkforceJobDetailDto[];
}) {
  const [items, setItems] = useState<readonly QWorkDoneItemDto[]>(
    initial?.items ?? [],
  );
  const [cursor, setCursor] = useState(initial?.nextCursor ?? null);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const more = () => {
    if (cursor === null) return;
    startTransition(async () => {
      const result = await listDoneAction(cursor).catch(() => null);
      if (result?.ok !== true) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setItems((now) => withPage(now, result.value.items));
      setCursor(result.value.nextCursor);
    });
  };
  const groups = doneGroups(items);
  return (
    <section aria-labelledby="work-done" data-work-done>
      <h2
        id="work-done"
        className="flex items-baseline gap-2 cq-title-sm text-(--cq-text-primary)"
      >
        Done for you
        {initial === null ? null : (
          <span className="cq-body font-normal cq-numeric text-(--cq-text-tertiary)">
            {initial.thisWeek} this week
          </span>
        )}
      </h2>
      {initial === null ? (
        <p className="mt-2 cq-body-sm text-(--cq-text-secondary)" role="status">
          What Q did couldn’t load. Try again in a moment.
        </p>
      ) : groups.length === 0 ? (
        <p className="mt-2 cq-body-sm text-(--cq-text-secondary)">
          Nothing done yet. Messages Q sends and calls it books for you show
          here, grouped by company.
        </p>
      ) : (
        <ul className="mt-3 border-t border-(--cq-border-subtle)">
          {groups.map((group) => (
            <DoneRow key={group.key} group={group} jobs={jobs} done={items} />
          ))}
        </ul>
      )}
      {cursor === null ? null : (
        <MoreButton onClick={more} disabled={pending}>
          {failed ? "Couldn’t load more. Try again" : "Show more"}
        </MoreButton>
      )}
    </section>
  );
}

function DoneRow({
  group,
  jobs,
  done,
}: {
  readonly group: DoneGroup;
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly done: readonly QWorkDoneItemDto[];
}) {
  const [earlier, setEarlier] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const thread = useThread(group.relationshipId, threadOpen);
  const latest = group.items[0];
  if (latest === undefined) return null;
  const rest = group.items.slice(1);
  return (
    <li className="border-b border-(--cq-border-subtle) py-2.5" data-done-group>
      <div className="flex items-start gap-2.5">
        <Mark name={group.name ?? latest.words} named={group.named} size={28} />
        <div className="min-w-0 flex-1">
          {group.name === null ? null : (
            <p className="m-0 truncate cq-body-sm font-medium text-(--cq-text-primary)">
              {group.name}
            </p>
          )}
          <p
            className={cx(
              "m-0 cq-label font-normal",
              group.name === null
                ? "cq-body-sm text-(--cq-text-primary)"
                : "text-(--cq-text-tertiary)",
            )}
          >
            {latest.words} ·{" "}
            <span suppressHydrationWarning>{ago(latest.at)}</span>
          </p>
          {rest.length === 0 ? null : (
            <button
              type="button"
              aria-expanded={earlier}
              onClick={() => setEarlier((now) => !now)}
              className="min-h-9 cq-label font-normal text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            >
              {earlier ? "Hide earlier" : `${String(rest.length)} earlier`}
            </button>
          )}
          {earlier ? (
            <ul className="m-0 list-none pl-0">
              {rest.map((item) => (
                <li
                  key={item.id}
                  className="cq-label font-normal text-(--cq-text-tertiary)"
                >
                  {item.words} ·{" "}
                  <span suppressHydrationWarning>{ago(item.at)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {group.relationshipId === null ? (
          group.linkPath === null ? null : (
            <Link
              href={group.linkPath}
              className="inline-flex min-h-11 items-center px-2 cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            >
              Open
            </Link>
          )
        ) : (
          <Button
            variant="quiet"
            size="compact"
            aria-expanded={threadOpen}
            onClick={() => setThreadOpen((now) => !now)}
            className="text-(--cq-text-secondary)"
          >
            {threadOpen ? "Hide thread" : "Thread"}
          </Button>
        )}
      </div>
      {threadOpen && group.relationshipId !== null ? (
        <div className="mt-2">
          <ThreadPanel
            relationshipId={group.relationshipId}
            thread={thread}
            jobs={jobs}
            done={done}
          />
          {group.linkPath === null ? null : (
            <Link
              href={`${group.linkPath}/messages`}
              className="inline-flex min-h-11 items-center cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            >
              Open the conversation
            </Link>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** "2h ago", "yesterday", "Mon 6 Oct": short, in the reader's locale. */
function ago(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(at));
}
