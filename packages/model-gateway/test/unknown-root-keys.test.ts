import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createDefaultPromptRegistry } from "@capital-q/q-core";

import { acceptStructuredOutput } from "../src/policy/structured.js";
import {
  ANALYST_LENIENT_FIELDS,
  ANALYST_RESULT_SCHEMA,
} from "../src/q/index.js";

/**
 * Live 2026-10-13: a selected-company answer added a root `followUps`
 * beside an otherwise valid reading. The whole object was refused and the
 * turn paid two more full model rounds (~31 s) before Q could answer.
 */
const Schema = z
  .object({
    answer: z.string(),
    findings: z.array(z.object({ text: z.string() }).strict()),
  })
  .strict();

const reading = {
  answer: "Tensorgate fits on stage and sector.",
  findings: [{ text: "Raising $4M seed." }],
};

describe("root keys the reading does not define", () => {
  it("are refused by default, as before", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({ ...reading, followUps: ["Ask about runway"] }),
      Schema,
    );
    expect(accepted).toMatchObject({ ok: false, stage: "SCHEMA" });
  });

  it("with DROP are left out, counted but never named, and the reading is kept whole", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({ ...reading, followUps: ["x"], extra: 1 }),
      Schema,
      { unknownRootKeys: "DROP" },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value).toEqual(reading);
    expect(accepted.dropped).toEqual(["(root):unrecognized_keys:2"]);
    expect(JSON.stringify(accepted.dropped)).not.toContain("followUps");
  });

  it("with DROP still refuses a reading whose defined fields are wrong", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({ answer: 7, findings: [], followUps: [] }),
      Schema,
      { unknownRootKeys: "DROP" },
    );
    expect(accepted).toMatchObject({ ok: false, stage: "SCHEMA" });
  });

  it("with DROP never drops an unknown key nested inside a defined field", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({ ...reading, findings: [{ text: "a", invented: 1 }] }),
      Schema,
      { unknownRootKeys: "DROP" },
    );
    expect(accepted).toMatchObject({ ok: false, stage: "SCHEMA" });
  });

  it("keeps the active analyst's own shape example whole beside a root followUps", () => {
    const template =
      createDefaultPromptRegistry().getActive("COMPANY_ANALYST").definition
        .template;
    const json = template.match(
      /JSON SHAPE EXAMPLE\n([^\n]+)\nEND JSON SHAPE EXAMPLE/u,
    )?.[1];
    if (json === undefined) throw new Error("Missing active shape example");
    const example: unknown = JSON.parse(json);
    const options = {
      invalidListItems: "DROP" as const,
      lenientFields: ANALYST_LENIENT_FIELDS,
    };
    const withFollowUps = JSON.stringify({
      ...(example as Record<string, unknown>),
      followUps: ["What is the runway?"],
    });
    expect(
      acceptStructuredOutput(withFollowUps, ANALYST_RESULT_SCHEMA, options).ok,
    ).toBe(false);
    const accepted = acceptStructuredOutput(
      withFollowUps,
      ANALYST_RESULT_SCHEMA,
      { ...options, unknownRootKeys: "DROP" },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value).toEqual(ANALYST_RESULT_SCHEMA.parse(example));
  });
});
