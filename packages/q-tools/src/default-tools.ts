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
import { createResultsTools } from "./tools/results.js";
// DOCS block.
import { createDocumentStudioTools } from "./tools/documents.js";
import { createOwnRecordTools } from "./tools/own-records.js";
import { createRecordChangeTools } from "./tools/record-changes.js";
import { createProposeProfileChangeTool } from "./tools/profile-change.js";
import { createProposeEmailTool } from "./tools/email.js";
import { createChatTools } from "./tools/chat.js";
import { createErrandTools } from "./tools/errands.js";
// AUTO block (ADR 0030)
import { createQWorkTools } from "./tools/q-work.js";
import { createScheduleTools } from "./tools/schedule.js";
import { createRelationshipTools } from "./tools/relationships.js";
import { createGetPitchMomentTool } from "./tools/pitch-moment.js";
import { createVisibilityTools } from "./tools/visibility.js";
import { createQDailyTools } from "./tools/daily.js";
import { createSearchCompaniesTool } from "./tools/search-companies.js";
import { createClientActionTools } from "./tools/client-actions.js";
import {
  createOnboardingReminderTools,
  createSetOnboardingRemindersTool,
} from "./tools/onboarding-reminders.js";
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
    // R34: the relationship chat, read and prepared for approval.
    ...(ports.chat === undefined || ports.relationships === undefined
      ? []
      : createChatTools(ports.chat, ports.relationships)),
    // Founder direction 2026-09-29: errands, on the same board.
    ...(ports.chat === undefined || ports.relationships === undefined
      ? []
      : createErrandTools(ports, ports.chat, ports.relationships)),
    // AUTO block (ADR 0030): "Q, handle it" -- outreach, stand-in, and
    // following, answering and stopping them, from any Q surface.
    ...(ports.work === undefined ? [] : createQWorkTools(ports.work)),
    // BIZ-008: calls and reminders, prepared on the same board.
    ...(ports.schedule === undefined ||
    ports.chat === undefined ||
    ports.relationships === undefined
      ? []
      : createScheduleTools(ports.schedule, ports.chat, ports.relationships)),
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
    // Setup reminders: later / stop, and back to their own setup. The
    // continue tool is a client action, so it needs a screen too.
    ...(ports.onboardingReminders === undefined
      ? []
      : ports.clientActions === true
        ? createOnboardingReminderTools(ports.onboardingReminders)
        : [createSetOnboardingRemindersTool(ports.onboardingReminders)]),
    // R33: their approvals inbox, their documents, Save / Unsave / Pass.
    ...createOwnWorkTools(ports),
    // DOCS block: brand kit, a document's audit, their brand applied.
    ...createDocumentStudioTools(ports),
    // DAILY block: The Q Daily, read and set by their own Q.
    ...(ports.daily === undefined ? [] : createQDailyTools(ports.daily)),
    // R33: the record forms as Prepare → Approve, and their own records.
    ...(ports.recordChanges === undefined
      ? []
      : createRecordChangeTools(ports, ports.recordChanges)),
    ...createOwnRecordTools(ports),
    // ADMIN block: "how is my raise going", "download my pipeline report".
    ...createResultsTools(ports),
    // end ADMIN block
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
