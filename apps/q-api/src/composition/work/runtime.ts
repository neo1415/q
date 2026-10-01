import { createHash } from "node:crypto";

import {
  ChatMessageBodySchema,
  QWorkOutreachGrantSchema,
  QWorkStandInGrantSchema,
  type QWorkCallWindow,
  type QWorkOutreachGrant,
  type QWorkStandInGrant,
} from "@capital-q/contracts";
import type { ChatService, ScheduleService } from "@capital-q/communication";
import type { InterestService } from "@capital-q/network";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import {
  createQWorkEngine,
  laneThreadId,
  PersonAnswerSchema,
  QEnvelopeSchema,
  type Candidate,
  type DelegationRef,
  type LaneObservation,
  type ObservedMessage,
  type QCheckpointStore,
  type QWorkPorts,
  type ShortlistPick,
  type Slot,
  type StandInObservation,
  type StandInThread,
} from "@capital-q/q-orchestrator";
import type { RelationshipIntelligencePort } from "@capital-q/q-tools";
import {
  AuthUserIdSchema,
  OrganisationIdSchema,
  resolveHumanActorContext,
  type ActorContext,
  type ActorContextResolver,
} from "@capital-q/security";

import type { WorkComposers } from "./composers.js";
import {
  TERMINAL_STAGES,
  type DelegationRow,
  type LaneRow,
  type WorkStore,
} from "./store.js";

/**
 * Q's delegated work, composed (AUTO, ADR 0030): the ports the LangGraph
 * engine acts through, and the runner that wakes it.
 *
 * Every acting port re-resolves the person's own actor context for the
 * delegation (a revoked membership stops the work) and calls the command
 * their own button calls -- Express Interest, the chat, the calendar --
 * under a step-scoped idempotency key. What Q may say is the approved
 * grant; what Q reads is what the person may already see: their own feed,
 * pitches they may play, their own chats.
 */

/** A call is booked no sooner than this, so nobody is surprised. */
const CALL_LEAD_MS = 18 * 3_600_000;
const CALL_HORIZON_MS = 14 * 24 * 3_600_000;
/** How long a wait is left unwoken when nothing changes. */
const WAKE_BUCKET_MS = 3 * 3_600_000;
const MATERIAL_MAX = 3_800;

export type WorkRuntimeDependencies = {
  readonly store: WorkStore;
  readonly checkpoints: QCheckpointStore;
  readonly resolver: ActorContextResolver;
  readonly authUserOf: (userId: string) => Promise<string | null>;
  readonly composers: WorkComposers;
  readonly chat: {
    readonly readForQ: ChatService["readForQ"];
    readonly send: (
      input: Parameters<ChatService["send"]>[0],
    ) => Promise<unknown>;
  };
  readonly schedule: Pick<ScheduleService, "findSlots" | "schedule">;
  readonly interests: Pick<InterestService, "expressInterest">;
  readonly relationships: Pick<RelationshipIntelligencePort, "byRelationship">;
  /** The investor's own Discover feed, as the page shows it. */
  readonly feed: (
    actor: ActorContext,
    limit: number,
  ) => Promise<
    | readonly {
        readonly companyId: string;
        readonly name: string;
        readonly stageCode: string | null;
        readonly headquartersCountry: string | null;
        readonly shortDescription: string | null;
        readonly websiteUrl: string | null;
        readonly reasonCodes: readonly string[];
      }[]
    | null
  >;
  /** A pitch's transcript text, under the pitch's own playback rule. */
  readonly pitchTranscript: (
    actor: ActorContext,
    companyId: string,
    mediaAssetId: string,
  ) => Promise<string | null>;
  /** The investor's own declared mandate, as plain lines. */
  readonly mandateText: (actor: ActorContext) => Promise<string | null>;
  readonly ownCompany: (actor: ActorContext) => Promise<string | null>;
  readonly nameOf: (userId: string) => Promise<string | null>;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

function localLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(at);
}

/** ISO weekday (1-7) and hour of an instant in a zone. */
function weekdayHour(
  at: Date,
  timeZone: string,
): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const day =
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday) + 1;
  return { day, hour };
}

export function insideWindows(
  start: Date,
  durationMinutes: number,
  windows: readonly QWorkCallWindow[],
  timeZone: string,
): boolean {
  const begin = weekdayHour(start, timeZone);
  const end = weekdayHour(
    new Date(start.getTime() + durationMinutes * 60_000 - 1),
    timeZone,
  );
  return windows.some(
    (window) =>
      window.days.includes(begin.day) &&
      begin.day === end.day &&
      begin.hour >= window.startHour &&
      end.hour < window.endHour,
  );
}

function fingerprint(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function chatPathOf(counterpart: {
  readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
  readonly id: string;
}): string {
  return counterpart.kind === "COMPANY"
    ? `/relationships/company/${counterpart.id}/messages`
    : `/relationships/investor/${counterpart.id}/messages`;
}

export function createWorkRuntime(dependencies: WorkRuntimeDependencies) {
  const { store, composers, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  // --- who acts ------------------------------------------------------------

  async function actorForRow(row: DelegationRow): Promise<ActorContext | null> {
    const authUserId = AuthUserIdSchema.safeParse(
      await dependencies.authUserOf(row.user_id),
    );
    if (!authUserId.success) return null;
    const organisationId =
      row.organisation_id === null
        ? undefined
        : OrganisationIdSchema.parse(row.organisation_id);
    const resolution = await resolveHumanActorContext(dependencies.resolver, {
      principal: { authUserId: authUserId.data },
      selection: organisationId === undefined ? {} : { organisationId },
    });
    return resolution.status === "RESOLVED" &&
      resolution.context.userId === row.user_id
      ? resolution.context
      : null;
  }

  async function actorFor(ref: DelegationRef): Promise<ActorContext | null> {
    const row = await store.delegation(ref.delegationId);
    if (row?.status !== "ACTIVE") return null;
    return actorForRow(row);
  }

  const kindOf = new Map<string, DelegationRow["kind"]>();

  // --- reading a chat as the engine sees it --------------------------------

  type Read = Awaited<ReturnType<ChatService["readForQ"]>>;
  function observed(read: Read): ObservedMessage[] {
    return read.messages
      .filter((message) => message.kind === "TEXT" || message.text !== null)
      .map((message) => {
        const envelope = QEnvelopeSchema.safeParse(message.envelope);
        return {
          id: message.id,
          at: message.sentAt,
          from: message.from === "OTHER_SIDE" ? "OTHER_SIDE" : "OWN_SIDE",
          senderName: message.senderName,
          text: message.text,
          envelope: envelope.success ? envelope.data : null,
          viaQ: message.viaQ,
        };
      });
  }
  const q2qLastDay = (messages: readonly ObservedMessage[], at: Date) =>
    messages.filter(
      (message) =>
        message.envelope !== null &&
        Date.parse(message.at) > at.getTime() - 24 * 3_600_000,
    ).length;

  // --- the ports -------------------------------------------------------------

  const ports: QWorkPorts = {
    step: (ref, laneId, key, words) => store.step(ref, laneId, key, words),
    notify: (ref, notice) =>
      store.notify(
        ref,
        kindOf.get(ref.delegationId) ?? "INVESTOR_OUTREACH",
        notice,
      ),
    finishDelegation: (ref, status, summary) =>
      store.finish(ref.delegationId, status, summary),
    summarise: (ref, summary) => store.summarise(ref.delegationId, summary),
    updateLane: (laneId, patch) => store.updateLane(laneId, patch),

    source: async (ref) => {
      const actor = await actorFor(ref);
      if (actor === null) return [];
      const items =
        (await dependencies.feed(actor, 15).catch(() => null)) ?? [];
      const candidates: Candidate[] = [];
      for (const item of items) {
        const lines = [
          `Profile: ${item.name}`,
          item.stageCode === null ? null : `Stage: ${item.stageCode}`,
          item.headquartersCountry === null
            ? null
            : `Country: ${item.headquartersCountry}`,
          item.shortDescription === null
            ? null
            : `In their words: ${item.shortDescription}`,
          item.reasonCodes.length === 0
            ? null
            : `Why it is in the feed: ${item.reasonCodes.join(", ")}`,
        ].filter((line): line is string => line !== null);
        for (const pitchId of await store.pitchIds(item.companyId)) {
          const transcript = await dependencies
            .pitchTranscript(actor, item.companyId, pitchId)
            .catch(() => null);
          if (transcript !== null && transcript.trim().length > 0) {
            lines.push(`Pitch transcript: ${transcript.slice(0, 2_400)}`);
          }
        }
        candidates.push({
          companyId: item.companyId,
          name: item.name,
          material: lines.join("\n").slice(0, MATERIAL_MAX),
        });
      }
      return candidates;
    },

    shortlist: async (ref, grant, candidates) => {
      const actor = await actorFor(ref);
      if (actor === null) return null;
      const mandate =
        (await dependencies.mandateText(actor).catch(() => null)) ?? "";
      const result = await composers.shortlist(ref, {
        principalName: ref.principalName,
        mandate: mandate.slice(0, 3_000),
        maxCompanies: grant.maxCompanies,
        candidates: candidates
          .map(
            (candidate) =>
              `### companyId: ${candidate.companyId}\nName: ${candidate.name}\n${candidate.material}`,
          )
          .join("\n\n")
          .slice(0, 60_000),
      });
      if (result === null) return null;
      return result.picks.map((pick) => ({
        companyId: pick.companyId,
        name: "",
        reasons: pick.reasons,
      }));
    },

    expressInterest: async (ref, companyId) => {
      const actor = await actorFor(ref);
      if (actor === null) return { outcome: "REFUSED", code: "ACCESS_LOST" };
      try {
        const expressed = await dependencies.interests.expressInterest({
          actor,
          companyId,
          surface: "Q_CONVERSATION",
          idempotencyKey: `q-work:${ref.delegationId}:interest:${companyId}`,
          correlationId: createCorrelationId(),
        });
        return {
          outcome: "OK",
          relationshipId: expressed.interest.relationshipId,
        };
      } catch (error: unknown) {
        logger?.warn(
          { err: error, delegationId: ref.delegationId },
          "q work interest refused",
        );
        return { outcome: "REFUSED", code: "NOT_AVAILABLE" };
      }
    },

    openLane: (ref, lane) => store.openLane(ref, lane),

    post: async (ref, relationshipId, key, body, envelope) => {
      const actor = await actorFor(ref);
      if (actor === null) return false;
      const parsed = ChatMessageBodySchema.safeParse(body.slice(0, 4_000));
      if (!parsed.success) return false;
      try {
        await dependencies.chat.send({
          actor,
          relationshipId,
          request: { kind: "TEXT", body: parsed.data },
          // Per relationship: several lanes may use the same step names.
          idempotencyKey:
            `work:${ref.delegationId}:${relationshipId}:${key}`.slice(0, 200),
          qDelegationId: ref.delegationId,
          ...(envelope === null ? {} : { qEnvelope: envelope }),
        });
        return true;
      } catch (error: unknown) {
        logger?.warn(
          { err: error, delegationId: ref.delegationId },
          "q work message not sent",
        );
        return false;
      }
    },

    converse: (ref, input) =>
      composers.converse(ref, {
        principalName: input.principalName,
        counterpartName: input.counterpartName,
        brief: input.brief ?? "",
        topicsOpen: input.topicsOpen.join("\n"),
        otherSideIsQ: input.otherSideIsQ,
        thread: input.thread,
      }),

    interviewTurn: (ref, input) =>
      composers.interviewTurn(ref, {
        principalName: input.principalName,
        counterpartName: input.counterpartName,
        question: input.question,
        answerSoFar: input.answerSoFar,
        followUpAllowed: input.followUpAllowed,
      }),

    report: async (ref, input) => {
      const actor = await actorFor(ref);
      if (actor === null) return null;
      const mandate =
        (await dependencies.mandateText(actor).catch(() => null)) ?? "";
      const written = await composers.report(ref, {
        principalName: ref.principalName,
        counterpartName: input.counterpartName,
        mandate: mandate.slice(0, 3_000),
        reasons: input.reasons
          .map((reason) => `${reason.reason} ("${reason.quote}")`)
          .join("\n")
          .slice(0, 2_000),
        interview: input.interview
          .map(
            (item) =>
              `Q: ${item.question}\nA${item.byQ ? " (from their Q, standing in)" : ""}: ${item.answer}`,
          )
          .join("\n\n")
          .slice(0, 12_000),
        learned: input.learned
          .map((item) => `${item.topic}: ${item.words}`)
          .join("\n")
          .slice(0, 3_000),
        transcript: input.transcript.slice(-12_000),
      });
      if (written === null) return null;
      await store.saveReport(input.laneId, {
        ...written,
        counterpartName: input.counterpartName,
        interview: input.interview,
      });
      return {
        recommendation: written.recommendation,
        headline: written.headline,
        path: `/work/${ref.delegationId}/report/${input.laneId}`,
      };
    },

    slots: async (ref, relationshipId, call) => {
      const actor = await actorFor(ref);
      if (actor === null) return { outcome: "REFUSED", code: "ACCESS_LOST" };
      const current = now();
      const found = await dependencies.schedule
        .findSlots({
          actor,
          relationshipId,
          from: new Date(current.getTime() + CALL_LEAD_MS),
          to: new Date(current.getTime() + CALL_HORIZON_MS),
          durationMinutes: call.durationMinutes,
        })
        .catch(() => null);
      if (found === null) return { outcome: "REFUSED", code: "UNAVAILABLE" };
      if (found.outcome !== "OK") {
        return {
          outcome: "REFUSED",
          code: found.outcome === "REFUSED" ? found.code : "UNAVAILABLE",
        };
      }
      const slots: Slot[] = found.slots
        .filter((slot) =>
          insideWindows(
            slot.start,
            call.durationMinutes,
            call.windows,
            found.timeZone,
          ),
        )
        .slice(0, 3)
        .map((slot) => ({
          start: slot.start.toISOString(),
          label: localLabel(slot.start, found.timeZone),
        }));
      return { outcome: "OK", slots };
    },

    book: async (ref, relationshipId, input) => {
      const actor = await actorFor(ref);
      if (actor === null) return { outcome: "REFUSED", code: "ACCESS_LOST" };
      const startsAt = new Date(input.at);
      if (
        Number.isNaN(startsAt.getTime()) ||
        startsAt.getTime() < now().getTime()
      ) {
        return { outcome: "REFUSED", code: "TIME_PASSED" };
      }
      const booked = await dependencies.schedule
        .schedule({
          actor,
          relationshipId,
          purpose: input.purpose,
          startsAt,
          durationMinutes: input.durationMinutes,
          idempotencyKey:
            `work:${ref.delegationId}:${relationshipId}:call:${input.key}`.slice(
              0,
              200,
            ),
          correlationId: createCorrelationId(),
        })
        .catch(() => null);
      if (booked === null) return { outcome: "REFUSED", code: "UNAVAILABLE" };
      if (booked.outcome !== "OK") {
        return {
          outcome: "REFUSED",
          code: booked.outcome === "REFUSED" ? booked.code : "UNAVAILABLE",
        };
      }
      return {
        outcome: "OK",
        meetingId: booked.meeting.id,
        when: localLabel(startsAt, booked.meeting.timeZone),
        meetLink: booked.meeting.meetLink,
      };
    },

    standInReply: (ref, input) =>
      composers.standInReply(ref, {
        principalName: input.principalName,
        counterpartName: input.counterpartName,
        brief: input.brief,
        otherSideIsQ: input.otherSideIsQ,
        thread: input.thread,
      }),

    standInLane: async (ref, relationshipId, counterpartName) => {
      const actor = await actorFor(ref);
      const found =
        actor === null
          ? null
          : await dependencies.relationships
              .byRelationship(actor, relationshipId)
              .catch(() => null);
      return store.openLane(ref, {
        companyId: null,
        investorOrganisationId:
          found?.counterpart.kind === "INVESTOR_ORGANISATION"
            ? found.counterpart.id
            : null,
        relationshipId,
        counterpartName,
        stage: "STANDING_IN",
        reasons: [],
      });
    },
  };

  const engine = createQWorkEngine({
    checkpoints: dependencies.checkpoints,
    ports,
    logger,
  });

  // --- observations ------------------------------------------------------------

  async function observeLane(
    actor: ActorContext,
    row: DelegationRow,
    lane: LaneRow,
  ): Promise<LaneObservation> {
    const current = now();
    const expired = current > row.expires_at;
    const base = {
      now: current.toISOString(),
      status:
        lane.stage === "STOPPED"
          ? ("STOPPED" as const)
          : expired
            ? ("EXPIRED" as const)
            : ("ACTIVE" as const),
      relationshipId: lane.relationship_id,
      answer: (() => {
        const needs = lane.needs as { answer?: unknown } | null;
        const parsed = PersonAnswerSchema.safeParse(needs?.answer);
        return parsed.success ? parsed.data : null;
      })(),
    };
    if (lane.relationship_id === null) {
      return {
        ...base,
        access: "OK",
        chatPath: null,
        connected: false,
        declined: false,
        messages: [],
        q2qLastDay: 0,
      };
    }
    const [read, found] = await Promise.all([
      dependencies.chat
        .readForQ({ actor, relationshipId: lane.relationship_id, limit: 40 })
        .catch(() => null),
      dependencies.relationships
        .byRelationship(actor, lane.relationship_id)
        .catch(() => null),
    ]);
    if (read === null || found === null) {
      return {
        ...base,
        access: "LOST",
        chatPath: null,
        connected: false,
        declined: false,
        messages: [],
        q2qLastDay: 0,
      };
    }
    const messages = observed(read);
    return {
      ...base,
      access: read.blocked ? "BLOCKED" : "OK",
      chatPath: chatPathOf(found.counterpart),
      connected: read.connected,
      declined: found.status?.state === "DECLINED",
      messages,
      q2qLastDay: q2qLastDay(messages, current),
    };
  }

  async function observeStandIn(
    actor: ActorContext | null,
    row: DelegationRow,
    grant: QWorkStandInGrant,
  ): Promise<StandInObservation> {
    const current = now();
    const status = current > row.expires_at ? "EXPIRED" : "ACTIVE";
    if (actor === null) {
      return {
        now: current.toISOString(),
        status,
        access: "LOST",
        away: false,
        threads: [],
      };
    }
    const presence = await store.presence(row.user_id);
    const away =
      presence.away ||
      presence.lastSeenAt === null ||
      current.getTime() - presence.lastSeenAt.getTime() >
        grant.awayAfterMinutes * 60_000;
    const companyId = await dependencies.ownCompany(actor).catch(() => null);
    const threads: StandInThread[] = [];
    if (companyId !== null) {
      for (const relationshipId of await store.recentInvestorThreads(
        companyId,
      )) {
        const [read, found] = await Promise.all([
          dependencies.chat
            .readForQ({ actor, relationshipId, limit: 30 })
            .catch(() => null),
          dependencies.relationships
            .byRelationship(actor, relationshipId)
            .catch(() => null),
        ]);
        if (
          read === null ||
          found === null ||
          read.blocked ||
          !read.connected
        ) {
          continue;
        }
        const messages = observed(read);
        const other = messages.findLast(
          (message) => message.from === "OTHER_SIDE",
        );
        threads.push({
          relationshipId,
          counterpartName: other?.senderName ?? "An investor",
          chatPath: chatPathOf(found.counterpart),
          messages,
          q2qLastDay: q2qLastDay(messages, current),
        });
      }
    }
    return { now: current.toISOString(), status, access: "OK", away, threads };
  }

  const bucket = () => Math.floor(now().getTime() / WAKE_BUCKET_MS);
  const standInPrints = new Map<string, string>();

  // --- the runner ----------------------------------------------------------------

  async function refOf(row: DelegationRow): Promise<DelegationRef> {
    return {
      delegationId: row.id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      principalName: (await dependencies.nameOf(row.user_id)) ?? "the person",
      threadId: row.thread_id,
    };
  }

  async function advanceOutreach(
    row: DelegationRow,
    grant: QWorkOutreachGrant,
    actor: ActorContext,
  ): Promise<void> {
    const ref = await refOf(row);
    await engine.runOutreach(ref, grant);
    const lanes = await store.lanes(row.id);
    for (const lane of lanes) {
      if (TERMINAL_STAGES.includes(lane.stage)) continue;
      const obs = await observeLane(actor, row, lane);
      const print = fingerprint([
        obs.status,
        obs.access,
        obs.connected,
        obs.declined,
        obs.messages.at(-1)?.id ?? null,
        obs.answer?.id ?? null,
        bucket(),
      ]);
      if (print === lane.observed_fingerprint) continue;
      const outcome = await engine.advanceLane(
        {
          ref,
          laneId: lane.id,
          grant,
          counterpartName: lane.counterpart_name,
          reasons: Array.isArray(lane.match_reasons)
            ? (lane.match_reasons as ShortlistPick["reasons"])
            : [],
          relationshipId: lane.relationship_id,
        },
        obs,
      );
      if (obs.answer !== null) await store.clearAnswer(lane.id, obs.answer.id);
      await store.fingerprint(lane.id, print);
      if (outcome === "FINISHED") {
        logger?.info(
          { laneId: lane.id, thread: laneThreadId(lane.id) },
          "q work lane finished",
        );
      }
    }
    const after = await store.lanes(row.id);
    const current = await store.delegation(row.id);
    if (
      current?.status === "ACTIVE" &&
      after.length > 0 &&
      after.every(
        (lane) =>
          TERMINAL_STAGES.includes(lane.stage) || lane.stage === "REPORT_READY",
      )
    ) {
      const booked = after.filter((lane) => lane.meeting_id !== null).length;
      await store.finish(
        row.id,
        now() > row.expires_at ? "EXPIRED" : "DONE",
        booked > 0
          ? `Done: ${String(booked)} ${booked === 1 ? "call" : "calls"} booked.`
          : "Done.",
      );
    } else if (current?.status === "ACTIVE" && now() > row.expires_at) {
      await store.finish(row.id, "EXPIRED", "Time's up; handed back to you.");
    }
  }

  async function advance(row: DelegationRow): Promise<void> {
    kindOf.set(row.id, row.kind);
    const actor = await actorForRow(row);
    if (row.kind === "INVESTOR_OUTREACH") {
      const grant = QWorkOutreachGrantSchema.safeParse(row.grant_plan);
      if (!grant.success) {
        await store.finish(row.id, "FAILED", "The plan could not be read.");
        return;
      }
      if (actor === null) {
        const ref = await refOf(row);
        await store.notify(ref, row.kind, {
          key: "access-lost",
          title: "Q stopped your outreach",
          body: "Your access changed, so Q stopped.",
          link: null,
          priority: "UPDATE",
        });
        await store.finish(
          row.id,
          "STOPPED",
          "Your access changed, so Q stopped.",
        );
        return;
      }
      await advanceOutreach(row, grant.data, actor);
      return;
    }
    const grant = QWorkStandInGrantSchema.safeParse(row.grant_plan);
    if (!grant.success) {
      await store.finish(row.id, "FAILED", "The brief could not be read.");
      return;
    }
    const obs = await observeStandIn(actor, row, grant.data);
    // Quiet is free: resumed only when presence or a thread changed (or
    // the wake bucket turned), so checkpoints do not grow by the minute.
    const print = fingerprint([
      obs.status,
      obs.access,
      obs.away,
      obs.threads.map((thread) => thread.messages.at(-1)?.id ?? null),
      bucket(),
    ]);
    if (standInPrints.get(row.id) === print) return;
    const ref = await refOf(row);
    await engine.advanceStandIn(ref, grant.data, obs);
    standInPrints.set(row.id, print);
  }

  return {
    engine,
    ports,
    /** One pass over active work, bounded; each delegation in turn. */
    tick: async (limit = 20): Promise<number> => {
      const rows = await store.active(limit);
      for (const row of rows) {
        try {
          await advance(row);
        } catch (error: unknown) {
          logger?.warn(
            { err: error, delegationId: row.id },
            "q work step failed",
          );
        } finally {
          await store.touch(row.id).catch(() => undefined);
        }
      }
      return rows.length;
    },
  };
}

export type WorkRuntime = ReturnType<typeof createWorkRuntime>;
