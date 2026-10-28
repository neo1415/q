import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QArtifactDetail } from "@capital-q/contracts";

import { createWorkforceDelivery } from "../src/composition/workforce/delivery.js";
import { createWorkforcePage } from "../src/composition/workforce/page.js";
import type { WorkRow } from "../src/composition/workforce/queue.js";

/**
 * QA 25 Oct 2026: "Write a one-page investor update and save it to my
 * board" (job 4d1a8b04) was DONE in 2 s, yet its card said "Done" with no
 * document, and the thread was never told it was ready.
 */

const TENANT = randomUUID();
const USER = randomUUID();
const ORG = randomUUID();
const RUN = randomUUID();
const CONVERSATION = randomUUID();
const ARTIFACT = randomUUID();
const owner = { tenantId: TENANT, userId: USER };

function row(over: Partial<WorkRow> = {}): WorkRow {
  return {
    job_id: randomUUID(),
    tenant_id: TENANT,
    user_id: USER,
    state: "COMPLETED",
    plan: {},
    trace: { runId: RUN, organisationId: ORG },
    results: {
      documents: {
        status: "DONE",
        summary: "Prepared the document; it is ready in your workspace.",
        outputs: { artifactId: ARTIFACT },
      },
    },
    attempts: 1,
    max_attempts: 3,
    reason: null,
    created_at: new Date(),
    updated_at: new Date(),
    finished_at: new Date(),
    ...over,
  };
}

const update = {
  artifactId: ARTIFACT,
  type: "INVESTOR_UPDATE",
  title: "Investor update — October 2026",
};

function delivery(filedTitle: string | null) {
  const posted: { content: string; blocks: unknown }[] = [];
  const deliver = createWorkforceDelivery({
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    runtime: {
      runs: {
        findForActor: () =>
          Promise.resolve({
            id: RUN,
            tenantId: TENANT,
            conversationId: CONVERSATION,
          }),
        allocateEventSequence: () => Promise.resolve(2),
      },
      runEvents: { append: () => Promise.resolve({}) },
      messages: {
        insert: (
          _tx: unknown,
          input: { content: string; blocks?: unknown },
        ) => {
          posted.push({ content: input.content, blocks: input.blocks });
          return Promise.resolve({
            id: randomUUID(),
            tenantId: TENANT,
            conversationId: CONVERSATION,
            runId: RUN,
            role: "Q",
            content: input.content,
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          });
        },
      },
    } as never,
    notify: () => Promise.resolve(),
    filed: () =>
      Promise.resolve(
        filedTitle === null ? [] : [{ ...update, title: filedTitle }],
      ),
  });
  return { deliver, posted };
}

describe("a finished plain document is announced once, with its card", () => {
  it("a plain document is delivered with its card", async () => {
    const { deliver, posted } = delivery(update.title);
    expect(await deliver(owner, row())).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.content).toBe(
      "Your Investor update — October 2026 is ready — here it is.",
    );
    expect(posted[0]?.blocks).toEqual([
      expect.objectContaining({
        kind: "ARTIFACT_REFERENCE",
        artifactId: ARTIFACT,
        status: "READY",
      }),
      expect.objectContaining({ kind: "WORK_IN_PROGRESS" }),
    ]);
  });

  it("says nothing extra when the document cannot be read as its owner", async () => {
    const { deliver, posted } = delivery(null);
    expect(await deliver(owner, row())).toBe(false);
    expect(posted).toHaveLength(0);
  });
});

describe("the live card finds a plain document (job 4d1a8b04)", () => {
  it("a DONE job's document is resolved as its owner may read it", async () => {
    const done = row();
    const page = createWorkforcePage({
      store: {} as never,
      work: { forOwner: () => Promise.resolve([done]) },
      deliverables: () =>
        Promise.resolve({
          documents: [
            {
              artifact: {
                artifactId: ARTIFACT,
                type: "INVESTOR_UPDATE",
                title: update.title,
                status: "READY",
              },
            } as unknown as QArtifactDetail,
          ],
          approvals: [],
        }),
    });
    const live = await page.live(owner, done.job_id);
    expect(live).toMatchObject({
      state: "DONE",
      document: {
        artifactId: ARTIFACT,
        type: "INVESTOR_UPDATE",
        title: update.title,
      },
    });
  });
});
