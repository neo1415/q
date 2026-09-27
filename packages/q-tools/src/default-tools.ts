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
import { createProposeHandleClaimTool } from "./tools/handle-claim.js";
import {
  createApprovePendingProposalTool,
  createDeclinePendingProposalTool,
} from "./tools/pending-proposal.js";
import { createOwnWorkTools } from "./tools/own-work.js";
import { createProposeProfileChangeTool } from "./tools/profile-change.js";
import { createProposeEmailTool } from "./tools/email.js";
import { createRelationshipTools } from "./tools/relationships.js";
import { createGetPitchMomentTool } from "./tools/pitch-moment.js";
import { createVisibilityTools } from "./tools/visibility.js";
import { createSearchCompaniesTool } from "./tools/search-companies.js";
import { createClientActionTools } from "./tools/client-actions.js";
import { createGetQCardTool } from "./tools/q-card.js";

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
    // BIZ-007: "email the founder", drafted for the person's approval.
    ...(ports.email === undefined
      ? []
      : [createProposeEmailTool(ports.email, ports.relationships)]),
    // BIZ-002: every profile field the page edits, Q can prepare.
    ...(ports.profileChanges === undefined
      ? []
      : [createProposeProfileChangeTool(ports, ports.profileChanges)]),
    // R18: what is said in the pitch being watched, around a moment.
    ...(ports.pitchMoments === undefined
      ? []
      : [createGetPitchMomentTool(ports.pitchMoments)]),
    // CQ-BIZ-003: who can see what, and sharing, prepared for approval.
    ...(ports.visibility === undefined
      ? []
      : createVisibilityTools(ports.visibility)),
    // BIZ-004: "make me a Q card" / "change our handle".
    ...(ports.handleClaims === undefined
      ? []
      : [createProposeHandleClaimTool(ports, ports.handleClaims)]),
    // Approval by conversation: the one waiting change, approved as the
    // card approves it (live test 2026-09-27 #1).
    ...(ports.pendingProposals === undefined
      ? []
      : [createApprovePendingProposalTool(ports.pendingProposals)]),
    // R33: "no, don't" to a waiting change, as the card's Decline does.
    ...(ports.pendingProposals?.decline === undefined
      ? []
      : [
          createDeclinePendingProposalTool(
            ports.pendingProposals,
            ports.pendingProposals.decline,
          ),
        ]),
    // Founder live test 2026-09-27 #4: "is my card saved?".
    ...(ports.qCards === undefined
      ? []
      : [createGetQCardTool(ports, ports.qCards)]),
    // R20/R33: the app's own actions in their browser (theme, reload,
    // their own website), where a screen reads the answer.
    ...(ports.clientActions === true ? createClientActionTools(ports) : []),
    // R33: their approvals inbox, their documents, Save / Unsave / Pass.
    ...createOwnWorkTools(ports),
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
