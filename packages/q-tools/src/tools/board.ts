import { createHash } from "node:crypto";

import { z } from "zod";

import {
  BOARD_ITEM_KINDS,
  BOARD_COLUMNS,
  BoardItemRefSchema,
  BoardItemTitleSchema,
  LocalDateSchema,
  Q_TASK_CLASSES,
  type BoardItem,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QBoardPort } from "../ports.js";
import type { QJobPort } from "./q-job.js";

/**
 * The work board for Q (owner 2026-10-23, QA F-14/F-26): "save this plan to
 * my board, then work on those items". Each tool reaches the same board
 * service the page calls, as the person; the service finds their own items
 * only, so an id that is not theirs is NOT_FOUND.
 *
 * Their own board is their own private arrangement, like their own
 * documents: adding, moving or editing an item is INSTANT, with no card,
 * and every change is said back in the answer. Working on an item is Q's
 * own-account work (research, a draft for them), started through the same
 * job port as propose_q_job; anything that would reach someone else still
 * becomes a card for their approval and is never linked here.
 */

export const MY_BOARD = "board.own" as const;

/** At most this many items are added or worked on in one call. */
export const BOARD_TOOL_BATCH_MAX = 12;

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

const OWN = {
  version: 1,
  status: "ACTIVE",
  requiredCapabilities: [],
  supportedPurposes: [...Q_TASK_CLASSES],
  requiredScopeKinds: ["OWN_Q_CONVERSATION"],
  approval: "NONE",
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
  visibleStage: null,
} as const;

const authorizeOwn = (
  _input: unknown,
  { actor, plan }: { actor: ActorContext; plan: PermittedContextPlan },
) =>
  Promise.resolve(
    ownConversation(actor, plan)
      ? allow<null>("CONFIDENTIAL", null)
      : deny<null>("NOT_AVAILABLE"),
  );

/**
 * Same run, same change, same words: the same key (a UUID, as the board
 * stores it), so a retried call changes nothing twice.
 */
export function boardKey(runId: string, what: string, input: unknown): string {
  const hex = createHash("sha1")
    .update(`${runId}|${what}|${JSON.stringify(input)}`)
    .digest("hex");
  // RFC 4122 layout (version 5, variant 10), so it parses as a UUID.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

const ItemOutSchema = z
  .object({
    itemId: z.string().max(64),
    kind: z.enum(BOARD_ITEM_KINDS),
    title: z.string().max(300),
    status: z.enum(BOARD_COLUMNS),
    refId: z.string().max(200).nullable(),
    notes: z.string().max(600).nullable(),
    dueOn: z.string().max(10).nullable(),
    /** Q's own work on it is under way (or done) when set. */
    workJobId: z.string().max(64).nullable(),
    revision: z.number().int().min(1),
  })
  .strict();

function itemOut(item: BoardItem): z.infer<typeof ItemOutSchema> {
  return {
    itemId: item.id,
    kind: item.kind,
    title: item.title.slice(0, 300),
    status: item.status,
    refId: item.refId,
    notes: item.notes === null ? null : item.notes.slice(0, 600),
    dueOn: item.dueOn,
    workJobId: item.workJobId,
    revision: item.revision,
  };
}

// --- the one tool ----------------------------------------------------------------
//
// One tool, four actions: every purpose's catalogue is bounded by what one
// model request carries, and their board is one thing to them.

const ListActionSchema = z
  .object({ action: z.literal("LIST") })
  .strict()
  .describe("Read their board: each item, its column and its itemId.");

const AddItemSchema = z
  .object({
    kind: z
      .enum(BOARD_ITEM_KINDS)
      .describe(
        "DOCUMENT: one of their documents (refId: its artifactId). COMPANY: a company (refId: its companyId). TASK: something to do. NOTE: something to keep in mind. WORK_JOB: a piece of Q's work (refId: its job id).",
      ),
    title: BoardItemTitleSchema.describe(
      "The item in their words, or the document's or company's name.",
    ),
    refId: BoardItemRefSchema.optional().describe(
      "Required for DOCUMENT, COMPANY and WORK_JOB: the id from its card or a list tool. Never made up.",
    ),
    notes: z.string().trim().max(2000).optional(),
    dueOn: LocalDateSchema.optional().describe(
      "When they gave a date for it (YYYY-MM-DD).",
    ),
    status: z
      .enum(BOARD_COLUMNS)
      .optional()
      .describe("Where it starts; TODO unless they said otherwise."),
  })
  .strict();

const AddActionSchema = z
  .object({
    action: z.literal("ADD"),
    items: z.array(AddItemSchema).min(1).max(BOARD_TOOL_BATCH_MAX),
  })
  .strict()
  .describe(
    "Add only what they asked for, in their words, at the end of the column.",
  );

const UpdateActionSchema = z
  .object({
    action: z.literal("UPDATE"),
    itemId: z.string().min(1).max(64).describe("The item's itemId from LIST."),
    moveTo: z
      .enum(BOARD_COLUMNS)
      .optional()
      .describe("Move it to this column (to its end unless place is given)."),
    place: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Its place in that column, from 1 at the top, when they said."),
    title: BoardItemTitleSchema.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    dueOn: LocalDateSchema.nullable().optional(),
    remove: z
      .literal(true)
      .optional()
      .describe("Take it off their board (its history is kept)."),
  })
  .strict()
  .describe("Move, rename, set notes or a due date, or remove one item.");

const WorkActionSchema = z
  .object({
    action: z.literal("WORK"),
    itemIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(BOARD_TOOL_BATCH_MAX)
      .describe("The items to work on, by itemId from LIST."),
    proceed: z
      .boolean()
      .default(false)
      .describe(
        "True only after you told them what was already waiting (ALREADY_WAITING) and they said to go ahead anyway.",
      ),
  })
  .strict()
  .describe("Start Q's own work on the items they named.");

const MyBoardInputSchema = z.discriminatedUnion("action", [
  ListActionSchema,
  AddActionSchema,
  UpdateActionSchema,
  WorkActionSchema,
]);
type MyBoardInput = z.output<typeof MyBoardInputSchema>;

const MyBoardOutputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("LIST"),
      items: z.array(ItemOutSchema).max(200),
      /** How many more there are beyond these, by column order. */
      more: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      action: z.literal("ADD"),
      added: z.array(ItemOutSchema).max(BOARD_TOOL_BATCH_MAX),
      /** Already added by this same request (a retry): not added twice. */
      alreadyThere: z.number().int().min(0),
      refused: z
        .array(
          z
            .object({
              title: z.string().max(300),
              reason: z.enum(["NEEDS_REF", "FULL", "CONFLICT"]),
            })
            .strict(),
        )
        .max(BOARD_TOOL_BATCH_MAX),
    })
    .strict(),
  z
    .object({
      action: z.literal("UPDATE"),
      status: z.enum([
        "UPDATED",
        "REMOVED",
        "NOT_FOUND",
        "NOTHING_TO_CHANGE",
        "CHANGED_SINCE",
      ]),
      item: ItemOutSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("WORK"),
      status: z.enum([
        "STARTED",
        "PREPARED",
        "ALREADY_WAITING",
        "NOT_PLANNED",
        "LIMIT_REACHED",
        "NOT_FOUND",
        "FAILED",
      ]),
      /** STARTED: the items now in DOING with Q's work linked. */
      working: z.array(ItemOutSchema).max(BOARD_TOOL_BATCH_MAX),
      /** Items not worked on: not theirs, already done or gone. */
      skipped: z.array(z.string().max(64)).max(BOARD_TOOL_BATCH_MAX),
      summary: z.string().max(400).nullable(),
      firstRead: z.string().max(700).nullable(),
      /** PREPARED: what will need them (their approval of the card). */
      needsYou: z.array(z.string()).max(8),
      waiting: z.array(z.string()).max(5),
    })
    .strict(),
]);
type MyBoardOutput = z.infer<typeof MyBoardOutputSchema>;
type Out<A extends MyBoardOutput["action"]> = Extract<
  MyBoardOutput,
  { action: A }
>;
type ItemOut = z.infer<typeof ItemOutSchema>;
type Context = { readonly actor: ActorContext; readonly runId: string };

async function listBoard(
  board: QBoardPort,
  context: Context,
): Promise<Out<"LIST">> {
  const { items } = await board.list(context.actor);
  return {
    action: "LIST",
    items: items.slice(0, 200).map(itemOut),
    more: Math.max(0, items.length - 200),
  };
}

async function addToBoard(
  board: QBoardPort,
  input: Extract<MyBoardInput, { action: "ADD" }>,
  context: Context,
): Promise<Out<"ADD">> {
  const added: ItemOut[] = [];
  const refused: Out<"ADD">["refused"] = [];
  let alreadyThere = 0;
  for (const [at, item] of input.items.entries()) {
    if (
      (item.kind === "DOCUMENT" ||
        item.kind === "COMPANY" ||
        item.kind === "WORK_JOB") &&
      item.refId === undefined
    ) {
      refused.push({ title: item.title, reason: "NEEDS_REF" });
      continue;
    }
    const outcome = await board.add(
      context.actor,
      {
        kind: item.kind,
        title: item.title,
        ...(item.refId === undefined ? {} : { refId: item.refId }),
        ...(item.notes === undefined || item.notes === ""
          ? {}
          : { notes: item.notes }),
        ...(item.dueOn === undefined ? {} : { dueOn: item.dueOn }),
        ...(item.status === undefined ? {} : { status: item.status }),
      },
      {
        by: "Q",
        idempotencyKey: boardKey(context.runId, "add", { at, item }),
      },
    );
    if (outcome.outcome === "REFUSED") {
      refused.push({
        title: item.title,
        reason: outcome.code === "FULL" ? "FULL" : "CONFLICT",
      });
    } else if (outcome.replayed) {
      alreadyThere += 1;
    } else {
      added.push(itemOut(outcome.value));
    }
  }
  return { action: "ADD", added, alreadyThere, refused };
}

async function updateItem(
  board: QBoardPort,
  input: Extract<MyBoardInput, { action: "UPDATE" }>,
  context: Context,
): Promise<Out<"UPDATE">> {
  const refusedAs = (code: string): Out<"UPDATE"> => ({
    action: "UPDATE",
    status: code === "CONFLICT" ? "CHANGED_SINCE" : "NOT_FOUND",
    item: null,
  });
  const current = (await board.list(context.actor)).items.find(
    (item) => item.id === input.itemId,
  );
  if (current === undefined) {
    return { action: "UPDATE", status: "NOT_FOUND", item: null };
  }
  const edits = {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.dueOn === undefined ? {} : { dueOn: input.dueOn }),
  };
  const editing = Object.keys(edits).length > 0;
  if (!editing && input.moveTo === undefined && input.remove !== true) {
    return { action: "UPDATE", status: "NOTHING_TO_CHANGE", item: null };
  }
  let item = current;
  if (editing || input.remove === true) {
    const outcome = await board.update(
      context.actor,
      item.id,
      {
        revision: item.revision,
        ...edits,
        ...(input.remove === true ? { archived: true } : {}),
      },
      { by: "Q", idempotencyKey: boardKey(context.runId, "update", input) },
    );
    if (outcome.outcome === "REFUSED") return refusedAs(outcome.code);
    if (input.remove === true) {
      return {
        action: "UPDATE",
        status: "REMOVED",
        item: itemOut(outcome.value),
      };
    }
    item = outcome.value;
  }
  if (input.moveTo !== undefined) {
    const column = (await board.list(context.actor)).items.filter(
      (one) => one.status === input.moveTo && one.id !== item.id,
    );
    const outcome = await board.move(
      context.actor,
      item.id,
      {
        revision: item.revision,
        status: input.moveTo,
        index:
          input.place === undefined
            ? column.length
            : Math.min(input.place - 1, column.length),
      },
      { by: "Q", idempotencyKey: boardKey(context.runId, "move", input) },
    );
    if (outcome.outcome === "REFUSED") return refusedAs(outcome.code);
    item = outcome.value;
  }
  return { action: "UPDATE", status: "UPDATED", item: itemOut(item) };
}

/**
 * Q's own work on items of their board, as the my_board tool's WORK does:
 * exported so the answer seam runs it by code ("work on the first task").
 */
export type BoardWorkOutcome = Out<"WORK">;

export function workOnBoardItems(
  board: QBoardPort,
  jobs: QJobPort | undefined,
  itemIds: readonly string[],
  context: Context,
): Promise<BoardWorkOutcome> {
  return workOnItems(
    board,
    jobs,
    { action: "WORK", itemIds: [...itemIds], proceed: false },
    context,
  );
}

async function workOnItems(
  board: QBoardPort,
  jobs: QJobPort | undefined,
  input: Extract<MyBoardInput, { action: "WORK" }>,
  context: Context,
): Promise<Out<"WORK">> {
  const empty: Omit<Out<"WORK">, "status" | "skipped"> = {
    action: "WORK",
    working: [],
    summary: null,
    firstRead: null,
    needsYou: [],
    waiting: [],
  };
  const items = (await board.list(context.actor)).items;
  const chosen = input.itemIds.flatMap((id) => {
    const item = items.find((one) => one.id === id);
    return item === undefined || item.status === "DONE" ? [] : [item];
  });
  const skipped = input.itemIds.filter(
    (id) => !chosen.some((item) => item.id === id),
  );
  if (chosen.length === 0) return { ...empty, status: "NOT_FOUND", skipped };
  if (jobs === undefined) return { ...empty, status: "NOT_PLANNED", skipped };
  // The goal is built from their own items, in their words; nothing the
  // model wrote about them goes into it.
  const goal = [
    "Work on these items from my board:",
    ...chosen.map(
      (item, at) =>
        `${at + 1}. ${item.title}${item.notes === null ? "" : ` (${item.notes.slice(0, 200)})`}`,
    ),
  ]
    .join("\n")
    .slice(0, 1_000);
  const prepared = await jobs
    .prepare(context.actor, context.runId, goal, { proceed: input.proceed })
    .catch(() => ({ status: "FAILED" }) as const);
  switch (prepared.status) {
    case "STARTED": {
      const working: ItemOut[] = [];
      const jobId = prepared.jobId;
      for (const item of jobId === undefined ? [] : chosen) {
        if (jobId === undefined) break;
        const linked = await board.linkJob(context.actor, item.id, jobId, {
          idempotencyKey: boardKey(context.runId, "work", {
            item: item.id,
            jobId,
          }),
        });
        if (linked.outcome === "OK") working.push(itemOut(linked.value));
        else skipped.push(item.id);
      }
      return {
        ...empty,
        status: "STARTED",
        working,
        skipped,
        summary: prepared.plan.summary.slice(0, 400),
        firstRead: prepared.firstRead?.slice(0, 700) ?? null,
      };
    }
    case "PREPARED":
    case "ONE_PER_TURN":
      return {
        ...empty,
        status: "PREPARED",
        skipped,
        summary: prepared.plan.summary.slice(0, 400),
        needsYou: prepared.plan.needsYou.slice(0, 8),
      };
    case "ALREADY_WAITING":
      return {
        ...empty,
        status: "ALREADY_WAITING",
        skipped,
        waiting: prepared.waiting.slice(0, 5),
      };
    case "NOT_PLANNED":
    case "LIMIT_REACHED":
    case "FAILED":
      return { ...empty, status: prepared.status, skipped };
  }
}

export function createMyBoardTool(
  board: QBoardPort,
  jobs?: QJobPort,
): AnyQToolDefinition {
  return defineQTool<MyBoardInput, MyBoardOutput, null>({
    ...OWN,
    id: MY_BOARD,
    // Where a board ask is read (doing something, or a general ask): every
    // other purpose's offer is already at what one request carries, and
    // the board would push a read out of it.
    supportedPurposes: ["ACTION_PREPARATION", "GENERAL_QUESTION"],
    // A board ask the turn names (reader boardAsk) reaches it on any
    // purpose; never offered by area alone.
    offeredWhenNamed: true,
    providerName: "my_board",
    description:
      "Their own work board: the documents, companies, tasks, notes and Q work they keep, in TODO, DOING and DONE. LIST: what is on it, with itemIds. ADD: put what they ask on it ('put this on my board', 'add a task to call Kestrel'), only what they asked for, in their words; a document or company by its id from its card or a list tool (NEEDS_REF: it needs that id). UPDATE: move an item ('mark it done', 'I'm on the hiring task'), rename it, set its notes or due date, or remove it (CHANGED_SINCE: LIST again). WORK: start Q's own work on items they name ('work on those items'): STARTED -- research and drafts for them began, those items are now in DOING and move to DONE when it finishes, so say which and give firstRead; PREPARED -- the work would reach someone else, so it is a card for their approval and the items stay put; ALREADY_WAITING -- say what waits and ask before calling again with proceed true. Their own board needs no approval: always say back what changed.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    input: MyBoardInputSchema,
    output: MyBoardOutputSchema,
    authorize: authorizeOwn,
    execute: (input, context) => {
      switch (input.action) {
        case "LIST":
          return listBoard(board, context);
        case "ADD":
          return addToBoard(board, input, context);
        case "UPDATE":
          return updateItem(board, input, context);
        case "WORK":
          return workOnItems(board, jobs, input, context);
      }
    },
  });
}

export function createBoardTools(ports: {
  readonly board?: QBoardPort | undefined;
  readonly jobs?: QJobPort | undefined;
}): readonly AnyQToolDefinition[] {
  return ports.board === undefined
    ? []
    : [createMyBoardTool(ports.board, ports.jobs)];
}
