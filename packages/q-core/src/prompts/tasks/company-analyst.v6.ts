import type { PromptDefinition } from "../definition.js";
import {
  COMPANY_ANALYST_V2_SCHEMA_NAME,
  COMPANY_ANALYST_V5_UNTRUSTED,
  COMPANY_ANALYST_V6_SCHEMA_VERSION,
  CompanyAnalystV5VariablesSchema,
  CompanyAnalystV6ResultSchema,
  type CompanyAnalystV5Variables,
  type CompanyAnalystV6Result,
} from "../schemas/company-analyst.js";
import { COMPANY_ANALYST_V5 } from "./company-analyst.v5.js";

/**
 * COMPANY_ANALYST v6 — v5, with slides beside prose (QX-004 §2, §3).
 *
 * v5 could read a request for a document and could compose exactly one
 * kind of thing. A founder who says "can you make me a deck" is asking
 * for the same act and a different artifact, and the paragraph says so in
 * the same terms as the rest: the model reads what they meant, and the
 * server decides whether anything is written.
 *
 * A new version rather than an edit to v5, because a published prompt is
 * immutable: a run recorded against `company-analyst/v5` has to stay
 * explainable by the exact template and schema it ran under, and a
 * silently widened v5 would turn that history into a guess.
 *
 * `visualDirection` is here for the same reason `artifactType` is. A
 * founder saying "something darker, more technical" has expressed a
 * preference the composer can act on, and the alternative — a model
 * writing colours and sizes into a deck — is what makes generated decks
 * look identical to one another.
 */
const ANCHOR = "AUTHORISED FACTS\n{{authorisedFacts}}";

const V5_SECTION = `PREPARING A DOCUMENT
If in THIS message they ask for a document about their company (a brief, a one-pager, "something I can send round"), set artifactRequest: kind PREPARE, artifactType INVESTMENT_BRIEF, their words as quote. To change one you already prepared, kind REVISE with what they want changed in instruction. Otherwise null. A question is not a request for a document; you neither write nor store it here.
`;

const V6_SECTION = `PREPARING A DOCUMENT
If in THIS message they ask for a document about their company, set artifactRequest: kind PREPARE, their words as quote, artifactType INVESTMENT_BRIEF for prose (a brief, one-pager) or PITCH_DECK for slides (a deck, pitch). visualDirection MINIMAL_INSTITUTIONAL, DARK_TECHNICAL or WARM_GROWTH if they said how it looks, else null. To change one: kind REVISE, the change in instruction. Otherwise null; a question is not a request.
`;

if (!COMPANY_ANALYST_V5.template.includes(V5_SECTION)) {
  throw new Error(
    "COMPANY_ANALYST v6 rewrites v5's document paragraph, and v5 no longer carries it",
  );
}
if (!COMPANY_ANALYST_V5.template.includes(ANCHOR)) {
  throw new Error(
    "COMPANY_ANALYST v6 derives from v5's template, and v5 no longer carries the section it extends",
  );
}

export const COMPANY_ANALYST_V6: PromptDefinition<
  CompanyAnalystV5Variables,
  CompanyAnalystV6Result
> = {
  ...COMPANY_ANALYST_V5,
  version: 6,
  status: "ACTIVE",
  changeDescription:
    "QX-004: artifactRequest may name PITCH_DECK beside INVESTMENT_BRIEF, and carries a named visual direction when the founder said how it should look. Still a reading and never an act: the answer seam validates the quote, resolves the subject from the run's own plan, and the artifact service persists.",
  effectiveFrom: "2026-09-22",
  variables: {
    schema: CompanyAnalystV5VariablesSchema,
    untrusted: [...COMPANY_ANALYST_V5_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: COMPANY_ANALYST_V2_SCHEMA_NAME,
    schemaVersion: COMPANY_ANALYST_V6_SCHEMA_VERSION,
    schema: CompanyAnalystV6ResultSchema,
  },
  template: COMPANY_ANALYST_V5.template.replace(V5_SECTION, V6_SECTION),
};
