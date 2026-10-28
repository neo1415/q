import type { DatabaseExecutor } from "@capital-q/database";
import type {
  SituationActivityItem,
  SituationActivityPort,
} from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

/**
 * Addendum 2 (owner 2026-10-28): "what you did recently" -- the person's
 * own domain events, read from the transactional outbox, as part of every
 * plan's situation. The defect it closes: they recorded $1M with Zino
 * Aviation and Q did not know.
 *
 * Firewall: only events of THEIR tenant whose actor is THEM (a person's
 * own acts, `actor.type = HUMAN`, `actor.id = their user id`); never
 * another member's, never the other side's. Nothing from the payload's
 * data is read: the words are code's, from the event's type, and the
 * record is the event's own aggregate (type and id), which grants nothing
 * (every later use is re-authorised as them). One round trip, bounded.
 */

export const ACTIVITY_LIMIT = 20;
export const ACTIVITY_DAYS = 30;

type ActivityRow = {
  readonly event_type: string;
  readonly aggregate_type: string | null;
  readonly aggregate_id: string | null;
  readonly created_at: Date;
};

/**
 * Plain words for an event type `<context>.<entity>.<past_tense>` (code's,
 * never the payload's): "capital.commitment.amount_confirmed" -> "confirmed
 * an amount on a commitment".
 */
export function activityWords(eventType: string): string | null {
  const parts = eventType.split(".");
  if (parts.length !== 3) return null;
  const [, entity, happened] = parts;
  if (entity === undefined || happened === undefined) return null;
  const words = happened.split("_").filter((word) => word.length > 0);
  if (words.length === 0) return null;
  // The verb is the past tense; anything before it is what it acted on.
  const verbIndex = words.findIndex((word) =>
    /(?:ed|wn|nt|ne|un)$/u.test(word),
  );
  const verb =
    verbIndex === -1 ? words.join(" ") : words.slice(verbIndex).join(" ");
  const object = verbIndex <= 0 ? [] : words.slice(0, verbIndex);
  const thing = [...object, ...entity.split("_")].join(" ");
  const article = /^[aeiou]/u.test(thing) ? "an" : "a";
  return `${verb} ${article} ${thing}`.slice(0, 200);
}

const RECORD_KINDS: Readonly<
  Record<string, NonNullable<SituationActivityItem["record"]>["kind"]>
> = {
  company: "COMPANY",
  investor_organisation: "INVESTOR_ORGANISATION",
  relationship: "RELATIONSHIP",
  document: "DOCUMENT",
  meeting: "MEETING",
};

export function activityItemOf(row: ActivityRow): SituationActivityItem | null {
  const what = activityWords(row.event_type);
  if (what === null) return null;
  const kind =
    row.aggregate_type === null
      ? undefined
      : RECORD_KINDS[row.aggregate_type.toLowerCase()];
  return {
    at: row.created_at.toISOString(),
    what,
    record:
      kind === undefined || row.aggregate_id === null
        ? null
        : { kind, id: row.aggregate_id.slice(0, 200) },
  };
}

export function createActivityRead(
  sql: DatabaseExecutor,
  options: { readonly limit?: number; readonly days?: number } = {},
): SituationActivityPort {
  const limit = options.limit ?? ACTIVITY_LIMIT;
  const days = options.days ?? ACTIVITY_DAYS;
  return async ({ actor }: { readonly actor: ActorContext }) => {
    if (actor.actorType !== "HUMAN") return [];
    const rows = await sql<ActivityRow[]>`
      select o.event_type,
             o.payload->'aggregate'->>'type' as aggregate_type,
             o.payload->'aggregate'->>'id' as aggregate_id,
             o.created_at
        from events.outbox o
       where o.tenant_id = ${actor.tenantId}
         and o.created_at > now() - make_interval(days => ${days})
         and o.payload->'actor'->>'type' = 'HUMAN'
         and o.payload->'actor'->>'id' = ${actor.userId}::text
       order by o.id desc
       limit ${limit}`;
    return rows.flatMap((row) => {
      const item = activityItemOf(row);
      return item === null ? [] : [item];
    });
  };
}
