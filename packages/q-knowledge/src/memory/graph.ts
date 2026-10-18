import type { ActorContext } from "@capital-q/security";

import type { MemoryItem } from "./contracts.js";

/**
 * Connected recall: a small, selective graph over what the person already
 * owns, for questions no single recall section can answer ("Which companies
 * we discussed last month match our mandate and have a memo, and what did
 * the reviewer flag?").
 *
 * There is no graph store. Every node is a row of a canonical table, read
 * through a port that authorises it as the asking person, and every edge
 * is a typed join computed on read from fields those rows already carry:
 *
 *   conversation ─subject ref / names the company─▶ company
 *   job ─step output companyId─▶ company,  job ─artifactId─▶ document
 *   document ─artifacts.company_id─▶ company
 *   review (job step output) ─artifactId─▶ document
 *   mandate ─current slate membership─▶ company
 *   person's memory ─subject COMPANY─▶ company
 *
 * So the edges are derived and always rebuildable (there is nothing to
 * rebuild), and canonical tables stay the only source of truth. Traversal
 * is at most two hops from the person (their conversation or job, then the
 * company, then its document, review or mandate slate), each read is
 * bounded, the whole build has a time budget, and code alone decides when
 * a turn needs it (`planGraphRecall`). Nothing here writes.
 *
 * Context Firewall: a port read that is not the person's own (their
 * conversations and jobs; their organisation's documents; their own
 * organisation's mandate; listed company names) returns nothing, so a
 * founder-private fact has no path into an investor's section.
 */

export type GraphConversation = {
  readonly conversationId: string;
  readonly title: string | null;
  /** Model-written working memory: untrusted text, matched, never followed. */
  readonly summary: string | null;
  readonly at: string;
  /** COMPANY subject refs of the conversation. */
  readonly companyIds: readonly string[];
};

export type GraphReviewIssue = {
  readonly kind: string;
  readonly section: string;
  readonly problem: string;
};

export type GraphJob = {
  readonly jobId: string;
  readonly goal: string;
  readonly state: string;
  readonly finishedAt: string | null;
  /** When the job last moved (its row's updated_at). */
  readonly updatedAt: string;
  readonly conversationId: string | null;
  /** Documents its steps prepared, with the company each was about. */
  readonly documents: readonly {
    readonly artifactId: string;
    readonly companyId: string | null;
  }[];
  /** The reviewer's last recorded verdict, as the step persisted it. */
  readonly review: {
    readonly artifactId: string;
    /** Null: an older or partial record did not say (unknown). */
    readonly material: boolean | null;
    readonly issues: readonly GraphReviewIssue[];
    readonly revisedToVersion: number | null;
  } | null;
  readonly diligence: {
    readonly questions: readonly string[];
    readonly filedForApproval: boolean;
  } | null;
};

export type GraphDocument = {
  readonly artifactId: string;
  readonly type: string;
  readonly title: string;
  readonly summary: string | null;
  readonly companyId: string | null;
  readonly status: string;
  readonly version: number;
  readonly updatedAt: string;
};

export type GraphMandateFit = {
  readonly mandateName: string;
  readonly mandateVersion: number;
  readonly slateGeneratedAt: string | null;
  /**
   * The current slate's companies, in rank order. Null: the mandate has no
   * current slate (none yet, or one of an older version), so fit is unknown.
   */
  readonly companyIds: readonly string[] | null;
};

/**
 * Every read is as the actor: tenant, owner and organisation come from it,
 * never from the query. An unauthorised read returns nothing.
 */
export type RecallGraphPort = {
  /** The person's own summarised conversations active since `since`. */
  readonly conversations: (
    actor: ActorContext,
    query: { readonly since: string; readonly limit: number },
  ) => Promise<readonly GraphConversation[]>;
  /** The person's own workforce jobs, newest first. */
  readonly jobs: (
    actor: ActorContext,
    query: { readonly limit: number },
  ) => Promise<readonly GraphJob[]>;
  /** Documents of the actor's organisation, newest first. */
  readonly documents: (
    actor: ActorContext,
    query: { readonly limit: number },
  ) => Promise<readonly GraphDocument[]>;
  /** The actor's organisation's single active mandate and its slate; null: none. */
  readonly mandateFit: (actor: ActorContext) => Promise<GraphMandateFit | null>;
  /** Names of companies the actor may see (listed to the network). */
  readonly companies: (
    actor: ActorContext,
    companyIds: readonly string[],
  ) => Promise<
    readonly { readonly companyId: string; readonly name: string }[]
  >;
};

// --- When a turn needs it (code, never a model) -----------------------------

export const GRAPH_CUES = [
  "DISCUSSED",
  "DOCUMENT",
  "REVIEW",
  "MANDATE",
  "CHANGE",
  "DILIGENCE",
  // "What did we talk about last time?": their recent distinct
  // conversations and jobs, dated. One cue is enough for this one.
  "RECENT",
] as const;
export type GraphCue = (typeof GRAPH_CUES)[number];

const CUE_PATTERNS: Record<GraphCue, RegExp> = {
  DISCUSSED:
    /\b(?:discuss(?:ed|ing)?|talked|spoke|conversations?|chatted|we covered|mentioned|raised)\b/iu,
  DOCUMENT:
    /\b(?:memos?|documents?|briefs?|write-?ups?|reports?|one-?pagers?)\b/iu,
  REVIEW:
    /\b(?:review(?:er|ed)?|flag(?:ged|s)?|critique|critic|concerns?|objections?)\b/iu,
  MANDATE: /\b(?:mandate|thesis|fits?|match(?:es|ed|ing)?|slate)\b/iu,
  CHANGE:
    /\b(?:changed?|since (?:our|my|the|we) (?:last|first)|what'?s new|updated?|answered)\b/iu,
  DILIGENCE: /\b(?:diligence|questions? (?:for|to) the founders?)\b/iu,
  RECENT:
    /\b(?:last time|(?:the )?(?:last|previous|earlier) (?:conversation|chat|session|call)s?|where (?:were|did) we (?:leave|get|stop)|catch me up|what (?:have|had) we (?:been )?(?:talk(?:ed|ing)|discuss(?:ed|ing)|work(?:ed|ing)) (?:about|on)|what did we (?:talk|discuss|cover|work on))\b/iu,
};

export type GraphRecallPlan = {
  readonly cues: ReadonlySet<GraphCue>;
  /** How far back "discussed" reaches, from the words of the question. */
  readonly windowDays: number;
};

export const GRAPH_DEFAULT_WINDOW_DAYS = 92;

function windowFrom(utterance: string): number {
  const days = /\b(?:last|past) (\d{1,3}) days?\b/iu.exec(utterance);
  if (days?.[1] !== undefined) {
    return Math.min(Math.max(Number(days[1]), 1), 365);
  }
  if (/\b(?:last|past|this) week\b/iu.test(utterance)) return 7;
  if (/\b(?:last|past|this) month\b/iu.test(utterance)) return 31;
  if (
    /\b(?:last|past|this) quarter\b|\b(?:last|past) (?:three|3) months\b/iu.test(
      utterance,
    )
  )
    return 92;
  if (/\b(?:last|past|this) year\b/iu.test(utterance)) return 365;
  return GRAPH_DEFAULT_WINDOW_DAYS;
}

/**
 * Whether a turn asks across linked things: two kinds of link in one
 * question ("discussed" and "memo"), or one kind about a company the turn
 * is already about. A plain question reads none of this.
 */
export function planGraphRecall(
  utterance: string,
  companyIds: readonly string[] = [],
): GraphRecallPlan | null {
  const cues = new Set<GraphCue>(
    GRAPH_CUES.filter((cue) => CUE_PATTERNS[cue].test(utterance)),
  );
  const multiHop =
    cues.has("RECENT") ||
    cues.size >= 2 ||
    (cues.size >= 1 && companyIds.length > 0);
  if (!multiHop) return null;
  return { cues, windowDays: windowFrom(utterance) };
}

// --- The bounded build -------------------------------------------------------

export const GRAPH_LIMITS = {
  conversations: 30,
  jobs: 10,
  documents: 25,
  companies: 40,
  reported: 5,
  discussedPerCompany: 3,
  documentsPerCompany: 2,
  issuesPerReview: 4,
  questionsPerJob: 3,
  saidPerCompany: 3,
} as const;
export const GRAPH_BUDGET_MS = 700;
/** Older than this, a dated line says so. */
export const GRAPH_STALE_DAYS = 90;

export type GraphFacet = "conversations" | "jobs" | "documents" | "mandate";

export type ConnectedCompany = {
  readonly companyId: string;
  /** Null: not listed to the network, so no name is shown from here. */
  readonly name: string | null;
  readonly discussed: readonly {
    readonly conversationId: string;
    readonly title: string | null;
    readonly at: string;
  }[];
  /** Null: not known (no mandate on record, or it could not be read). */
  readonly mandate: { readonly rank: number | null } | null;
  readonly documents: readonly GraphDocument[];
  readonly reviews: readonly {
    readonly at: string | null;
    readonly documentTitle: string | null;
    readonly reviewedVersion: number | null;
    readonly revisedToVersion: number | null;
    /** The document's current version, when it moved past the review. */
    readonly documentNowAt: number | null;
    /** False: the record did not say whether the review changed anything. */
    readonly outcomeKnown: boolean;
    readonly issues: readonly GraphReviewIssue[];
  }[];
  readonly diligence: readonly {
    readonly at: string | null;
    readonly questions: readonly string[];
    readonly filedForApproval: boolean;
  }[];
  /** The person's own live memories about it (superseded ones never). */
  readonly said: readonly MemoryItem[];
};

export type ConnectedRecall = {
  readonly asOf: string;
  readonly windowDays: number;
  readonly cues: readonly GraphCue[];
  readonly mandate: {
    readonly name: string;
    readonly version: number;
    readonly slateGeneratedAt: string | null;
    /** False: no current slate, so every company's fit is unknown. */
    readonly hasSlate: boolean;
  } | null;
  readonly companies: readonly ConnectedCompany[];
  /**
   * Asked "last time": their most recent other conversations and their
   * jobs, newest first and dated. Absent: not asked.
   */
  readonly recent?: readonly RecentItem[] | undefined;
  /** Reads that failed: unknown, never "none". */
  readonly unread: readonly GraphFacet[];
};

export type RecentItem =
  | {
      readonly kind: "CONVERSATION";
      readonly at: string;
      readonly title: string | null;
      /** Q's rolled-forward notes of it; null: not summarised yet. */
      readonly summary: string | null;
      readonly companyNames: readonly string[];
    }
  | {
      readonly kind: "JOB";
      readonly at: string;
      readonly goal: string;
      readonly state: string;
    };

export const RECENT_ITEMS = 8;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Whether `text` names `name` as a whole word, ignoring case. */
export function namesCompany(text: string, name: string): boolean {
  if (name.trim().length < 3) return false;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(name.trim())}(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

async function settle<T>(
  read: () => Promise<T>,
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false };
  }
}

export type BuildConnectedRecallInput = {
  readonly port: RecallGraphPort;
  readonly actor: ActorContext;
  readonly plan: GraphRecallPlan;
  /** Companies the turn is already about: the graph is focused on them. */
  readonly seedCompanyIds: readonly string[];
  /** The person's live memory items (already owner-scoped by the service). */
  readonly memories: readonly MemoryItem[];
  /** The conversation being had: never listed as an earlier one. */
  readonly conversationId?: string | undefined;
  readonly now: number;
};

/**
 * Two hops, bounded: the person's conversations, jobs and documents and
 * their mandate (hop 1), then the companies they connect to and what hangs
 * off each (hop 2). Only companies that something of the person's links to
 * are reported; a slate member nobody discussed or wrote about is not.
 */
export async function buildConnectedRecall(
  input: BuildConnectedRecallInput,
): Promise<ConnectedRecall> {
  const { port, actor, plan, now } = input;
  const since = new Date(now - plan.windowDays * 86_400_000).toISOString();
  const [conversationsRead, jobsRead, documentsRead, mandateRead] =
    await Promise.all([
      settle(() =>
        port.conversations(actor, {
          since,
          limit: GRAPH_LIMITS.conversations,
        }),
      ),
      settle(() => port.jobs(actor, { limit: GRAPH_LIMITS.jobs })),
      settle(() => port.documents(actor, { limit: GRAPH_LIMITS.documents })),
      settle(() => port.mandateFit(actor)),
    ]);
  const unread: GraphFacet[] = [];
  if (!conversationsRead.ok) unread.push("conversations");
  if (!jobsRead.ok) unread.push("jobs");
  if (!documentsRead.ok) unread.push("documents");
  if (!mandateRead.ok) unread.push("mandate");
  const conversations = (conversationsRead.ok ? conversationsRead.value : [])
    .filter((c) => Date.parse(c.at) >= Date.parse(since))
    .slice(0, GRAPH_LIMITS.conversations);
  const jobs = (jobsRead.ok ? jobsRead.value : []).slice(0, GRAPH_LIMITS.jobs);
  // A document still being prepared, or that failed, says nothing yet.
  const documents = (documentsRead.ok ? documentsRead.value : [])
    .filter((d) => d.status === "READY" && d.version >= 1)
    .slice(0, GRAPH_LIMITS.documents);
  const mandate = mandateRead.ok ? mandateRead.value : null;
  const companyMemories = input.memories.filter(
    (m) =>
      m.memoryType !== "small_talk" && m.subject?.subjectType === "COMPANY",
  );

  // Hop 1 → company ids, in the order their links were found.
  const seeds = [...new Set(input.seedCompanyIds)];
  const linked = new Set<string>(seeds);
  for (const c of conversations) for (const id of c.companyIds) linked.add(id);
  for (const d of documents) if (d.companyId !== null) linked.add(d.companyId);
  for (const j of jobs)
    for (const d of j.documents)
      if (d.companyId !== null) linked.add(d.companyId);
  for (const m of companyMemories)
    if (m.subject !== null) linked.add(m.subject.subjectId);
  // Slate members can be named in a Home conversation that carries no
  // subject ref, so their names are read too; they are reported only when
  // something of the person's links to them.
  const slate = mandate?.companyIds ?? [];
  const candidateIds = [
    ...linked,
    ...slate.filter((id) => !linked.has(id)),
  ].slice(0, GRAPH_LIMITS.companies);
  const namesRead = await settle(() => port.companies(actor, candidateIds));
  const names = new Map(
    (namesRead.ok ? namesRead.value : []).map((c) => [c.companyId, c.name]),
  );

  const docById = new Map(documents.map((d) => [d.artifactId, d]));
  const companies: (ConnectedCompany & {
    readonly score: number;
    readonly latest: number;
  })[] = [];
  for (const companyId of candidateIds) {
    const name = names.get(companyId) ?? null;
    const discussed = conversations
      .filter(
        (c) =>
          c.companyIds.includes(companyId) ||
          (name !== null &&
            namesCompany(`${c.title ?? ""}\n${c.summary ?? ""}`, name)),
      )
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const ownDocuments = documents
      .filter((d) => d.companyId === companyId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const companyJobs = jobs.filter(
      (j) =>
        j.documents.some((d) => d.companyId === companyId) ||
        (j.review !== null &&
          docById.get(j.review.artifactId)?.companyId === companyId),
    );
    const reviews = companyJobs.flatMap((j) => {
      if (j.review === null) return [];
      const doc = docById.get(j.review.artifactId) ?? null;
      const revised =
        j.review.material === true && j.review.revisedToVersion !== null;
      const reviewedVersion =
        revised && j.review.revisedToVersion !== null
          ? Math.max(j.review.revisedToVersion - 1, 1)
          : (j.review.revisedToVersion ?? null);
      const settledAt = revised ? j.review.revisedToVersion : reviewedVersion;
      return [
        {
          at: j.finishedAt,
          documentTitle: doc?.title ?? null,
          reviewedVersion,
          revisedToVersion: revised ? j.review.revisedToVersion : null,
          documentNowAt:
            doc !== null && settledAt !== null && doc.version > settledAt
              ? doc.version
              : null,
          outcomeKnown: j.review.material !== null,
          issues: j.review.issues.slice(0, GRAPH_LIMITS.issuesPerReview),
        },
      ];
    });
    const diligence = companyJobs.flatMap((j) =>
      j.diligence === null
        ? []
        : [
            {
              at: j.finishedAt,
              questions: j.diligence.questions.slice(
                0,
                GRAPH_LIMITS.questionsPerJob,
              ),
              filedForApproval: j.diligence.filedForApproval,
            },
          ],
    );
    const said = companyMemories
      .filter((m) => m.subject?.subjectId === companyId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, GRAPH_LIMITS.saidPerCompany);
    const rank = slate.indexOf(companyId);
    const mandateLink =
      mandate === null || mandate.companyIds === null
        ? null
        : { rank: rank === -1 ? null : rank + 1 };
    const isSeed = seeds.includes(companyId);
    const hasOwnLink =
      discussed.length > 0 ||
      ownDocuments.length > 0 ||
      reviews.length > 0 ||
      diligence.length > 0 ||
      said.length > 0;
    if (!isSeed && !hasOwnLink) continue;
    // A question about what was discussed is about those companies only.
    if (plan.cues.has("DISCUSSED") && !isSeed && discussed.length === 0)
      continue;
    // Focused on the turn's companies when it has any.
    if (seeds.length > 0 && !isSeed) continue;
    const score =
      (isSeed ? 8 : 0) +
      (discussed.length > 0 ? 2 : 0) +
      (plan.cues.has("MANDATE") && typeof mandateLink?.rank === "number"
        ? 2
        : 0) +
      (ownDocuments.length > 0 ? (plan.cues.has("DOCUMENT") ? 2 : 1) : 0) +
      (reviews.length > 0 ? (plan.cues.has("REVIEW") ? 2 : 1) : 0) +
      (diligence.length > 0 && plan.cues.has("DILIGENCE") ? 2 : 0);
    const latest = Math.max(
      0,
      ...discussed.map((c) => Date.parse(c.at)),
      ...ownDocuments.map((d) => Date.parse(d.updatedAt)),
    );
    companies.push({
      companyId,
      name,
      discussed: discussed
        .slice(0, GRAPH_LIMITS.discussedPerCompany)
        .map((c) => ({
          conversationId: c.conversationId,
          title: c.title,
          at: c.at,
        })),
      mandate: mandateLink,
      documents: ownDocuments.slice(0, GRAPH_LIMITS.documentsPerCompany),
      reviews,
      diligence,
      said,
      score,
      latest,
    });
  }
  companies.sort((a, b) => b.score - a.score || b.latest - a.latest);
  // "What did we talk about last time?" alone is about the conversations
  // and jobs themselves, not about companies across them.
  const onlyRecent =
    plan.cues.has("RECENT") &&
    seeds.length === 0 &&
    [...plan.cues].every((cue) => cue === "RECENT" || cue === "DISCUSSED");
  const recent: RecentItem[] | undefined = plan.cues.has("RECENT")
    ? [
        ...conversations
          .filter((c) => c.conversationId !== input.conversationId)
          .map((c): RecentItem => ({
            kind: "CONVERSATION",
            at: c.at,
            title: c.title,
            summary: c.summary,
            companyNames: c.companyIds.flatMap((id) => {
              const name = names.get(id);
              return name === undefined ? [] : [name];
            }),
          })),
        ...jobs.map((j): RecentItem => ({
          kind: "JOB",
          at: j.finishedAt ?? j.updatedAt,
          goal: j.goal,
          state: j.state,
        })),
      ]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, RECENT_ITEMS)
    : undefined;
  return {
    asOf: new Date(now).toISOString(),
    windowDays: plan.windowDays,
    cues: GRAPH_CUES.filter((cue) => plan.cues.has(cue)),
    mandate:
      mandate === null
        ? null
        : {
            name: mandate.mandateName,
            version: mandate.mandateVersion,
            slateGeneratedAt: mandate.slateGeneratedAt,
            hasSlate: mandate.companyIds !== null,
          },
    companies: onlyRecent
      ? []
      : companies
          .slice(0, GRAPH_LIMITS.reported)
          .map(({ score: _score, latest: _latest, ...company }) => company),
    ...(recent === undefined ? {} : { recent }),
    unread,
  };
}

/** The build under a time budget: late or failed is absent (unknown). */
export async function connectedRecallWithin(
  input: BuildConnectedRecallInput,
  budgetMs: number = GRAPH_BUDGET_MS,
): Promise<ConnectedRecall | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      buildConnectedRecall(input),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), budgetMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// --- Rendering ---------------------------------------------------------------

export const CONNECTED_LABEL =
  "Connected across their own conversations, Q's documents and work, and their mandate (links derived from Capital Q records; each line names its source and date; what was discussed is talk, and Q-prepared content is Q inference, neither is verified evidence):";
export const CONNECTED_MAX = 2_000;

const day = (iso: string) => iso.slice(0, 10);
const shorten = (text: string, max: number) => {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

function dated(iso: string | null, now: number): string {
  if (iso === null) return "date not recorded";
  const stale = now - Date.parse(iso) > GRAPH_STALE_DAYS * 86_400_000;
  return stale
    ? `${day(iso)}, over ${String(GRAPH_STALE_DAYS)} days old`
    : day(iso);
}

function companyLines(
  c: ConnectedCompany,
  recall: ConnectedRecall,
  now: number,
): string {
  const head =
    (c.name === null ? null : shorten(c.name, 100)) ??
    (c.documents[0] === undefined
      ? "A company not listed to the network"
      : `The company of "${shorten(c.documents[0].title, 80)}"`);
  const rows = [`- ${head}`];
  if (c.discussed.length > 0) {
    rows.push(
      `  Discussed (your conversations): ${c.discussed
        .map(
          (d) =>
            `${dated(d.at, now)}${d.title === null ? "" : ` "${shorten(d.title, 60)}"`}`,
        )
        .join("; ")}`,
    );
  } else if (recall.cues.includes("DISCUSSED")) {
    rows.push(
      `  Discussed: not in your conversations of the last ${String(recall.windowDays)} days`,
    );
  }
  if (recall.mandate === null || !recall.mandate.hasSlate) {
    if (recall.cues.includes("MANDATE"))
      rows.push(
        recall.unread.includes("mandate")
          ? "  Mandate fit: not known (could not be read this time)"
          : recall.mandate === null
            ? "  Mandate fit: not known (no single active mandate on record)"
            : `  Mandate fit: not known (no current slate for "${shorten(recall.mandate.name, 60)}" v${String(recall.mandate.version)})`,
      );
  } else if (typeof c.mandate?.rank === "number") {
    rows.push(
      `  Mandate: ranked ${String(c.mandate.rank)} in the current slate for "${shorten(recall.mandate.name, 60)}" v${String(recall.mandate.version)} (Capital Q's deterministic fit ranking${recall.mandate.slateGeneratedAt === null ? "" : `, ${dated(recall.mandate.slateGeneratedAt, now)}`}; fit, not a judgement of quality)`,
    );
  } else {
    rows.push(
      `  Mandate: not in the current slate for "${shorten(recall.mandate.name, 60)}" v${String(recall.mandate.version)} (not ranked there; this is not evidence against the company)`,
    );
  }
  if (c.documents.length > 0) {
    for (const d of c.documents) {
      rows.push(
        `  ${d.type === "MEMO" || d.type === "INVESTMENT_MEMO" ? "Memo" : "Document"} (Q-prepared, Q inference): "${shorten(d.title, 80)}" v${String(d.version)}, ${dated(d.updatedAt, now)}`,
      );
    }
  } else if (recall.cues.includes("DOCUMENT")) {
    rows.push(
      recall.unread.includes("documents")
        ? "  Documents: could not be read this time (unknown)"
        : "  Documents: none of your organisation's on record",
    );
  }
  for (const r of c.reviews) {
    const what =
      r.revisedToVersion !== null
        ? `on v${String(r.reviewedVersion ?? 1)}, revised to v${String(r.revisedToVersion)}`
        : !r.outcomeKnown
          ? "outcome not recorded"
          : r.issues.length === 0
            ? "no material change needed"
            : "kept as written";
    const moved =
      r.documentNowAt === null
        ? ""
        : `; the document has changed since (now v${String(r.documentNowAt)})`;
    const source = `Reviewer (Q's reviewer, Q inference; ${dated(r.at, now)}; ${what}${moved})`;
    if (r.issues.length === 0) rows.push(`  ${source}`);
    for (const issue of r.issues) {
      rows.push(
        `  ${source} flagged: ${shorten(issue.section, 60)}: ${shorten(issue.problem, 140)}`,
      );
    }
  }
  for (const d of c.diligence) {
    // Each question keeps its canonical final qualifier. Splitting the
    // collection lets a large job keep useful questions inside the budget.
    const source = `Diligence questions Q prepared (${d.filedForApproval ? "filed for approval; current approval status not checked" : "kept, not sent"}; ${dated(d.at, now)})`;
    for (const question of d.questions) {
      rows.push(`  ${source}: ${shorten(question, 180)}`);
    }
  }
  for (const m of c.said) {
    rows.push(
      `  You said (${dated(m.createdAt, now)}, your words, not verified): ${shorten(m.content, 160)}`,
    );
  }
  if (recall.cues.includes("CHANGE")) {
    const lastDoc = c.documents[0];
    if (lastDoc !== undefined) {
      const after = c.discussed.filter(
        (d) => Date.parse(d.at) > Date.parse(lastDoc.updatedAt),
      );
      const saidAfter = c.said.filter(
        (m) => Date.parse(m.createdAt) > Date.parse(lastDoc.updatedAt),
      );
      rows.push(
        after.length === 0 && saidAfter.length === 0
          ? `  Since the latest document (${day(lastDoc.updatedAt)}): nothing of yours on record`
          : `  Since the latest document (${day(lastDoc.updatedAt)}): ${[
              ...(after.length === 0
                ? []
                : [
                    `discussed again ${after.map((d) => day(d.at)).join(", ")}`,
                  ]),
              ...(saidAfter.length === 0
                ? []
                : [
                    `you said more on ${saidAfter.map((m) => day(m.createdAt)).join(", ")}`,
                  ]),
            ].join("; ")}`,
      );
    }
  }
  return rows.join("\n");
}

export const RECENT_LABEL =
  "Their most recent other conversations and Q's jobs for them, newest first (their own records; a summary is Q's note of what was said, not evidence):";
const STATE_WORDS: Readonly<Record<string, string>> = {
  COMPLETED: "done",
  DONE: "done",
  FAILED: "failed",
  CANCELLED: "stopped",
  STOPPED: "stopped",
  NEEDS_DECISION: "waiting for their decision",
  BLOCKED: "blocked",
  HELD: "held",
  QUEUED: "queued",
  RUNNING: "running",
  RECOVERING: "running",
  PLANNING: "being planned",
};

/** The "last time" lines, or "" when not asked. */
function renderRecent(recall: ConnectedRecall, now: number): string {
  if (recall.recent === undefined) return "";
  const conversationsUnread = recall.unread.includes("conversations");
  const jobsUnread = recall.unread.includes("jobs");
  if (recall.recent.length === 0) {
    return conversationsUnread || jobsUnread
      ? `${RECENT_LABEL}\n- Could not be read this time (unknown).`
      : `${RECENT_LABEL}\n- None on record in the last ${String(recall.windowDays)} days besides this conversation.`;
  }
  const lines = recall.recent.map((item) => {
    if (item.kind === "JOB") {
      return `- ${dated(item.at, now)} job (${STATE_WORDS[item.state] ?? item.state.toLowerCase()}): ${shorten(item.goal, 160)}`;
    }
    const about =
      item.companyNames.length === 0
        ? ""
        : ` [about ${item.companyNames.join(", ")}]`;
    const title = item.title === null ? "" : ` "${shorten(item.title, 60)}"`;
    return `- ${dated(item.at, now)} conversation${title}${about}: ${
      item.summary === null ? "not summarised yet" : shorten(item.summary, 240)
    }`;
  });
  const missing =
    conversationsUnread || jobsUnread
      ? [
          `- Not read this time (unknown, not none): ${[
            ...(conversationsUnread ? ["conversations"] : []),
            ...(jobsUnread ? ["jobs"] : []),
          ].join(", ")}.`,
        ]
      : [];
  return [RECENT_LABEL, ...lines, ...missing].join("\n");
}

/** The connected section, or "" when the turn did not need it. */
export function renderConnectedRecall(
  recall: ConnectedRecall | undefined,
  max: number = CONNECTED_MAX,
): string {
  if (recall === undefined) return "";
  const now = Date.parse(recall.asOf);
  const recent = renderRecent(recall, now);
  const asksAcross = recall.cues.some(
    (cue) => cue !== "RECENT" && cue !== "DISCUSSED",
  );
  const onlyRecent =
    recall.companies.length === 0 && recent.length > 0 && !asksAcross;
  const omittedDisclosure =
    "Some recorded evidence omitted to fit this section; omitted is unknown, not none.";
  const unreadDisclosure =
    recall.unread.length === 0
      ? ""
      : `Not read this time (unknown, not none): ${recall.unread.join(", ")}.`;
  // Reserve disclosures before selecting evidence. Failed reads cannot
  // disappear merely because successful reads filled the context budget.
  const reserved = omittedDisclosure.length + unreadDisclosure.length + 2;
  const unknown = "Recorded evidence unknown: omitted or unread.";
  if (
    max <
    reserved + (onlyRecent ? RECENT_LABEL.length : CONNECTED_LABEL.length)
  ) {
    // Never emit clipped evidence or a clipped disclaimer at tiny budgets.
    return max >= unknown.length ? unknown : "";
  }
  const evidenceMax = max - reserved;
  const rows: string[] = [];
  let used = 0;
  let omitted = false;
  const append = (line: string, limit = evidenceMax) => {
    const size = line.length + (rows.length === 0 ? 0 : 1);
    if (used + size > limit) {
      omitted = true;
      return false;
    }
    rows.push(line);
    used += size;
    return true;
  };
  const companyRows = recall.companies.map((company) =>
    companyLines(company, recall, now).split("\n"),
  );
  const companyMinimum = companyRows.reduce(
    (size, lines) =>
      // Recent history must leave room for initial substantive evidence
      // (the memo and first reviewer finding), beyond discussion metadata.
      size + lines.slice(0, 5).reduce((sum, line) => sum + line.length + 1, 0),
    0,
  );
  if (recent.length > 0) {
    const recentLimit = Math.max(
      0,
      evidenceMax -
        companyMinimum -
        (onlyRecent ? 0 : CONNECTED_LABEL.length + 1),
    );
    const [label, ...items] = recent.split("\n");
    if (label !== undefined && append(label, recentLimit)) {
      for (const line of items) append(line, recentLimit);
      append("");
    }
  }
  if (!onlyRecent) append(CONNECTED_LABEL);
  if (recall.companies.length === 0 && !onlyRecent) {
    append(
      `- Nothing of theirs on record connects to what they asked (conversations of the last ${String(recall.windowDays)} days, their jobs and documents).`,
    );
  }
  for (const [index, lines] of companyRows.entries()) {
    // Leave room for the names and first evidence of later companies;
    // repeated jobs on the first company cannot monopolise the section.
    const laterMinimum = companyRows
      .slice(index + 1)
      .reduce(
        (size, later) =>
          size +
          later.slice(0, 2).reduce((sum, line) => sum + line.length + 1, 0),
        0,
      );
    const limit = Math.max(used, evidenceMax - laterMinimum);
    const head = lines[0];
    if (head === undefined || !append(head, limit)) continue;
    // An oversized item does not suppress later evidence or companies.
    for (const line of lines.slice(1)) append(line, limit);
  }
  if (unreadDisclosure.length > 0) rows.push(unreadDisclosure);
  if (omitted) rows.push(omittedDisclosure);
  const out = rows.join("\n");
  return out;
}
