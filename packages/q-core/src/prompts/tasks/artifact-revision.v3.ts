import type { PromptDefinition } from "../definition.js";
import {
  ARTIFACT_REVISION_SCHEMA_NAME,
  ARTIFACT_REVISION_V3_SCHEMA_VERSION,
  ArtifactRevisionV3ResultSchema,
  type ArtifactRevisionV3Result,
  type ArtifactRevisionVariables,
} from "../schemas/artifact-revision.js";
import { ARTIFACT_REVISION_V2 } from "./artifact-revision.v2.js";

/**
 * ARTIFACT_REVISION v3 (founder live 2026-09-30): the look of any
 * document. "Make the background light brown" on an investment mandate
 * changed nothing under v2, which could only colour a deck's cover.
 */
const V2_LOOK =
  "Only when the instruction names colours or a look: set style. coverBackground is the first page's background, one colour or two for a gradient from the first to the second; coverTitleInk the colour of its title text; accent the deck's accent.";

const V3_LOOK =
  'Only when the instruction names colours or a look: set style. For any document: pageBackground is the background of every page (for a deck, every slide), ink the colour of its text, accent the colour of its headings and highlights. For a deck\'s first page only: coverBackground, one colour or two for a gradient from the first to the second, and coverTitleInk its title colour. "The background" with no page named means pageBackground.';

if (!ARTIFACT_REVISION_V2.template.includes(V2_LOOK)) {
  throw new Error(
    "ARTIFACT_REVISION v3 replaces v2's look rule, which v2 lost",
  );
}

export const ARTIFACT_REVISION_V3: PromptDefinition<
  ArtifactRevisionVariables,
  ArtifactRevisionV3Result
> = {
  ...ARTIFACT_REVISION_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Founder live 2026-09-30: any document's look -- page background, text colour and accent -- not only a deck's cover; style is still null unless asked for.",
  effectiveFrom: "2026-09-30",
  output: {
    kind: "STRUCTURED",
    schemaName: ARTIFACT_REVISION_SCHEMA_NAME,
    schemaVersion: ARTIFACT_REVISION_V3_SCHEMA_VERSION,
    schema: ArtifactRevisionV3ResultSchema,
  },
  template: ARTIFACT_REVISION_V2.template.replace(V2_LOOK, V3_LOOK),
};
