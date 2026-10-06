import { createHash } from "node:crypto";

import {
  GATEQ_INBOX_VIEWS,
  GateqPassReasonSchema,
  type GateqInboxDetailDto,
  type GateqInboxDto,
  type GateqInboxItemDto,
  type GateqInboxView,
  type GateqMemberDto,
  type GateqPassReason,
} from "@capital-q/contracts";
import type { TransactionManager } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  draftPassMessage,
  fitBandOf,
  inboxOrder,
  initialsOf,
  inView,
  moneyWords,
  profileOf,
  readQualification,
  readSnapshot,
  replyPromise,
  rulesOf,
  suggestedReason,
  triage,
  type TriageProposal,
} from "./domain.js";
import { buildPack, packFileName, type PackFile } from "./pack.js";
import type {
  InboxActivityKind,
  InboxAuthority,
  InboxGateway,
  InboxRepository,
  InboxRow,
  SharedDocumentPort,
} from "./ports.js";
import {
  renderGateqAnswerEmail,
  sendLogged,
  type GateqEmailEvent,
  type GateqOutboundSender,
} from "./founder-mail.js";

/**
 * F4: the investor's GateQ inbox.
 *
 * Every operation starts with GateQ's own authority over the gateway: a
 * gateway that is not the caller's organisation's is the same refusal as
 * none, and every application id is checked to have been submitted to that
 * gateway before anything is read or changed. Reading, starring, labelling,
 * notes and the pack need investor.gateway.view; replying, passing,
 * assigning and changing the promise need investor.gateway.edit.
 *
 * What a person sends a founder is what they approved, word for word: a
 * pass or a reply carries the exact text and its digest, under the
 * caller's own idempotency key. Q may draft; it never sends on its own.
 */

/** A refusal is one shape whatever the reason: no oracle for what exists. */
export type InboxRefused = { readonly ok: false };
const REFUSED: InboxRefused = { ok: false };

export type InboxChanged = {
  readonly ok: true;
  readonly changed: number;
  readonly deduplicated: boolean;
};

const ACTIVITY_WORDS: Readonly<Record<InboxActivityKind, string>> = {
  ASSIGNED: "Assigned to",
  UNASSIGNED: "Unassigned",
  LABELLED: "Labelled",
  UNLABELLED: "Label removed",
  ARCHIVED: "Archived",
  RESTORED: "Moved back to the inbox",
  PASSED: "Passed, with a reason",
  REPLIED: "Replied",
  NOTED: "Team note added",
  PACK_DOWNLOADED: "Pack downloaded",
};

export function createInboxService(dependencies: {
  readonly repository: InboxRepository;
  readonly authority: InboxAuthority;
  readonly transactions: TransactionManager;
  readonly documents?: SharedDocumentPort | undefined;
  readonly clock?: (() => Date) | undefined;
  /** P14: the founder hears a pass or a reply by email (after commit). */
  readonly founderMail?: GateqOutboundSender | undefined;
  readonly onEmail?: ((event: GateqEmailEvent) => void) | undefined;
}) {
  const { repository, authority, transactions } = dependencies;

  /**
   * P14: after the answer committed, the founder's contact (from what they
   * submitted) gets the approved words. A failed send never undoes the
   * answer; it is logged with the recipient's domain only.
   */
  const mailFounder = async (
    actor: ActorContext,
    gateway: {
      readonly tenantId: string;
      readonly gatewayId: string;
      readonly fund: string;
    },
    applicationId: string,
    kind: "PASS" | "REPLY",
    body: string,
  ): Promise<void> => {
    if (dependencies.founderMail === undefined) return;
    const row = await repository
      .one({
        tenantId: gateway.tenantId,
        gatewayId: gateway.gatewayId,
        userId: actor.userId,
        applicationId,
      })
      .catch(() => null);
    if (row === null) return;
    const submitted = readSnapshot(row.snapshot);
    const profile = profileOf(submitted);
    const rendered = renderGateqAnswerEmail({
      kind,
      fund: gateway.fund,
      companyName: profile.companyName,
      reference: submitted.reference === "" ? null : submitted.reference,
      body,
    });
    await sendLogged(
      dependencies.founderMail,
      dependencies.onEmail,
      kind,
      profile.contactEmail,
      {
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        fromName: `${gateway.fund} via Capital Q`,
      },
    );
  };
  const clock = dependencies.clock ?? (() => new Date());

  const memberDto = (member: {
    userId: string;
    name: string;
  }): GateqMemberDto => ({
    userId: member.userId,
    name: member.name,
    initials: initialsOf(member.name),
  });

  const itemOf = (
    row: InboxRow,
    replyWithinDays: number | null,
    members: ReadonlyMap<string, GateqMemberDto>,
  ): GateqInboxItemDto => {
    const submitted = readSnapshot(row.snapshot);
    const read = readQualification(row.qualification);
    const profile = profileOf(submitted);
    const promise = replyPromise({
      submittedAt: new Date(row.submittedAt),
      replyWithinDays,
      answered: row.answered || row.folder === "PASSED",
      now: clock(),
    });
    return {
      applicationId: row.applicationId,
      reference: submitted.reference,
      companyName: profile.companyName,
      oneLiner: profile.oneLiner,
      stage: profile.stage,
      sector: profile.sector,
      country: profile.country,
      raise: profile.raise,
      fit: fitBandOf(read),
      rules: rulesOf(read),
      starred: row.starred,
      unread: row.readAt === null,
      labels: [...row.labels],
      assignee:
        row.assigneeUserId === null
          ? null
          : (members.get(row.assigneeUserId) ?? {
              userId: row.assigneeUserId,
              name: "A former member",
              initials: "?",
            }),
      folder: row.folder,
      replyBy: promise.replyBy,
      replyState: promise.state,
      daysLeft: promise.daysLeft,
      submittedAt: row.submittedAt,
    };
  };

  const membersOf = async (gateway: InboxGateway) => {
    const members = await repository.members({
      tenantId: gateway.tenantId,
      organisationId: gateway.organisationId,
    });
    return members.map(memberDto);
  };

  /** Authorise, then keep only ids submitted to this very gateway. */
  const scoped = async (
    actor: ActorContext,
    gatewayId: string,
    applicationIds: readonly string[],
    needs: "VIEW" | "DECIDE",
  ) => {
    const granted = await authority.authorise(actor, gatewayId);
    if (granted === null) return null;
    if (needs === "DECIDE" && !granted.canDecide) return null;
    const ids = await repository.submittedAmong({
      tenantId: granted.gateway.tenantId,
      gatewayId: granted.gateway.gatewayId,
      applicationIds: [...new Set(applicationIds)],
    });
    // All or nothing: one foreign id refuses the whole request.
    if (ids.length !== new Set(applicationIds).size) return null;
    return { ...granted, ids };
  };

  const digest = (text: string) =>
    createHash("sha256").update(text, "utf8").digest("hex");

  return {
    list: async (
      actor: ActorContext,
      gatewayId: string,
      view: GateqInboxView,
    ): Promise<GateqInboxDto | InboxRefused> => {
      const granted = await authority.authorise(actor, gatewayId);
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      const [rows, replyWithinDays, members, labels] = await Promise.all([
        repository.list({
          tenantId: gateway.tenantId,
          gatewayId: gateway.gatewayId,
          userId: actor.userId,
        }),
        repository.replyWithinDays(gateway.gatewayId),
        membersOf(gateway),
        repository.labels(gateway.gatewayId),
      ]);
      const byId = new Map(members.map((m) => [m.userId, m]));
      const items = rows
        .map((row) => itemOf(row, replyWithinDays, byId))
        .sort(inboxOrder);
      const counts = Object.fromEntries(
        GATEQ_INBOX_VIEWS.map((v) => [
          v,
          items.filter(
            (item) =>
              inView(item, v, actor.userId) &&
              // The Inbox count is what is still to read, as a mail client counts.
              (v !== "INBOX" || item.unread),
          ).length,
        ]),
      ) as Record<GateqInboxView, number>;
      return {
        gateway: {
          id: gateway.gatewayId,
          name: gateway.name,
          publicId: gateway.publicId,
          replyWithinDays,
        },
        viewer: {
          userId: actor.userId,
          canDecide: granted.canDecide,
          solo: members.length <= 1,
        },
        view,
        counts,
        items: items
          .filter((item) => inView(item, view, actor.userId))
          .slice(0, 200),
        labels: [...labels],
        members,
      };
    },

    detail: async (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
    ): Promise<GateqInboxDetailDto | InboxRefused> => {
      const granted = await authority.authorise(actor, gatewayId);
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      const row = await repository.one({
        tenantId: gateway.tenantId,
        gatewayId: gateway.gatewayId,
        userId: actor.userId,
        applicationId,
      });
      if (row === null) return REFUSED;
      const [replyWithinDays, members, notes, messages, activity] =
        await Promise.all([
          repository.replyWithinDays(gateway.gatewayId),
          membersOf(gateway),
          repository.notes(applicationId),
          repository.messages(applicationId),
          repository.activity(applicationId),
        ]);
      // Opening it is reading it; a mail client's unread mark is per person.
      if (row.readAt === null) {
        await repository.markRead({
          tenantId: gateway.tenantId,
          userId: actor.userId,
          applicationId,
          at: clock().toISOString(),
        });
      }
      const byId = new Map(members.map((m) => [m.userId, m]));
      const submitted = readSnapshot(row.snapshot);
      const read = readQualification(row.qualification);
      const profile = profileOf(submitted);
      const titles =
        dependencies.documents === undefined ||
        submitted.documentIds.length === 0
          ? new Map<string, string>()
          : await dependencies.documents
              .titles(submitted.documentIds)
              .catch(() => new Map<string, string>());
      const answers: { label: string; value: string }[] = [];
      const add = (label: string, value: string | null) => {
        if (value !== null) answers.push({ label, value });
      };
      add("Stage", profile.stage);
      add("Sector", profile.sector);
      add("Based in", profile.country);
      add("Raising", profile.raise === null ? null : moneyWords(profile.raise));
      add("Instrument", profile.instrument);
      add("Lead investor", profile.lead);
      add("Website", profile.website);
      return {
        item: { ...itemOf(row, replyWithinDays, byId), unread: false },
        rules: read.criteria
          .filter((c) => c.status !== "NOT_APPLICABLE")
          .map((c) => ({
            label: c.label,
            dimension: c.dimension,
            required: c.required,
            standing:
              c.status === "MATCH"
                ? ("MEETS" as const)
                : c.status === "NO_MATCH"
                  ? ("DOES_NOT_MEET" as const)
                  : ("NOT_ANSWERED" as const),
          })),
        answers,
        note: profile.note,
        contact: { name: profile.contactName, email: profile.contactEmail },
        shared: submitted.documentIds.map((documentId) => ({
          documentId,
          title: titles.get(documentId) ?? "Shared document",
        })),
        notes: notes.map((note) => ({
          id: note.id,
          author:
            byId.get(note.authorUserId) ??
            memberDto({ userId: note.authorUserId, name: note.authorName }),
          body: note.body,
          createdAt: note.createdAt,
        })),
        activity: [
          { at: row.submittedAt, text: `Applied through ${gateway.name}` },
          ...activity.map((entry) => ({
            at: entry.createdAt,
            text: [
              ACTIVITY_WORDS[entry.kind],
              typeof entry.detail["name"] === "string"
                ? entry.detail["name"]
                : null,
              entry.actorName === null ? null : `by ${entry.actorName}`,
            ]
              .filter((part) => part !== null)
              .join(" "),
          })),
        ],
        messages: messages.map((message) => ({
          kind: message.kind,
          reasonCode:
            GateqPassReasonSchema.safeParse(message.reasonCode).data ?? null,
          body: message.body,
          at: message.createdAt,
        })),
      } satisfies GateqInboxDetailDto;
    },

    star: async (
      actor: ActorContext,
      gatewayId: string,
      input: {
        readonly applicationIds: readonly string[];
        readonly starred: boolean;
      },
    ): Promise<InboxChanged | InboxRefused> => {
      const granted = await scoped(
        actor,
        gatewayId,
        input.applicationIds,
        "VIEW",
      );
      if (granted === null) return REFUSED;
      await repository.setStar({
        tenantId: granted.gateway.tenantId,
        userId: actor.userId,
        applicationIds: granted.ids,
        starred: input.starred,
      });
      return { ok: true, changed: granted.ids.length, deduplicated: false };
    },

    archive: async (
      actor: ActorContext,
      gatewayId: string,
      input: {
        readonly applicationIds: readonly string[];
        readonly archived: boolean;
      },
    ): Promise<InboxChanged | InboxRefused> => {
      const granted = await scoped(
        actor,
        gatewayId,
        input.applicationIds,
        "VIEW",
      );
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      await transactions.run(async (tx) => {
        await repository.setFolder(tx, {
          tenantId: gateway.tenantId,
          gatewayId: gateway.gatewayId,
          applicationIds: granted.ids,
          folder: input.archived ? "ARCHIVED" : "INBOX",
        });
        for (const applicationId of granted.ids) {
          await repository.record(tx, {
            applicationId,
            tenantId: gateway.tenantId,
            actorUserId: actor.userId,
            kind: input.archived ? "ARCHIVED" : "RESTORED",
            detail: {},
          });
        }
      });
      return { ok: true, changed: granted.ids.length, deduplicated: false };
    },

    label: async (
      actor: ActorContext,
      gatewayId: string,
      input: {
        readonly applicationIds: readonly string[];
        readonly label: string;
        readonly on: boolean;
      },
    ): Promise<InboxChanged | InboxRefused> => {
      const granted = await scoped(
        actor,
        gatewayId,
        input.applicationIds,
        "VIEW",
      );
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      const label = input.label.trim().replace(/\s+/g, " ");
      await transactions.run(async (tx) => {
        await repository.setLabel(tx, {
          tenantId: gateway.tenantId,
          gatewayId: gateway.gatewayId,
          applicationIds: granted.ids,
          label,
          on: input.on,
          userId: actor.userId,
        });
        for (const applicationId of granted.ids) {
          await repository.record(tx, {
            applicationId,
            tenantId: gateway.tenantId,
            actorUserId: actor.userId,
            kind: input.on ? "LABELLED" : "UNLABELLED",
            detail: { name: label },
          });
        }
      });
      return { ok: true, changed: granted.ids.length, deduplicated: false };
    },

    assign: async (
      actor: ActorContext,
      gatewayId: string,
      input: {
        readonly applicationIds: readonly string[];
        readonly assigneeUserId: string | null;
      },
    ): Promise<InboxChanged | InboxRefused> => {
      const granted = await scoped(
        actor,
        gatewayId,
        input.applicationIds,
        "DECIDE",
      );
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      const members = await membersOf(gateway);
      const assignee =
        input.assigneeUserId === null
          ? null
          : (members.find((m) => m.userId === input.assigneeUserId) ?? null);
      // Only a member of the gateway's own organisation can be given one:
      // assigning outside it would hand a founder's application to a stranger.
      if (input.assigneeUserId !== null && assignee === null) return REFUSED;
      await transactions.run(async (tx) => {
        await repository.setAssignee(tx, {
          tenantId: gateway.tenantId,
          gatewayId: gateway.gatewayId,
          applicationIds: granted.ids,
          assigneeUserId: input.assigneeUserId,
        });
        for (const applicationId of granted.ids) {
          await repository.record(tx, {
            applicationId,
            tenantId: gateway.tenantId,
            actorUserId: actor.userId,
            kind: assignee === null ? "UNASSIGNED" : "ASSIGNED",
            detail: assignee === null ? {} : { name: assignee.name },
          });
        }
      });
      return { ok: true, changed: granted.ids.length, deduplicated: false };
    },

    note: async (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
      input: { readonly body: string; readonly clientRequestId: string },
    ): Promise<InboxChanged | InboxRefused> => {
      const granted = await scoped(actor, gatewayId, [applicationId], "VIEW");
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      const result = await transactions.run(async (tx) => {
        const added = await repository.addNote(tx, {
          tenantId: gateway.tenantId,
          applicationId,
          authorUserId: actor.userId,
          body: input.body.trim(),
          clientRequestId: input.clientRequestId,
        });
        if (!added.deduplicated) {
          await repository.record(tx, {
            applicationId,
            tenantId: gateway.tenantId,
            actorUserId: actor.userId,
            kind: "NOTED",
            detail: {},
          });
        }
        return added;
      });
      return {
        ok: true,
        changed: result.deduplicated ? 0 : 1,
        deduplicated: result.deduplicated,
      };
    },

    /**
     * Pass, with a reason, sending exactly the approved words. Consequential:
     * the screen's Send press or an approved card is the approval.
     */
    pass: async (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
      input: {
        readonly reasonCode: GateqPassReason;
        readonly message: string;
        readonly clientRequestId: string;
      },
    ): Promise<InboxChanged | InboxRefused> => {
      const granted = await scoped(actor, gatewayId, [applicationId], "DECIDE");
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      const body = input.message.trim();
      const result = await transactions.run(async (tx) => {
        const added = await repository.addMessage(tx, {
          tenantId: gateway.tenantId,
          applicationId,
          kind: "PASS",
          reasonCode: input.reasonCode,
          body,
          bodySha256: digest(body),
          approvedByUserId: actor.userId,
          clientRequestId: input.clientRequestId,
        });
        if (!added.deduplicated) {
          await repository.setFolder(tx, {
            tenantId: gateway.tenantId,
            gatewayId: gateway.gatewayId,
            applicationIds: [applicationId],
            folder: "PASSED",
          });
          await repository.record(tx, {
            applicationId,
            tenantId: gateway.tenantId,
            actorUserId: actor.userId,
            kind: "PASSED",
            detail: { reason: input.reasonCode },
          });
        }
        return added;
      });
      if (!result.deduplicated) {
        await mailFounder(actor, gateway, applicationId, "PASS", body);
      }
      return {
        ok: true,
        changed: result.deduplicated ? 0 : 1,
        deduplicated: result.deduplicated,
      };
    },

    reply: async (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
      input: { readonly message: string; readonly clientRequestId: string },
    ): Promise<InboxChanged | InboxRefused> => {
      const granted = await scoped(actor, gatewayId, [applicationId], "DECIDE");
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      const body = input.message.trim();
      const result = await transactions.run(async (tx) => {
        const added = await repository.addMessage(tx, {
          tenantId: gateway.tenantId,
          applicationId,
          kind: "REPLY",
          reasonCode: null,
          body,
          bodySha256: digest(body),
          approvedByUserId: actor.userId,
          clientRequestId: input.clientRequestId,
        });
        if (!added.deduplicated) {
          await repository.record(tx, {
            applicationId,
            tenantId: gateway.tenantId,
            actorUserId: actor.userId,
            kind: "REPLIED",
            detail: {},
          });
        }
        return added;
      });
      if (!result.deduplicated) {
        await mailFounder(actor, gateway, applicationId, "REPLY", body);
      }
      return {
        ok: true,
        changed: result.deduplicated ? 0 : 1,
        deduplicated: result.deduplicated,
      };
    },

    setReplyPromise: async (
      actor: ActorContext,
      gatewayId: string,
      input: { readonly replyWithinDays: number | null },
    ): Promise<InboxChanged | InboxRefused> => {
      const granted = await authority.authorise(actor, gatewayId);
      if (granted === null || !granted.canDecide) return REFUSED;
      await transactions.run((tx) =>
        repository.setReplyWithinDays(tx, {
          tenantId: granted.gateway.tenantId,
          gatewayId: granted.gateway.gatewayId,
          replyWithinDays: input.replyWithinDays,
          userId: actor.userId,
        }),
      );
      return { ok: true, changed: 1, deduplicated: false };
    },

    /** A first draft of a pass for a person to edit and approve. Never sent here. */
    draftPass: async (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
      reason?: GateqPassReason,
    ): Promise<
      | {
          readonly ok: true;
          readonly reasonCode: GateqPassReason;
          readonly message: string;
          readonly companyName: string;
        }
      | InboxRefused
    > => {
      const granted = await authority.authorise(actor, gatewayId);
      if (granted === null) return REFUSED;
      const row = await repository.one({
        tenantId: granted.gateway.tenantId,
        gatewayId: granted.gateway.gatewayId,
        userId: actor.userId,
        applicationId,
      });
      if (row === null) return REFUSED;
      const profile = profileOf(readSnapshot(row.snapshot));
      const reasonCode =
        reason ?? suggestedReason(readQualification(row.qualification));
      return {
        ok: true,
        reasonCode,
        companyName: profile.companyName,
        message: draftPassMessage({
          founderName: profile.contactName,
          companyName: profile.companyName,
          fund: granted.gateway.fund,
          reason: reasonCode,
        }),
      };
    },

    /** For Q, which has no screen: an application by the company's name as said. */
    findApplication: async (
      actor: ActorContext,
      gatewayId: string,
      companyName: string,
    ): Promise<
      | { readonly applicationId: string; readonly companyName: string }
      | { readonly ambiguous: readonly string[] }
      | null
    > => {
      const granted = await authority.authorise(actor, gatewayId);
      if (granted === null) return null;
      const rows = await repository.list({
        tenantId: granted.gateway.tenantId,
        gatewayId: granted.gateway.gatewayId,
        userId: actor.userId,
      });
      const wanted = companyName.trim().toLowerCase();
      const named = rows.map((row) => ({
        applicationId: row.applicationId,
        companyName: profileOf(readSnapshot(row.snapshot)).companyName,
      }));
      const exact = named.filter((n) => n.companyName.toLowerCase() === wanted);
      const loose =
        exact.length > 0
          ? exact
          : named.filter(
              (n) =>
                n.companyName.toLowerCase().includes(wanted) ||
                wanted.includes(n.companyName.toLowerCase()),
            );
      if (loose.length === 1) return loose[0] ?? null;
      if (loose.length > 1)
        return { ambiguous: loose.map((n) => n.companyName).slice(0, 5) };
      return null;
    },

    findMember: async (
      actor: ActorContext,
      gatewayId: string,
      name: string,
    ): Promise<string | null> => {
      const granted = await authority.authorise(actor, gatewayId);
      if (granted === null) return null;
      const wanted = name.trim().toLowerCase();
      const members = await membersOf(granted.gateway);
      const matches = members.filter(
        (m) =>
          m.name.toLowerCase() === wanted ||
          m.name.toLowerCase().split(/\s+/)[0] === wanted,
      );
      return matches.length === 1 ? (matches[0]?.userId ?? null) : null;
    },

    /** Q's triage: proposals for a person to accept, one by one or together. */
    triage: async (
      actor: ActorContext,
      gatewayId: string,
    ): Promise<
      | { readonly ok: true; readonly proposals: readonly TriageProposal[] }
      | InboxRefused
    > => {
      const granted = await authority.authorise(actor, gatewayId);
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      const [rows, replyWithinDays] = await Promise.all([
        repository.list({
          tenantId: gateway.tenantId,
          gatewayId: gateway.gatewayId,
          userId: actor.userId,
        }),
        repository.replyWithinDays(gateway.gatewayId),
      ]);
      const members = new Map<string, GateqMemberDto>();
      return {
        ok: true,
        proposals: triage(
          rows
            .map((row) => ({
              ...itemOf(row, replyWithinDays, members),
              read: readQualification(row.qualification),
            }))
            .sort(inboxOrder),
        ),
      };
    },

    /**
     * The download pack: only what the founder sent, never the
     * organisation's own notes, labels or messages. Audited as it is built.
     */
    pack: async (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
    ): Promise<
      | {
          readonly ok: true;
          readonly fileName: string;
          readonly bytes: Uint8Array;
        }
      | InboxRefused
    > => {
      const granted = await authority.authorise(actor, gatewayId);
      if (granted === null) return REFUSED;
      const { gateway } = granted;
      const row = await repository.one({
        tenantId: gateway.tenantId,
        gatewayId: gateway.gatewayId,
        userId: actor.userId,
        applicationId,
      });
      if (row === null) return REFUSED;
      const submitted = readSnapshot(row.snapshot);
      const read = readQualification(row.qualification);
      const profile = profileOf(submitted);
      // Every page names who downloaded it.
      const downloadedBy =
        (await membersOf(gateway)).find((m) => m.userId === actor.userId)
          ?.name ?? `a member of ${gateway.fund}`;
      const shared: PackFile[] = [];
      const omitted: string[] = [];
      // Only the ids the frozen submission names: nothing else can be asked for.
      for (const documentId of submitted.documentIds) {
        const file = await dependencies.documents
          ?.file(documentId)
          .catch(() => null);
        if (file === undefined || file === null) {
          omitted.push("A shared document: no longer available");
        } else if (file.bytes === null) {
          omitted.push(`${file.title}: ${file.why ?? "view only"}`);
        } else {
          shared.push({ name: file.fileName, bytes: file.bytes });
        }
      }
      const now = clock().toISOString();
      const bytes = buildPack({
        companyName: profile.companyName,
        reference: submitted.reference,
        submittedAt: row.submittedAt,
        downloadedBy,
        downloadedAt: now,
        fund: gateway.fund,
        summaryLines: [
          profile.oneLiner ?? "",
          [
            profile.stage,
            profile.sector,
            profile.country,
            profile.raise === null
              ? null
              : `raising ${moneyWords(profile.raise)}`,
            profile.instrument,
            profile.lead,
          ]
            .filter((part) => part !== null && part !== "")
            .join(" · "),
          profile.note === null ? "" : `Their note: "${profile.note}"`,
          [profile.contactName, profile.contactEmail]
            .filter((p) => p !== null)
            .join(", "),
        ].filter((line) => line !== ""),
        answers: {
          company: profile.companyName,
          oneLiner: profile.oneLiner,
          stage: profile.stage,
          sector: profile.sector,
          country: profile.country,
          raise:
            profile.raise === null
              ? null
              : `${profile.raise.amount} ${profile.raise.currency}`,
          instrument: profile.instrument,
          lead: profile.lead,
          website: profile.website,
          note: profile.note,
          contactName: profile.contactName,
          contactEmail: profile.contactEmail,
        },
        rules: read.criteria
          .filter((c) => c.status !== "NOT_APPLICABLE")
          .map((c) => ({
            label: c.label,
            standing:
              c.status === "MATCH"
                ? "Meets"
                : c.status === "NO_MATCH"
                  ? "Doesn't meet"
                  : "Not answered",
          })),
        shared,
        omitted,
      });
      await repository.recordNow({
        applicationId,
        tenantId: gateway.tenantId,
        actorUserId: actor.userId,
        kind: "PACK_DOWNLOADED",
        detail: { files: shared.length },
      });
      return {
        ok: true,
        fileName: packFileName(profile.companyName, now),
        bytes,
      };
    },
  };
}

export type InboxService = ReturnType<typeof createInboxService>;
