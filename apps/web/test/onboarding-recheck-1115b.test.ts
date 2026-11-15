import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FOUNDER_STEPS } from "@capital-q/founder-onboarding/definition";

import { createFixtureRuntimePort } from "../src/features/founder-onboarding/adapters/fixture-port";
import { createRuntimeFounderClient } from "../src/features/founder-onboarding/adapters/runtime-port";
import {
  currentGroup,
  resumeGroup,
} from "../src/features/founder-onboarding/models/journey";
import { workingNote } from "../src/features/onboarding-conversation/deck-figure-sync";

/**
 * Live founder re-check 2026-11-15 (84ac9afa7),
 * docs/ai-handoff/audits/2026-11-15-founder-onboarding-live.md.
 */

const STILL = "Still reading figures…";

describe("after the read-back, the working line says the figures are still being read", () => {
  it("replaces the upload's 'Reading …pdf' note until the cards come", () => {
    // The live shape: the read-back line was said at 14:55:07Z; the note
    // still read "Reading mangrove-tally-fictional-deck.pdf" until the
    // four cards were drawn 62.7 s after the upload.
    expect(
      workingNote({
        turnStage: null,
        uploadNote: "Reading mangrove-tally-fictional-deck.pdf",
        figuresReading: true,
        stillReading: STILL,
      }),
    ).toBe(STILL);
    expect(
      workingNote({
        turnStage: null,
        uploadNote: null,
        figuresReading: true,
        stillReading: STILL,
      }),
    ).toBe(STILL);
  });

  it("a turn's own stage still comes first, and with the cards in nothing claims to read", () => {
    expect(
      workingNote({
        turnStage: "Saving your round size",
        uploadNote: null,
        figuresReading: true,
        stillReading: STILL,
      }),
    ).toBe("Saving your round size");
    expect(
      workingNote({
        turnStage: null,
        uploadNote: null,
        figuresReading: false,
        stillReading: STILL,
      }),
    ).toBeNull();
  });

  it("the workspace shows the working line while the figures are read for, and clears the upload note at the read-back", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../src/features/onboarding-conversation/q-onboarding-workspace.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(
      /qThinking \|\| uploadNote !== null \|\| figuresReading \?/u,
    );
    expect(source).toMatch(/label=\{workingNote\(\{/u);
    expect(source).toMatch(
      /const line = deckReadLine\([\s\S]{0,300}push\("Q", line\);[\s\S]{0,200}setUploadNote\(null\);/u,
    );
  });
});

describe("the form reopens where the founder left off", () => {
  it("a reload with the cursor back on a finished 'Your company' reopens at the stage", async () => {
    const port = createFixtureRuntimePort({ storage: null, seed: "reset" });
    const founder = createRuntimeFounderClient(port, {
      adapter: "test",
      synthetic: true,
    });
    await founder.getSession();
    await founder.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "raising_now" },
    });
    const saved = await founder.saveResponse({
      stepId: "company_basics",
      response: {
        kind: "company_basics",
        name: "Saltpan Freight (fictional)",
        website: "saltpanfreight.example",
        countryCode: "GH",
      },
    });
    expect(saved.currentStepId).toBe("stage");
    const before = saved.raw;
    if (before === undefined) throw new Error("no runtime view");
    // As on production after the reload: the session points back at
    // F1.company_name while every field of that screen is saved.
    const reloaded = await port.navigate({
      sessionId: before.session.id,
      expectedSessionVersion: before.session.version,
      targetStepKey: FOUNDER_STEPS.companyName,
    });
    expect(currentGroup(reloaded).id).toBe("company_basics");
    expect(resumeGroup(reloaded)?.id).toBe("stage");
  });

  it("a screen with a step still open is where it stays", async () => {
    const port = createFixtureRuntimePort({ storage: null, seed: "reset" });
    const view = await port.start("00000000-0000-4000-8000-000000011152");
    expect(resumeGroup(view)).toBeNull();
  });

  it("the form screen asks for it on load and from 'Use the form', never over an editor opened for a step", () => {
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../src/features/founder-onboarding/founder-onboarding-screen.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(
      /useRef\(opening\.mode === "form"\)[\s\S]{0,600}resumeGroup\(raw\)[\s\S]{0,120}actions\.openStep\(target\.id\)/u,
    );
    expect(source).toMatch(
      /resumeForm\.current = true;\s*setMode\("form"\);[\s\S]{0,40}data-use-the-form/u,
    );
  });
});
