import { z } from "zod";

import {
  CompanyIdSchema,
  toCompanyDto,
  toCompanyMemberDto,
  toCompanyTeamFactsDto,
  toFounderProfileDto,
} from "@capital-q/companies";
import {
  ClaimHandleRequestSchema,
  CompanyDtoSchema,
  CompanyMemberDtoSchema,
  CompanyTeamFactsDtoSchema,
  FounderProfileDtoSchema,
  InvestorOrganisationDtoSchema,
  InvestorRepresentativeDtoSchema,
  QCardDtoSchema,
  QCardSubjectTypeSchema,
  UpdateCompanyRequestSchema,
  UpdateCompanyTeamFactsRequestSchema,
  UpdateInvestorOrganisationRequestSchema,
  UpdateMyFounderProfileRequestSchema,
  UpdateQCardRequestSchema,
  UpsertMyCompanyMembershipRequestSchema,
  UpsertMyInvestorRepresentativeRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";
import {
  InvestorOrganisationIdSchema,
  toInvestorOrganisationDto,
  toInvestorRepresentativeDto,
} from "@capital-q/investors";

import type { CompanyService } from "@capital-q/companies";
import type { InvestorService } from "@capital-q/investors";
import type { PublicIdentityService } from "@capital-q/public-identity";

import { defineAppAction, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Profile and records (ADR 0040 checklist, first L area). Each screen
 * write is declared once and its route is generated: the person's own
 * edit, through the same service, under its own capability check. For Q
 * these are CONSEQUENTIAL; the hand-written proposal tools still serve Q
 * until the area's tools migrate (`legacyTool`), so nothing Q does here
 * changes in this step.
 */

const missing = (port: string): never => {
  throw new Error(`APP_ACTION_PORT_MISSING:${port}`);
};

/** What the service returned; its own type is the contract. */
const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The services own the authorization; a declaration adds no looser path. */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const companyBody = <T extends z.ZodType>(body: T) =>
  z.object({ companyId: CompanyIdSchema, input: body }).strict();
const investorBody = <T extends z.ZodType>(body: T) =>
  z
    .object({
      investorOrganisationId: InvestorOrganisationIdSchema,
      input: body,
    })
    .strict();

const fromCompany = (params: Record<string, string>, body: unknown) => ({
  companyId: params["companyId"],
  input: body,
});
const fromInvestor = (params: Record<string, string>, body: unknown) => ({
  investorOrganisationId: params["investorOrganisationId"],
  input: body,
});

const card = (summary: string) => () => ({
  summary,
  preview: "The change is applied exactly as shown once approved.",
});

async function companyPitch(ports: AppActionPorts, companyId: string) {
  return ports.companyPitch === undefined
    ? null
    : await ports.companyPitch(companyId).catch(() => null);
}

const CompanyUpdate = companyBody(UpdateCompanyRequestSchema);
const CompanyTeamMe = companyBody(UpsertMyCompanyMembershipRequestSchema);
const FounderProfileMe = companyBody(UpdateMyFounderProfileRequestSchema);
const TeamFacts = companyBody(UpdateCompanyTeamFactsRequestSchema);
const InvestorUpdate = investorBody(UpdateInvestorOrganisationRequestSchema);
const RepresentativeMe = investorBody(
  UpsertMyInvestorRepresentativeRequestSchema,
);
const QCardSubject = z
  .object({ subjectType: QCardSubjectTypeSchema, subjectId: UuidSchema })
  .strict();
const HandleClaim = z
  .object({ subject: QCardSubject, input: ClaimHandleRequestSchema })
  .strict();
const QCardUpdate = z
  .object({ subject: QCardSubject, input: UpdateQCardRequestSchema })
  .strict();

const fromCard = (params: Record<string, string>, body: unknown) => ({
  subject: {
    subjectType: params["subjectType"],
    subjectId: params["subjectId"],
  },
  input: body,
});

export const PROFILE_AND_RECORDS: readonly AnyAppAction[] = [
  defineAppAction<
    z.infer<typeof CompanyUpdate>,
    Awaited<ReturnType<CompanyService["updateCompany"]>>
  >({
    name: "company.profile.update",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Changes their company profile's declared fields, as the profile page's Save does.",
    input: CompanyUpdate,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      (ports.companies ?? missing("companies")).updateCompany({
        actor: context.actor,
        companyId: input.companyId,
        input: input.input,
        correlationId: context.correlationId,
      }),
    targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
    card: card("Update your company profile"),
    done: () => "Your company profile is updated.",
    http: {
      method: "PATCH",
      path: "/v1/companies/:companyId",
      fromRequest: fromCompany,
      respond: async (out, input, ports) => {
        const company = out;
        return CompanyDtoSchema.parse({
          ...toCompanyDto(company),
          pitch: await companyPitch(ports, input.companyId),
        });
      },
    },
    legacyTool: "propose_profile_change",
  }),
  defineAppAction<
    z.infer<typeof CompanyTeamMe>,
    Awaited<ReturnType<CompanyService["upsertMyCompanyMembership"]>>
  >({
    name: "company.team.me.upsert",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Records their own place on their company's team, as the team page does.",
    input: CompanyTeamMe,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      (ports.companies ?? missing("companies")).upsertMyCompanyMembership({
        actor: context.actor,
        companyId: input.companyId,
        input: input.input,
        correlationId: context.correlationId,
      }),
    targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
    card: card("Update your place on the team"),
    done: () => "Your place on the team is updated.",
    http: {
      method: "PUT",
      path: "/v1/companies/:companyId/team/me",
      fromRequest: fromCompany,
      respond: (out) => CompanyMemberDtoSchema.parse(toCompanyMemberDto(out)),
    },
    legacyTool: "propose_team_change",
  }),
  defineAppAction<
    z.infer<typeof FounderProfileMe>,
    Awaited<ReturnType<CompanyService["updateMyFounderProfile"]>>
  >({
    name: "company.founder_profile.me.update",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Changes their own founder profile, as the team page does.",
    input: FounderProfileMe,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      (ports.companies ?? missing("companies")).updateMyFounderProfile({
        actor: context.actor,
        companyId: input.companyId,
        input: input.input,
        correlationId: context.correlationId,
      }),
    targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
    card: card("Update your founder profile"),
    done: () => "Your founder profile is updated.",
    http: {
      method: "PATCH",
      path: "/v1/companies/:companyId/founder-profile/me",
      fromRequest: fromCompany,
      respond: (out) => FounderProfileDtoSchema.parse(toFounderProfileDto(out)),
    },
    legacyTool: "propose_team_change",
  }),
  defineAppAction<
    z.infer<typeof TeamFacts>,
    Awaited<ReturnType<CompanyService["updateCompanyTeamFacts"]>>
  >({
    name: "company.team_facts.update",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Changes their company's team facts (size, roles), as the team page does.",
    input: TeamFacts,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      (ports.companies ?? missing("companies")).updateCompanyTeamFacts({
        actor: context.actor,
        companyId: input.companyId,
        input: input.input,
        correlationId: context.correlationId,
      }),
    targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
    card: card("Update your team facts"),
    done: () => "Your team facts are updated.",
    http: {
      method: "PATCH",
      path: "/v1/companies/:companyId/team-facts",
      fromRequest: fromCompany,
      respond: (out) =>
        CompanyTeamFactsDtoSchema.parse(toCompanyTeamFactsDto(out)),
    },
    legacyTool: "propose_team_change",
  }),
  defineAppAction<
    z.infer<typeof InvestorUpdate>,
    Awaited<ReturnType<InvestorService["updateInvestorOrganisation"]>>
  >({
    name: "investor.profile.update",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Changes their investor organisation's declared profile, as its page does.",
    input: InvestorUpdate,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      (ports.investors ?? missing("investors")).updateInvestorOrganisation({
        actor: context.actor,
        investorOrganisationId: input.investorOrganisationId,
        input: input.input,
        correlationId: context.correlationId,
      }),
    targets: (input) => [
      {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: input.investorOrganisationId,
      },
    ],
    card: card("Update your investor profile"),
    done: () => "Your investor profile is updated.",
    http: {
      method: "PATCH",
      path: "/v1/investors/:investorOrganisationId",
      fromRequest: fromInvestor,
      respond: (out) =>
        InvestorOrganisationDtoSchema.parse(toInvestorOrganisationDto(out)),
    },
    legacyTool: "propose_profile_change",
  }),
  defineAppAction<
    z.infer<typeof RepresentativeMe>,
    Awaited<ReturnType<InvestorService["upsertMyInvestorRepresentative"]>>
  >({
    name: "investor.representative.me.upsert",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Records how they represent their investor organisation, as its page does.",
    input: RepresentativeMe,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      (ports.investors ?? missing("investors")).upsertMyInvestorRepresentative({
        actor: context.actor,
        investorOrganisationId: input.investorOrganisationId,
        input: input.input,
        correlationId: context.correlationId,
      }),
    targets: (input) => [
      {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: input.investorOrganisationId,
      },
    ],
    card: card("Update how you represent your organisation"),
    done: () => "How you represent your organisation is updated.",
    http: {
      method: "PUT",
      path: "/v1/investors/:investorOrganisationId/representatives/me",
      fromRequest: fromInvestor,
      respond: (out) =>
        InvestorRepresentativeDtoSchema.parse(toInvestorRepresentativeDto(out)),
    },
    legacyTool: "propose_team_change",
  }),
  defineAppAction<
    z.infer<typeof HandleClaim>,
    Awaited<ReturnType<PublicIdentityService["claimHandle"]>>
  >({
    name: "q_card.handle.claim",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Claims the @handle of their Q Card, as the card page does.",
    input: HandleClaim,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      (ports.publicIdentity ?? missing("publicIdentity")).claimHandle({
        actor: context.actor,
        subject: input.subject,
        handle: input.input.handle,
        correlationId: context.correlationId,
      }),
    targets: () => [],
    card: card("Claim your Q Card handle"),
    done: () => "Your handle is claimed.",
    http: {
      method: "PUT",
      path: "/v1/q-cards/:subjectType/:subjectId/handle",
      fromRequest: fromCard,
      respond: (out) => QCardDtoSchema.parse(out),
    },
    legacyTool: "propose_handle_claim",
  }),
  defineAppAction<
    z.infer<typeof QCardUpdate>,
    Awaited<ReturnType<PublicIdentityService["updateCard"]>>
  >({
    name: "q_card.update",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Changes their Q Card, as the card page does.",
    input: QCardUpdate,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      (ports.publicIdentity ?? missing("publicIdentity")).updateCard({
        actor: context.actor,
        subject: input.subject,
        input: input.input,
        correlationId: context.correlationId,
      }),
    targets: () => [],
    card: card("Update your Q Card"),
    done: () => "Your Q Card is updated.",
    http: {
      method: "PATCH",
      path: "/v1/q-cards/:subjectType/:subjectId",
      fromRequest: fromCard,
      respond: (out) => QCardDtoSchema.parse(out),
    },
    legacyTool: "propose_q_card_change",
  }),
];
