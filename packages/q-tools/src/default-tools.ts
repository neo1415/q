import type { Logger } from "@capital-q/observability";
import type { QToolPort } from "@capital-q/q-runtime";

import type { AnyQToolDefinition } from "./definition.js";
import { createQToolExecutor } from "./executor.js";
import type { QToolPorts } from "./ports.js";
import { createQToolRegistry, type QToolRegistry } from "./registry.js";
import { createGetCapitalObjectiveTool } from "./tools/get-capital-objective.js";
import { createGetCompanyTool } from "./tools/get-company.js";
import { createExtractPublicWebTool } from "./tools/extract-public-web.js";
import { createGetInvestorMandateTool } from "./tools/get-investor-mandate.js";
import { createLookupPublicProfileTool } from "./tools/lookup-public-profile.js";
import { createResearchPublicWebTool } from "./tools/research-public-web.js";
import { createDiscoverySlateTool } from "./tools/discovery-slate.js";
import { createFindProspectiveInvestorsTool } from "./tools/find-prospective-investors.js";
import { createRecommendationExplanationTool } from "./tools/recommendation-explanation.js";
import { createProposeProfileChangeTool } from "./tools/profile-change.js";
import { createRelationshipTools } from "./tools/relationships.js";
import { createVisibilityTools } from "./tools/visibility.js";
import { createSearchCompaniesTool } from "./tools/search-companies.js";

/**
 * The catalogue: four SAFE_READ tools over public query ports, plus the two
 * public-web research tools when a research capability is composed
 * (CQ-Q-RESEARCH-001). No provider means no research tool exists at all.
 */
export function createDefaultQTools(
  ports: QToolPorts,
): readonly AnyQToolDefinition[] {
  const research = ports.research;
  const profiles = ports.profiles;
  return [
    createGetCompanyTool(ports),
    createGetCapitalObjectiveTool(ports),
    createGetInvestorMandateTool(ports),
    createSearchCompaniesTool(ports),
    ...(ports.discovery === undefined ? [] : [createDiscoverySlateTool(ports)]),
    ...(ports.discovery === undefined
      ? []
      : [createFindProspectiveInvestorsTool(ports)]),
    ...(ports.recommendationExplanations === undefined
      ? []
      : [createRecommendationExplanationTool(ports)]),
    ...(research === undefined
      ? []
      : [
          createResearchPublicWebTool({ ...ports, research }),
          createExtractPublicWebTool({ ...ports, research }),
        ]),
    ...(profiles === undefined
      ? []
      : [createLookupPublicProfileTool({ ...ports, profiles })]),
    // CQ-Q-030: relationships, when the Network context is composed.
    ...(ports.relationships === undefined
      ? []
      : createRelationshipTools(ports, ports.relationships)),
    // BIZ-002: every profile field the page edits, Q can prepare.
    ...(ports.profileChanges === undefined
      ? []
      : [createProposeProfileChangeTool(ports, ports.profileChanges)]),
    // CQ-BIZ-003: who can see what, and sharing, prepared for approval.
    ...(ports.visibility === undefined
      ? []
      : createVisibilityTools(ports.visibility)),
  ];
}

export type QToolsComposition = {
  readonly registry: QToolRegistry;
  readonly port: QToolPort;
};

/** Registry plus executor over the default catalogue; what apps compose. */
export function createQTools(options: {
  readonly ports: QToolPorts;
  readonly logger?: Logger | undefined;
  readonly definitions?: readonly AnyQToolDefinition[] | undefined;
}): QToolsComposition {
  const registry = createQToolRegistry(
    options.definitions ?? createDefaultQTools(options.ports),
  );
  return {
    registry,
    port: createQToolExecutor({ registry, logger: options.logger }),
  };
}
