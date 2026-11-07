import { describe, expect, it } from "vitest";

import {
  ENGAGEMENT_BATCH_MAX,
  ENGAGEMENT_MAX_DURATION_MS,
  RecordEngagementBatchRequestSchema,
  type EngagementEventInput,
} from "@capital-q/contracts";

import { createEngagementReporter } from "../src/features/engagement/engagement-reporter";

const COMPANY = "f0000000-0000-4000-8000-000000000001";
const DECK = "f0000000-0000-4000-8000-000000000002";

function harness() {
  const sent: (readonly EngagementEventInput[])[] = [];
  let clock = 1_700_000_000_000;
  let scheduled: (() => void) | null = null;
  const reporter = createEngagementReporter((events) => sent.push(events), {
    now: () => clock,
    schedule: (run) => {
      scheduled = run;
      return 1;
    },
    cancel: () => {
      scheduled = null;
    },
  });
  return {
    reporter,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
    fire: () => {
      const run = scheduled;
      scheduled = null;
      run?.();
    },
  };
}

describe("engagement reporter", () => {
  it("batches until the timer and sends valid, viewer-free events", () => {
    const h = harness();
    h.reporter.report({ type: "PROFILE_VIEW", companyId: COMPANY });
    h.reporter.report({ type: "Q_CARD_VIEW", companyId: COMPANY });
    expect(h.sent).toHaveLength(0);
    h.fire();
    expect(h.sent).toHaveLength(1);
    const batch = { events: h.sent[0] };
    expect(RecordEngagementBatchRequestSchema.safeParse(batch).success).toBe(
      true,
    );
    for (const event of h.sent[0] ?? []) {
      expect(Object.keys(event)).not.toContain("viewerUserId");
      expect(Object.keys(event)).not.toContain("visibility");
    }
    expect(new Set(h.sent[0]?.map((e) => e.clientEventId)).size).toBe(2);
  });

  it("sends at the batch ceiling without waiting", () => {
    const h = harness();
    for (let i = 0; i < ENGAGEMENT_BATCH_MAX; i += 1) {
      h.reporter.report({ type: "PROFILE_VIEW", companyId: COMPANY });
    }
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toHaveLength(ENGAGEMENT_BATCH_MAX);
  });

  it("times a slide once and caps the dwell", () => {
    const h = harness();
    const stop = h.reporter.dwell((durationMs) => ({
      type: "DECK_SLIDE_DWELL",
      companyId: COMPANY,
      documentId: DECK,
      slideNumber: 2,
      durationMs,
    }));
    h.advance(ENGAGEMENT_MAX_DURATION_MS + 60_000);
    stop();
    stop();
    h.reporter.flush();
    expect(h.sent.flat()).toHaveLength(1);
    expect(h.sent.flat()[0]).toMatchObject({
      type: "DECK_SLIDE_DWELL",
      durationMs: ENGAGEMENT_MAX_DURATION_MS,
    });
  });

  it("a dwell that decides not to report sends nothing", () => {
    const h = harness();
    const stop = h.reporter.dwell(() => null);
    h.advance(500);
    stop();
    h.reporter.flush();
    expect(h.sent).toHaveLength(0);
  });
});
