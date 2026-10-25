import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QArtifactDetail } from "@capital-q/contracts";

import {
  createWorkforceDelivery,
  followUpLine,
} from "../src/composition/workforce/delivery.js";
import { createWorkforcePage } from "../src/composition/workforce/page.js";
import type { WorkRow } from "../src/composition/workforce/queue.js";

/**
 * QA 25 Oct 2026: "Write a one-page investor update and save it to my
 * board" (job 4d1a8b04) was DONE in 2 s, yet its card said "Done" with no
 * document; and (F-117) "On it. Starting now" was followed by neither a
 * document nor a clear failure.
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

describe("followUpLine", () => {
  it("names the document, or says plainly why there is none", () => {
    expect(followUpLine(row(), update.title)).toBe(
      "Your Investor update — October 2026 is ready.",
    );
    expect(followUpLine(row(), null)).toBe("That work is done.");
    expect(
      followUpLine(
        row({ state: "FAILED", reason: "Public sources could not be read." }),
        null,
      ),
    ).toBe(
      "I couldn't finish that work, so there is no document: Public sources could not be read.",
    );
    expect(followUpLine(row({ state: "NEEDS_DECISION" }), null)).toBe(
      "That work is waiting for you before it can go on.",
    );
    expect(followUpLine(row({ state: "CANCELLED" }), null)).toBe("");
  });
});

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

describe("F-117: every job that ends says so once, in the conversation", () => {
  it("a plain document is delivered with its card", async () => {
    const { deliver, posted } = delivery(update.title);
    expect(await deliver(owner, row())).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.content).toBe(
      "Your Investor update — October 2026 is ready.",
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

  it("a job that failed says why, in one line", async () => {
    const { deliver, posted } = delivery(null);
    await deliver(
      owner,
      row({
        state: "FAILED",
        reason: "Public sources could not be read.",
        results: {},
      }),
    );
    expect(posted.map((one) => one.content)).toEqual([
      "I couldn't finish that work, so there is no document: Public sources could not be read.",
    ]);
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
