import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  PROMPT_EMPTY_CASES,
  renderPrompt,
  type PromptId,
} from "../src/index.js";

/**
 * Class fix (2026-10-30): an empty prompt field renders "(not provided)",
 * and prompts whose rules turn on a field being empty misread it
 * (RESEARCH_PLAN and JOB_PLAN each returned nothing). Every audited
 * prompt is rendered here with its empty-case values, and the section
 * must state the case in its own words, never "(not provided)".
 */

const FRAME = new Set([
  "operatingMode",
  "communicationProfile",
  "communicationGuidance",
  "environmentNotes",
]);

type Def = {
  readonly type: string;
  readonly innerType?: z.ZodType;
  readonly element?: z.ZodType;
  readonly shape?: Record<string, z.ZodType>;
  readonly entries?: Record<string, string>;
  readonly checks?: readonly {
    readonly _zod: {
      readonly def: Def & {
        readonly check?: string;
        readonly minimum?: number;
        readonly value?: number;
      };
    };
  }[];
};

function defOf(schema: z.ZodType): Def {
  return (schema as unknown as { readonly _zod: { readonly def: Def } })._zod
    .def;
}

/** A schema-valid sample for one variable: enough to render, nothing more. */
function sample(schema: z.ZodType): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case "default":
    case "optional":
    case "nullable":
    case "catch":
      return def.innerType === undefined ? null : sample(def.innerType);
    case "string":
      return "Sample words.";
    case "number": {
      const min = def.checks
        ?.map((check) => check._zod.def)
        .find((one) => one.check === "greater_than");
      return min?.value ?? 1;
    }
    case "boolean":
      return false;
    case "enum":
      return Object.values(def.entries ?? {})[0];
    case "array":
      return [];
    case "object":
      return Object.fromEntries(
        Object.entries(def.shape ?? {}).map(([key, value]) => [
          key,
          sample(value),
        ]),
      );
    default:
      return null;
  }
}

/** Per-prompt values a generic sample cannot satisfy (formats, minimums). */
const OVERRIDES: Partial<Record<PromptId, Record<string, unknown>>> = {
  TURN_READER: { modality: "TEXT" },
  PLAN_WRITE: { today: "2026-10-30" },
  FIT_EXPLANATION: {
    factors: [{ factor: "Stage", kind: "HARD_CONSTRAINT", outcome: "MATCHED" }],
  },
};

const registry = createDefaultPromptRegistry();

function renderWith(id: PromptId, overrides: Record<string, unknown>): string {
  const definition = registry.getActive(id).definition;
  const shape = (
    definition.variables.schema as unknown as {
      readonly shape: Record<string, z.ZodType>;
    }
  ).shape;
  const variables: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape)) {
    if (FRAME.has(key)) continue;
    variables[key] = sample(schema);
  }
  Object.assign(variables, OVERRIDES[id] ?? {}, overrides);
  const checked = definition.variables.schema.safeParse({
    ...variables,
    operatingMode: "CONTINUOUS_INTELLIGENCE",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    communicationGuidance: "",
    environmentNotes: "test",
  });
  if (!checked.success) {
    throw new Error(
      `${id} sample is invalid: ${checked.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.code}`)
        .join("; ")}`,
    );
  }
  return renderPrompt(registry, {
    task: id,
    operatingMode: "CONTINUOUS_INTELLIGENCE",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    environmentNotes: "test",
    variables,
  })
    .messages.map((message) => message.content)
    .join("\n");
}

/** The line in the template just before a variable's token, or its own line. */
function headerOf(template: string, variable: string): string {
  const lines = template.split("\n");
  const at = lines.findIndex((line) => line.includes(`{{${variable}}}`));
  if (at < 0) return "";
  const own = lines[at] ?? "";
  const header =
    own.trim() !== `{{${variable}}}`
      ? own.slice(0, own.indexOf(`{{${variable}}}`))
      : (lines[at - 1] ?? "");
  // Up to any other token in it: the rendered header holds its value.
  return header.split("{{")[0]?.trim() ?? "";
}

const CASES = Object.entries(PROMPT_EMPTY_CASES).flatMap(([id, values]) =>
  Object.entries(values).map(
    ([variable, text]) => [id as PromptId, variable, text] as const,
  ),
);

describe("empty prompt fields say what they mean", () => {
  it.each(CASES)(
    "%s.%s renders its empty case plainly",
    (id, variable, text) => {
      const template = registry.getActive(id).definition.template;
      expect(template).toContain(`{{${variable}}}`);
      expect(text).not.toBe("(not provided)");
      const rendered = renderWith(id, { [variable]: text });
      const header = headerOf(template, variable);
      // The section, from its header to the end of the case's text, holds
      // the case said in words and no "(not provided)".
      const start = header.length > 0 ? rendered.indexOf(header) : 0;
      expect(start).toBeGreaterThanOrEqual(0);
      const end = rendered.indexOf(text, start);
      expect(end).toBeGreaterThan(-1);
      expect(rendered.slice(start, end + text.length)).not.toContain(
        "(not provided)",
      );
    },
  );

  it("each value names the case the way the prompt's rule does", () => {
    const named: readonly (readonly [PromptId, string, RegExp])[] = [
      ["INTERVIEW_AGENT", "thisTurn", /empty/i],
      ["DELEGATION_READER", "askedStep", /^null/],
      ["FIT_EXPLANATION", "overallFit", /none was supplied/i],
      ["GATEQ_INTERVIEWER", "utterance", /empty.*first turn/i],
      ["WORK_CONVERSE", "brief", /empty/i],
      ["WORK_CONVERSE", "topicsOpen", /empty/i],
      ["MEETING_HOST_TURN", "seen", /empty: nothing is shown/i],
      ["MEETING_HOST_TURN", "prepared", /empty/i],
      ["CALL_PREP", "soFar", /^Nothing is given/],
      ["WELCOME_CONDUCTOR", "knownName", /^null$/],
      ["JOB_PLAN", "priorAnswer", /^\(none\)$/],
      ["RESEARCH_PLAN", "gaps", /first round/i],
      ["PLAN_WRITE", "priorPlan", /MODE is NEW/],
    ];
    const cases = PROMPT_EMPTY_CASES as Record<string, Record<string, string>>;
    for (const [id, variable, says] of named) {
      expect(cases[id]?.[variable], `${id}.${variable}`).toMatch(says);
    }
  });

  /**
   * The guard: a section header in an active prompt that describes what
   * the field holds when it is empty ("empty when none", "null when
   * none", "(none)", "first round") has a value here, or a reason below
   * why the rendered empty value already says it.
   */
  const SAYS_IT_ALREADY: Readonly<Record<string, string>> = {
    // A list renders as "[]", which is plainly an empty list.
    "INVESTOR_MANDATE_SYNTHESIS.observedBehaviour": "array: renders []",
    // Names the profile's empty fields; code calls it only when some are
    // open (profile-gap-reader.ts), so the list itself is never empty.
    "PROFILE_GAP_READER.openFields": "never empty when called",
  };
  const EMPTY_HEADER =
    /\b(empty|null when none|\(none\)|first round|first turn|may be empty)\b/i;

  it("every active prompt's empty-keyed section is covered", () => {
    const cases = PROMPT_EMPTY_CASES as Record<string, Record<string, string>>;
    const missing: string[] = [];
    for (const record of registry.list()) {
      const definition = record.definition;
      if (definition.status !== "ACTIVE") continue;
      const tokens = new Set(
        [...definition.template.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(
          (match) => match[1] ?? "",
        ),
      );
      for (const variable of tokens) {
        if (FRAME.has(variable)) continue;
        const header = headerOf(definition.template, variable);
        if (!EMPTY_HEADER.test(header)) continue;
        const key = `${definition.id}.${variable}`;
        if (cases[definition.id]?.[variable] !== undefined) continue;
        if (SAYS_IT_ALREADY[key] !== undefined) continue;
        missing.push(`${key} (${header.slice(0, 80)})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
