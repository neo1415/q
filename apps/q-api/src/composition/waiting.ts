import type { DatabaseExecutor } from "@capital-q/database";
import {
  WAIT_NUDGE_AFTER_DAYS,
  WAIT_TELL_OWNER_AFTER_DAYS,
} from "@capital-q/q-orchestrator";

/**
 * Waiting like a person would (founder direction 2026-10-01, AUTO): when
 * Q's work waits for the other side to accept, it says what it waits for,
 * wakes the moment they accept (the relationship's own outbox event, see
 * `createWorkWakeListener`), and if they never do: one gentle reminder to
 * them after a few days, then Q tells its owner plainly.
 */

/** One policy for errands and delegated work (the engine owns the numbers). */
export const NUDGE_AFTER_DAYS = WAIT_NUDGE_AFTER_DAYS;
export const TELL_OWNER_AFTER_DAYS = WAIT_TELL_OWNER_AFTER_DAYS;

const DAY_MS = 24 * 3_600_000;

export type WaitingDecision = "WAIT" | "NUDGE" | "TELL_OWNER";

/** What a still-unanswered wait calls for now; each fires once (dedupe). */
export function waitingDecision(since: Date, now: Date): WaitingDecision {
  const days = (now.getTime() - since.getTime()) / DAY_MS;
  if (days >= TELL_OWNER_AFTER_DAYS) return "TELL_OWNER";
  if (days >= NUDGE_AFTER_DAYS) return "NUDGE";
  return "WAIT";
}

/**
 * One gentle reminder to the other side's people about an interest or a
 * connection request they already received. Nothing new is disclosed: it
 * names who is waiting and links to their own inbox. Once per wait.
 */
export function createCounterpartNudger(sql: DatabaseExecutor) {
  return {
    nudge: async (input: {
      readonly relationshipId: string;
      /** The side that is waiting (the owner's side). */
      readonly waitingSide: "INVESTOR" | "COMPANY";
      readonly waitingName: string;
      /** Stable for this wait, so a replay reminds nobody twice. */
      readonly key: string;
    }): Promise<number> => {
      const inbox =
        input.waitingSide === "INVESTOR" ? "/company/interest" : "/investors";
      const rows = await sql<{ id: string }[]>`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
        select m.tenant_id, m.user_id, 'REMINDER',
               ${`${input.waitingName.slice(0, 120)} is waiting to hear from you`},
               ${
                 input.waitingSide === "INVESTOR"
                   ? "They expressed interest in your company. Accept or decline when you're ready."
                   : "They asked to connect with you. Accept or decline when you're ready."
               },
               ${inbox}, ${`waiting-nudge:${input.key}`.slice(0, 200)}, 'NEEDS_YOU'
          from network.relationships r
          join core.companies c on c.id = r.company_id
          join core.investor_organisations i on i.id = r.investor_organisation_id
          join identity.organisation_memberships m
            on m.organisation_id = case when ${input.waitingSide} = 'INVESTOR'
                                        then c.organisation_id else i.organisation_id end
           and m.membership_status = 'active'
         where r.id = ${input.relationshipId}
         limit 20
        on conflict (user_id, dedupe_key) do nothing
        returning id`;
      return rows.length;
    },
  };
}

export type CounterpartNudger = ReturnType<typeof createCounterpartNudger>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Wakes waiting work the moment a relationship moves. The workers' outbox
 * consumer announces `network.relationship.matched` / `interest_declined`
 * on the `q_work_wake` channel (after the relationship state is
 * projected); here every errand and delegation waiting on that
 * relationship continues at once. The payload is only an id: everything
 * is re-read under the owner's own access. Idempotent end to end: a second
 * notice finds the work already moved on. The minute's tick remains the
 * safety net for a notice sent while this process was down.
 */
export function createWorkWakeListener(dependencies: {
  readonly listen: (
    channel: string,
    onNotify: (payload: string) => void,
    onListen?: () => void,
  ) => Promise<unknown>;
  /**
   * Run when the listening connection is (re)established: notices may have
   * been missed meanwhile, so durable state is re-read (a full pass).
   */
  readonly catchUp?: (() => void) | undefined;
  readonly channel: string;
  readonly targets: readonly {
    readonly name: string;
    readonly wake: (relationshipId: string) => Promise<number>;
  }[];
  readonly logger?: {
    readonly info: (fields: Record<string, unknown>, message: string) => void;
    readonly warn: (fields: Record<string, unknown>, message: string) => void;
  };
}) {
  const handle = async (payload: string): Promise<void> => {
    const relationshipId = payload.trim();
    if (!UUID.test(relationshipId)) return;
    for (const target of dependencies.targets) {
      try {
        const woken = await target.wake(relationshipId);
        if (woken > 0) {
          dependencies.logger?.info(
            { relationshipId, target: target.name, woken },
            "q work woken",
          );
        }
      } catch (error: unknown) {
        dependencies.logger?.warn(
          { err: error, relationshipId, target: target.name },
          "q work wake failed",
        );
      }
    }
  };
  return {
    handle,
    start: () =>
      dependencies.listen(
        dependencies.channel,
        (payload) => {
          void handle(payload);
        },
        dependencies.catchUp,
      ),
  };
}
