/** Test-only SSR boundary: React and ReactDOM belong to the web package. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UnicornPotentialDto } from "@capital-q/contracts";
import { UnicornPotential } from "../../src/features/scores/unicorn-potential.js";

export function renderSyntheticUnicornAssessment(
  companyId: string,
  score: UnicornPotentialDto,
): string {
  return renderToStaticMarkup(
    createElement(UnicornPotential, { companyId, score }),
  );
}
