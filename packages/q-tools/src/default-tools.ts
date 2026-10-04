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
import {
  createResearchPublicWebTool,
  RESEARCH_PUBLIC_WEB,
} from "./tools/research-public-web.js";
import {
  createGetMyPlanTool,
  gateQTool,
  type QToolGate,
} from "./tools/plan.js";
import { createDiscoverySlateTool } from "./tools/discovery-slate.js";
import { createFindProspectiveInvestorsTool } from "./tools/find-prospective-investors.js";
import { createRecommendationExplanationTool } from "./tools/recommendation-explanation.js";
import {
  createApprovePendingProposalTool,
  createDeclinePendingProposalTool,
} from "./tools/pending-proposal.js";
import { createOwnWorkTools } from "./tools/own-work.js";
import { createAppActionTools } from "./tools/app-actions.js";
import { createOwnSettingsTools } from "./tools/own-settings.js";
import { createResultsTools } from "./tools/results.js";
import { createProposeHumanReviewTool } from "./tools/human-review.js";
// DOCS block.
import { createDocumentStudioTools } from "./tools/documents.js";
import { createOwnRecordTools } from "./tools/own-records.js";
import { createRecordChangeTools } from "./tools/record-changes.js";
import { createFillProfileGapsTool } from "./tools/profile-gaps.js";
import { createProposeEmailTool } from "./tools/email.js";
import { createInboundEmailTools } from "./tools/inbound-email.js";
import { createChatTools } from "./tools/chat.js";
import { createErrandTools, PROPOSE_ERRAND } from "./tools/errands.js";
// AUTO block (ADR 0030)
import {
  createQWorkTools,
  PROPOSE_Q_OUTREACH,
  PROPOSE_STAND_IN,
  PROPOSE_STANDING_INSTRUCTION,
} from "./tools/q-work.js";
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
import { createUseCapabilityTool } from "./tools/use-capability.js";

/**
 * The catalogue: four SAFE_READ tools over public query ports, plus the two
 * public-web research tools when a research capability is composed
 * (CQ-Q-RESEARCH-001). No provider means no research tool exists at all.
 */
export function createDefaultQTools(
  ports: QToolPorts,
): readonly AnyQToolDefinition[] {
  // BILLING block (ADR 0034): the plan-controlled tools pass through the
  // plan gate, and the person can ask what their plan includes.
  const entitlements = ports.entitlements;
  const tools = createUngatedQTools(ports);
  if (entitlements === undefined) return tools;
  return [
    ...tools.map((tool) => {
      const gate = Q_TOOL_GATES[tool.id];
      return gate === undefined ? tool : gateQTool(tool, gate, entitlements);
    }),
    createGetMyPlanTool(entitlements),
  ];
  // end BILLING block
}

/**
 * BILLING block (ADR 0034): which Q tools draw on which plan feature.
 * Proposals only CHECK (the unit is taken when the approved action runs);
 * a web research request is itself the metered work.
 */
export const Q_TOOL_GATES: Readonly<Record<string, QToolGate>> = {
  [PROPOSE_ERRAND]: { feature: "q.delegations", mode: "CHECK" },
  [PROPOSE_Q_OUTREACH]: { feature: "q.delegations", mode: "CHECK" },
  [PROPOSE_STAND_IN]: { feature: "q.delegations", mode: "CHECK" },
  [PROPOSE_STANDING_INSTRUCTION]: { feature: "q.delegations", mode: "CHECK" },
  [RESEARCH_PUBLIC_WEB]: { feature: "q.research", mode: "CONSUME" },
};

function createUngatedQTools(ports: QToolPorts): readonly AnyQToolDefinition[] {
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
    // Inbound email: a reply is a propose_email card too.
    ...(ports.email === undefined && ports.inboundEmail === undefined
      ? []
      : [
          createProposeEmailTool(
            ports.email,
            ports.relationships,
            ports.inboundEmail,
          ),
        ]),
    // Inbound email: what arrived at their own Q address, read as fields.
    ...createInboundEmailTools(ports.inboundEmail),
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
    // BIZ-002: every profile field the page edits, Q prepares through the
    // tools generated from the app's action registry (ADR 0040).
    // HARDEN P0 (live 2026-10-02): "search online and fill my profile's
    // gaps" as a tool whose rules are code, not guidance.
    ...(ports.profileChanges === undefined || research === undefined
      ? []
      : [
          createFillProfileGapsTool({
            ...ports,
            research,
            profileChanges: ports.profileChanges,
          }),
        ]),
    // R18: what is said in the pitch being watched, around a moment.
    ...(ports.pitchMoments === undefined
      ? []
      : [createGetPitchMomentTool(ports.pitchMoments)]),
    // CQ-BIZ-003: who can see what, and sharing, prepared for approval.
    ...(ports.visibility === undefined
      ? []
      : createVisibilityTools(ports.visibility)),
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
    // ADR 0040: the app's declared actions and read_my, generated.
    ...createAppActionTools(ports),
    // Action parity (2026-10-02): Settings switches, by asking.
    ...createOwnSettingsTools(ports),
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
    // ADMIN-3: "want a person to look at this?"
    ...(ports.humanReviews === undefined
      ? []
      : [createProposeHumanReviewTool(ports.humanReviews)]),
    // end ADMIN block
    // Lead 2026-10-04: any tool this run may use, loaded mid-turn.
    createUseCapabilityTool(),
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
