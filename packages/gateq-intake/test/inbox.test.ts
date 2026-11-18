import { createHash } from "node:crypto";
import type {
  GateqEmailEvent,
  GateqOutboundLimits,
  GateqOutboundSender,
} from "../src/index.js";
import type { GateqOutboundDelivery } from "@capital-q/contracts";
import { describe, expect, it } from "vitest";
import { GateqInboxDtoSchema } from "@capital-q/contracts";

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
    {
      dimension: "contact.email",
      value: { kind: "TEXT", text: "amara@sunline.example" },
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
    id: string;
    applicationId: string;
    kind: string;
    reasonCode: string | null;
    body: string;
    bodySha256: string;
    key: string;
    subject: string;
    recipientSha256: string | null;
    approvedBy: string;
    at: string;
  }[];
  deliveries: {
    messageId: string;
    outcome: string;
    recipientDomain: string | null;
  }[];
  activity: InboxActivity[];
  promise: number | null;
};

function harness(
  options: {
    readonly now?: string;
    readonly mail?: GateqOutboundSender;
    /** GateQ slice 1: a v2 submission for APP_FIT (dossier + transcript). */
    readonly v2?: { readonly dossier: unknown; readonly transcript: unknown };
    readonly descriptionPhrases?: readonly string[];
    readonly synthesisState?: InboxRow["synthesisState"];
    /** Replaces Harvest's frozen qualification (decision 91 cases). */
    readonly partialQualification?: unknown;
    readonly limits?: GateqOutboundLimits;
    readonly replyTo?: string | null;
  } = {},
) {
  const emailEvents: GateqEmailEvent[] = [];
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
        qualification:
          options.partialQualification ??
          qualification("INSUFFICIENT_INFORMATION", [
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
    deliveries: [],
    activity: [],
    promise: 10,
  };
  const rowOf = (id: string, userId: string): InboxRow => {
    const s = submitted.get(id);
    if (s === undefined) throw new Error("no such application");
    if (id === APP_FIT && options.descriptionPhrases !== undefined) {
      const original = snapshot("Sunline");
      s.snapshot = {
        ...original,
        facts: [
          ...original.facts,
          {
            dimension: "company.description",
            value: { kind: "PHRASES", phrases: options.descriptionPhrases },
            provenance: "APPLICANT_PROVIDED",
          },
        ],
      };
    }
    return {
      applicationId: id,
      submittedAt: s.at,
      snapshot:
        id === APP_FIT && options.v2 !== undefined
          ? {
              ...(s.snapshot as object),
              snapshotVersion: 2,
              transcript: options.v2.transcript,
            }
          : s.snapshot,
      qualification: s.qualification,
      dossier: id === APP_FIT ? (options.v2?.dossier ?? null) : null,
      synthesisState: options.synthesisState,
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
      const stored = state.messages.find(
        (m) =>
          m.applicationId === input.applicationId &&
          m.key === input.clientRequestId,
      );
      if (stored !== undefined) {
        return Promise.resolve({
          deduplicated: true as const,
          storedBodySha256: stored.bodySha256,
        });
      }
      const id = `00000000-0000-4000-8000-0000000003${String(state.messages.length).padStart(2, "0")}`;
      state.messages.push({
        id,
        applicationId: input.applicationId,
        kind: input.kind,
        reasonCode: input.reasonCode,
        body: input.body,
        bodySha256: input.bodySha256,
        key: input.clientRequestId,
        subject: input.subject,
        recipientSha256: input.recipientSha256,
        approvedBy: input.approvedByUserId,
        at: options.now ?? "2026-10-06T10:00:00.000Z",
      });
      return Promise.resolve({ deduplicated: false as const, messageId: id });
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
            subject: m.subject,
            delivery:
              (state.deliveries.find((d) => d.messageId === m.id)?.outcome as
                GateqOutboundDelivery | undefined) ?? null,
          })),
      ),
    outboundCounts: (input) => {
      const since = (ms: number) => input.now.getTime() - ms;
      return Promise.resolve({
        tenantLastHour: state.messages.filter(
          (m) => Date.parse(m.at) > since(60 * 60 * 1000),
        ).length,
        applicationLastDay: state.messages.filter(
          (m) =>
            m.applicationId === input.applicationId &&
            Date.parse(m.at) > since(24 * 60 * 60 * 1000),
        ).length,
        alreadyRecorded: state.messages.some(
          (m) =>
            m.applicationId === input.applicationId &&
            m.key === input.clientRequestId,
        ),
      });
    },
    recordDelivery: (input) => {
      if (!state.deliveries.some((d) => d.messageId === input.messageId)) {
        state.deliveries.push({
          messageId: input.messageId,
          outcome: input.outcome,
          recipientDomain: input.recipientDomain,
        });
      }
      return Promise.resolve();
    },
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
    founderMail: options.mail,
    onEmail: (event) => {
      emailEvents.push(event);
    },
    outboundLimits: options.limits,
    replyToFor:
      options.replyTo === undefined
        ? undefined
        : () => Promise.resolve(options.replyTo ?? null),
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
  return { service, state, fetched, emailEvents };
}

describe("reading the inbox (F4)", () => {
  it("returns a valid bounded list preview for a long phrase-based description", async () => {
    const { service } = harness({
      descriptionPhrases: ["a".repeat(120), "b".repeat(120), "c".repeat(120)],
    });
    const inbox = GateqInboxDtoSchema.parse(
      await service.list(actor(ADMIN), GATEWAY, "INBOX"),
    );
    const preview = inbox.items.find(
      (i) => i.applicationId === APP_FIT,
    )?.oneLiner;
    expect(preview).toHaveLength(280);
    expect(preview).toContain("a".repeat(120));
    expect(preview?.endsWith("…")).toBe(true);
  });

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
      { met: 2, total: 3, unknown: 1, unresolved: 0 },
    );
    expect(inbox.counts.FITS).toBe(1);
    expect(inbox.counts.NOT_A_FIT).toBe(1);
    expect(inbox.viewer).toMatchObject({ canDecide: true, solo: false });
    // Never another gateway's application.
    expect(inbox.items.some((i) => i.companyName === "Elsewhere")).toBe(false);
  });

  it("still lists an application whose required rule is UNRESOLVED (decision 91), never as a miss", async () => {
    const { service } = harness({
      partialQualification: qualification("UNRESOLVED", [
        "MATCH",
        "MATCH",
        "UNRESOLVED",
      ]),
    });
    const inbox = GateqInboxDtoSchema.parse(
      await service.list(actor(ADMIN), GATEWAY, "INBOX"),
    );
    expect(inbox.items).toHaveLength(3);
    expect(inbox.items.find((i) => i.companyName === "Harvest")).toMatchObject({
      fit: "PARTIAL",
      rules: { met: 2, total: 3, unknown: 1 },
    });
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

  it("P14: the founder gets the approved words by email, once; a failed send keeps the answer", async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const { service, emailEvents } = harness({
      mail: {
        available: true,
        send: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
      },
    });
    const input = {
      reasonCode: "TIMING" as const,
      message: "Not this year, thank you.",
      clientRequestId: "pass-0000002",
    };
    await service.pass(actor(ADMIN), GATEWAY, APP_PARTIAL, input);
    await service.pass(actor(ADMIN), GATEWAY, APP_PARTIAL, input);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("amara@sunline.example");
    expect(sent[0]?.text).toContain("Not this year, thank you.");
    // A reserved test domain reaches the sender (whose recording wrapper
    // stops it) and is reported SUPPRESSED, never SENT.
    expect(emailEvents).toEqual([
      {
        kind: "PASS",
        outcome: "SUPPRESSED",
        recipientDomain: "sunline.example",
      },
    ]);
    const failing = harness({
      mail: {
        available: true,
        send: () => Promise.reject(new Error("relay down")),
      },
    });
    expect(
      await failing.service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, {
        message: "Can you send the cap table?",
        clientRequestId: "reply-000001",
      }),
    ).toMatchObject({ ok: true, deduplicated: false });
    expect(failing.state.messages).toHaveLength(1);
    expect(failing.emailEvents[0]).toMatchObject({
      kind: "REPLY",
      outcome: "FAILED",
      recipientDomain: "sunline.example",
    });
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
    const pack = await service.pack(actor(MEMBER), GATEWAY, APP_FIT);
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

describe("the dossier in the inbox (GateQ slice 1)", () => {
  const dossier = {
    schemaVersion: "gateq-dossier.v1",
    generatedAt: "2026-10-05T09:00:00.000Z",
    application: {
      reference: "ga_0123456789abcdefghjkmnpqrs",
      submittedAt: "2026-10-05T09:00:00.000Z",
    },
    company: {
      name: "Sunline",
      description: null,
      website: null,
      country: "Nigeria",
      stage: "Seed",
      sectorPhrases: [],
      note: null,
    },
    contact: {
      name: "Amara Obi",
      email: "amara@confirmed.example",
      role: "CEO",
      companyName: "Sunline",
      phone: null,
      preferredChannel: "EMAIL",
      emailConfirmed: true,
      confirmedVia: "EMAIL_CODE",
    },
    qualification: {
      outcome: "QUALIFIED",
      access: "MAY_APPLY",
      criteria: [{ label: "Seed", requiredness: "REQUIRED", status: "MATCH" }],
    },
    dimensions: [],
    unknowns: [],
    declined: [],
    missing: [],
    contradictions: [],
    documents: [],
    diligenceQuestions: [],
    transcript: { turnCount: 2 },
    synthesis: null,
  };
  const transcript = [
    {
      seq: 1,
      role: "PERSON",
      text: "We help clinics get paid.",
      at: "2026-10-05T08:00:00.000Z",
    },
    {
      seq: 2,
      role: "Q",
      text: "Who pays you?",
      at: "2026-10-05T08:00:01.000Z",
    },
  ];

  it("shows the frozen dossier and transcript to the receiving organisation", async () => {
    const { service } = harness({ v2: { dossier, transcript } });
    const detail = await service.detail(actor(MEMBER), GATEWAY, APP_FIT);
    if (!("item" in detail)) throw new Error("refused");
    expect(detail.dossier?.company.name).toBe("Sunline");
    expect(detail.dossier?.synthesis).toBeNull();
    expect(detail.transcript?.map((t) => t.role)).toEqual(["PERSON", "Q"]);
    // The confirmed contact is the one the investor reaches.
    expect(detail.contact.email).toBe("amara@confirmed.example");
  });

  it("says plainly when Q's reading will not come, never 'not ready' forever (live D1)", async () => {
    const pending = harness({ v2: { dossier, transcript } });
    const waiting = await pending.service.detail(
      actor(MEMBER),
      GATEWAY,
      APP_FIT,
    );
    if (!("item" in waiting)) throw new Error("refused");
    expect(waiting.synthesis).toBeNull();
    expect(waiting.synthesisState).toBe("PENDING");

    const spent = harness({
      v2: { dossier, transcript },
      synthesisState: "UNAVAILABLE",
    });
    const failed = await spent.service.detail(actor(MEMBER), GATEWAY, APP_FIT);
    if (!("item" in failed)) throw new Error("refused");
    expect(failed.synthesis).toBeNull();
    expect(failed.synthesisState).toBe("UNAVAILABLE");
  });

  it("answers null for a submission made before dossiers existed", async () => {
    const { service } = harness();
    const detail = await service.detail(actor(MEMBER), GATEWAY, APP_PARTIAL);
    if (!("item" in detail)) throw new Error("refused");
    expect(detail.dossier).toBeNull();
    expect(detail.transcript).toBeNull();
    expect(detail.contact.email).toBe("amara@sunline.example");
  });

  it("never shows another gateway's dossier", async () => {
    const { service } = harness({ v2: { dossier, transcript } });
    expect(await service.detail(actor(ADMIN), OTHER_GATEWAY, APP_FIT)).toEqual({
      ok: false,
    });
  });
});

describe("emailing an applicant from the inbox (GateQ outbound)", () => {
  // A fake sender only: nothing in these tests reaches a provider, and every
  // address is on a reserved test domain.
  const fakeMail = () => {
    const sent: {
      to: string;
      subject: string;
      text: string;
      replyTo?: string | undefined;
    }[] = [];
    const mail: GateqOutboundSender = {
      available: true,
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    };
    return { sent, mail };
  };
  const sha = (text: string) =>
    createHash("sha256").update(text, "utf8").digest("hex");

  it("sends exactly the approved recipient, subject and words, and keeps them in the thread", async () => {
    const { sent, mail } = fakeMail();
    const { service, state } = harness({ mail });
    expect(
      await service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, {
        message: "Could you share a few times for a call?",
        clientRequestId: "reply-bind-0001",
        to: "Amara@Sunline.example",
        subject: "A call about Harvest",
      }),
    ).toEqual({ ok: true, changed: 1, deduplicated: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("amara@sunline.example");
    expect(sent[0]?.subject).toBe("A call about Harvest");
    expect(sent[0]?.text).toContain("Could you share a few times for a call?");
    expect(state.messages[0]).toMatchObject({
      subject: "A call about Harvest",
      recipientSha256: sha("amara@sunline.example"),
      approvedBy: ADMIN,
    });
    const detail = await service.detail(actor(ADMIN), GATEWAY, APP_PARTIAL);
    if (!("item" in detail)) throw new Error("refused");
    expect(detail.messages).toEqual([
      expect.objectContaining({
        kind: "REPLY",
        subject: "A call about Harvest",
        body: "Could you share a few times for a call?",
        // Reserved test domain: stopped before any provider, and said so.
        delivery: "SUPPRESSED",
      }),
    ]);
  });

  it("refuses a recipient that is no longer the application's contact: nothing recorded, nothing sent", async () => {
    const { sent, mail } = fakeMail();
    const { service, state } = harness({ mail });
    expect(
      await service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, {
        message: "Hello",
        clientRequestId: "reply-bind-0002",
        to: "someone-else@elsewhere.example",
      }),
    ).toEqual({ ok: false, reason: "RECIPIENT_CHANGED" });
    expect(state.messages).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("an edited body under an approved key is refused: an edit needs a new approval", async () => {
    const { sent, mail } = fakeMail();
    const { service, state } = harness({ mail });
    const approved = {
      message: "Thanks, we'll come back to you on Friday.",
      clientRequestId: "reply-edit-0001",
    };
    await service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, approved);
    expect(
      await service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, {
        ...approved,
        message: "Thanks, we'll invest.",
      }),
    ).toEqual({ ok: false, reason: "KEY_REUSED" });
    // The same approval replayed is idempotent: recorded once, sent once.
    expect(
      await service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, approved),
    ).toEqual({ ok: true, changed: 0, deduplicated: true });
    expect(state.messages.map((m) => m.body)).toEqual([approved.message]);
    expect(sent.map((m) => m.text.includes("we'll invest"))).toEqual([false]);
  });

  it("drafting and previewing send nothing; only an approved reply does", async () => {
    const { sent, mail } = fakeMail();
    const { service, state } = harness({ mail, replyTo: null });
    const draft = await service.draftReply(
      actor(ADMIN),
      GATEWAY,
      APP_PARTIAL,
      "ASK",
    );
    expect(draft).toMatchObject({ ok: true, purpose: "ASK" });
    if (!draft.ok) throw new Error("refused");
    expect(draft.message).toContain("Northbound Capital");
    expect(
      await service.outboundPreview(
        actor(ADMIN),
        GATEWAY,
        APP_PARTIAL,
        "REPLY",
      ),
    ).toEqual({
      ok: true,
      companyName: "Harvest",
      fund: "Northbound Capital",
      to: "amara@sunline.example",
      toName: "Amara Obi",
      subject: "Northbound Capital replied about Harvest",
      replyTo: null,
      deliverable: true,
    });
    expect(sent).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
  });

  it("only the gateway's own organisation members who may decide can email", async () => {
    const { sent, mail } = fakeMail();
    const { service, state } = harness({ mail });
    const input = { message: "Hello", clientRequestId: "reply-auth-0001" };
    // A member who may read but not decide, an outsider, another gateway.
    expect(
      await service.reply(actor(MEMBER), GATEWAY, APP_PARTIAL, input),
    ).toEqual({ ok: false });
    expect(
      await service.reply(actor(OUTSIDER), GATEWAY, APP_PARTIAL, input),
    ).toEqual({ ok: false });
    expect(
      await service.reply(actor(ADMIN), OTHER_GATEWAY, APP_PARTIAL, input),
    ).toEqual({ ok: false });
    expect(
      await service.reply(actor(ADMIN), GATEWAY, FOREIGN_APP, input),
    ).toEqual({ ok: false });
    expect(
      await service.outboundPreview(
        actor(MEMBER),
        GATEWAY,
        APP_PARTIAL,
        "REPLY",
      ),
    ).toEqual({ ok: false });
    expect(state.messages).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("rate-limits new answers, never a replay of one already recorded", async () => {
    const { sent, mail } = fakeMail();
    const { service } = harness({
      mail,
      limits: { perTenantPerHour: 2, perApplicationPerDay: 10 },
    });
    const first = { message: "One", clientRequestId: "reply-rate-0001" };
    await service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, first);
    await service.reply(actor(ADMIN), GATEWAY, APP_FIT, {
      message: "Two",
      clientRequestId: "reply-rate-0002",
    });
    expect(
      await service.reply(actor(ADMIN), GATEWAY, APP_NO, {
        message: "Three",
        clientRequestId: "reply-rate-0003",
      }),
    ).toEqual({ ok: false, reason: "RATE_LIMITED" });
    expect(
      await service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, first),
    ).toEqual({ ok: true, changed: 0, deduplicated: true });
    expect(sent).toHaveLength(2);
  });

  it("says where the applicant's answer goes: the member's Q address, or that replies don't reach the firm", async () => {
    const withQ = fakeMail();
    await harness({
      mail: withQ.mail,
      replyTo: "q+token@inbound.capitalq.test",
    }).service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, {
      message: "Hello",
      clientRequestId: "reply-to-00001",
    });
    expect(withQ.sent[0]?.replyTo).toBe("q+token@inbound.capitalq.test");
    expect(withQ.sent[0]?.text).toContain(
      "Reply to this email to answer Northbound Capital directly.",
    );
    expect(withQ.sent[0]?.text).toContain("not a mailing list");

    const without = fakeMail();
    await harness({ mail: without.mail }).service.reply(
      actor(ADMIN),
      GATEWAY,
      APP_PARTIAL,
      { message: "Hello", clientRequestId: "reply-to-00002" },
    );
    expect(without.sent[0]?.replyTo).toBeUndefined();
    expect(without.sent[0]?.text).toContain(
      "Replies to this email don't reach Northbound Capital.",
    );
  });

  it("records an email that could not go, and keeps the answer", async () => {
    const { service } = harness({
      mail: { available: false, send: () => Promise.resolve() },
    });
    await service.reply(actor(ADMIN), GATEWAY, APP_PARTIAL, {
      message: "Hello",
      clientRequestId: "reply-none-0001",
    });
    const detail = await service.detail(actor(ADMIN), GATEWAY, APP_PARTIAL);
    if (!("item" in detail)) throw new Error("refused");
    expect(detail.messages[0]?.delivery).toBe("UNAVAILABLE");
  });
});
