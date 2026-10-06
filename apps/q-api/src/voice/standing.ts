import { Q_PERSONALITIES, type QPersonality } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import { INITIAL_CONDUCT, type ConductState } from "./conduct.js";

/**
 * Q's standing with one person, kept across visits (founder direction
 * 2026-09-30): the personality they chose for Q and Q's patience with
 * small talk. Read and written for the actor's own user only.
 */

/**
 * Who Q is, as Q is told. Trusted product copy, the same in text and voice
 * (autopilot P3, 2026-10-06: each one a human register on the same sharp
 * analyst, so the choice changes how Q sounds, never what Q concludes).
 */
export const PERSONALITY_NOTES: Readonly<Record<QPersonality, string>> = {
  AUTO: "Read the person and match them, turn by turn: playful with the playful, crisp with the busy, gentle with the unsure, straight with the sceptical. Underneath, always a warm, sharp analyst with a view.",
  WARM: "Warm and encouraging: a kind word where it is earned, patient, makes people feel in good hands. Still candid about risks and quick to the point.",
  WITTY:
    "Playful and quick: light jokes, gentle teasing, a real laugh when something is funny. The work and the honest view come first.",
  SHARP:
    "Direct and efficient, like a seasoned analyst: the recommendation first, short sentences, no fluff, the occasional dry aside. Respectful of their time above all.",
  CALM: "Calm and steady: unhurried, reassuring, plain words, never flustered. Good company for someone under pressure, and still clear about what you would do.",
};

/** Thrown when a paused account tries to talk to Q. */
export class AccountPausedError extends Error {
  constructor() {
    super("this account is paused");
    this.name = "AccountPausedError";
  }
}

/** A visit ends after this long with nothing said. */
const VISIT_GAP_MS = 30 * 60 * 1000;

export type PersonStanding = {
  readonly personality: QPersonality;
  readonly conduct: ConductState;
};

export type StandingStore = {
  readonly read: (
    userId: string,
    tenantId: string,
    now: Date,
  ) => Promise<PersonStanding>;
  readonly saveConduct: (
    userId: string,
    tenantId: string,
    conduct: ConductState,
  ) => Promise<void>;
  readonly setPersonality: (
    userId: string,
    tenantId: string,
    personality: QPersonality,
  ) => Promise<void>;
  /** Pause the account; true only the first time. */
  readonly suspend: (
    userId: string,
    tenantId: string,
    reason: string,
  ) => Promise<boolean>;
};

type Row = {
  personality: string;
  streak: number;
  q_started: boolean;
  rounds: number;
  strikes: number;
  suspended_at: Date | null;
  updated_at: Date;
};

function personalityOf(value: string): QPersonality {
  return (Q_PERSONALITIES as readonly string[]).includes(value)
    ? (value as QPersonality)
    : "AUTO";
}

export function createPostgresStandingStore(
  sql: DatabaseExecutor,
): StandingStore {
  return {
    read: async (userId, _tenantId, now) => {
      const rows = await sql<Row[]>`
        select personality, streak, q_started, rounds, strikes,
               suspended_at, updated_at
          from q_runtime.person_standing
         where user_id = ${userId}
         limit 1`;
      const row = rows[0];
      if (row === undefined) {
        return { personality: "AUTO", conduct: INITIAL_CONDUCT };
      }
      // A new visit starts its rounds afresh; strikes are remembered.
      const newVisit = now.getTime() - row.updated_at.getTime() > VISIT_GAP_MS;
      return {
        personality: personalityOf(row.personality),
        conduct: {
          streak: newVisit ? 0 : row.streak,
          qStarted: newVisit ? false : row.q_started,
          rounds: newVisit ? 0 : row.rounds,
          strikes: row.strikes,
          suspended: row.suspended_at !== null,
        },
      };
    },
    saveConduct: async (userId, tenantId, conduct) => {
      await sql`
        insert into q_runtime.person_standing
          (user_id, tenant_id, streak, q_started, rounds, strikes)
        values
          (${userId}, ${tenantId}, ${Math.min(conduct.streak, 20)},
           ${conduct.qStarted}, ${Math.min(conduct.rounds, 20)},
           ${Math.min(conduct.strikes, 20)})
        on conflict (user_id) do update
          set streak = excluded.streak, q_started = excluded.q_started,
              rounds = excluded.rounds, strikes = excluded.strikes,
              updated_at = clock_timestamp()`;
    },
    setPersonality: async (userId, tenantId, personality) => {
      await sql`
        insert into q_runtime.person_standing (user_id, tenant_id, personality)
        values (${userId}, ${tenantId}, ${personality})
        on conflict (user_id) do update
          set personality = excluded.personality,
              updated_at = clock_timestamp()`;
    },
    suspend: async (userId, tenantId, reason) => {
      const rows = await sql<{ user_id: string }[]>`
        insert into q_runtime.person_standing
          (user_id, tenant_id, suspended_at, suspended_reason)
        values (${userId}, ${tenantId}, clock_timestamp(), ${reason.slice(0, 300)})
        on conflict (user_id) do update
          set suspended_at = clock_timestamp(),
              suspended_reason = excluded.suspended_reason,
              updated_at = clock_timestamp()
          where q_runtime.person_standing.suspended_at is null
        returning user_id`;
      return rows.length > 0;
    },
  };
}

/** Q's recent replies' first words, so the next one begins differently. */
export function openingsOf(
  thread: readonly { readonly role: "PERSON" | "Q"; readonly text: string }[],
): string {
  return thread
    .filter((turn) => turn.role === "Q")
    .slice(-4)
    .map((turn) => `- ${turn.text.split(/\s+/).slice(0, 4).join(" ")}`)
    .join("\n");
}
