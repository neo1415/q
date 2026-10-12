import type { DatabaseExecutor } from "@capital-q/database";
import { RehearsalReviewResultSchema } from "@capital-q/q-core";
import type {
  MemoryRehearsalDigest,
  MemoryRehearsalPort,
} from "@capital-q/q-knowledge";

/**
 * The person's own rehearsal reviews for memory recall ("what did I
 * struggle with last week?"). Founder-private practice: keyed on the
 * actor's user and tenant only, never on anything the caller passes, so
 * no one else's rehearsal (an investor, a teammate, another tenant) can be
 * read here. A provisional review (written by code while Q could not
 * write the real one) carries no coaching and is left out; a stored review
 * that no longer reads as one is skipped, never guessed at.
 */

const RECALL_MAX = 3;

type Row = {
  id: string;
  counterpart_name: string;
  difficulty: string;
  outcome: string | null;
  score: number | null;
  scorecard: unknown;
  at: Date;
};

export function rehearsalDigestOf(row: Row): MemoryRehearsalDigest | null {
  if (row.scorecard === null || typeof row.scorecard !== "object") return null;
  // Presence, slides and the external basis sit beside the review; the
  // review itself is the stored shape.
  const {
    presence: _presence,
    slides: _slides,
    provisional,
    externalBasis: _basis,
    ...review
  } = row.scorecard as Record<string, unknown>;
  if (provisional === true) return null;
  const parsed = RehearsalReviewResultSchema.safeParse(review);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    rehearsalId: row.id,
    at: row.at.toISOString(),
    counterpartName: row.counterpart_name,
    difficulty: row.difficulty,
    outcome: row.outcome,
    score: row.score,
    overall: r.overall,
    needsWork: r.dimensions
      .filter((d) => d.rating === "NEEDS_WORK")
      .map((d) => d.name),
    strong: r.dimensions
      .filter((d) => d.rating === "STRONG")
      .map((d) => d.name),
    wentWrong: r.wentWrong,
    wentRight: r.wentRight.map((w) => w.moment),
    tips: r.tips,
  };
}

export function createRehearsalRecallPort(
  sql: DatabaseExecutor,
): MemoryRehearsalPort {
  return {
    recentForOwner: async (actor, limit) => {
      const take = Math.min(Math.max(limit, 1), RECALL_MAX);
      const rows = await sql<Row[]>`
        select id, counterpart_name, difficulty, outcome, score, scorecard,
               coalesce(ended_at, created_at) as at
          from q_runtime.rehearsals
         where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
           and status = 'FINISHED' and scorecard is not null
           and coalesce(scorecard ->> 'provisional', 'false') <> 'true'
         order by coalesce(ended_at, created_at) desc
         limit ${take}`;
      return rows.flatMap((row) => {
        const digest = rehearsalDigestOf(row);
        return digest === null ? [] : [digest];
      });
    },
  };
}
