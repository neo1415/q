import { createHash, randomUUID } from "node:crypto";

import { APP_ACTIONS } from "@capital-q/app-actions";
import type { MeetingNextStepNote } from "@capital-q/communication";
import {
  CorrelationIdSchema,
  QConversationIdSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { QActionService } from "@capital-q/q-actions";
import {
  runRef,
  type QOrchestrationRuntime,
  type QRuntimeService,
} from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
  type ActorContext,
  type ActorContextResolver,
} from "@capital-q/security";

import type { OutwardReview } from "./workforce/review.js";

/**
 * After the call, Q works in the app (meet-47, founder direction
 * 2026-10-03). From the record Q wrote (MEETING_NOTES v3), each person on
 * the call gets their own approval cards, built by code from the declared
 * app actions, never by the model:
 *
 * - the organiser: a chat recap of what was agreed, to send to the other side;
 * - a next call agreed with a day and a time: a booking card, else a reminder;
 * - a document the investor asked for: the investor's diligence request card;
 * - the deck the founder will share: the share card for their current deck;
 * - everything else they took on: a reminder.
 *
 * Every card is a proposal through the Approval Engine (Prepare, Recommend,
 * Human Approval, Execute): nothing runs until that person approves that
 * exact payload, and the execution gate re-checks their authority then.
 * Context Firewall: the cards are built only from what both sides read
 * (agreements and next steps), never from one side's private analysis.
 * What was said in the call is data: a step only becomes a card for the
 * side it belongs to, so nobody in a call can make Q act for the other side.
 */

export const MEETING_FOLLOW_UP_ORCHESTRATION_VERSION = "q-meeting-follow-up-v1";

/** Never a wall of cards after one call. */
export const FOLLOW_UP_CARDS_MAX = 5;

const FOLLOW_UP_CALL_MINUTES = 30;
const DEFAULT_DUE_DAYS = 2;

export type FollowUpPerson = {
  readonly userId: string;
  readonly side: "FOUNDER" | "INVESTOR";
  readonly organiser: boolean;
};

export type FollowUpCard = {
  readonly actionType: `app.${string}`;
  readonly payload: Record<string, unknown>;
  /** What the card is for, in plain words (the run's message). */
  readonly words: string;
};

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A due time: 09:00 UTC on the day said, else two days after the call. */
function dueAt(step: MeetingNextStepNote, startsAt: Date, now: Date): string {
  const said =
    step.dueDate === null ? null : new Date(`${step.dueDate}T09:00:00.000Z`);
  if (said !== null && !Number.isNaN(said.getTime()) && said > now) {
    return said.toISOString();
  }
  const fallback = new Date(
    Math.max(startsAt.getTime(), now.getTime()) +
      DEFAULT_DUE_DAYS * 24 * 3_600_000,
  );
  fallback.setUTCHours(9, 0, 0, 0);
  return fallback.toISOString();
}

/** Whose step it is: their side's, or the organiser's when nobody took it. */
function belongsTo(step: MeetingNextStepNote, person: FollowUpPerson): boolean {
  return step.ownerSide === null
    ? person.organiser
    : step.ownerSide === person.side;
}

/** The chat recap both sides can read: agreements and next steps, as said. */
export function recapMessage(input: {
  readonly agreements: readonly string[];
  readonly nextSteps: readonly MeetingNextStepNote[];
}): string | null {
  const agreed = input.agreements.map((line) => `- ${clip(line, 300)}`);
  const steps = input.nextSteps.map((step) => `- ${clip(step.what, 200)}`);
  if (agreed.length === 0 && steps.length === 0) return null;
  const parts = ["Thanks for the call today. A quick recap:"];
  if (agreed.length > 0) parts.push(`What we agreed:\n${agreed.join("\n")}`);
  if (steps.length > 0) parts.push(`Next steps:\n${steps.join("\n")}`);
  const text = parts.join("\n\n");
  return text.length > 3_800 ? `${text.slice(0, 3_799)}…` : text;
}

/**
 * The cards for one person, in order: recap first, at most five. Pure: the
 * caller proposes them. Every payload is checked against the declared
 * action's own input schema; one that does not fit is dropped, never sent.
 */
export function followUpCards(input: {
  readonly person: FollowUpPerson;
  readonly meetingId: string;
  readonly relationshipId: string;
  readonly purpose: string;
  readonly startsAt: Date;
  readonly counterpartName: string;
  readonly agreements: readonly string[];
  readonly nextSteps: readonly MeetingNextStepNote[];
  /** The founder's current deck, when they have one. */
  readonly deckDocumentId: string | null;
  readonly now: Date;
}): FollowUpCard[] {
  const { person, relationshipId, startsAt, now } = input;
  const keyBase = `meet:${input.meetingId}:${person.userId}`;
  const cards: FollowUpCard[] = [];
  const reminder = (
    title: string,
    step: MeetingNextStepNote,
    index: number,
  ): FollowUpCard => ({
    actionType: "app.schedule.reminder.create",
    payload: {
      idempotencyKey: `${keyBase}:remind-${String(index)}`,
      input: {
        title: clip(title, 200),
        dueAt: dueAt(step, startsAt, now),
        note: clip(`From your call: ${input.purpose}`, 1_000),
        relationshipId,
        channel: "IN_APP",
      },
    },
    words: `Remind you: ${clip(title, 200)}`,
  });

  const recap = person.organiser
    ? recapMessage({
        agreements: input.agreements,
        nextSteps: input.nextSteps,
      })
    : null;
  if (recap !== null) {
    cards.push({
      actionType: "app.chat.message.send",
      payload: {
        relationshipId,
        idempotencyKey: `${keyBase}:recap`,
        input: { kind: "TEXT", body: recap },
      },
      words: `Send ${input.counterpartName} a recap of the call`,
    });
  }

  input.nextSteps.forEach((step, index) => {
    // The investor asks for the document; the founder sees it on their
    // checklist once the investor approves the request.
    if (step.kind === "DOCUMENT_REQUEST") {
      if (person.side !== "INVESTOR") return;
      const title = clip(step.document ?? step.what, 200);
      cards.push({
        actionType: "app.diligence.document.request",
        payload: {
          relationshipId,
          idempotencyKey: `${keyBase}:ask-${String(index)}`,
          input: {
            title,
            note: clip(`Asked for on our call: ${step.what}`, 1_000),
          },
        },
        words: `Ask ${input.counterpartName} for: ${title}`,
      });
      return;
    }
    if (!belongsTo(step, person)) return;
    switch (step.kind) {
      case "NEXT_CALL": {
        const at = step.callAt === null ? null : new Date(step.callAt);
        if (at !== null && !Number.isNaN(at.getTime()) && at > now) {
          cards.push({
            actionType: "app.schedule.meeting.book",
            payload: {
              relationshipId,
              idempotencyKey: `${keyBase}:book-${String(index)}`,
              input: {
                purpose: clip(`Follow-up: ${input.purpose}`, 500),
                startsAt: at.toISOString(),
                durationMinutes: FOLLOW_UP_CALL_MINUTES,
              },
            },
            words: `Book the next call with ${input.counterpartName}`,
          });
        } else {
          cards.push(
            reminder(
              `Book the next call with ${input.counterpartName}`,
              step,
              index,
            ),
          );
        }
        return;
      }
      case "SHARE_DECK":
        if (person.side !== "FOUNDER") return;
        if (input.deckDocumentId !== null) {
          cards.push({
            actionType: "app.diligence.document.share",
            payload: {
              relationshipId,
              input: { documentId: input.deckDocumentId },
            },
            words: `Share your deck with ${input.counterpartName}`,
          });
        } else {
          cards.push(
            reminder(
              `Share your deck with ${input.counterpartName}`,
              step,
              index,
            ),
          );
        }
        return;
      case "MESSAGE":
        // The organiser's recap carries what was said; anyone else's
        // promised message is theirs to write, so Q reminds them.
        if (recap !== null) return;
        cards.push(reminder(step.what, step, index));
        return;
      case "REMINDER":
      case "OTHER":
        cards.push(reminder(step.what, step, index));
        return;
    }
  });

  return cards
    .filter((card) => {
      const declared = APP_ACTIONS.find(
        (action) => `app.${action.name}` === card.actionType,
      );
      return declared?.input.safeParse(card.payload).success === true;
    })
    .slice(0, FOLLOW_UP_CARDS_MAX);
}

/**
 * A request made to Q in the call (meet-47), as the asker's own next step.
 * Code reads the kind, never the model, and only ever as something the
 * asker does: a founder's "send them the deck" shares their own deck; an
 * investor's "send me the deck" asks for it. Nobody's words make a card
 * for the other side.
 */
export function callRequestStep(input: {
  readonly request: string;
  readonly side: "FOUNDER" | "INVESTOR";
  readonly askerName: string;
}): MeetingNextStepNote {
  const text = input.request.toLowerCase();
  const said = (pattern: RegExp) => pattern.test(text);
  const document =
    /\b(pitch deck|deck|slides|financials|financial model|model|cap table|data ?room|metrics|accounts|term sheet|documents?)\b/.exec(
      text,
    )?.[1] ?? null;
  const base = {
    what: clip(input.request.trim(), 300),
    owner: input.askerName,
    ownerSide: input.side,
    dueDate: null,
    callAt: null,
    document: null,
  } as const;
  if (
    said(
      /\b(book|schedule|set up|arrange)\b.*\b(call|meeting|catch[- ]?up)\b/,
    ) ||
    said(/\b(next|follow[- ]up) (call|meeting)\b/)
  ) {
    return { ...base, kind: "NEXT_CALL" };
  }
  if (document !== null && input.side === "FOUNDER") {
    return /deck|slides/.test(document)
      ? { ...base, kind: "SHARE_DECK" }
      : { ...base, kind: "REMINDER" };
  }
  if (document !== null && input.side === "INVESTOR") {
    return { ...base, kind: "DOCUMENT_REQUEST", document };
  }
  return { ...base, kind: "REMINDER" };
}

type Person = {
  readonly user_id: string;
  readonly auth_user_id: string | null;
  readonly side: "FOUNDER" | "INVESTOR" | null;
  readonly organiser: boolean;
  readonly counterpart: string;
};

/**
 * Proposes each person's cards in their own Q conversation for this call,
 * as them. A run begun under its own orchestration version is never
 * resumed by the conversational engine: an approval goes straight through
 * the Approval Engine's execution gate (approved-continuation.ts).
 */
export function createMeetingFollowUpCards(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly resolver: ActorContextResolver;
  readonly runtime: Pick<QRuntimeService, "createRun">;
  readonly orchestration: Pick<
    QOrchestrationRuntime,
    "begin" | "advanceThrough" | "fail"
  >;
  readonly actions: Pick<QActionService, "propose">;
  /** Founder brief J2: the recap to the other side is graded first. */
  readonly review?: OutwardReview | undefined;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { sql, logger } = dependencies;

  /**
   * The recap message, through the reviewer: a passing recap is offered
   * (perhaps redrafted); a held one is not offered at all.
   */
  async function reviewed(
    actor: ActorContext,
    card: FollowUpCard,
    meetingId: string,
    counterpartName: string,
    agreements: readonly string[],
  ): Promise<{
    card: FollowUpCard;
    settle: (() => Promise<void>) | null;
  } | null> {
    const review = dependencies.review;
    const input = card.payload["input"];
    if (
      review === undefined ||
      card.actionType !== "app.chat.message.send" ||
      typeof input !== "object" ||
      input === null ||
      !("body" in input) ||
      typeof input.body !== "string"
    ) {
      return { card, settle: null };
    }
    const verdict = await review.review(
      actor,
      {
        kind: "MEETING_FOLLOW_UP",
        id: meetingId,
        goal: `Follow up the call with ${counterpartName}`,
      },
      {
        principalName: "the organiser",
        counterpartName,
        channel: "CHAT",
        stage: "FOLLOW_UP",
        purpose:
          "A short, warm recap after a call: what was agreed and the next steps, exactly as both sides heard them.",
        material: agreements.join("\n"),
        thread: "",
        body: input.body,
      },
    );
    if (verdict.verdict === "HELD") {
      logger?.info(
        { meetingId, reason: verdict.reason },
        "meeting recap held below the bar",
      );
      return null;
    }
    return {
      card: {
        ...card,
        payload: { ...card.payload, input: { ...input, body: verdict.body } },
      },
      settle: () => review.settle(actor, verdict, "OFFERED"),
    };
  }
  const now = dependencies.now ?? (() => new Date());

  async function actorOf(person: Person): Promise<ActorContext | null> {
    const auth = AuthUserIdSchema.safeParse(person.auth_user_id);
    if (!auth.success) return null;
    const resolution = await resolveHumanActorContext(dependencies.resolver, {
      principal: { authUserId: auth.data },
      selection: {},
    });
    return resolution.status === "RESOLVED" &&
      resolution.context.userId === person.user_id
      ? resolution.context
      : null;
  }

  async function propose(
    actor: ActorContext,
    card: FollowUpCard,
    conversationId: string | null,
  ): Promise<string | null> {
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const own = card.payload["idempotencyKey"];
    const key =
      typeof own === "string"
        ? own
        : `${card.actionType}:${JSON.stringify(card.payload)}`.slice(0, 200);
    const created = await dependencies.runtime.createRun({
      actor,
      input: {
        capability: "PREPARE_ACTION",
        message: { text: `After your call: ${card.words}`.slice(0, 1_000) },
        modality: "TEXT",
        ...(conversationId === null
          ? {}
          : {
              conversationId: QConversationIdSchema.parse(conversationId),
            }),
      },
      idempotencyKey: `meet-card:${key}`.slice(0, 255),
      correlationId,
    });
    // Already proposed (a retried settle): the card stands as it was.
    if (!created.created) return created.conversation.id;
    const ref = runRef(created.run);
    await dependencies.orchestration.begin(
      ref,
      MEETING_FOLLOW_UP_ORCHESTRATION_VERSION,
    );
    await dependencies.orchestration.advanceThrough(ref, [
      "CONTEXT_RESOLUTION",
      "POLICY_CHECK",
      "PLANNING",
      "SYNTHESIS",
    ]);
    try {
      await dependencies.actions.propose({
        actor,
        runId: created.run.id,
        correlationId,
        actionType: card.actionType,
        payload: card.payload,
      });
    } catch (error: unknown) {
      await dependencies.orchestration
        .fail(ref, "INTERNAL_ERROR")
        .catch(() => undefined);
      throw error;
    }
    return created.conversation.id;
  }

  async function peopleOf(
    meetingId: string,
    relationshipId: string,
  ): Promise<readonly (Person & { readonly name: string })[]> {
    return sql<(Person & { readonly name: string })[]>`
        select p.user_id, u.auth_user_id, p.display_name as name,
               case when exists (
                      select 1 from identity.organisation_memberships m
                       where m.user_id = p.user_id
                         and m.organisation_id = c.organisation_id
                         and m.membership_status = 'active') then 'FOUNDER'
                    when exists (
                      select 1 from identity.organisation_memberships m
                       where m.user_id = p.user_id
                         and m.organisation_id = i.organisation_id
                         and m.membership_status = 'active') then 'INVESTOR'
               end as side,
               p.role = 'ORGANISER' as organiser,
               case when exists (
                      select 1 from identity.organisation_memberships m
                       where m.user_id = p.user_id
                         and m.organisation_id = c.organisation_id
                         and m.membership_status = 'active')
                    then i.display_name else c.canonical_name end as counterpart
          from communication.meeting_participants p
          join identity.user_profiles u on u.id = p.user_id
          join network.relationships r on r.id = ${relationshipId}
          join core.companies c on c.id = r.company_id
          join core.investor_organisations i on i.id = r.investor_organisation_id
         where p.meeting_id = ${meetingId}
         limit 20`;
  }

  async function deckOf(relationshipId: string): Promise<string | null> {
    const deck = await sql<{ id: string }[]>`
        select d.id from evidence.documents d
          join network.relationships r on r.company_id = d.company_id
         where r.id = ${relationshipId}
           and d.document_type = 'PITCH_DECK' and d.status = 'ACTIVE'
         order by d.created_at desc limit 1`;
    return deck[0]?.id ?? null;
  }

  return {
    /**
     * meet-47: a request made to Q in the call becomes one card in the
     * asker's own Capital Q, as their own action for them to approve. An
     * asker who is not on the booking gets nothing (false): nobody in the
     * call can make Q act for someone else.
     */
    cardFromCall: async (request: {
      readonly meetingId: string;
      readonly askerUserId: string;
      readonly text: string;
    }): Promise<boolean> => {
      const meeting = (
        await sql<
          { relationship_id: string; purpose: string; starts_at: Date }[]
        >`
          select relationship_id, purpose, starts_at
            from communication.meetings where id = ${request.meetingId} limit 1`
      )[0];
      if (meeting === undefined) return false;
      const person = (
        await peopleOf(request.meetingId, meeting.relationship_id)
      ).find((candidate) => candidate.user_id === request.askerUserId);
      if (person === undefined || person.side === null) return false;
      const step = callRequestStep({
        request: request.text,
        side: person.side,
        askerName: person.name,
      });
      const said = createHash("sha256")
        .update(request.text.trim().toLowerCase())
        .digest("hex")
        .slice(0, 12);
      const [card] = followUpCards({
        // Never the organiser's recap: just this one request.
        person: { userId: person.user_id, side: person.side, organiser: false },
        meetingId: `${request.meetingId}:call-${said}`,
        relationshipId: meeting.relationship_id,
        purpose: meeting.purpose,
        startsAt: new Date(meeting.starts_at),
        counterpartName: person.counterpart,
        agreements: [],
        nextSteps: [step],
        deckDocumentId:
          step.kind === "SHARE_DECK"
            ? await deckOf(meeting.relationship_id)
            : null,
        now: now(),
      });
      if (card === undefined) return false;
      const actor = await actorOf(person);
      if (actor === null) return false;
      await propose(actor, card, null);
      return true;
    },

    /** Returns how many cards were proposed, per user id. */
    prepare: async (held: {
      readonly meetingId: string;
      readonly relationshipId: string;
      readonly purpose: string;
      readonly startsAt: Date;
      readonly agreements: readonly string[];
      readonly nextSteps: readonly MeetingNextStepNote[];
    }): Promise<Map<string, number>> => {
      const people = await peopleOf(held.meetingId, held.relationshipId);
      const deckId = await deckOf(held.relationshipId);
      const proposed = new Map<string, number>();
      for (const person of people) {
        if (person.side === null) continue;
        const cards = followUpCards({
          person: {
            userId: person.user_id,
            side: person.side,
            organiser: person.organiser,
          },
          meetingId: held.meetingId,
          relationshipId: held.relationshipId,
          purpose: held.purpose,
          startsAt: held.startsAt,
          counterpartName: person.counterpart,
          agreements: held.agreements,
          nextSteps: held.nextSteps,
          deckDocumentId: deckId,
          now: now(),
        });
        if (cards.length === 0) continue;
        const actor = await actorOf(person);
        if (actor === null) continue;
        let conversationId: string | null = null;
        let count = 0;
        for (const proposed of cards) {
          try {
            const graded = await reviewed(
              actor,
              proposed,
              held.meetingId,
              person.counterpart,
              held.agreements,
            );
            if (graded === null) continue;
            const { card } = graded;
            conversationId = await propose(actor, card, conversationId);
            await graded.settle?.();
            count += 1;
          } catch (error: unknown) {
            logger?.warn(
              {
                err: error,
                meetingId: held.meetingId,
                action: proposed.actionType,
              },
              "meeting follow-up card not prepared",
            );
          }
        }
        proposed.set(person.user_id, count);
      }
      return proposed;
    },
  };
}

export type MeetingFollowUpCards = ReturnType<
  typeof createMeetingFollowUpCards
>;
