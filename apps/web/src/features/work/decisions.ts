import type {
  NamedPicture,
  QApprovalView,
  QPendingApproval,
  QWorkDoneItemDto,
  WorkforceDraftDto,
  WorkforceJobDetailDto,
} from "@capital-q/contracts";

import { draftChain, HELD_WORDS } from "./workforce-view";

/**
 * Work, around decisions (Zino, 2026-10-08: "I see it and I'm like, okay...
 * so what do I do next?"). Code turns what the server recorded into three
 * answers: what needs the person (one card per decision, grouped per
 * company or person), what Q did for them (grouped per relationship,
 * latest first) and what is still running (one line per job). The writer
 * and reviewer's drafts are never rows of their own: they hang off the
 * decision or the message they produced. Nothing here decides anything.
 */

/** One approval card, with what is known about it. */
export type Decision = {
  readonly kind: "APPROVAL";
  readonly approvalId: string;
  readonly summary: string;
  readonly at: string;
  readonly named: NamedPicture | null;
  /** The card read in full (its exact bound content); null: not read yet. */
  readonly view: QApprovalView | null;
  /** The drafts behind its message, oldest first; empty when none. */
  readonly drafts: readonly WorkforceDraftDto[];
};

/** A message Q held and did not send: the person reads it and decides. */
export type HeldDecision = {
  readonly kind: "HELD";
  readonly draftId: string;
  readonly body: string;
  readonly reason: string;
  readonly at: string;
  readonly drafts: readonly WorkforceDraftDto[];
};

export type DecisionGroup = {
  readonly key: string;
  /** The other side's name, as the drafts or the done list recorded it. */
  readonly name: string | null;
  readonly named: NamedPicture | null;
  readonly relationshipId: string | null;
  readonly items: readonly (Decision | HeldDecision)[];
  readonly at: string;
};

/** The relationship an approval's action is aimed at, if it names one. */
export function relationshipOf(view: QApprovalView | null): string | null {
  for (const one of view?.action.targets ?? []) {
    if (one.kind === "RELATIONSHIP") return one.relationshipId;
  }
  return null;
}

/** The drafts behind the card an approval binds to. */
export function draftsForApproval(
  jobs: readonly WorkforceJobDetailDto[],
  approvalId: string,
): readonly WorkforceDraftDto[] {
  for (const job of jobs) {
    const last = job.drafts.find(
      (draft) => draft.outcome?.approvalId === approvalId,
    );
    if (last !== undefined) return draftChain(job.drafts, last);
  }
  return [];
}

/** How long a held draft stays a decision before it is history. */
const HELD_DAYS = 7;

/**
 * Held drafts still worth a decision: the latest per counterpart, within
 * a week, and not followed by a later message to them that was sent or
 * offered (that one superseded it).
 */
export function heldDecisions(
  jobs: readonly WorkforceJobDetailDto[],
  now: number,
  dismissed: ReadonlySet<string> = new Set(),
): readonly (HeldDecision & { readonly name: string | null })[] {
  const all = jobs.flatMap((job) =>
    job.drafts.map((draft) => ({ job, draft })),
  );
  const out: (HeldDecision & { readonly name: string | null })[] = [];
  const seen = new Set<string>();
  const newestFirst = [...all].sort((a, b) =>
    b.draft.createdAt.localeCompare(a.draft.createdAt),
  );
  for (const { job, draft } of newestFirst) {
    const name = draft.counterpartName;
    const who = name ?? draft.id;
    if (seen.has(who)) continue;
    if (draft.outcome === null) continue;
    seen.add(who);
    if (draft.outcome.outcome !== "HELD") continue;
    if (dismissed.has(draft.id)) continue;
    if (now - Date.parse(draft.createdAt) > HELD_DAYS * 86_400_000) continue;
    out.push({
      kind: "HELD",
      draftId: draft.id,
      body: draft.body,
      reason:
        HELD_WORDS[draft.outcome.reason ?? ""] ??
        "Q didn't send it. Read it and decide.",
      at: draft.createdAt,
      drafts: draftChain(job.drafts, draft),
      name,
    });
  }
  return out;
}

/**
 * The decision queue: one group per company or person, newest first;
 * inside a group, its cards newest first. A group is keyed by the
 * relationship where the card names one, else by who it is aimed at.
 */
export function decisionGroups(input: {
  readonly approvals: readonly QPendingApproval[];
  readonly views: ReadonlyMap<string, QApprovalView>;
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly now: number;
  readonly dismissedHeld?: ReadonlySet<string> | undefined;
  /** Names and relationships already known (from the done list). */
  readonly known?: readonly QWorkDoneItemDto[] | undefined;
}): readonly DecisionGroup[] {
  const groups = new Map<
    string,
    {
      key: string;
      name: string | null;
      named: NamedPicture | null;
      relationshipId: string | null;
      items: (Decision | HeldDecision)[];
      at: string;
    }
  >();
  const relationshipByName = new Map<string, string>();
  for (const item of input.known ?? []) {
    if (
      item.counterpartName != null &&
      item.relationshipId != null &&
      !relationshipByName.has(item.counterpartName)
    ) {
      relationshipByName.set(item.counterpartName, item.relationshipId);
    }
  }
  const add = (
    key: string,
    seed: Omit<DecisionGroup, "items" | "at" | "key">,
    item: Decision | HeldDecision,
  ) => {
    const group = groups.get(key) ?? {
      key,
      ...seed,
      items: [],
      at: item.at,
    };
    group.items.push(item);
    if (item.at > group.at) group.at = item.at;
    group.name ??= seed.name;
    group.named ??= seed.named;
    group.relationshipId ??= seed.relationshipId;
    groups.set(key, group);
  };

  for (const approval of input.approvals) {
    const view = input.views.get(approval.approvalId) ?? null;
    const drafts = draftsForApproval(input.jobs, approval.approvalId);
    const name = drafts.at(-1)?.counterpartName ?? null;
    const relationshipId =
      relationshipOf(view) ??
      (name === null ? null : (relationshipByName.get(name) ?? null));
    const key =
      relationshipId ??
      approval.named?.id ??
      (name === null ? `approval:${approval.approvalId}` : `name:${name}`);
    add(
      key,
      { name, named: approval.named ?? null, relationshipId },
      {
        kind: "APPROVAL",
        approvalId: approval.approvalId,
        summary: approval.summary,
        at: approval.requestedAt,
        named: approval.named ?? null,
        view,
        drafts,
      },
    );
  }

  for (const held of heldDecisions(
    input.jobs,
    input.now,
    input.dismissedHeld,
  )) {
    const relationshipId =
      held.name === null ? null : (relationshipByName.get(held.name) ?? null);
    // Join the group of the same relationship, else the same name.
    const existing = [...groups.values()].find(
      (group) =>
        (relationshipId !== null && group.relationshipId === relationshipId) ||
        (held.name !== null && group.name === held.name),
    );
    const key =
      existing?.key ??
      relationshipId ??
      (held.name === null ? `held:${held.draftId}` : `name:${held.name}`);
    const { name, ...item } = held;
    add(key, { name, named: null, relationshipId }, item);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => b.at.localeCompare(a.at)),
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export type DoneGroup = {
  readonly key: string;
  readonly name: string | null;
  readonly named: NamedPicture | null;
  readonly relationshipId: string | null;
  readonly linkPath: string | null;
  /** Newest first. */
  readonly items: readonly QWorkDoneItemDto[];
};

/**
 * What Q did, per relationship, newest first. Items are read a page at a
 * time by cursor; a later page's items join the groups already shown.
 */
export function doneGroups(
  items: readonly QWorkDoneItemDto[],
): readonly DoneGroup[] {
  const groups = new Map<string, DoneGroup & { items: QWorkDoneItemDto[] }>();
  const sorted = [...items].sort((a, b) => b.at.localeCompare(a.at));
  for (const item of sorted) {
    const key =
      item.relationshipId ??
      item.named?.id ??
      item.linkPath ??
      `done:${item.id}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        key,
        name: item.counterpartName ?? null,
        named: item.named ?? null,
        relationshipId: item.relationshipId ?? null,
        linkPath: item.linkPath,
        items: [item],
      });
    } else {
      group.items.push(item);
    }
  }
  return [...groups.values()];
}

/** Merge a further page into the items shown, once each, newest first. */
export function withPage(
  shown: readonly QWorkDoneItemDto[],
  page: readonly QWorkDoneItemDto[],
): readonly QWorkDoneItemDto[] {
  const ids = new Set(shown.map((item) => item.id));
  return [...shown, ...page.filter((item) => !ids.has(item.id))].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
}

/** The decision's own words for its kind of card. */
export function decisionTitle(item: Decision | HeldDecision): string {
  if (item.kind === "HELD") return "Q held a message";
  const type = item.view?.action.actionType;
  if (type === "chat.message.send") return "Reply ready to send";
  if (type === "email.send") return "Email ready to send";
  return item.summary;
}

/** One line of a relationship's conversation, with Q's part explained. */
export type ThreadLine = {
  readonly id: string;
  readonly side: "THEM" | "US";
  readonly who: string;
  readonly body: string;
  readonly at: string;
  /** Sent by Q for the person: the drafts behind it and why it went. */
  readonly byQ: {
    readonly drafts: readonly WorkforceDraftDto[];
    /** What Q was doing, in the words its step recorded. */
    readonly why: string | null;
    /** The reviewer's verdict on the draft that went, in words. */
    readonly verdict: string | null;
  } | null;
};

const SAME_WINDOW_MS = 10 * 60_000;

/**
 * The conversation as the person judges it: their words, and each message
 * sent for them by Q matched to the draft that produced it (the same text)
 * and to the step that sent it (the same relationship, within minutes).
 */
export function threadLines(input: {
  readonly messages: readonly {
    readonly messageId: string;
    readonly mine: boolean;
    readonly senderName: string;
    readonly body: string | null;
    readonly viaQ: boolean;
    readonly unsent: boolean;
    readonly sentAt: string;
  }[];
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly done: readonly QWorkDoneItemDto[];
  readonly relationshipId: string;
}): readonly ThreadLine[] {
  const sentDrafts = input.jobs.flatMap((job) =>
    job.drafts
      .filter(
        (draft) =>
          draft.outcome?.outcome === "SENT" ||
          draft.outcome?.outcome === "OFFERED",
      )
      .map((draft) => ({ job, draft })),
  );
  const steps = input.done.filter(
    (item) => item.relationshipId === input.relationshipId,
  );
  const lines: ThreadLine[] = [];
  for (const message of input.messages) {
    if (message.unsent || message.body === null) continue;
    const body = message.body;
    const match = message.mine
      ? sentDrafts.find(({ draft }) => draft.body.trim() === body.trim())
      : undefined;
    const at = Date.parse(message.sentAt);
    const step = steps.find(
      (item) => Math.abs(Date.parse(item.at) - at) <= SAME_WINDOW_MS,
    );
    const grade = match?.draft.grade ?? null;
    const byQ =
      match === undefined && !(message.mine && message.viaQ)
        ? null
        : {
            drafts:
              match === undefined
                ? []
                : draftChain(match.job.drafts, match.draft),
            why: step?.words ?? null,
            verdict:
              grade === null
                ? null
                : grade.passed
                  ? `The reviewer passed it (${(grade.score / 10).toFixed(1)} against a bar of ${(grade.threshold / 10).toFixed(1)}).`
                  : "It went below the reviewer's bar.",
          };
    lines.push({
      id: message.messageId,
      side: message.mine ? "US" : "THEM",
      who: message.senderName,
      body,
      at: message.sentAt,
      byQ,
    });
  }
  return lines;
}

/** "How Q wrote this (3 drafts)". */
export function draftsLabel(drafts: readonly WorkforceDraftDto[]): string {
  return `How Q wrote this (${String(drafts.length)} ${drafts.length === 1 ? "draft" : "drafts"})`;
}
