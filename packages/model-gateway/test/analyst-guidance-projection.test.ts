import { describe, expect, it } from "vitest";

import { QResultBlockSchema, QSubjectRefSchema } from "@capital-q/contracts";
import {
  CompanyAnalystV22ResultSchema,
  createDefaultPromptRegistry,
} from "@capital-q/q-core";

import { analystResultBlocks } from "../src/q/result-blocks.js";

describe("active analyst guidance through the conversation renderer", () => {
  it("projects the advertised finding shape with runtime-owned subjects and truth axes", () => {
    const template =
      createDefaultPromptRegistry().getActive("COMPANY_ANALYST").definition
        .template;
    const json = template.match(
      /JSON SHAPE EXAMPLE\n([^\n]+)\nEND JSON SHAPE EXAMPLE/u,
    )?.[1];
    if (json === undefined) throw new Error("Missing active shape example");
    const result = CompanyAnalystV22ResultSchema.parse(JSON.parse(json));
    const subjects = [
      QSubjectRefSchema.parse({
        kind: "COMPANY" as const,
        companyId: "00000000-0000-4000-8000-000000000001",
      }),
    ];
    const blocks = analystResultBlocks({ result, subjects }) ?? [];
    const findings = blocks.filter((block) => block.kind === "FINDING");
    expect(findings).toHaveLength(1);
    const block = findings[0];
    if (block?.kind !== "FINDING") throw new Error("Missing native finding");
    expect(QResultBlockSchema.safeParse(block).success).toBe(true);
    expect(block.finding).toMatchObject({
      statement: result.findings[0]?.statement,
      subjects,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      confidence: "LOW",
      evidenceRefs: [],
    });
    // The specialist channel has its own dimensional/citation contract.
    expect(result.companyFindings).toHaveLength(1);
    expect(result.companyFindings[0]?.citations).toEqual(["F1"]);
  });
});
