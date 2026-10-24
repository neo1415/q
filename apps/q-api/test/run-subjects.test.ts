import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import {
  ActorContextSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withSilenceLadder } from "../src/voice/narration.js";
import { createRunSubjects } from "../src/voice/run-subjects.js";

const REACHABLE = "1b6f3a52-6c1e-4a59-9d1b-2f2b0c6a7e10";
const UNREACHABLE = "9c2d4e61-7a3b-4c8d-8e2f-3a4b5c6d7e8f";
const MET = "5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const DEMO = "6f7a8b9c-2d3e-4f5a-9b0c-1d2e3f4a5b6c";
const RUN = "run-1";
const TENANT_A = "a0000000-0000-4000-8000-00000000000a";
const actor = ActorContextSchema.parse({
  actorType: "HUMAN",
  tenantId: TENANT_A,
  userId: "b0000000-0000-4000-8000-00000000000a",
  organisationId: "c0000000-0000-4000-8000-00000000000a",
});

function contextFor(
  subjects: readonly { kind: "COMPANY"; companyId: string }[] = [],
): QToolExecutionContext {
  return {
    actor,
    runId: RUN,
    plan: { subjects },
  } as unknown as QToolExecutionContext;
}

/**
 * Stands in for the executor: get_company succeeds only for the company
 * this actor may see; for any other it is DENIED before executing, exactly
 * as the executor's authorize step answers, with no data at all.
 */
const port: QToolPort = {
  offer: () => Promise.resolve([]),
  execute: (proposal: QToolProposal): Promise<QToolCallOutcome> => {
    const args = proposal.arguments as Record<string, unknown>;
    const base = {
      callId: proposal.callId,
      toolVersion: 1,
      classification: "SAFE_READ",
      latencyMs: 1,
    } as const;
    if (proposal.name === "get_company" && args["companyId"] === REACHABLE) {
      return Promise.resolve({
        ...base,
        toolName: "company.get",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "INTERNAL",
        result: {
          ok: true,
          data: { companyId: REACHABLE, canonicalName: "Ledgerline" },
        },
      } as unknown as QToolCallOutcome);
    }
    // A company met in passing (a search, a list), and a demo record's
    // profile whose name carries its "(fictional)" marker.
    if (proposal.name === "search_companies" || proposal.name === "get_demo") {
      const demo = proposal.name === "get_demo";
      return Promise.resolve({
        ...base,
        toolName: demo ? "company.get" : "company.search",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "INTERNAL",
        result: {
          ok: true,
          data: {
            companyId: demo ? DEMO : MET,
            canonicalName: demo ? "Harbourline Cargo (fictional)" : "Mizan",
          },
        },
      } as unknown as QToolCallOutcome);
    }
    if (proposal.name === "read_company_document") {
      return Promise.resolve({
        ...base,
        toolName: "company.data_room.document.read",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        result: {
          ok: true,
          data: {
            status: "READ",
            documentId: "3d1c2b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
            title: "Seed pitch deck",
          },
        },
      } as unknown as QToolCallOutcome);
    }
    return Promise.resolve({
      ...base,
      toolName: "company.get",
      status: "DENIED",
      failureCode: "NOT_AVAILABLE",
      sensitivity: null,
      result: {
        ok: false,
        error: { code: "NOT_AVAILABLE", safeMessage: "Not available." },
      },
    } as unknown as QToolCallOutcome);
  },
};

const call = (name: string, args: Record<string, unknown>): QToolProposal => ({
  callId: `c-${name}`,
  name,
  arguments: args,
});

describe("the wait's subject, from the run's own authorised tool calls (W4b)", () => {
  it("names a company a tool of this run read for this actor, and its deck", async () => {
    const subjects = createRunSubjects();
    const tools = subjects.observe(port);
    await tools.execute(
      call("get_company", { companyId: REACHABLE }),
      contextFor(),
    );
    expect(subjects.focusFor(RUN, actor)).toEqual({ name: "Ledgerline" });
    await tools.execute(
      call("read_company_document", { companyId: REACHABLE }),
      contextFor(),
    );
    expect(subjects.focusFor(RUN, actor)).toEqual({
      name: "Ledgerline",
      thing: "deck",
    });
  });

  it("never names a company the actor cannot reach, even when the page (a browser id) points at it", async () => {
    const subjects = createRunSubjects();
    const tools = subjects.observe(port);
    // The page subject is the unreachable company; the read is denied.
    const context = contextFor([{ kind: "COMPANY", companyId: UNREACHABLE }]);
    await tools.execute(
      call("get_company", { companyId: UNREACHABLE }),
      context,
    );
    await tools.execute(call("read_company_document", {}), context);
    expect(subjects.focusFor(RUN, actor)).toBeNull();
  });

  // QA F-88 (I19): the holding line named a company the run had only met.
  it("never names a company only met in a search or list", async () => {
    const subjects = createRunSubjects();
    await subjects
      .observe(port)
      .execute(call("search_companies", { query: "credit" }), contextFor());
    expect(subjects.focusFor(RUN, actor)).toBeNull();
  });

  it("names no one when the run read several profiles (a comparison)", async () => {
    const subjects = createRunSubjects();
    const tools = subjects.observe(port);
    await tools.execute(
      call("get_company", { companyId: REACHABLE }),
      contextFor(),
    );
    await tools.execute(call("get_demo", {}), contextFor());
    expect(subjects.focusFor(RUN, actor)).toBeNull();
  });

  it("says a demo record's name without its '(fictional)' marker (F-62)", async () => {
    const subjects = createRunSubjects();
    await subjects.observe(port).execute(call("get_demo", {}), contextFor());
    expect(subjects.focusFor(RUN, actor)).toEqual({
      name: "Harbourline Cargo",
    });
  });

  it("is the run's own actor's only", async () => {
    const subjects = createRunSubjects();
    await subjects
      .observe(port)
      .execute(call("get_company", { companyId: REACHABLE }), contextFor());
    expect(
      subjects.focusFor(RUN, {
        tenantId: TenantIdSchema.parse(TENANT_A),
        userId: UserIdSchema.parse("b0000000-0000-4000-8000-00000000000b"),
      }),
    ).toBeNull();
    expect(subjects.focusFor("another-run", actor)).toBeNull();
  });

  describe("on the ladder", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("falls back to generic wording, then names the subject once a tool has read it", async () => {
      const subjects = createRunSubjects();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      async function* answer(): AsyncGenerator<string> {
        await gate;
        yield "Done.";
      }
      const heard: string[] = [];
      const done = (async () => {
        for await (const part of withSilenceLadder(answer(), {
          live: { stage: "REVIEWING_COMPANY", approvalWaiting: false },
          focus: () => Promise.resolve(subjects.focusFor(RUN, actor)),
          seed: 11,
          now: () => Date.now(),
        })) {
          heard.push(part);
        }
      })();
      await vi.advanceTimersByTimeAsync(1_600);
      expect(heard).toHaveLength(1);
      expect(heard[0]).not.toMatch(/Ledgerline/u);
      await subjects
        .observe(port)
        .execute(call("get_company", { companyId: REACHABLE }), contextFor());
      await vi.advanceTimersByTimeAsync(2_600);
      expect(heard).toHaveLength(2);
      expect(heard[1]).toMatch(/Ledgerline's/u);
      release();
      await vi.advanceTimersByTimeAsync(10);
      await done;
    });
  });
});
