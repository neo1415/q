import type { ActorContext } from "@capital-q/security";
import { ownInvestorOrganisationIn } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  GetCompanyOutputSchema,
  GetInvestorMandateOutputSchema,
} from "@capital-q/q-tools";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

import { NO_OWN_RECORDS, type OwnRecordNames } from "./company/own-names.js";

export type QOwnRecordsPort = {
  readonly read: (request: QAnswerRequest) => Promise<OwnRecordNames>;
};

/**
 * The names on the person's own records, for resolving a name they said
 * (founder live 2026-09-27, failure 6): their company's canonical and
 * legal names, their firm's name and their own name.
 *
 * Every read goes through the tool the model could call, under this run's
 * plan, so nothing here decides a permission: a company is theirs only
 * when get_company says it is OWN, a firm only when the plan binds a
 * mandate to their own investor organisation, and their name only when
 * the firewall granted OWN_ONBOARDING (to nobody but themselves). A read
 * that fails is a name not known, never a failed answer.
 */
export function createToolOwnRecordsPort(dependencies: {
  readonly tools: QToolPort;
  readonly personName?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  readonly logger?: Logger | undefined;
}): QOwnRecordsPort {
  const { tools, logger } = dependencies;
  return {
    read: async (request) => {
      const context = {
        actor: request.actor,
        runId: request.runId,
        correlationId: request.correlationId,
        capability: request.capability,
        plan: request.plan,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      };
      const call = async (name: string, args: Record<string, unknown>) => {
        try {
          const outcome = await tools.execute(
            { callId: `q-own-records-${name}`, name, arguments: args },
            context,
          );
          return outcome.result.ok ? outcome.result.data : null;
        } catch (error: unknown) {
          if (request.signal?.aborted === true) throw error;
          logger?.warn(
            { err: error, qRunId: request.runId, tool: name },
            "an own record's name was not read",
          );
          return null;
        }
      };
      const companyRef = request.subjects.find(
        (subject) => subject.kind === "COMPANY",
      );
      const firmId = ownInvestorOrganisationIn(request.plan);
      const mayReadName = request.plan.scopes.some(
        (scope) =>
          scope.kind === "OWN_ONBOARDING" && scope.subject === undefined,
      );
      const [company, firm, person] = await Promise.all([
        companyRef === undefined || companyRef.kind !== "COMPANY"
          ? null
          : call("get_company", { companyId: companyRef.companyId }),
        firmId === null
          ? null
          : call("get_investor_mandate", { investorOrganisationId: firmId }),
        mayReadName && dependencies.personName !== undefined
          ? dependencies.personName(request.actor).catch(() => null)
          : null,
      ]);
      const ownCompany = GetCompanyOutputSchema.safeParse(company);
      const ownFirm = GetInvestorMandateOutputSchema.safeParse(firm);
      const personName = person?.trim() ?? "";
      return {
        ...NO_OWN_RECORDS,
        company:
          ownCompany.success && ownCompany.data.relationToYou === "OWN"
            ? {
                companyId: ownCompany.data.companyId,
                names: [
                  ownCompany.data.canonicalName,
                  ...(ownCompany.data.legalName === null
                    ? []
                    : [ownCompany.data.legalName]),
                ],
              }
            : null,
        firm: ownFirm.success ? { names: [ownFirm.data.displayName] } : null,
        person: personName.length > 0 ? { names: [personName] } : null,
      };
    },
  };
}
