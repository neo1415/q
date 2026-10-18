import type { PromptDefinition } from "../definition.js";
import {
  ARTIFACT_REVISION_SCHEMA_NAME,
  ARTIFACT_REVISION_V2_SCHEMA_VERSION,
  ArtifactRevisionV2ResultSchema,
  type ArtifactRevisionV2Result,
  type ArtifactRevisionVariables,
} from "../schemas/artifact-revision.js";
import { ARTIFACT_REVISION_V1 } from "./artifact-revision.v1.js";

/**
 * ARTIFACT_REVISION v2 (founder live 2026-09-29, ADR 0025): v1's rules for
 * prose, plus a deck's slides and the colours the person named. A change
 * the person asked for is made or visibly not made: "no difference between
 * v1, v2 and v3" is the failure this version exists to end.
 */
const V1_RESPOND =
  "Respond with a single JSON object matching the ArtifactRevisionResult schema: the headings you changed, each with its new body.";

const V2_ADDITIONS = `SLIDES
When the document lists slides, rewrite slide text by the same rules when the instruction concerns it: return each slide you changed by number, with only the title, subtitle or bullets you changed (null for the rest).

LOOK
Only when the instruction names colours or a look: set style. coverBackground is the first page's background, one colour or two for a gradient from the first to the second; coverTitleInk the colour of its title text; accent the deck's accent. Colours as #rrggbb, reading names as a designer would (green #2e7d32 or a lighter #a5d6a7 for a soft gradient, white #ffffff, black #000000). Keep the title readable against the background. Never set a colour they did not ask for; otherwise style is null.

Respond with a single JSON object matching the ArtifactRevisionResult schema: the headings you changed, each with its new body; the slides you changed; and style.`;

if (!ARTIFACT_REVISION_V1.template.includes(V1_RESPOND)) {
  throw new Error(
    "ARTIFACT_REVISION v2 replaces v1's closing line, which v1 no longer carries",
  );
}

export const ARTIFACT_REVISION_V2: PromptDefinition<
  ArtifactRevisionVariables,
  ArtifactRevisionV2Result
> = {
  ...ARTIFACT_REVISION_V1,
  version: 2,
  status: "DEPRECATED",
  changeDescription:
    "Founder live 2026-09-29 (ADR 0025): revises a deck's slide text under v1's rules and sets the cover background, title ink and accent the person named; style is null unless asked for.",
  effectiveFrom: "2026-09-29",
  output: {
    kind: "STRUCTURED",
    schemaName: ARTIFACT_REVISION_SCHEMA_NAME,
    schemaVersion: ARTIFACT_REVISION_V2_SCHEMA_VERSION,
    schema: ArtifactRevisionV2ResultSchema,
  },
  template: ARTIFACT_REVISION_V1.template.replace(V1_RESPOND, V2_ADDITIONS),
};
