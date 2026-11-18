import { createHash } from "node:crypto";

import {
  ApplicationTranscriptTurnDtoSchema,
  GATEQ_INBOX_VIEWS,
  GATEQ_TRANSCRIPT_MAX_TURNS,
  GATEQ_UNRESOLVED_WORDS,
  GateqDossierSchema,
  gateqDossierAsReadNow,
  GateqSynthesisSchema,
  GateqPassReasonSchema,
  gateqAnswerSubject,
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
  draftReplyMessage,
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
  type GateqReplyPurpose,
  type TriageProposal,
} from "./domain.js";
import { withDerivedAmountsMarked } from "../application/dossier.js";
import { withSettledGaps } from "../application/statement-words.js";
import { amountWords } from "../application/stated-amount.js";
import { buildPack, packFileName, type PackFile } from "./pack.js";
import type {
  InboxActivityKind,
  InboxAuthority,
  InboxGateway,
  InboxRepository,
  InboxRow,
  SharedDocumentPort,
  SubmittedDocumentReading,
  SubmittedDocumentTextPort,
} from "./ports.js";
import {
  recipientDomain,
  renderGateqAnswerEmail,
  sendReported,
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

/**
 * An answer to an applicant that was not sent, and why. Only ever after the
 * gateway and application were authorised: no oracle for what exists.
 */
export type InboxAnswerRefused = {
  readonly ok: false;
  readonly reason: "RECIPIENT_CHANGED" | "KEY_REUSED" | "RATE_LIMITED";
};
export type InboxAnswered = InboxChanged | InboxRefused | InboxAnswerRefused;

/** What an answer would carry besides its words; for a card or the screen. */
export type OutboundPreview = {
  readonly ok: true;
  readonly companyName: string;
  readonly fund: string;
  readonly to: string | null;
  readonly toName: string | null;
  readonly subject: string;
  readonly replyTo: string | null;
  /** False: no contact email, or no email service here. */
  readonly deliverable: boolean;
};

/**
 * Bounds on email to applicants: a firm's answers per hour, and answers to
 * one application per day. Enough for a busy inbox; a stop for a runaway
 * loop or a mistaken bulk send.
 */
export type GateqOutboundLimits = {
  readonly perTenantPerHour: number;
  readonly perApplicationPerDay: number;
};
export const GATEQ_OUTBOUND_LIMITS: GateqOutboundLimits = {
  perTenantPerHour: 60,
  perApplicationPerDay: 10,
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
  /** The submitted documents' text, for Q's reading of one application. */
  readonly documentText?: SubmittedDocumentTextPort | undefined;
  readonly clock?: (() => Date) | undefined;
  /** P14: the founder hears a pass or a reply by email (after commit). */
  readonly founderMail?: GateqOutboundSender | undefined;
  readonly onEmail?: ((event: GateqEmailEvent) => void) | undefined;
  /**
   * Where an applicant's answer to an email goes: the approving member's own
   * Q address (inbound email), when they have one. Null or absent: no
   * Reply-To, and the email says replies don't reach the firm.
   */
  readonly replyToFor?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  /** Outbound bounds; the defaults are GATEQ_OUTBOUND_LIMITS. */
  readonly outboundLimits?: GateqOutboundLimits | undefined;
}) {
  const { repository, authority, transactions } = dependencies;
  const limits = dependencies.outboundLimits ?? GATEQ_OUTBOUND_LIMITS;

  /**
   * P14: after the answer committed, the founder's contact (the one the
   * person approved it for) gets the approved words under the approved
   * subject, and the outcome is recorded against the message. A failed send
   * never undoes the answer and is never retried on its own; the log holds
   * the recipient's domain only.
   */
  const mailFounder = async (
    actor: ActorContext,
    gateway: InboxGateway,
    message: {
      readonly messageId: string;
      readonly applicationId: string;
      readonly kind: "PASS" | "REPLY";
      readonly body: string;
      readonly subject: string;
      readonly to: string | null;
      readonly companyName: string;
      readonly reference: string | null;
    },
  ): Promise<void> => {
    if (dependencies.founderMail === undefined) return;
    const replyTo =
      dependencies.replyToFor === undefined
        ? null
        : await dependencies.replyToFor(actor).catch(() => null);
    const rendered = renderGateqAnswerEmail({
      kind: message.kind,
      fund: gateway.fund,
      companyName: message.companyName,
      reference: message.reference,
      body: message.body,
      subject: message.subject,
      repliesReachFirm: replyTo !== null,
    });
    const outcome = await sendReported(
      dependencies.founderMail,
      dependencies.onEmail,
      message.kind,
      message.to,
      {
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        fromName: `${gateway.fund} via Capital Q`,
        ...(replyTo === null ? {} : { replyTo }),
      },
    );
    await repository
      .recordDelivery({
        messageId: message.messageId,
        applicationId: message.applicationId,
        tenantId: gateway.tenantId,
        outcome,
        recipientDomain:
          message.to === null ? null : recipientDomain(message.to),
      })
      .catch(() => undefined);
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
      // The list preview is bounded; the frozen dossier retains the full claim.
      oneLiner:
        profile.oneLiner !== null && profile.oneLiner.length > 280
          ? `${profile.oneLiner.slice(0, 279)}…`
          : profile.oneLiner,
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

  /** Who an answer goes to: the same contact the detail screen shows. */
  const founderOf = (row: InboxRow) => {
    const submitted = readSnapshot(row.snapshot);
    const profile = profileOf(submitted);
    const dossier = GateqDossierSchema.safeParse(row.dossier ?? null);
    const contact =
      dossier.success && dossier.data.contact !== null
        ? {
            name: dossier.data.contact.name,
            email: dossier.data.contact.email,
          }
        : { name: profile.contactName, email: profile.contactEmail };
    const email =
      contact.email === null || contact.email.trim() === ""
        ? null
        : contact.email.trim();
    return {
      name: contact.name,
      email,
      companyName: profile.companyName,
      reference: submitted.reference === "" ? null : submitted.reference,
    };
  };

  /**
   * A pass or a reply: the exact words, subject and recipient a person who
   * may decide approved, recorded once under their key, then emailed once.
   *
   *   - a recipient the person approved that is no longer the application's
   *     contact is refused (RECIPIENT_CHANGED): they approve again;
   *   - the same key with different words is refused (KEY_REUSED): an edit
   *     is a new approval, never a silent replay of the old one;
   *   - a new answer beyond the tenant's hourly or the application's daily
   *     bound is refused (RATE_LIMITED); a replay of a recorded key is not.
   */
  const answer = async (
    actor: ActorContext,
    gatewayId: string,
    applicationId: string,
    kind: "PASS" | "REPLY",
    input: {
      readonly reasonCode: GateqPassReason | null;
      readonly message: string;
      readonly clientRequestId: string;
      readonly to?: string | undefined;
      readonly subject?: string | undefined;
    },
  ): Promise<InboxAnswered> => {
    const granted = await scoped(actor, gatewayId, [applicationId], "DECIDE");
    if (granted === null) return REFUSED;
    const { gateway } = granted;
    const row = await repository.one({
      tenantId: gateway.tenantId,
      gatewayId: gateway.gatewayId,
      userId: actor.userId,
      applicationId,
    });
    if (row === null) return REFUSED;
    const founder = founderOf(row);
    if (
      input.to !== undefined &&
      input.to.trim().toLowerCase() !== (founder.email ?? "").toLowerCase()
    ) {
      return { ok: false, reason: "RECIPIENT_CHANGED" };
    }
    const body = input.message.trim();
    const bodySha256 = digest(body);
    const subject =
      input.subject?.trim() ??
      gateqAnswerSubject({
        kind,
        fund: gateway.fund,
        companyName: founder.companyName,
      });
    const counts = await repository.outboundCounts({
      tenantId: gateway.tenantId,
      applicationId,
      clientRequestId: input.clientRequestId,
      now: clock(),
    });
    if (
      !counts.alreadyRecorded &&
      (counts.tenantLastHour >= limits.perTenantPerHour ||
        counts.applicationLastDay >= limits.perApplicationPerDay)
    ) {
      return { ok: false, reason: "RATE_LIMITED" };
    }
    const added = await transactions.run(async (tx) => {
      const recorded = await repository.addMessage(tx, {
        tenantId: gateway.tenantId,
        applicationId,
        kind,
        reasonCode: input.reasonCode,
        body,
        bodySha256,
        approvedByUserId: actor.userId,
        clientRequestId: input.clientRequestId,
        subject,
        recipientSha256:
          founder.email === null ? null : digest(founder.email.toLowerCase()),
      });
      if (!recorded.deduplicated) {
        if (kind === "PASS") {
          await repository.setFolder(tx, {
            tenantId: gateway.tenantId,
            gatewayId: gateway.gatewayId,
            applicationIds: [applicationId],
            folder: "PASSED",
          });
        }
        await repository.record(tx, {
          applicationId,
          tenantId: gateway.tenantId,
          actorUserId: actor.userId,
          kind: kind === "PASS" ? "PASSED" : "REPLIED",
          detail:
            kind === "PASS" && input.reasonCode !== null
              ? { reason: input.reasonCode }
              : {},
        });
      }
      return recorded;
    });
    if (added.deduplicated) {
      return added.storedBodySha256 !== null &&
        added.storedBodySha256 !== bodySha256
        ? { ok: false, reason: "KEY_REUSED" }
        : { ok: true, changed: 0, deduplicated: true };
    }
    await mailFounder(actor, gateway, {
      messageId: added.messageId,
      applicationId,
      kind,
      body,
      subject,
      to: founder.email,
      companyName: founder.companyName,
      reference: founder.reference,
    });
    return { ok: true, changed: 1, deduplicated: false };
  };

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

    /**
     * The documents the founder attached to this submission, read for Q's
     * answer to the receiving organisation (live D4, 2026-11-13: Q said no
     * document was read while a deck and a brief were attached). Null when
     * this composition cannot read them; each one not read says why.
     */
    submittedDocuments: async (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
    ): Promise<readonly SubmittedDocumentReading[] | null | InboxRefused> => {
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
      if (dependencies.documentText === undefined) return null;
      return dependencies.documentText
        .read({ tenantId: gateway.tenantId, applicationId })
        .catch(() => null);
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
      // GateQ slice 1: the dossier and transcript frozen at submission.
      // Only an authorised member of the receiving organisation reaches
      // here, and only for a submitted application (the row is a
      // submission). Older submissions carry neither: null, never a guess.
      // Every frozen version is read as it was frozen: v1 rows are never
      // rewritten, v2 carries the statement view (slice 3).
      const dossier = GateqDossierSchema.safeParse(row.dossier ?? null);
      const transcript = readTranscript(row.snapshot);
      const contact =
        dossier.success && dossier.data.contact !== null
          ? {
              name: dossier.data.contact.name,
              email: dossier.data.contact.email,
            }
          : { name: profile.contactName, email: profile.contactEmail };
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
                  : // Decision 91: answers in disagreement are the
                    // investor's judgement, never "not answered".
                    c.status === "UNRESOLVED"
                    ? ("UNRESOLVED" as const)
                    : ("NOT_ANSWERED" as const),
          })),
        answers,
        note: profile.note,
        contact,
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
          subject: message.subject,
          delivery: message.delivery,
        })),
        // A frozen amount Q computed reads as Q's inference, not "you said".
        // A relation the current rule does not allow (a pre-fix "600 vs
        // Not known") is not shown as a contradiction; the frozen row is
        // never rewritten (root cause 2026-11-14).
        dossier: dossier.success
          ? withDerivedAmountsMarked(
              withSettledGaps(gateqDossierAsReadNow(dossier.data)),
              transcript ?? [],
            )
          : null,
        transcript,
        // Q's reading of the same frozen submission; never a guess when absent.
        synthesis: GateqSynthesisSchema.safeParse(row.synthesis).data ?? null,
        // Honest about a reading that will not come: every bounded attempt
        // failed, or there is no frozen dossier for Q to read.
        synthesisState: GateqSynthesisSchema.safeParse(row.synthesis).success
          ? "READY"
          : row.synthesisState === "UNAVAILABLE" || !dossier.success
            ? "UNAVAILABLE"
            : "PENDING",
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
    pass: (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
      input: {
        readonly reasonCode: GateqPassReason;
        readonly message: string;
        readonly clientRequestId: string;
        readonly to?: string | undefined;
        readonly subject?: string | undefined;
      },
    ): Promise<InboxAnswered> =>
      answer(actor, gatewayId, applicationId, "PASS", input),

    /** A reply to the applicant, exactly as approved. Consequential. */
    reply: (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
      input: {
        readonly message: string;
        readonly clientRequestId: string;
        readonly to?: string | undefined;
        readonly subject?: string | undefined;
      },
    ): Promise<InboxAnswered> =>
      answer(actor, gatewayId, applicationId, "REPLY", {
        ...input,
        reasonCode: null,
      }),

    /**
     * What an answer to this applicant would carry besides the words: the
     * recipient, the default subject and where their answer would go. For
     * Q's approval card and the screen; sends nothing. Needs the right to
     * decide, as sending does: no card the person cannot approve.
     */
    outboundPreview: async (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
      kind: "PASS" | "REPLY",
    ): Promise<OutboundPreview | InboxRefused> => {
      const granted = await scoped(actor, gatewayId, [applicationId], "DECIDE");
      if (granted === null) return REFUSED;
      const row = await repository.one({
        tenantId: granted.gateway.tenantId,
        gatewayId: granted.gateway.gatewayId,
        userId: actor.userId,
        applicationId,
      });
      if (row === null) return REFUSED;
      const founder = founderOf(row);
      const replyTo =
        dependencies.replyToFor === undefined
          ? null
          : await dependencies.replyToFor(actor).catch(() => null);
      return {
        ok: true,
        companyName: founder.companyName,
        fund: granted.gateway.fund,
        to: founder.email,
        toName: founder.name,
        subject: gateqAnswerSubject({
          kind,
          fund: granted.gateway.fund,
          companyName: founder.companyName,
        }),
        replyTo,
        deliverable:
          founder.email !== null &&
          dependencies.founderMail !== undefined &&
          dependencies.founderMail.available,
      };
    },

    /**
     * A first draft of a reply for a person to edit and approve: a call, a
     * request for what is still open, or a plain thank-you. Never sent here.
     */
    draftReply: async (
      actor: ActorContext,
      gatewayId: string,
      applicationId: string,
      purpose: GateqReplyPurpose = "CALL",
    ): Promise<
      | {
          readonly ok: true;
          readonly purpose: GateqReplyPurpose;
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
      const founder = founderOf(row);
      return {
        ok: true,
        purpose,
        companyName: founder.companyName,
        message: draftReplyMessage({
          founderName: founder.name,
          companyName: founder.companyName,
          fund: granted.gateway.fund,
          purpose,
          openRules: rulesOf(readQualification(row.qualification)).unknown,
        }),
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
              : amountWords(profile.raise.amount, profile.raise.currency),
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
                  : c.status === "UNRESOLVED"
                    ? GATEQ_UNRESOLVED_WORDS
                    : "Needs clarification",
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

/**
 * The transcript a v2 snapshot froze, read defensively: it is stored JSON.
 * A v1 snapshot has none, which is null rather than an empty conversation.
 */
function readTranscript(snapshot: unknown) {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const turns = (snapshot as { readonly transcript?: unknown }).transcript;
  if (!Array.isArray(turns)) return null;
  return turns.slice(0, GATEQ_TRANSCRIPT_MAX_TURNS).flatMap((turn: unknown) => {
    const parsed = ApplicationTranscriptTurnDtoSchema.safeParse(turn);
    return parsed.success ? [parsed.data] : [];
  });
}
