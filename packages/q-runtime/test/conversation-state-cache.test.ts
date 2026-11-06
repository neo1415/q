import { describe, expect, it } from "vitest";

import {
  createConversationStateCache,
  EMPTY_CONVERSATION_LEDGER,
  type QConversationState,
  type QConversationSummaryRevision,
} from "../src/index.js";

/**
 * Step 11: the in-process cache of committed conversation states. Keyed by
 * tenant + owner + conversation; a state never moves backwards; a summary
 * revision is never replaced by an older one; entries age out and are
 * bounded.
 */

const state = (
  over: Partial<QConversationState> = {},
): QConversationState => ({
  conversationId: "c1",
  tenantId: "t1",
  userId: "u1",
  ledger: EMPTY_CONVERSATION_LEDGER,
  openThreads: [],
  throughMessageAt: "2026-11-06T10:00:00.000Z",
  throughMessageId: "m1",
  messagesFolded: 1,
  builderVersion: "b",
  version: 1,
  ...over,
});

const summary = (revision: number): QConversationSummaryRevision => ({
  revision,
  summary: `summary ${String(revision)}`,
  coversThroughAt: "2026-11-06T10:00:00.000Z",
  coveredMessages: revision * 2,
});

const KEY = { tenantId: "t1", userId: "u1", conversationId: "c1" };

describe("the conversation state cache", () => {
  it("serves an entry only to its own tenant, owner and conversation", () => {
    const cache = createConversationStateCache();
    cache.remember({ state: state(), summary: summary(1) });
    expect(cache.get(KEY)?.state.version).toBe(1);
    // Another person in the same tenant, the same person in another
    // tenant, and another conversation all miss.
    expect(cache.get({ ...KEY, userId: "u2" })).toBeUndefined();
    expect(cache.get({ ...KEY, tenantId: "t2" })).toBeUndefined();
    expect(cache.get({ ...KEY, conversationId: "c2" })).toBeUndefined();
  });

  it("keys by the state's own identity, so a state is never filed under someone else", () => {
    const cache = createConversationStateCache();
    cache.remember({ state: state({ userId: "u2" }), summary: null });
    expect(cache.get(KEY)).toBeUndefined();
    expect(cache.get({ ...KEY, userId: "u2" })?.state.userId).toBe("u2");
  });

  it("never moves a state backwards when two saves race", () => {
    const cache = createConversationStateCache();
    cache.remember({ state: state({ version: 3 }), summary: null });
    cache.remember({ state: state({ version: 2 }), summary: null });
    expect(cache.get(KEY)?.state.version).toBe(3);
  });

  it("keeps the newest summary revision, from a state save or the learner", () => {
    const cache = createConversationStateCache();
    cache.remember({ state: state(), summary: summary(1) });
    cache.noteSummary(KEY, summary(2));
    expect(cache.get(KEY)?.summary?.revision).toBe(2);
    // A save that read revision 1 before the learner appended 2 does not
    // put 1 back.
    cache.remember({ state: state({ version: 2 }), summary: summary(1) });
    expect(cache.get(KEY)?.summary?.revision).toBe(2);
    expect(cache.get(KEY)?.state.version).toBe(2);
  });

  it("keeps no summary for a conversation it holds no state for", () => {
    const cache = createConversationStateCache();
    cache.noteSummary(KEY, summary(1));
    expect(cache.get(KEY)).toBeUndefined();
  });

  it("forgets on request, and says whether anything was held", () => {
    const cache = createConversationStateCache();
    cache.remember({ state: state(), summary: null });
    expect(cache.forget(KEY)).toBe(true);
    expect(cache.forget(KEY)).toBe(false);
    expect(cache.get(KEY)).toBeUndefined();
  });

  it("ages entries out", () => {
    let now = 0;
    const cache = createConversationStateCache({
      maxAgeMs: 1_000,
      now: () => now,
    });
    cache.remember({ state: state(), summary: null });
    now = 1_000;
    expect(cache.get(KEY)).toBeDefined();
    now = 1_001;
    expect(cache.get(KEY)).toBeUndefined();
  });

  it("is bounded, dropping the least recently written first", () => {
    const cache = createConversationStateCache({ max: 2 });
    for (const id of ["c1", "c2", "c3"]) {
      cache.remember({ state: state({ conversationId: id }), summary: null });
    }
    expect(cache.get(KEY)).toBeUndefined();
    expect(cache.get({ ...KEY, conversationId: "c2" })).toBeDefined();
    expect(cache.get({ ...KEY, conversationId: "c3" })).toBeDefined();
  });
});
