import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_PARAMETER_LABELS,
  type FitProfileDto,
  type ModelDataPosture,
  type ModelSensitivity,
  type QViewDto,
} from "@capital-q/contracts";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  FitQViewResultSchema,
  renderPrompt,
  type FitQViewResult,
  type FitQViewVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import { budgetForTaskClass } from "@capital-q/model-gateway/q";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";

/**
 * Q's view beside a computed fit (founder brief B4; ADR 0052).
 *
 *   fit model (code)   the band, the confidence, nine rows; fixed
 *   this file          Worth a look / Maybe / Probably not, in Q's words
 *
 * The model is given the reader's own fit rows and the company's
 * network-visible line, nothing else: no snapshot, no mandate text, no
 * private company material (Context Firewall). It cannot alter the fit:
 * the caller keeps the profile and shows this beside it, labelled, as a
 * Q_INFERENCE. Every failure is in-band UNAVAILABLE and the card simply
 * shows no view; the fit is unaffected.
 */

export type FitQViewRequest = {
  readonly tenantId: string;
  readonly userId: string;
  readonly correlationId: string;
  readonly companyName: string;
  /** Network-visible one-liner. Untrusted content, fenced by the prompt. */
  readonly companyLine: string | null;
  readonly profile: FitProfileDto;
  readonly signal?: AbortSignal | undefined;
};

export type FitQViewer = {
  readonly view: (request: FitQViewRequest) => Promise<QViewDto>;
};

export type FitQViewerDependencies = {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly sensitivity?: ModelSensitivity | undefined;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
};

/** Anything that turns a view into a quantity or a prediction. */
const FORBIDDEN =
  /%|\b(per cent|percent|percentage|probability|likelihood|odds|score[sd]?|scoring|out of (ten|10)|will invest|guaranteed?)\b/i;

/**
 * Mechanical grounding: no quantity words, and every figure the view
 * mentions appears in what it was given. Returns the rule that failed.
 */
export function fitQViewGroundingFailure(
  result: FitQViewResult,
  supplied: string,
): string | null {
  const text = [result.summary, result.mainRisk ?? "", ...result.unknowns].join(
    " ",
  );
  if (FORBIDDEN.test(text)) return "QUANTITY_CLAIMED";
  const figures = text.match(/\d[\d.,]*/g) ?? [];
  for (const figure of figures) {
    const bare = figure.replace(/[.,]+$/, "");
    if (!supplied.includes(bare)) return "FIGURE_NOT_SUPPLIED";
  }
  return null;
}

export function createFitQViewer(
  dependencies: FitQViewerDependencies,
): FitQViewer {
  const { gateway, logger } = dependencies;
  const registry = dependencies.registry ?? createDefaultPromptRegistry();

  return {
    view: async (request) => {
      const unavailable: QViewDto = {
        status: "UNAVAILABLE",
        companyId: request.profile.companyId,
      };
      // A declared exclusion is the investor's own rule; Q has no view to add.
      if (request.profile.band === "OUTSIDE_MANDATE") return unavailable;

      const rows = request.profile.parameters.map((p) => ({
        parameter: FIT_PARAMETER_LABELS[p.parameter],
        outcome: p.applicable ? p.outcome : ("NO_PREFERENCE" as const),
        reason: p.reason,
      }));
      const companyDescription = [
        request.companyName,
        request.companyLine ?? "",
      ]
        .filter((s) => s.length > 0)
        .join(": ")
        .slice(0, 400);
      const fitLabel = `${FIT_BAND_LABELS[request.profile.band]}, ${FIT_CONFIDENCE_LABELS[request.profile.confidence].toLowerCase()}`;

      let rendered;
      try {
        rendered = renderPrompt<FitQViewVariables>(registry, {
          task: "FIT_Q_VIEW",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You are giving a short view beside a fit Capital Q already computed. You cannot change the fit or any row.",
          variables: { rows, fitLabel, companyDescription },
        });
      } catch (error: unknown) {
        logger?.warn({ err: error }, "fit Q view prompt did not render");
        return unavailable;
      }

      let result: FitQViewResult | undefined;
      try {
        const response = await gateway.execute<FitQViewResult>(
          {
            taskClass: "NORMAL_DIALOGUE",
            budget: budgetForTaskClass("NORMAL_DIALOGUE"),
            sensitivity: dependencies.sensitivity ?? "NETWORK_VISIBLE",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              tenantId: request.tenantId,
              userId: request.userId,
              correlationId: request.correlationId,
            },
          },
          {
            schema: FitQViewResultSchema,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        if (response.output.kind === "STRUCTURED")
          result = response.output.value;
      } catch (error: unknown) {
        const failureClass = (error as { failureClass?: string }).failureClass;
        logger?.warn(
          { failureClass: failureClass ?? "UNKNOWN" },
          "fit Q view was not formed by a model",
        );
        return unavailable;
      }
      if (result === undefined) return unavailable;

      const supplied = [companyDescription, ...rows.map((r) => r.reason)].join(
        " ",
      );
      const ungrounded = fitQViewGroundingFailure(result, supplied);
      if (ungrounded !== null) {
        logger?.warn({ rule: ungrounded }, "fit Q view was not grounded");
        return unavailable;
      }
      return {
        status: "READY",
        companyId: request.profile.companyId,
        verdict: result.verdict,
        summary: result.summary,
        mainRisk: result.mainRisk,
        unknowns: result.unknowns,
        truthClass: "Q_INFERENCE",
        configVersion: request.profile.configVersion,
      };
    },
  };
}
