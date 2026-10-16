import {
  decodeJsonbString,
  jsonbParam,
  type DatabaseExecutor,
} from "@capital-q/database";
import {
  FOUNDER_PROFILE_SECTIONS,
  FOUNDER_PROFILE_SECTIONS_VERSION,
} from "@capital-q/founder-onboarding/profile-sections";
import {
  PITCH_SECTION_READER_PROMPT_VERSION,
  type PitchCue,
  type PitchSectionReader,
  type PitchSectionSpec,
} from "@capital-q/model-gateway/q";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * Lane ov 2026-10-16: Q reads each pitch's transcript into the founder
 * profile's standard sections, once per pitch (a replaced pitch is a new
 * asset), transcript language, prompt version and section-list version,
 * and stores it (media.pitch_section_readings). The profile serves the
 * stored reading; no model runs on a page view.
 *
 * Work comes from the database, never a message: a READY founder pitch,
 * not deleted or superseded, with a stored transcript and no reading for
 * the current versions. The reader's only input is that transcript
 * (Context Firewall). The same function serves the timed sweep and the
 * bounded backfill script.
 */

/** Never more than this many pitches in one backfill run, whatever is asked. */
export const PITCH_SECTION_BACKFILL_HARD_MAX = 100;

/** The sections the reader files under: each section's factKey, else its key. */
export function pitchSectionSpecs(): readonly PitchSectionSpec[] {
  return [...FOUNDER_PROFILE_SECTIONS]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({
      key: section.factKey ?? section.key,
      title: section.title,
    }));
}

export type PitchSectionReadingOptions = {
  readonly sql: DatabaseExecutor;
  readonly reader: PitchSectionReader;
  readonly logger: RunnerLogger;
};

export type PitchSectionReadingOutcome =
  /** Not a readable pitch, no transcript, or already read. */
  | { readonly kind: "NOT_ELIGIBLE" }
  /** The model (or its validation) gave nothing back; tried again later. */
  | { readonly kind: "EMPTY" }
  | {
      readonly kind: "READ";
      readonly sections: number;
      readonly facts: number;
      readonly stored: boolean;
    };

export type PitchSectionTarget = {
  readonly tenantId: string;
  readonly mediaAssetId: string;
};

const CueSchemaGuard = (value: unknown): value is PitchCue =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { startMs?: unknown }).startMs === "number" &&
  typeof (value as { text?: unknown }).text === "string";

/** Pitches with a transcript and no reading for the current versions. */
export async function listUnreadPitches(
  sql: DatabaseExecutor,
  limit: number,
): Promise<readonly PitchSectionTarget[]> {
  const rows = await sql<{ tenant_id: string; media_asset_id: string }[]>`
    select distinct on (t.media_asset_id) t.tenant_id, t.media_asset_id
      from media.pitch_transcripts t
      join media.media_assets m
        on m.id = t.media_asset_id and m.tenant_id = t.tenant_id
     where m.purpose = 'FOUNDER_PITCH'
       and m.status = 'READY'
       and m.deleted_at is null
       and m.superseded_at is null
       and not exists (
         select 1 from media.pitch_section_readings r
          where r.media_asset_id = t.media_asset_id
            and r.language = t.language
            and r.prompt_version = ${PITCH_SECTION_READER_PROMPT_VERSION}
            and r.sections_version = ${FOUNDER_PROFILE_SECTIONS_VERSION})
     order by t.media_asset_id, t.created_at
     limit ${Math.max(0, Math.min(PITCH_SECTION_BACKFILL_HARD_MAX, Math.trunc(limit)))}`;
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    mediaAssetId: row.media_asset_id,
  }));
}

/**
 * Reads one pitch's transcript into the sections and stores it. A database
 * failure throws (the caller decides on retry); a model that gives nothing
 * back is an outcome, and nothing is stored, so a later sweep tries again.
 * An honest empty reading (the pitch speaks to no section) is stored, so
 * it is never paid for twice.
 */
export async function readPitchSections(
  options: PitchSectionReadingOptions,
  target: PitchSectionTarget,
  correlationId: string,
): Promise<PitchSectionReadingOutcome> {
  const row = (
    await options.sql<
      {
        language: string;
        cues: unknown;
        duration_seconds: number | null;
      }[]
    >`
      select t.language, t.cues, m.duration_seconds
        from media.pitch_transcripts t
        join media.media_assets m
          on m.id = t.media_asset_id and m.tenant_id = t.tenant_id
       where t.tenant_id = ${target.tenantId}
         and t.media_asset_id = ${target.mediaAssetId}
         and m.purpose = 'FOUNDER_PITCH'
         and m.status = 'READY'
         and m.deleted_at is null
         and m.superseded_at is null
         and not exists (
           select 1 from media.pitch_section_readings r
            where r.media_asset_id = t.media_asset_id
              and r.language = t.language
              and r.prompt_version = ${PITCH_SECTION_READER_PROMPT_VERSION}
              and r.sections_version = ${FOUNDER_PROFILE_SECTIONS_VERSION})
       order by t.created_at
       limit 1`
  )[0];
  if (row === undefined) return { kind: "NOT_ELIGIBLE" };
  const raw = decodeJsonbString(row.cues);
  const cues = Array.isArray(raw) ? raw.filter(CueSchemaGuard) : [];
  if (cues.length === 0) return { kind: "NOT_ELIGIBLE" };
  const reading = await options.reader.read({
    sections: pitchSectionSpecs(),
    durationSeconds: row.duration_seconds,
    cues,
    attribution: {
      tenantId: target.tenantId,
      correlationId: correlationId.slice(0, 128),
    },
  });
  if (reading === null) {
    options.logger.error(
      { mediaAssetId: target.mediaAssetId, alert: "PITCH_SECTIONS_EMPTY" },
      "Q could not read a pitch transcript into sections",
    );
    return { kind: "EMPTY" };
  }
  const inserted = await options.sql<{ id: string }[]>`
    insert into media.pitch_section_readings
      (tenant_id, media_asset_id, language, prompt_version, sections_version, sections)
    values (${target.tenantId}, ${target.mediaAssetId}, ${row.language},
            ${PITCH_SECTION_READER_PROMPT_VERSION}, ${FOUNDER_PROFILE_SECTIONS_VERSION},
            ${jsonbParam(options.sql, reading)})
    on conflict (media_asset_id, language, prompt_version, sections_version) do nothing
    returning id`;
  const facts = reading.reduce((sum, section) => sum + section.facts.length, 0);
  options.logger.info(
    {
      mediaAssetId: target.mediaAssetId,
      sections: reading.length,
      facts,
      stored: inserted.length > 0,
    },
    "Q read a pitch transcript into the profile's sections",
  );
  return {
    kind: "READ",
    sections: reading.length,
    facts,
    stored: inserted.length > 0,
  };
}

export type PitchSectionBackfillResult = {
  readonly mode: "DRY_RUN" | "APPLIED";
  readonly selected: number;
  readonly outcomes: readonly {
    readonly mediaAssetId: string;
    readonly outcome:
      PitchSectionReadingOutcome["kind"] | "FAILED" | "SKIPPED_BUDGET";
  }[];
  readonly spentUsd: number;
  readonly stoppedForBudget: boolean;
};

/**
 * Reads pitches that have a transcript and no reading, through the same
 * `readPitchSections` the sweep uses. Idempotent (the work list, the read
 * and the insert all skip a pitch already read). Capped twice: a pitch
 * count (≤ PITCH_SECTION_BACKFILL_HARD_MAX) and a dollar ceiling measured
 * from the gateway's own usage ledger for this run's correlation prefix,
 * checked before each read.
 */
export async function backfillPitchSections(options: {
  readonly reading: PitchSectionReadingOptions;
  readonly apply: boolean;
  readonly max: number;
  readonly maxUsd: number;
  readonly runId: string;
}): Promise<PitchSectionBackfillResult> {
  const { sql, logger } = options.reading;
  const pitches = await listUnreadPitches(sql, options.max);
  if (!options.apply) {
    return {
      mode: "DRY_RUN",
      selected: pitches.length,
      outcomes: pitches.map((pitch) => ({
        mediaAssetId: pitch.mediaAssetId,
        outcome: "NOT_ELIGIBLE",
      })),
      spentUsd: 0,
      stoppedForBudget: false,
    };
  }
  const prefix = `cor_pitchsec_${options.runId}_`;
  const spent = async (): Promise<number> => {
    const rows = await sql<{ usd: string | null }[]>`
      select sum(cost_usd)::text as usd from ai_ops.model_usage
       where correlation_id like ${`${prefix}%`}`;
    return Number(rows[0]?.usd ?? 0);
  };
  const outcomes: PitchSectionBackfillResult["outcomes"][number][] = [];
  let stoppedForBudget = false;
  for (const [index, pitch] of pitches.entries()) {
    if (stoppedForBudget || (await spent()) >= options.maxUsd) {
      stoppedForBudget = true;
      outcomes.push({
        mediaAssetId: pitch.mediaAssetId,
        outcome: "SKIPPED_BUDGET",
      });
      continue;
    }
    try {
      const outcome = await readPitchSections(
        options.reading,
        pitch,
        `${prefix}${String(index)}`,
      );
      outcomes.push({
        mediaAssetId: pitch.mediaAssetId,
        outcome: outcome.kind,
      });
    } catch (error: unknown) {
      logger.error(
        {
          mediaAssetId: pitch.mediaAssetId,
          err: error,
          alert: "PITCH_SECTIONS_FAILED",
        },
        "pitch section backfill could not store a reading",
      );
      outcomes.push({ mediaAssetId: pitch.mediaAssetId, outcome: "FAILED" });
    }
  }
  return {
    mode: "APPLIED",
    selected: pitches.length,
    outcomes,
    spentUsd: await spent(),
    stoppedForBudget,
  };
}

/**
 * The live path: every `intervalMs`, read up to `perSweep` new pitches.
 * A pitch is tried at most once per process, so one that can never be
 * read (an empty answer) is not paid for again on every sweep.
 */
export async function runPitchSectionSweep(options: {
  readonly reading: PitchSectionReadingOptions;
  readonly intervalMs: number;
  readonly perSweep: number;
  readonly signal: AbortSignal;
}): Promise<void> {
  const tried = new Set<string>();
  while (!options.signal.aborted) {
    try {
      const pitches = (
        await listUnreadPitches(options.reading.sql, options.perSweep * 4)
      )
        .filter((pitch) => !tried.has(pitch.mediaAssetId))
        .slice(0, options.perSweep);
      for (const pitch of pitches) {
        tried.add(pitch.mediaAssetId);
        await readPitchSections(
          options.reading,
          pitch,
          `cor_pitchsec_sweep_${pitch.mediaAssetId}`,
        );
      }
    } catch (error: unknown) {
      options.reading.logger.warn({ err: error }, "pitch section sweep failed");
    }
    await abortableSleep(options.intervalMs, options.signal);
  }
}
