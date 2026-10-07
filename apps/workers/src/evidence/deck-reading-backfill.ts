import type { DatabaseExecutor } from "@capital-q/database";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";
import {
  checkUnreadDecks,
  listUnreadDecks,
  readDeckDocument,
  type DeckReadingOptions,
  type DeckReadingOutcome,
} from "./deck-reading-handler.js";

/** Never more than this many decks in one run, whatever is asked. */
export const DECK_BACKFILL_HARD_MAX = 50;

export type DeckBackfillResult = {
  readonly mode: "DRY_RUN" | "APPLIED";
  readonly selected: number;
  readonly outcomes: readonly {
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly outcome: DeckReadingOutcome["kind"] | "FAILED" | "SKIPPED_BUDGET";
  }[];
  readonly spentUsd: number;
  readonly stoppedForBudget: boolean;
};

/**
 * Re-reads ready decks that have no reading, through the same
 * `readDeckDocument` a live upload uses (Q.08 backfill). Idempotent: the
 * work list and the read itself both skip a version already read under the
 * current prompt version, and the insert is `on conflict do nothing`.
 * Budget-capped twice: a deck count (≤ DECK_BACKFILL_HARD_MAX) and a dollar
 * ceiling measured from the gateway's own usage ledger for this run's
 * correlation prefix, checked before each read.
 */
export async function backfillDeckReadings(options: {
  readonly reading: DeckReadingOptions;
  readonly sql: DatabaseExecutor;
  readonly logger: RunnerLogger;
  readonly apply: boolean;
  readonly max: number;
  readonly maxUsd: number;
  readonly runId: string;
}): Promise<DeckBackfillResult> {
  const limit = Math.max(0, Math.min(options.max, DECK_BACKFILL_HARD_MAX));
  const decks = await listUnreadDecks(options.sql, {
    uploadedMinutesAgo: 0,
    limit,
  });
  if (!options.apply) {
    return {
      mode: "DRY_RUN",
      selected: decks.length,
      outcomes: decks.map((deck) => ({ ...deck, outcome: "NOT_ELIGIBLE" })),
      spentUsd: 0,
      stoppedForBudget: false,
    };
  }
  const prefix = `cor_deckfill_${options.runId}_`;
  const spent = async (): Promise<number> => {
    const rows = await options.sql<{ usd: string | null }[]>`
      select sum(cost_usd)::text as usd from ai_ops.model_usage
       where correlation_id like ${`${prefix}%`}`;
    return Number(rows[0]?.usd ?? 0);
  };
  const outcomes: DeckBackfillResult["outcomes"][number][] = [];
  let stoppedForBudget = false;
  for (const [index, deck] of decks.entries()) {
    if (stoppedForBudget || (await spent()) >= options.maxUsd) {
      stoppedForBudget = true;
      outcomes.push({ ...deck, outcome: "SKIPPED_BUDGET" });
      continue;
    }
    try {
      const outcome = await readDeckDocument(
        options.reading,
        deck.documentId,
        `${prefix}${String(index)}`,
      );
      outcomes.push({ ...deck, outcome: outcome.kind });
    } catch (error: unknown) {
      options.logger.error(
        {
          documentVersionId: deck.documentVersionId,
          err: error,
          alert: "DECK_READING_FAILED",
        },
        "deck backfill could not store a reading",
      );
      outcomes.push({ ...deck, outcome: "FAILED" });
    }
  }
  return {
    mode: "APPLIED",
    selected: decks.length,
    outcomes,
    spentUsd: await spent(),
    stoppedForBudget,
  };
}

/**
 * Q.08 self-heal: every sweep alerts on unread decks, then re-reads a few
 * of them through the live path. A deck is tried at most once per process,
 * so a deck that can never be read (no text, empty answer) is not paid for
 * again on every sweep; the alert keeps naming it.
 */
export async function runDeckReadingHeal(options: {
  readonly reading: DeckReadingOptions;
  readonly sql: DatabaseExecutor;
  readonly logger: RunnerLogger;
  readonly intervalMs: number;
  readonly perSweep: number;
  readonly maxUsdPerSweep: number;
  readonly signal: AbortSignal;
}): Promise<void> {
  const tried = new Set<string>();
  let sweep = 0;
  while (!options.signal.aborted) {
    try {
      await checkUnreadDecks(options.sql, options.logger);
      const unread = await listUnreadDecks(options.sql, {
        uploadedMinutesAgo: 0,
        limit: DECK_BACKFILL_HARD_MAX,
      });
      const fresh = unread
        .filter((deck) => !tried.has(deck.documentVersionId))
        .slice(0, options.perSweep);
      sweep += 1;
      const prefix = `cor_deckheal_${String(Date.now())}_${String(sweep)}_`;
      const spent = async (): Promise<number> => {
        const rows = await options.sql<{ usd: string | null }[]>`
          select sum(cost_usd)::text as usd from ai_ops.model_usage
           where correlation_id like ${`${prefix}%`}`;
        return Number(rows[0]?.usd ?? 0);
      };
      for (const [index, deck] of fresh.entries()) {
        if (options.signal.aborted) break;
        if ((await spent()) >= options.maxUsdPerSweep) break;
        tried.add(deck.documentVersionId);
        try {
          const outcome = await readDeckDocument(
            options.reading,
            deck.documentId,
            `${prefix}${String(index)}`,
          );
          options.logger.info(
            {
              documentVersionId: deck.documentVersionId,
              outcome: outcome.kind,
            },
            "unread deck re-read",
          );
        } catch (error: unknown) {
          options.logger.error(
            {
              documentVersionId: deck.documentVersionId,
              err: error,
              alert: "DECK_READING_FAILED",
            },
            "unread deck could not be re-read",
          );
        }
      }
    } catch (error: unknown) {
      options.logger.warn({ err: error }, "deck reading heal sweep failed");
    }
    await abortableSleep(options.intervalMs, options.signal);
  }
}
