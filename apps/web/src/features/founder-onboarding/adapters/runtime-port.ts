import {
  createRuntimeClient,
  type JourneyModel,
  type RuntimePort,
} from "../../onboarding-kit/runtime-port";
import {
  currentGroup,
  GROUPS,
  groupById,
  isSupportedVersion,
  planSubmissions,
  describeSuggestion,
  toPresentation,
  type PresentationExtras,
} from "../models/journey";
import type {
  FounderOnboardingSessionView,
  StepResponse,
} from "../models/presentation";
import type { FounderOnboardingClient } from "./client";

export type { RuntimePort } from "../../onboarding-kit/runtime-port";

/** The founder journey as the kit's runtime client sees it. */
export const FOUNDER_JOURNEY_MODEL: JourneyModel<
  FounderOnboardingSessionView,
  StepResponse,
  PresentationExtras
> = {
  groups: GROUPS,
  groupById,
  currentGroup,
  isSupportedVersion,
  planSubmissions,
  toPresentation,
  enrich: async (view, group, port) => {
    if (group.id === "materials") {
      // The documents and where each one really is, read from the Evidence
      // API on every load. The browser remembers nothing, so there is
      // nothing for it to remember wrongly.
      const companyId =
        view.session.subject?.type === "COMPANY"
          ? view.session.subject.id
          : undefined;
      const list = port.listMaterials;
      if (companyId === undefined || list === undefined) {
        return { materials: [] };
      }
      return { materials: await list(companyId) };
    }
    if (group.id === "review") {
      // Straight from the session's own pending suggestions. Nothing is
      // reconstructed and nothing is invented: an empty list means Q has
      // proposed nothing, which is what F3 then says.
      return {
        suggestions: view.pendingSuggestions.flatMap((suggestion) => {
          const described = describeSuggestion(suggestion);
          return described === null ? [] : [described];
        }),
      };
    }
    if (group.id !== "categories") {
      return {};
    }
    const response = view.responses.find(
      (r) => r.stepKey === group.stepKeys[0],
    );
    const ids =
      response?.value.type === "RESOURCE_REFERENCE"
        ? response.value.resourceIds
        : [];
    return {
      selectedTaxonomy: ids.length === 0 ? [] : await port.describeNodes(ids),
    };
  },
};

export function createRuntimeFounderClient(
  port: RuntimePort,
  source: { readonly adapter: string; readonly synthetic: boolean },
): FounderOnboardingClient {
  return createRuntimeClient(port, FOUNDER_JOURNEY_MODEL, source);
}
