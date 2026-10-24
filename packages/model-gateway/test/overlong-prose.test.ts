import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createDefaultPromptRegistry } from "@capital-q/q-core";

import { acceptStructuredOutput, clipProse } from "../src/policy/structured.js";
import {
  ANALYST_LENIENT_FIELDS,
  ANALYST_RESULT_SCHEMA,
} from "../src/q/index.js";

/**
 * QA 2026-10-24 (run 4c314618): a long, correct answer was refused as
 * "answer:too_big", then "sections.0.body:too_big", and thrown away for its
 * length. Prose over its bound is clipped and kept; ids and codes are not.
 */
const sentence = "Ledgerfold grew revenue 3x in twelve months. ";

describe("prose longer than its bound", () => {
  it("keeps the active analyst's answer, clipped at a sentence end", () => {
    const template =
      createDefaultPromptRegistry().getActive("COMPANY_ANALYST").definition
        .template;
    const json = template.match(
      /JSON SHAPE EXAMPLE\n([^\n]+)\nEND JSON SHAPE EXAMPLE/u,
    )?.[1];
    if (json === undefined) throw new Error("Missing active shape example");
    const example = JSON.parse(json) as Record<string, unknown>;
    // The answer's own bound, as the schema states it.
    const bound = ANALYST_RESULT_SCHEMA.safeParse({
      ...example,
      answer: "x".repeat(100_000),
    }).error?.issues.find((issue) => issue.path.join(".") === "answer");
    const TEXT_MAX = Number(
      (bound as { readonly maximum?: unknown } | undefined)?.maximum,
    );
    expect(TEXT_MAX).toBeGreaterThan(1_000);
    const long = sentence.repeat(Math.ceil((TEXT_MAX * 1.3) / sentence.length));
    const accepted = acceptStructuredOutput(
      JSON.stringify({ ...example, answer: long }),
      ANALYST_RESULT_SCHEMA,
      {
        invalidListItems: "DROP",
        lenientFields: ANALYST_LENIENT_FIELDS,
        unknownRootKeys: "DROP",
      },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.answer.length).toBeLessThanOrEqual(TEXT_MAX);
    expect(accepted.value.answer.length).toBeGreaterThan(TEXT_MAX / 2);
    expect(accepted.value.answer).toMatch(/months\.$/u);
    expect(accepted.dropped).toContain("answer:too_big:clipped");
  });

  it("clips inside a list element too (a section body)", () => {
    const Schema = z
      .object({
        sections: z.array(
          z.object({ title: z.string(), body: z.string().trim().max(400) }),
        ),
      })
      .strict();
    const accepted = acceptStructuredOutput(
      JSON.stringify({
        sections: [{ title: "Traction", body: sentence.repeat(20) }],
      }),
      Schema,
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.sections[0]?.body.length).toBeLessThanOrEqual(400);
  });

  it("still refuses an over-long id or code, and prose when asked to", () => {
    const Schema = z.object({
      code: z.string().max(40),
      body: z.string().max(300),
    });
    expect(
      acceptStructuredOutput(
        JSON.stringify({ code: "x".repeat(41), body: "fine" }),
        Schema,
      ).ok,
    ).toBe(false);
    expect(
      acceptStructuredOutput(
        JSON.stringify({ code: "ok", body: sentence.repeat(10) }),
        Schema,
        { overlongProse: "REFUSE" },
      ).ok,
    ).toBe(false);
  });

  it("never cuts mid-word", () => {
    const words = "word ".repeat(100).trim();
    const cut = clipProse(words, 203);
    expect(cut.length).toBeLessThanOrEqual(203);
    expect(cut).toMatch(/word…$/u);
    expect(clipProse("Short.", 300)).toBe("Short.");
  });
});
