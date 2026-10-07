import { describe, expect, it } from "vitest";

import {
  ArtifactRequestV3Schema,
  COMPANY_ANALYST_V18,
  COMPANY_ANALYST_V19,
  CompanyAnalystV19ResultSchema,
  createDefaultPromptRegistry,
  V18_DOCUMENT_TYPES,
  V19_DOCUMENT_TYPES,
} from "../src/index.js";

/** Q room W5 (R8): one-pagers and memos, as a new version. */
describe("COMPANY_ANALYST v19", () => {
  it("changes only the document types line, and v18 is kept (v20 is active)", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(21);
    expect(COMPANY_ANALYST_V18.status).toBe("DEPRECATED");
    expect(COMPANY_ANALYST_V19.template).toContain(V19_DOCUMENT_TYPES);
    expect(COMPANY_ANALYST_V19.template).not.toContain(V18_DOCUMENT_TYPES);
    expect(
      COMPANY_ANALYST_V19.template.replace(
        V19_DOCUMENT_TYPES,
        V18_DOCUMENT_TYPES,
      ),
    ).toBe(COMPANY_ANALYST_V18.template);
  });

  it("reads ONE_PAGER and MEMO, and still refuses a type nothing composes", () => {
    const ask = (artifactType: string) =>
      ArtifactRequestV3Schema.safeParse({
        kind: "PREPARE",
        artifactType,
        quote: "Write me a one-pager",
      }).success;
    expect(ask("ONE_PAGER")).toBe(true);
    expect(ask("MEMO")).toBe(true);
    expect(ask("PITCH_DECK")).toBe(true);
    expect(ask("SPREADSHEET")).toBe(false);
    expect(
      CompanyAnalystV19ResultSchema.shape.artifactRequest.unwrap().unwrap(),
    ).toBe(ArtifactRequestV3Schema);
  });
});
