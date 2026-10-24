import { describe, expect, it, vi } from "vitest";

import type {
  BoardItem,
  BoardItemStatus,
  PermittedContextPlan,
} from "@capital-q/contracts";

import {
  boardKey,
  createMyBoardTool,
  createQToolExecutor,
  createQToolRegistry,
  type QBoardOutcome,
  type QBoardPort,
  type QJobPort,
} from "../src/index.js";
import { actorA, actorB, contextFor, planFor, RUN } from "./support.js";

/**
 * The work board for Q (owner 2026-10-23, QA F-14/F-26): Q reads and
 * changes the person's own board through the board service, as them, in
 * their own conversation only; every change is recorded as Q's for them
 * and replays rather than repeats; working on items starts Q's own-account
 * work and links it, while outward work stays a card and links nothing.
 */

function ownPlan(
  userId = actorA.userId,
  purpose: Parameters<typeof planFor>[1] = "ACTION_PREPARATION",
): PermittedContextPlan {
  const plan = planFor(actorA, purpose, [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId } }
        : scope,
    ),
  };
}

const ID = (n: number) => `b0000000-0000-4000-8000-00000000000${n}`;

function itemOf(
  n: number,
  title: string,
  status: BoardItemStatus = "TODO",
): BoardItem {
  return {
    id: ID(n),
    kind: "TASK",
    refId: null,
    title,
    notes: null,
    status,
    position: `${n * 1024}`,
    dueOn: null,
    workJobId: null,
    createdBy: "PERSON",
    revision: 1,
    createdAt: "2026-10-23T21:00:00.000Z",
    updatedAt: "2026-10-23T21:00:00.000Z",
  };
}

function memoryBoard(initial: BoardItem[]) {
  const items = [...initial];
  const keys = new Map<string, string>();
  const ok = (value: BoardItem, replayed = false): QBoardOutcome => ({
    outcome: "OK",
    value,
    replayed,
  });
  const port = {
    list: vi.fn<QBoardPort["list"]>(() =>
      Promise.resolve({
        items: [...items],
        columns: ["TODO", "DOING", "DONE"],
        visibility: "personal_private",
      }),
    ),
    add: vi.fn<QBoardPort["add"]>((_actor, request, options) => {
      const seen = keys.get(options.idempotencyKey);
      const existing = items.find((item) => item.id === seen);
      if (existing !== undefined) return Promise.resolve(ok(existing, true));
      const item: BoardItem = {
        ...itemOf(items.length + 1, request.title, request.status ?? "TODO"),
        kind: request.kind,
        refId: request.refId ?? null,
        createdBy: options.by,
      };
      items.push(item);
      keys.set(options.idempotencyKey, item.id);
      return Promise.resolve(ok(item));
    }),
    update: vi.fn<QBoardPort["update"]>((_actor, itemId, request) => {
      const at = items.findIndex((item) => item.id === itemId);
      const item = items[at];
      if (item === undefined) {
        return Promise.resolve({ outcome: "REFUSED", code: "NOT_FOUND" });
      }
      if (item.revision !== request.revision) {
        return Promise.resolve({ outcome: "REFUSED", code: "CONFLICT" });
      }
      const next = {
        ...item,
        ...(request.title === undefined ? {} : { title: request.title }),
        revision: item.revision + 1,
      };
      if (request.archived === true) items.splice(at, 1);
      else items[at] = next;
      return Promise.resolve(ok(next));
    }),
    move: vi.fn<QBoardPort["move"]>((_actor, itemId, request) => {
      const at = items.findIndex((item) => item.id === itemId);
      const item = items[at];
      if (item === undefined) {
        return Promise.resolve({ outcome: "REFUSED", code: "NOT_FOUND" });
      }
      const next = {
        ...item,
        status: request.status,
        revision: item.revision + 1,
      };
      items[at] = next;
      return Promise.resolve(ok(next));
    }),
    linkJob: vi.fn<QBoardPort["linkJob"]>((_actor, itemId, jobId) => {
      const at = items.findIndex((item) => item.id === itemId);
      const item = items[at];
      if (item === undefined) {
        return Promise.resolve({ outcome: "REFUSED", code: "NOT_FOUND" });
      }
      const next: BoardItem = {
        ...item,
        status: "DOING",
        workJobId: jobId,
        revision: item.revision + 1,
      };
      items[at] = next;
      return Promise.resolve(ok(next));
    }),
  };
  return { port, items };
}

const PLAN_VIEW = {
  summary: "Research the market and draft a hiring plan",
  steps: [{ who: "Research", does: "Reads the market" }],
  cannot: [],
  budgetUsd: "0.50",
  needsYou: ["Your approval of the outreach"],
};

function run(port: QBoardPort, jobs?: QJobPort, plan = ownPlan()) {
  const executor = createQToolExecutor({
    registry: createQToolRegistry([createMyBoardTool(port, jobs)]),
  });
  return async (args: Record<string, unknown>, actor = actorA) => {
    const outcome = await executor.execute(
      { callId: "c-board", name: "my_board", arguments: args },
      contextFor(actor, plan),
    );
    return outcome.result;
  };
}

const dataOf = (result: unknown) =>
  (result as { ok: true; data: Record<string, unknown> }).data;

describe("my_board", () => {
  it("lists their own board with each item's id and column", async () => {
    const { port } = memoryBoard([itemOf(1, "Hire a head of sales")]);
    const result = dataOf(await run(port)({ action: "LIST" }));
    expect(result).toMatchObject({
      action: "LIST",
      items: [{ itemId: ID(1), title: "Hire a head of sales", status: "TODO" }],
      more: 0,
    });
  });

  it("adds what they asked as Q's change for them, once, and asks for the id a document needs", async () => {
    const { port, items } = memoryBoard([]);
    const call = run(port);
    const args = {
      action: "ADD",
      items: [
        { kind: "TASK", title: "Call Kestrel" },
        { kind: "DOCUMENT", title: "12-month plan" },
      ],
    };
    expect(dataOf(await call(args))).toMatchObject({
      action: "ADD",
      added: [{ title: "Call Kestrel", kind: "TASK" }],
      alreadyThere: 0,
      refused: [{ title: "12-month plan", reason: "NEEDS_REF" }],
    });
    expect(port.add).toHaveBeenCalledTimes(1);
    expect(port.add.mock.calls[0]?.[2]).toEqual({
      by: "Q",
      idempotencyKey: boardKey(RUN, "add", {
        at: 0,
        item: { kind: "TASK", title: "Call Kestrel" },
      }),
    });
    // The same call again in the same run adds nothing twice.
    expect(dataOf(await call(args))).toMatchObject({
      added: [],
      alreadyThere: 1,
    });
    expect(items).toHaveLength(1);
  });

  it("makes keys that are UUIDs and stable for the same run and change", () => {
    const key = boardKey(RUN, "add", { at: 0 });
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(boardKey(RUN, "add", { at: 0 })).toBe(key);
    expect(boardKey(RUN, "add", { at: 1 })).not.toBe(key);
  });

  it("moves an item at its current revision, removes one, and says when it changed meanwhile", async () => {
    const { port } = memoryBoard([
      itemOf(1, "Hire a head of sales"),
      itemOf(2, "Close the round", "DONE"),
    ]);
    const call = run(port);
    expect(
      dataOf(await call({ action: "UPDATE", itemId: ID(1), moveTo: "DONE" })),
    ).toMatchObject({ status: "UPDATED", item: { status: "DONE" } });
    expect(port.move.mock.calls[0]?.slice(1, 3)).toEqual([
      ID(1),
      { revision: 1, status: "DONE", index: 1 },
    ]);
    expect(
      dataOf(await call({ action: "UPDATE", itemId: ID(2), remove: true })),
    ).toMatchObject({ status: "REMOVED" });
    expect(port.update.mock.calls[0]?.[2]).toEqual({
      revision: 1,
      archived: true,
    });
    expect(
      dataOf(await call({ action: "UPDATE", itemId: ID(9), moveTo: "DONE" })),
    ).toMatchObject({ status: "NOT_FOUND", item: null });
    expect(
      dataOf(await call({ action: "UPDATE", itemId: ID(1) })),
    ).toMatchObject({
      status: "NOTHING_TO_CHANGE",
    });
    port.update.mockResolvedValueOnce({ outcome: "REFUSED", code: "CONFLICT" });
    expect(
      dataOf(
        await call({ action: "UPDATE", itemId: ID(1), title: "Hire a VP" }),
      ),
    ).toMatchObject({ status: "CHANGED_SINCE" });
  });

  it("works on their items: own-account work starts, is linked, and the items go to DOING", async () => {
    const { port } = memoryBoard([
      itemOf(1, "Research the market"),
      itemOf(2, "Draft the hiring plan"),
      itemOf(3, "Already finished", "DONE"),
    ]);
    const prepare = vi.fn<QJobPort["prepare"]>(() =>
      Promise.resolve({
        status: "STARTED",
        plan: PLAN_VIEW,
        firstRead: "The market is crowded at seed.",
        jobId: "a9000000-0000-4000-8000-000000000001",
      }),
    );
    const result = dataOf(
      await run(port, { prepare })({
        action: "WORK",
        itemIds: [ID(1), ID(2), ID(3), ID(7)],
      }),
    );
    expect(result).toMatchObject({
      action: "WORK",
      status: "STARTED",
      working: [
        {
          itemId: ID(1),
          status: "DOING",
          workJobId: "a9000000-0000-4000-8000-000000000001",
        },
        { itemId: ID(2), status: "DOING" },
      ],
      skipped: [ID(3), ID(7)],
      firstRead: "The market is crowded at seed.",
    });
    // The goal is their own items, in their words.
    expect(prepare.mock.calls[0]?.[2]).toBe(
      "Work on these items from my board:\n1. Research the market\n2. Draft the hiring plan",
    );
    expect(port.linkJob).toHaveBeenCalledTimes(2);
  });

  it("leaves the items where they are when the work would reach someone else (a card)", async () => {
    const { port } = memoryBoard([itemOf(1, "Introduce me to Kestrel")]);
    const prepare = vi.fn<QJobPort["prepare"]>(() =>
      Promise.resolve({ status: "PREPARED", plan: PLAN_VIEW }),
    );
    expect(
      dataOf(
        await run(port, { prepare })({ action: "WORK", itemIds: [ID(1)] }),
      ),
    ).toMatchObject({
      status: "PREPARED",
      working: [],
      needsYou: ["Your approval of the outreach"],
    });
    expect(port.linkJob).not.toHaveBeenCalled();
  });

  it("is only for the person, in their own conversation", async () => {
    const { port } = memoryBoard([itemOf(1, "Hire a head of sales")]);
    // Another person's conversation scope.
    const someoneElse = await run(
      port,
      undefined,
      ownPlan(actorB.userId),
    )({
      action: "LIST",
    });
    expect(someoneElse.ok).toBe(false);
    // Not a person (Q itself, a system job).
    const asQ = await run(port)(
      { action: "LIST" },
      { ...actorA, actorType: "Q" },
    );
    expect(asQ.ok).toBe(false);
    expect(port.list).not.toHaveBeenCalled();
  });
});

/**
 * Live 2026-10-24 (founder.maji-loop, run eb24f299): "save that plan to my
 * board" was planned as a records question and my_board was never offered.
 * A turn that names it (a board ask) reaches it on any purpose; a turn
 * that does not is not shown it outside its own purposes, area or not.
 */
describe("my_board on other purposes", () => {
  const registry = createQToolRegistry([
    createMyBoardTool(memoryBoard([]).port),
  ]);
  const onRecords = (tools: string[], areas: string[] = []) => ({
    ...contextFor(actorA, ownPlan(actorA.userId, "OWN_COMPANY_QUESTION")),
    focus: { areas, tools },
  });
  const shown = (context: ReturnType<typeof onRecords>) =>
    registry.eligible(context).map(({ definition }) => definition.providerName);

  it("is offered and executes when the turn names it", () => {
    const named = onRecords(["my_board"]);
    expect(shown(named)).toContain("my_board");
    expect(registry.offeredByProviderName(named, "my_board")).toBeDefined();
  });

  it("is not offered by area alone, nor executes unnamed", () => {
    const records = onRecords([], ["RECORDS"]);
    expect(shown(records)).not.toContain("my_board");
    expect(registry.offeredByProviderName(records, "my_board")).toBeUndefined();
  });
});
