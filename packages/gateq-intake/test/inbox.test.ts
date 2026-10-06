import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";
import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";

import {
  createInboxService,
  replyPromise,
  zipEntries,
  type InboxActivity,
  type InboxAuthority,
  type InboxRepository,
  type InboxRow,
} from "../src/index.js";

/**
 * F4: the investor's GateQ inbox, against an in-memory store. What matters
 * here is what is refused (another firm, a foreign application, a member
 * acting for the firm, an outsider as assignee) and what the pack holds
 * (only what the founder sent; never the firm's own notes).
 */

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const GATEWAY = "00000000-0000-4000-8000-000000000b01";
const OTHER_GATEWAY = "00000000-0000-4000-8000-000000000b02";
const ORG = "00000000-0000-4000-8000-0000000000c1";
const ADMIN = "00000000-0000-4000-8000-0000000000e1";
const MEMBER = "00000000-0000-4000-8000-0000000000e2";
const OUTSIDER = "00000000-0000-4000-8000-0000000000e9";
const APP_FIT = "00000000-0000-4000-8000-0000000000f1";
const APP_PARTIAL = "00000000-0000-4000-8000-0000000000f2";
const APP_NO = "00000000-0000-4000-8000-0000000000f3";
const FOREIGN_APP = "00000000-0000-4000-8000-0000000000f9";
const DECK = "00000000-0000-4000-8000-0000000000d1";
const PRIVATE_DOC = "00000000-0000-4000-8000-0000000000d2";

const actor = (userId: string): ActorContext =>
  ({
    userId,
    tenantId: TENANT,
    organisationId: ORG,
    actorType: "HUMAN",
  }) as unknown as ActorContext;

const snapshot = (name: string, documentIds: string[] = []) => ({
  reference: `ga_${name.toLowerCase()}`,
  declaredName: name,
  facts: [
    {
      dimension: "company.stage",
      value: { kind: "CODE", code: "seed" },
      provenance: "APPLICANT_PROVIDED",
    },
    {
      dimension: "company.country",
      value: { kind: "CODE", code: "NG" },
      provenance: "APPLICANT_PROVIDED",
    },
    {
      dimension: "raise.amount",
      value: { kind: "AMOUNT", amount: "1200000", currency: "USD" },
      provenance: "APPLICANT_PROVIDED",
    },
    {
      dimension: "application.note",
      value: { kind: "TEXT", text: "We help clinics get paid." },
      provenance: "APPLICANT_PROVIDED",
    },
    {
      dimension: "contact.name",
      value: { kind: "TEXT", text: "Amara Obi" },
      provenance: "APPLICANT_PROVIDED",
    },
  ],
  documentIds,
});

const qualification = (outcome: string, statuses: string[]) => ({
  outcome,
  criteria: statuses.map((status, i) => ({
    label: ["Seed", "West Africa", "$500k to $3M"][i],
    type: ["STAGE", "GEOGRAPHY", "RAISE_SIZE"][i],
    requiredness: "REQUIRED",
    status,
  })),
});

type State = {
  folder: Map<string, InboxRow["folder"]>;
  assignee: Map<string, string | null>;
  stars: Map<string, boolean>;
  reads: Set<string>;
  labels: Map<string, Set<string>>;
  notes: { applicationId: string; body: string; key: string }[];
  messages: {
    applicationId: string;
    kind: string;
    reasonCode: string | null;
    body: string;
    key: string;
  }[];
  activity: InboxActivity[];
  promise: number | null;
};

function harness(options: { readonly now?: string } = {}) {
  const submitted = new Map<
    string,
    { gateway: string; at: string; snapshot: unknown; qualification: unknown }
  >([
    [
      APP_FIT,
      {
        gateway: GATEWAY,
        at: "2026-10-05T09:00:00.000Z",
        snapshot: snapshot("Sunline", [DECK]),
        qualification: qualification("QUALIFIED", ["MATCH", "MATCH", "MATCH"]),
      },
    ],
    [
      APP_PARTIAL,
      {
        gateway: GATEWAY,
        at: "2026-10-01T09:00:00.000Z",
        snapshot: snapshot("Harvest"),
        qualification: qualification("INSUFFICIENT_INFORMATION", [
          "MATCH",
          "MATCH",
          "UNKNOWN",
        ]),
      },
    ],
    [
      APP_NO,
      {
        gateway: GATEWAY,
        at: "2026-09-29T09:00:00.000Z",
        snapshot: snapshot("Mosaic"),
        qualification: qualification("NOT_QUALIFIED", [
          "MATCH",
          "NO_MATCH",
          "MATCH",
        ]),
      },
    ],
    [
      FOREIGN_APP,
      {
        gateway: OTHER_GATEWAY,
        at: "2026-10-05T09:00:00.000Z",
        snapshot: snapshot("Elsewhere"),
        qualification: qualification("QUALIFIED", ["MATCH"]),
      },
    ],
  ]);
  const state: State = {
    folder: new Map(),
    assignee: new Map(),
    stars: new Map(),
    reads: new Set(),
    labels: new Map(),
    notes: [],
    messages: [],
    activity: [],
    promise: 10,
  };
  const rowOf = (id: string, userId: string): InboxRow => {
    const s = submitted.get(id);
    if (s === undefined) throw new Error("no such application");
    return {
      applicationId: id,
      submittedAt: s.at,
      snapshot: s.snapshot,
      qualification: s.qualification,
      folder: state.folder.get(id) ?? "INBOX",
      assigneeUserId: state.assignee.get(id) ?? null,
      starred: state.stars.get(`${id}:${userId}`) ?? false,
      readAt: state.reads.has(`${id}:${userId}`)
        ? "2026-10-06T00:00:00.000Z"
        : null,
      labels: [...(state.labels.get(id) ?? [])],
      answered: state.messages.some((m) => m.applicationId === id),
    };
  };
  const mine = (gatewayId: string) =>
    [...submitted.entries()]
      .filter(([, s]) => s.gateway === gatewayId)
      .map(([id]) => id);
  const repository: InboxRepository = {
    list: (input) =>
      Promise.resolve(
        mine(input.gatewayId).map((id) => rowOf(id, input.userId)),
      ),
    one: (input) =>
      Promise.resolve(
        mine(input.gatewayId).includes(input.applicationId)
          ? rowOf(input.applicationId, input.userId)
          : null,
      ),
    submittedAmong: (input) =>
      Promise.resolve(
        input.applicationIds.filter((id) => mine(input.gatewayId).includes(id)),
      ),
    replyWithinDays: () => Promise.resolve(state.promise),
    setReplyWithinDays: (_tx, input) => {
      state.promise = input.replyWithinDays;
      return Promise.resolve();
    },
    members: () =>
      Promise.resolve([
        { userId: ADMIN, name: "Daniel Reyes" },
        { userId: MEMBER, name: "Sara Kamau" },
      ]),
    labels: () =>
      Promise.resolve([
        ...new Set([...state.labels.values()].flatMap((s) => [...s])),
      ]),
    setFolder: (_tx, input) => {
      for (const id of input.applicationIds) state.folder.set(id, input.folder);
      return Promise.resolve();
    },
    setAssignee: (_tx, input) => {
      for (const id of input.applicationIds)
        state.assignee.set(id, input.assigneeUserId);
      return Promise.resolve();
    },
    setStar: (input) => {
      for (const id of input.applicationIds)
        state.stars.set(`${id}:${input.userId}`, input.starred);
      return Promise.resolve();
    },
    markRead: (input) => {
      state.reads.add(`${input.applicationId}:${input.userId}`);
      return Promise.resolve();
    },
    setLabel: (_tx, input) => {
      for (const id of input.applicationIds) {
        const set = state.labels.get(id) ?? new Set<string>();
        if (input.on) set.add(input.label);
        else set.delete(input.label);
        state.labels.set(id, set);
      }
      return Promise.resolve();
    },
    addNote: (_tx, input) => {
      const duplicate = state.notes.some(
        (n) =>
          n.applicationId === input.applicationId &&
          n.key === input.clientRequestId,
      );
      if (!duplicate)
        state.notes.push({
          applicationId: input.applicationId,
          body: input.body,
          key: input.clientRequestId,
        });
      return Promise.resolve({ deduplicated: duplicate });
    },
    notes: (applicationId) =>
      Promise.resolve(
        state.notes
          .filter((n) => n.applicationId === applicationId)
          .map((n, i) => ({
            id: `00000000-0000-4000-8000-00000000010${i}`,
            authorUserId: MEMBER,
            authorName: "Sara Kamau",
            body: n.body,
            createdAt: "2026-10-06T00:00:00.000Z",
          })),
      ),
    addMessage: (_tx, input) => {
      const duplicate = state.messages.some(
        (m) =>
          m.applicationId === input.applicationId &&
          m.key === input.clientRequestId,
      );
      if (!duplicate)
        state.messages.push({
          applicationId: input.applicationId,
          kind: input.kind,
          reasonCode: input.reasonCode,
          body: input.body,
          key: input.clientRequestId,
        });
      return Promise.resolve({ deduplicated: duplicate });
    },
    messages: (applicationId) =>
      Promise.resolve(
        state.messages
          .filter((m) => m.applicationId === applicationId)
          .map((m) => ({
            kind: m.kind as "PASS" | "REPLY",
            reasonCode: m.reasonCode,
            body: m.body,
            createdAt: "2026-10-06T00:00:00.000Z",
          })),
      ),
    record: (_tx, activity) => {
      state.activity.push(activity);
      return Promise.resolve();
    },
    recordNow: (activity) => {
      state.activity.push(activity);
      return Promise.resolve();
    },
    activity: () => Promise.resolve([]),
  };
  const authority: InboxAuthority = {
    // Our firm's gateway only; the admin may decide, the member may not.
    authorise: (who, gatewayId) =>
      Promise.resolve(
        gatewayId !== GATEWAY || who.userId === OUTSIDER
          ? null
          : {
              gateway: {
                gatewayId: GATEWAY,
                tenantId: TENANT,
                organisationId: ORG,
                name: "Seed gate",
                publicId: "gq_seed",
                fund: "Northbound Capital",
              },
              canDecide: who.userId === ADMIN,
            },
      ),
  };
  const transactions: TransactionManager = {
    run: (work) => work({ sql: {} } as unknown as TransactionContext),
  };
  const fetched: string[] = [];
  const service = createInboxService({
    repository,
    authority,
    transactions,
    clock: () => new Date(options.now ?? "2026-10-06T10:00:00.000Z"),
    documents: {
      titles: (ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [id, id === DECK ? "Pitch deck" : "Private"]),
          ),
        ),
      file: (id) => {
        fetched.push(id);
        return Promise.resolve({
          title: "Pitch deck",
          fileName: "deck.pdf",
          bytes: new TextEncoder().encode("%PDF-deck"),
          why: null,
        });
      },
    },
  });
  return { service, state, fetched };
}

describe("reading the inbox (F4)", () => {
  it("shows every application to the gate with the engine's band, ordered by the reply promise", async () => {
    const { service } = harness();
    const inbox = await service.list(actor(ADMIN), GATEWAY, "INBOX");
    if (!("items" in inbox)) throw new Error("refused");
    expect(inbox.items.map((i) => [i.companyName, i.fit])).toEqual([
      ["Mosaic", "NOT_A_FIT"],
      ["Harvest", "PARTIAL"],
      ["Sunline", "FITS"],
    ]);
    expect(inbox.items.find((i) => i.companyName === "Harvest")?.rules).toEqual(
      { met: 2, total: 3, unknown: 1 },
    );
    expect(inbox.counts.FITS).toBe(1);
    expect(inbox.counts.NOT_A_FIT).toBe(1);
    expect(inbox.viewer).toMatchObject({ canDecide: true, solo: false });
    // Never another gateway's application.
    expect(inbox.items.some((i) => i.companyName === "Elsewhere")).toBe(false);
  });

  it("refuses another firm's gateway exactly as one that does not exist", async () => {
    const { service } = harness();
    expect(await service.list(actor(OUTSIDER), GATEWAY, "INBOX")).toEqual({
      ok: false,
    });
    expect(await service.list(actor(ADMIN), OTHER_GATEWAY, "INBOX")).toEqual({
      ok: false,
    });
    expect(await service.detail(actor(ADMIN), GATEWAY, FOREIGN_APP)).toEqual({
      ok: false,
    });
  });

  it("marks an application read for the person who opened it, and no one else", async () => {
    const { service, state } = harness();
    await service.detail(actor(MEMBER), GATEWAY, APP_FIT);
    expect(state.reads.has(`${APP_FIT}:${MEMBER}`)).toBe(true);
    expect(state.reads.has(`${APP_FIT}:${ADMIN}`)).toBe(false);
  });
});

describe("acting on applications (F4)", () => {
  it("stars, labels and archives in bulk, and a star is personal", async () => {
    const { service, state } = harness();
    const member = actor(MEMBER);
    expect(
      await service.star(member, GATEWAY, {
        applicationIds: [APP_FIT, APP_PARTIAL],
        starred: true,
      }),
    ).toMatchObject({ ok: true, changed: 2 });
    expect(state.stars.get(`${APP_FIT}:${MEMBER}`)).toBe(true);
    expect(state.stars.get(`${APP_FIT}:${ADMIN}`)).toBeUndefined();
    await service.label(member, GATEWAY, {
      applicationIds: [APP_FIT, APP_NO],
      label: "  IC   next week ",
      on: true,
    });
    expect([...(state.labels.get(APP_NO) ?? [])]).toEqual(["IC next week"]);
    await service.archive(member, GATEWAY, {
      applicationIds: [APP_NO],
      archived: true,
    });
    const archived = await service.list(member, GATEWAY, "ARCHIVED");
    expect(
      "items" in archived && archived.items.map((i) => i.companyName),
    ).toEqual(["Mosaic"]);
  });

  it("refuses a bulk action that names one application from elsewhere, and changes nothing", async () => {
    const { service, state } = harness();
    expect(
      await service.archive(actor(ADMIN), GATEWAY, {
        applicationIds: [APP_FIT, FOREIGN_APP],
        archived: true,
      }),
    ).toEqual({ ok: false });
    expect(state.folder.size).toBe(0);
  });

  it("lets only someone who may act for the firm assign, and only to a member", async () => {
    const { service, state } = harness();
    expect(
      await service.assign(actor(MEMBER), GATEWAY, {
        applicationIds: [APP_FIT],
        assigneeUserId: ADMIN,
      }),
    ).toEqual({ ok: false });
    expect(
      await service.assign(actor(ADMIN), GATEWAY, {
        applicationIds: [APP_FIT],
        assigneeUserId: OUTSIDER,
      }),
    ).toEqual({ ok: false });
    expect(
      await service.assign(actor(ADMIN), GATEWAY, {
        applicationIds: [APP_FIT],
        assigneeUserId: MEMBER,
      }),
    ).toMatchObject({ ok: true });
    expect(state.assignee.get(APP_FIT)).toBe(MEMBER);
    const mine = await service.list(actor(MEMBER), GATEWAY, "ASSIGNED_TO_ME");
    expect(
      "items" in mine && mine.items.map((i) => i.assignee?.initials),
    ).toEqual(["SK"]);
  });

  it("passes with the exact approved words, once, and only for someone who may decide", async () => {
    const { service, state } = harness();
    const input = {
      reasonCode: "TIMING" as const,
      message: "Not this year, thank you.",
      clientRequestId: "pass-0000001",
    };
    expect(
      await service.pass(actor(MEMBER), GATEWAY, APP_PARTIAL, input),
    ).toEqual({ ok: false });
    expect(
      await service.pass(actor(ADMIN), GATEWAY, APP_PARTIAL, input),
    ).toMatchObject({ ok: true, deduplicated: false });
    expect(
      await service.pass(actor(ADMIN), GATEWAY, APP_PARTIAL, input),
    ).toMatchObject({ ok: true, deduplicated: true });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      kind: "PASS",
      reasonCode: "TIMING",
      body: "Not this year, thank you.",
    });
    expect(state.folder.get(APP_PARTIAL)).toBe("PASSED");
    const passed = await service.list(actor(ADMIN), GATEWAY, "PASSED");
    expect("items" in passed && passed.items[0]?.replyState).toBe("ANSWERED");
  });

  it("drafts a pass with a reason from the rules, and drafting sends nothing", async () => {
    const { service, state } = harness();
    const draft = await service.draftPass(actor(ADMIN), GATEWAY, APP_NO);
    expect(draft).toMatchObject({ ok: true, reasonCode: "OTHER" });
    expect("message" in draft && draft.message).toMatch(
      /^Hi Amara, thank you for applying to Northbound Capital/,
    );
    expect(state.messages).toHaveLength(0);
  });

  it("triages without ever passing on anyone's behalf", async () => {
    const { service, state } = harness();
    const result = await service.triage(actor(MEMBER), GATEWAY);
    expect(
      "proposals" in result &&
        result.proposals.map((p) => [p.companyName, p.propose]),
    ).toEqual([
      ["Mosaic", "PREPARE_PASS"],
      ["Harvest", "ASK_FOR_MORE"],
      ["Sunline", "REVIEW_FIRST"],
    ]);
    expect(state.messages).toHaveLength(0);
    expect(state.folder.size).toBe(0);
  });
});

describe("the download pack (F4)", () => {
  it("holds only what the founder sent: summary, their shared deck, their answers; never team notes", async () => {
    const { service, fetched } = harness();
    await service.note(actor(MEMBER), GATEWAY, APP_FIT, {
      body: "SECRET internal view",
      clientRequestId: "note-0000001",
    });
    const pack = await service.pack(
      actor(MEMBER),
      GATEWAY,
      APP_FIT,
      "Sara Kamau",
    );
    if (!("bytes" in pack)) throw new Error("refused");
    expect(pack.fileName).toBe("Sunline-2026-10-06.zip");
    const entries = zipEntries(pack.bytes);
    expect(entries.map((e) => e.name)).toEqual([
      "00-summary.pdf",
      "01-shared/01-deck.pdf",
      "02-application.json",
    ]);
    // Only the ids the frozen submission named were ever asked for.
    expect(fetched).toEqual([DECK]);
    expect(fetched).not.toContain(PRIVATE_DOC);
    const everything = new TextDecoder().decode(pack.bytes);
    expect(everything).not.toContain("SECRET");
    expect(everything).toContain("Downloaded by Sara Kamau");
    expect(
      new TextDecoder().decode(entries[0]?.bytes).startsWith("%PDF-1.4"),
    ).toBe(true);
  });

  it("records who downloaded it, and refuses another firm", async () => {
    const { service, state } = harness();
    await service.pack(actor(ADMIN), GATEWAY, APP_FIT);
    expect(state.activity.at(-1)).toMatchObject({
      kind: "PACK_DOWNLOADED",
      actorUserId: ADMIN,
      applicationId: APP_FIT,
    });
    expect(await service.pack(actor(OUTSIDER), GATEWAY, APP_FIT)).toEqual({
      ok: false,
    });
    expect(await service.pack(actor(ADMIN), GATEWAY, FOREIGN_APP)).toEqual({
      ok: false,
    });
  });
});

describe("the reply promise (F4)", () => {
  it("counts working days, warns at three quarters, and is kept by a reply", () => {
    const submittedAt = new Date("2026-10-01T09:00:00.000Z"); // Thursday
    expect(
      replyPromise({
        submittedAt,
        replyWithinDays: 10,
        answered: false,
        now: new Date("2026-10-02T09:00:00Z"),
      }),
    ).toMatchObject({
      replyBy: "2026-10-15",
      state: "ON_TRACK",
    });
    expect(
      replyPromise({
        submittedAt,
        replyWithinDays: 10,
        answered: false,
        now: new Date("2026-10-13T09:00:00Z"),
      }).state,
    ).toBe("DUE_SOON");
    expect(
      replyPromise({
        submittedAt,
        replyWithinDays: 10,
        answered: false,
        now: new Date("2026-10-16T09:00:00Z"),
      }).state,
    ).toBe("OVERDUE");
    expect(
      replyPromise({
        submittedAt,
        replyWithinDays: 10,
        answered: true,
        now: new Date("2026-10-16T09:00:00Z"),
      }).state,
    ).toBe("ANSWERED");
    expect(
      replyPromise({
        submittedAt,
        replyWithinDays: null,
        answered: false,
        now: submittedAt,
      }).state,
    ).toBe("NONE");
  });
});
