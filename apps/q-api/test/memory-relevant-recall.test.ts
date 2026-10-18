import { describe, expect, it } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";
import {
  createMemoryService,
  RELEVANT_LABEL,
  type MemoryRepository,
} from "@capital-q/q-knowledge";
import {
  boundConversationSearch,
  type QConversation,
  type QConversationSearch,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createConversationDigestPort,
  createMemoryLearner,
} from "../src/composition/memory-learner.js";

/**
 * The journey behind relevant recall (live, 2026-10-12): an investor asks
 * "Remember what we discussed about Tensorgate? Has anything changed?"
 * and the Tensorgate conversation, started from Home with no company
 * subject, is older than the six most recent. Recent-only recall missed
 * it; relevant recall renders it, dated, and only ever from the person's
 * own open conversations.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "c0000000-0000-4000-8000-000000000002";
const USER = "b0000000-0000-4000-8000-000000000001";
const OTHER_USER = "b0000000-0000-4000-8000-000000000002";
const CURRENT = "f0000000-0000-4000-8000-000000000000";
const TENSORGATE = "f0000000-0000-4000-8000-000000000099";
const ASKED =
  "Remember what we discussed about Tensorgate? Has anything changed?";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  actorType: "HUMAN",
});
const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => logger,
} as never;

function conversation(
  id: string,
  summary: string,
  lastMessageAt: string,
  overrides: Partial<QConversation> = {},
): QConversation {
  return {
    id,
    tenantId: TENANT,
    userId: USER,
    organisationId: null,
    contextType: "PERSONAL",
    subjects: [],
    title: null,
    summary,
    summaryThrough: lastMessageAt,
    lastMessageAt,
    createdAt: lastMessageAt,
    archivedAt: null,
    ...overrides,
  } as unknown as QConversation;
}

/** The owner's eight conversations; Tensorgate's is the oldest. */
const OWN: QConversation[] = [
  ...Array.from({ length: 7 }, (_, i) =>
    conversation(
      `f0000000-0000-4000-8000-00000000001${String(i)}`,
      `Talked about pipeline item ${String(i)}.`,
      `2026-10-0${String(9 - i)}T10:00:00.000Z`,
    ),
  ),
  conversation(
    TENSORGATE,
    "They asked about Tensorgate's runway and the bridge round.",
    "2026-08-14T10:00:00.000Z",
    { title: "Tensorgate runway" },
  ),
];
/** Never to be returned: another person's, another tenant's, archived. */
const NOT_THEIRS: QConversation[] = [
  conversation(
    "f0000000-0000-4000-8000-000000000201",
    "Another investor's Tensorgate notes.",
    "2026-10-01T10:00:00.000Z",
    { userId: OTHER_USER as never },
  ),
  conversation(
    "f0000000-0000-4000-8000-000000000202",
    "Another tenant's Tensorgate notes.",
    "2026-10-01T10:00:00.000Z",
    { tenantId: OTHER_TENANT as never },
  ),
  conversation(
    "f0000000-0000-4000-8000-000000000203",
    "Archived Tensorgate thread.",
    "2026-10-01T10:00:00.000Z",
    { archivedAt: "2026-10-02T10:00:00.000Z" },
  ),
];
const ALL = [...OWN, ...NOT_THEIRS];

/** The repository's predicates, over rows, for the composed journey. */
function searchForOwner(
  _executor: unknown,
  tenantId: string,
  userId: string,
  query: QConversationSearch,
): Promise<readonly QConversation[]> {
  const bounded = boundConversationSearch(query);
  if (bounded === null) return Promise.resolve([]);
  const terms = bounded.patterns.map((p) =>
    p.slice(1, -1).replace(/\\(.)/g, "$1").toLowerCase(),
  );
  const hit = (text: string | null) =>
    text !== null && terms.some((t) => text.toLowerCase().includes(t));
  return Promise.resolve(
    ALL.filter(
      (c) =>
        c.tenantId === tenantId &&
        c.userId === userId &&
        c.archivedAt === null &&
        c.summary !== null &&
        !bounded.except.includes(c.id) &&
        (c.subjects.some(
          (s) =>
            s.kind === "COMPANY" && bounded.companyIds.includes(s.companyId),
        ) ||
          hit(c.title) ||
          hit(c.summary)),
    )
      .sort((a, b) =>
        (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
      )
      .slice(0, bounded.limit),
  );
}

function recallPort(withRelevant: boolean) {
  const repositories = {
    conversations: {
      findForOwner: () => Promise.resolve(null),
      listForOwner: (
        _e: unknown,
        tenantId: string,
        userId: string,
        page: { readonly limit: number },
      ) =>
        Promise.resolve(
          ALL.filter(
            (c) =>
              c.tenantId === tenantId &&
              c.userId === userId &&
              c.archivedAt === null,
          )
            .sort((a, b) =>
              (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
            )
            .slice(0, page.limit),
        ),
      searchForOwner,
    },
  } as never;
  const port = createConversationDigestPort(repositories, {} as never);
  const memory = createMemoryService({
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    repository: {
      listLive: () => Promise.resolve([]),
      markUsed: () => Promise.resolve(),
    } as unknown as MemoryRepository,
    conversations: withRelevant
      ? port
      : { digestOf: port.digestOf, recentDigests: port.recentDigests },
    logger,
  });
  return createMemoryLearner({
    gateway: {} as ModelGateway,
    memory,
    repositories: repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    people: { displayNameFor: () => Promise.resolve(null) },
    logger,
  }).recall;
}

describe("relevant recall across the person's own conversations", () => {
  it("before: recent-only recall misses the Tensorgate conversation, eighth by recency", async () => {
    const text = await recallPort(false).recall({
      actor,
      runId: "r1",
      conversationId: CURRENT,
      subjects: [],
      utterance: ASKED,
    });
    expect(text).not.toContain("Tensorgate");
  });

  it("after: renders it first with its date, never another person's, tenant's or an archived one", async () => {
    const text = await recallPort(true).recall({
      actor,
      runId: "r1",
      conversationId: CURRENT,
      subjects: [],
      utterance: ASKED,
    });
    expect(text.startsWith(RELEVANT_LABEL)).toBe(true);
    expect(text).toContain(
      "- 2026-08-14 Tensorgate runway: They asked about Tensorgate's runway and the bridge round.",
    );
    expect(text).not.toContain("Another investor's");
    expect(text).not.toContain("Another tenant's");
    expect(text).not.toContain("Archived Tensorgate");
  });

  it("finds it by the run's company subject too, when the name is not typed", async () => {
    const company = "d0000000-0000-4000-8000-000000000001";
    const tagged = OWN.at(-1);
    if (tagged === undefined) throw new Error("fixture");
    const original = tagged.subjects;
    (tagged as { subjects: unknown }).subjects = [
      { kind: "COMPANY", companyId: company },
    ];
    try {
      const text = await recallPort(true).recall({
        actor,
        runId: "r1",
        conversationId: CURRENT,
        subjects: [{ kind: "COMPANY", companyId: company } as never],
        utterance: "has anything changed?",
      });
      expect(text).toContain("2026-08-14 Tensorgate runway");
    } finally {
      (tagged as { subjects: unknown }).subjects = original;
    }
  });
});
