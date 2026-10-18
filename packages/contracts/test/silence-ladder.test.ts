import { describe, expect, it } from "vitest";

import {
  nextSilenceBeat,
  Q_SILENCE_START,
  silenceStageLine,
  silenceThreadLine,
  type QSilenceBeat,
  type QSilenceInput,
  type QSilenceState,
  type QVisibleStage,
} from "../src/index.js";

/**
 * ADR 0062: the silence ladder, rung by rung, on a fake clock. Drives the
 * pure decision the way both voice paths do: at each `nextAtMs`.
 */

type Run = { readonly at: number; readonly beat: QSilenceBeat };

function drive(
  until: number,
  overrides: Partial<Omit<QSilenceInput, "elapsedMs">> & {
    readonly stageAt?: (ms: number) => QVisibleStage | null;
    readonly hushedAt?: (ms: number) => boolean;
  } = {},
): readonly Run[] {
  let state: QSilenceState = Q_SILENCE_START;
  let at = 0;
  const out: Run[] = [];
  for (let guard = 0; guard < 50 && at <= until; guard += 1) {
    const step = nextSilenceBeat(state, {
      elapsedMs: at,
      stage: overrides.stageAt?.(at) ?? overrides.stage ?? "REVIEWING_COMPANY",
      focus:
        overrides.focus === undefined
          ? { name: "Ledgerline", thing: "deck" }
          : overrides.focus,
      hushed: overrides.hushedAt?.(at) ?? overrides.hushed ?? false,
      approvalWaiting: overrides.approvalWaiting ?? false,
      thread: overrides.thread ?? null,
      seed: overrides.seed ?? 7,
    });
    state = step.state;
    if (step.beat !== null) out.push({ at, beat: step.beat });
    if (step.nextAtMs === null) break;
    at = step.nextAtMs;
  }
  return out;
}

const LAGOS = {
  memoryItemId: "11111111-1111-4111-8111-111111111111",
  followUp: "how was Lagos?",
};

describe("the silence ladder", () => {
  it("is silent for a quick answer: nothing before 0.7 s", () => {
    expect(drive(600)).toEqual([]);
  });

  it("tones at 0.7 s, says what Q is doing at 1.5 s, then progresses from 4 s", () => {
    const beats = drive(20_000);
    expect(beats.map((b) => [b.at, b.beat.kind])).toEqual([
      [700, "TONE"],
      [1_500, "STAGE_LINE"],
      [4_000, "PROGRESS_LINE"],
      [10_000, "HUM"],
      [16_000, "PROGRESS_LINE"],
    ]);
    const stage = beats[1]?.beat;
    expect(stage?.kind === "STAGE_LINE" ? stage.text : "").toMatch(
      /Ledgerline's deck/,
    );
  });

  it("never gives more than three beats after the stage line", () => {
    expect(drive(120_000)).toHaveLength(5);
  });

  it("brings back one remembered thread in a long wait, never more", () => {
    const beats = drive(60_000, { thread: LAGOS });
    const threads = beats.filter((b) => b.beat.kind === "THREAD");
    expect(threads).toHaveLength(1);
    expect(threads[0]?.at).toBeGreaterThanOrEqual(8_000);
    const thread = threads[0]?.beat;
    expect(thread?.kind === "THREAD" ? thread.text : "").toMatch(
      /how was Lagos\?$/,
    );
  });

  it("is quiet while an approval waits", () => {
    expect(drive(30_000, { approvalWaiting: true })).toEqual([]);
    expect(drive(30_000, { stage: "WAITING_FOR_APPROVAL" })).toEqual([]);
  });

  it("is quiet while the person speaks, and resumes after", () => {
    const beats = drive(20_000, { hushedAt: (ms) => ms < 3_000 });
    expect(beats.map((b) => b.beat.kind)).toEqual([
      "TONE",
      "STAGE_LINE",
      "PROGRESS_LINE",
      "HUM",
      "PROGRESS_LINE",
    ]);
    expect(beats[0]?.at).toBeGreaterThanOrEqual(3_000);
  });

  it("follows the run's real stage", () => {
    const beats = drive(5_000, {
      stageAt: (ms) =>
        ms < 4_000 ? "REVIEWING_COMPANY" : "PREPARING_DOCUMENT",
    });
    const progress = beats.find((b) => b.beat.kind === "PROGRESS_LINE")?.beat;
    expect(progress?.kind === "PROGRESS_LINE" ? progress.text : "").toMatch(
      /Ledgerline's deck|document/,
    );
  });

  it("varies its phrasing across turns without a fixed line", () => {
    const lines = new Set(
      Array.from({ length: 40 }, (_, seed) =>
        silenceStageLine("REVIEWING_COMPANY", { name: "Ledgerline" }, seed),
      ),
    );
    expect(lines.size).toBeGreaterThan(8);
    for (const line of lines) expect(line).toMatch(/Ledgerline's profile/);
  });

  it("never repeats the line it just said", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const first = silenceStageLine("CHECKING_EVIDENCE", null, seed);
      expect(silenceStageLine("CHECKING_EVIDENCE", null, seed, first)).not.toBe(
        first,
      );
    }
  });

  it("says nothing it cannot ground: no name invented without a focus", () => {
    const line = silenceStageLine("REVIEWING_COMPANY", null, 3) ?? "";
    expect(line).toMatch(/profile/);
    expect(line).not.toMatch(/'s /);
  });

  it("asks the remembered question as a question", () => {
    expect(silenceThreadLine("How did the exams go", 1)).toMatch(
      /how did the exams go\?$|How did the exams go\?$/,
    );
  });
});
