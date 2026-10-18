import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import {
  FOUNDER_PROFILE_SECTIONS,
  FOUNDER_PROFILE_SECTIONS_VERSION,
} from "@capital-q/founder-onboarding/profile-sections";
import type { PitchSectionReader } from "@capital-q/model-gateway/q";

import {
  backfillPitchSections,
  pitchSectionSpecs,
  readPitchSections,
} from "../src/media/pitch-section-readings.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * Lane ov 2026-10-16: Q reads each pitch's transcript into the profile's
 * sections once per pitch and versions, from that transcript only, and
 * stores it; the backfill is bounded by count and dollars and is a dry run
 * unless asked.
 */

const PITCH = "a0000000-0000-4000-8000-000000000021";
const READING_ID = "a0000000-0000-4000-8000-000000000022";
const COMPANY_ID = "a0000000-0000-4000-8000-000000000023";
const ORGANISATION_ID = "a0000000-0000-4000-8000-000000000024";
const CUES = [{ startMs: 2_000, endMs: 4_000, text: "Ports lose a day." }];

function harness(options: {
  readonly eligible: boolean;
  readonly model?: "ok" | "empty";
  readonly spentUsd?: number;
}) {
  const logger = createRecordingLogger();
  const queries: string[] = [];
  const inserted: unknown[][] = [];
  const asked: Parameters<PitchSectionReader["read"]>[0][] = [];
  const fake = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      queries.push(text);
      if (text.includes("insert into media.pitch_section_readings")) {
        inserted.push(values);
        return Promise.resolve([{ id: READING_ID }]);
      }
      if (text.includes("select distinct on (t.media_asset_id)")) {
        return Promise.resolve(
          options.eligible
            ? [{ tenant_id: TENANT_A, media_asset_id: PITCH }]
            : [],
        );
      }
      if (text.includes("select t.language, t.cues")) {
        return Promise.resolve(
          options.eligible
            ? [{ language: "en", cues: CUES, duration_seconds: 90 }]
            : [],
        );
      }
      if (text.includes("select owner_type, owner_id")) {
        return Promise.resolve([
          {
            owner_type: "COMPANY",
            owner_id: COMPANY_ID,
            owner_organisation_id: ORGANISATION_ID,
            purpose: "FOUNDER_PITCH",
          },
        ]);
      }
      if (text.includes("from ai_ops.model_usage")) {
        return Promise.resolve([{ usd: String(options.spentUsd ?? 0) }]);
      }
      return Promise.resolve([]);
    },
    { json: (value: unknown) => ({ json: value }) },
  );
  const reader: PitchSectionReader = {
    read: (input) => {
      asked.push(input);
      return Promise.resolve(
        options.model === "empty"
          ? null
          : [
              {
                key: "problem",
                facts: [
                  {
                    label: "Delay",
                    value: "a day",
                    atSeconds: 2,
                    truthClass: "USER_CLAIM" as const,
                    evidenceStatus: "SELF_REPORTED" as const,
                  },
                ],
              },
            ],
      );
    },
  };
  return {
    reading: { sql: fake as unknown as DatabaseExecutor, reader, logger },
    queries,
    inserted,
    asked,
    logger,
  };
}

describe("the section list the reader files under", () => {
  it("is the shared list, in order, keyed by factKey (else key): all fourteen", () => {
    const specs = pitchSectionSpecs();
    expect(specs).toHaveLength(FOUNDER_PROFILE_SECTIONS.length);
    expect(specs[0]).toEqual({
      key: "opportunity",
      title: "Opportunity and Economics",
    });
    expect(specs.map((spec) => spec.key)).toContain("team");
    expect(specs.map((spec) => spec.key)).toContain("ask");
  });
});

describe("reading one pitch", () => {
  it("reads only that pitch's transcript, once, and stores it under the current versions", async () => {
    const h = harness({ eligible: true });
    const outcome = await readPitchSections(
      h.reading,
      { tenantId: TENANT_A, mediaAssetId: PITCH },
      "cor_test",
    );
    expect(outcome).toEqual({
      kind: "READ",
      sections: 1,
      facts: 1,
      stored: true,
    });
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]?.cues).toEqual(CUES);
    expect(h.asked[0]?.durationSeconds).toBe(90);
    const select = h.queries.find((q) =>
      q.includes("select t.language, t.cues"),
    );
    // Only a READY founder pitch, not deleted or replaced, not yet read.
    expect(select).toContain("m.purpose = 'FOUNDER_PITCH'");
    expect(select).toContain("m.deleted_at is null");
    expect(select).toContain("m.superseded_at is null");
    expect(select).toContain("from media.pitch_section_readings r");
    expect(h.inserted[0]).toEqual(
      expect.arrayContaining([
        TENANT_A,
        PITCH,
        "en",
        FOUNDER_PROFILE_SECTIONS_VERSION,
      ]),
    );
    expect(
      h.queries.find((q) =>
        q.includes("insert into media.pitch_section_readings"),
      ),
    ).toContain("on conflict");
  });

  it("stores nothing when the model gives nothing back (tried again later)", async () => {
    const h = harness({ eligible: true, model: "empty" });
    expect(
      await readPitchSections(
        h.reading,
        { tenantId: TENANT_A, mediaAssetId: PITCH },
        "cor_test",
      ),
    ).toEqual({ kind: "EMPTY" });
    expect(h.inserted).toHaveLength(0);
    expect(
      h.logger.lines.some(
        (line) => line.fields["alert"] === "PITCH_SECTIONS_EMPTY",
      ),
    ).toBe(true);
  });

  it("never calls the model for a pitch already read or not readable", async () => {
    const h = harness({ eligible: false });
    expect(
      await readPitchSections(
        h.reading,
        { tenantId: TENANT_A, mediaAssetId: PITCH },
        "cor_test",
      ),
    ).toEqual({ kind: "NOT_ELIGIBLE" });
    expect(h.asked).toHaveLength(0);
  });
});

describe("the backfill", () => {
  it("is a dry run unless asked, listing ids only", async () => {
    const h = harness({ eligible: true });
    const result = await backfillPitchSections({
      reading: h.reading,
      apply: false,
      max: 25,
      maxUsd: 0.5,
      runId: "t1",
    });
    expect(result.mode).toBe("DRY_RUN");
    expect(result.outcomes).toEqual([
      { mediaAssetId: PITCH, outcome: "NOT_ELIGIBLE" },
    ]);
    expect(h.asked).toHaveLength(0);
  });

  it("stops at its dollar ceiling before reading", async () => {
    const h = harness({ eligible: true, spentUsd: 0.6 });
    const result = await backfillPitchSections({
      reading: h.reading,
      apply: true,
      max: 25,
      maxUsd: 0.5,
      runId: "t2",
    });
    expect(result.stoppedForBudget).toBe(true);
    expect(result.outcomes[0]?.outcome).toBe("SKIPPED_BUDGET");
    expect(h.asked).toHaveLength(0);
  });

  it("reads through the live path when applied", async () => {
    const h = harness({ eligible: true });
    const result = await backfillPitchSections({
      reading: h.reading,
      apply: true,
      max: 25,
      maxUsd: 0.5,
      runId: "t3",
    });
    expect(result.outcomes).toEqual([{ mediaAssetId: PITCH, outcome: "READ" }]);
  });
});

describe("a stored reading is announced to founder onboarding (lane ob1)", () => {
  it("enqueues media.pitch_sections.read in the same unit, identifiers only", async () => {
    const h = harness({ eligible: true });
    const events: { type: string; data: unknown }[] = [];
    let units = 0;
    const outcome = await readPitchSections(
      {
        ...h.reading,
        publish: {
          transactions: {
            run: (work) => {
              units += 1;
              return work({ sql: h.reading.sql } as never);
            },
          },
          outbox: {
            enqueue: (_tx: unknown, event: { type: string; data: unknown }) => {
              events.push(event);
              return Promise.resolve();
            },
          } as never,
        },
      },
      { tenantId: TENANT_A, mediaAssetId: PITCH },
      "cor_test",
    );
    expect(outcome).toMatchObject({ kind: "READ", stored: true });
    expect(units).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("media.pitch_sections.read");
    expect(events[0]?.data).toEqual({
      mediaAssetId: PITCH,
      ownerType: "COMPANY",
      ownerId: COMPANY_ID,
      purpose: "FOUNDER_PITCH",
      readingId: READING_ID,
    });
    // Identifiers only: never a fact or a quote.
    expect(JSON.stringify(events[0])).not.toContain("a day");
  });
});
