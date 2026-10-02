import { z } from "zod";

import type { QSubjectRef } from "@capital-q/contracts";

import {
  CompanyIdSchema,
  toCompanyDto,
  toCompanyMemberDto,
  toCompanyTeamFactsDto,
  toFounderProfileDto,
} from "@capital-q/companies";
import {
  CompanyRelationshipTypeSchema,
  ClaimHandleRequestSchema,
  CompanyDtoSchema,
  CompanyMemberDtoSchema,
  CompanyTeamFactsDtoSchema,
  FounderProfileDtoSchema,
  InvestorOrganisationDtoSchema,
  InvestorDeploymentStateSchema,
  InvestorInboundPreferenceSchema,
  InvestorRepresentativeDtoSchema,
  InvestorTypeSchema,
  PersonDisplayNameSchema,
  PersonHeadlineSchema,
  QCardDtoSchema,
  QCardFieldSchema,
  QCardScopeSchema,
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
import {
  normaliseHandle,
  type PublicIdentityService,
} from "@capital-q/public-identity";
import { UserIdSchema, type PersonProfile } from "@capital-q/security";

import {
  defineAppAction,
  refusal,
  portMissing,
  type AnyAppAction,
  type AppActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Profile and records (ADR 0040 checklist, first L area). Each screen
 * write is declared once; its route and its Q tool are generated from the
 * declaration: the person's own edit, through the same service, under its
 * own capability check. For Q each is CONSEQUENTIAL: prepared for the
 * person's approval of exactly that change.
 *
 * Q's approvals bind the values, not the version (as the hand-written
 * profile actions did): a change Q prepared carries `atLatest`, and is
 * applied to the record as it stands when approved, so approving two
 * cards in a row does not fail the second on the first's version. The
 * screen never sets it: its route builds the input from the URL and puts
 * the body under `input`, where the request contract's own version holds.
 */

const missing = portMissing;

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

const LABELS: Readonly<Record<string, string>> = {
  canonicalName: "Name",
  legalName: "Legal name",
  websiteUrl: "Website",
  foundedDate: "Founded",
  headquartersCountry: "Country",
  headquartersCity: "City",
  currentStageCode: "Stage",
  primaryDescription: "Description",
  shortDescription: "One-line description",
  investorType: "Investor type",
  displayName: "Name",
  hqCountry: "Country",
  publicDescription: "Description",
  deploymentState: "Deploying",
  inboundPreference: "Inbound",
  headline: "Headline",
  timeZone: "Time zone",
  professionalSummary: "Professional summary",
  backgroundSummary: "Background",
  founderCount: "Founders",
  fullTimeFounderCount: "Full-time founders",
  teamSize: "Team size",
  relationshipType: "Role",
  businessTitle: "Title",
  isFounder: "Founder",
  indexable: "Findable by search engines",
  fieldScopes: "Shown fields",
  handle: "Handle",
};

function valueText(value: unknown): string {
  if (value === null) return "cleared";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${key} ${String(entry).replace("_", " ")}`)
    .join(", ");
}

/** The exact values the card shows: what is approved is what is applied. */
function previewOf(fields: Readonly<Record<string, unknown>>): string {
  const shown = Object.entries(fields).filter(
    ([field, value]) => value !== undefined && field !== "expectedVersion",
  );
  return shown.length === 0
    ? "Nothing changes."
    : shown
        .map(
          ([field, value]) => `${LABELS[field] ?? field}: ${valueText(value)}`,
        )
        .join(" · ");
}

const card =
  (summary: string) =>
  (input: { readonly input: Readonly<Record<string, unknown>> }) => ({
    summary,
    preview: previewOf(input.input),
  });

/** What people say ("kivu.example") and what the field holds (a URL). */
function website(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 || /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

/** Only the fields the model filled: an absent field is not a change. */
function filled<T extends Readonly<Record<string, unknown>>>(
  fields: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const own = async (
  find:
    ((actor: AppActionContext["actor"]) => Promise<string | null>) | undefined,
  context: AppActionContext,
): Promise<string | null> =>
  find === undefined ? null : await find(context.actor).catch(() => null);

const COMPANY_SCOPES = ["COMPANY_PROFILE"] as const;
const INVESTOR_SCOPES = ["INVESTOR_PROFILE"] as const;

/**
 * The turns each is offered on: a founder's own-company turn, an
 * investor's own-organisation turn, and a turn that prepares an action. A
 * turn about nobody (GENERAL_QUESTION) binds no company or investor
 * profile, so only the person's own profile is offered there.
 */
const COMPANY_TURNS = ["OWN_COMPANY_QUESTION", "ACTION_PREPARATION"] as const;
const INVESTOR_TURNS = ["INVESTOR_QUESTION", "ACTION_PREPARATION"] as const;
const OWN_TURNS = [
  "OWN_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "ACTION_PREPARATION",
] as const;

async function companyPitch(ports: AppActionPorts, companyId: string) {
  return ports.companyPitch === undefined
    ? null
    : await ports.companyPitch(companyId).catch(() => null);
}

const AtLatest = z.literal(true).optional();
const CompanyUpdate = z
  .object({
    companyId: CompanyIdSchema,
    input: UpdateCompanyRequestSchema,
    atLatest: AtLatest,
  })
  .strict();
const CompanyTeamMe = companyBody(UpsertMyCompanyMembershipRequestSchema);
const FounderProfileMe = companyBody(UpdateMyFounderProfileRequestSchema);
const TeamFacts = companyBody(UpdateCompanyTeamFactsRequestSchema);
const InvestorUpdate = z
  .object({
    investorOrganisationId: InvestorOrganisationIdSchema,
    input: UpdateInvestorOrganisationRequestSchema,
    atLatest: AtLatest,
  })
  .strict();
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
  .object({
    subject: QCardSubject,
    input: UpdateQCardRequestSchema,
    atLatest: AtLatest,
  })
  .strict();

/** Q only: the screen's /v1/me/profile route needs no organisation. */
const PersonUpdate = z
  .object({
    userId: UserIdSchema,
    input: z
      .object({
        displayName: PersonDisplayNameSchema.optional(),
        headline: PersonHeadlineSchema.nullable().optional(),
        timeZone: z
          .string()
          .trim()
          .max(64)
          .refine(isKnownTimeZone, {
            message: "needs to be a time zone such as Africa/Lagos",
          })
          .nullable()
          .optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.displayName !== undefined ||
          value.headline !== undefined ||
          value.timeZone !== undefined,
        { message: "expected at least one field to update" },
      ),
  })
  .strict();

const SubjectTool = z
  .enum(["COMPANY", "INVESTOR_ORGANISATION"])
  .describe(
    "Whose card: their own company's or their investor organisation's.",
  );

/** Their own company or investor organisation, as the card's subject. */
async function ownSubject(
  ports: AppActionPorts,
  context: AppActionContext,
  subject: "COMPANY" | "INVESTOR_ORGANISATION",
) {
  const subjectId = await own(
    subject === "COMPANY"
      ? ports.ownCompanyId
      : ports.ownInvestorOrganisationId,
    context,
  );
  return subjectId === null ? null : { subjectType: subject, subjectId };
}

const subjectTargets = (subject: {
  readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
  readonly subjectId: string;
}): readonly QSubjectRef[] =>
  subject.subjectType === "COMPANY"
    ? [{ kind: "COMPANY", companyId: subject.subjectId }]
    : [
        {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: subject.subjectId,
        },
      ];

const fromCard = (params: Record<string, string>, body: unknown) => ({
  subject: {
    subjectType: params["subjectType"],
    subjectId: params["subjectId"],
  },
  input: body,
});

// --- what the model fills (Q's side of each declaration) -----------------

const text = (max: number, says: string) =>
  z.string().max(max).nullable().optional().describe(says);

const CompanyTool = z
  .object({
    canonicalName: z
      .string()
      .max(200)
      .optional()
      .describe("The company's name."),
    legalName: text(200, "The registered legal name; null clears it."),
    websiteUrl: text(2048, "The website, as said (https:// is added)."),
    foundedDate: text(10, "YYYY-MM-DD."),
    headquartersCountry: text(2, "ISO 3166 two-letter code, e.g. KE."),
    headquartersCity: text(120, "The city."),
    currentStageCode: text(64, "A lower_snake_case stage code, e.g. seed."),
    shortDescription: text(280, "One line."),
    primaryDescription: text(8000, "The full description."),
  })
  .strict();

const InvestorTool = z
  .object({
    displayName: z
      .string()
      .max(200)
      .optional()
      .describe("The organisation's name."),
    investorType: InvestorTypeSchema.optional(),
    websiteUrl: text(2048, "The website, as said (https:// is added)."),
    hqCountry: text(2, "ISO 3166 two-letter code, e.g. NG."),
    publicDescription: text(8000, "What founders read about them."),
    deploymentState: InvestorDeploymentStateSchema.nullable().optional(),
    inboundPreference: InvestorInboundPreferenceSchema.nullable().optional(),
  })
  .strict();

const CompanyRoleTool = z
  .object({
    relationshipType: CompanyRelationshipTypeSchema.optional(),
    businessTitle: text(120, "Their title, e.g. CEO; null clears it."),
    isFounder: z.boolean().optional().describe("Whether they are a founder."),
  })
  .strict();

const FounderProfileTool = z
  .object({
    professionalSummary: text(2000, "What they do now, in their words."),
    backgroundSummary: text(2000, "Their background."),
  })
  .strict();

const TeamFactsTool = z
  .object({
    founderCount: z.number().int().min(0).nullable().optional(),
    fullTimeFounderCount: z.number().int().min(0).nullable().optional(),
    teamSize: z.number().int().min(0).nullable().optional(),
  })
  .strict();

const InvestorRoleTool = z
  .object({
    businessTitle: text(120, "Their title, e.g. Partner; null clears it."),
  })
  .strict();

const HandleClaimTool = z
  .object({
    subject: SubjectTool,
    handle: z
      .string()
      .max(40)
      .describe("The handle they asked for, without the @."),
  })
  .strict();

const QCardTool = z
  .object({
    subject: SubjectTool,
    indexable: z
      .boolean()
      .optional()
      .describe("Whether search engines may find the card."),
    fieldScopes: z
      .array(
        z.object({ field: QCardFieldSchema, scope: QCardScopeSchema }).strict(),
      )
      .max(20)
      .optional()
      .describe("Which fields the card shows, and to whom."),
  })
  .strict();

const PersonTool = z
  .object({
    displayName: z.string().max(80).optional().describe("What to call them."),
    headline: text(160, "One line about themselves; null clears it."),
    timeZone: z
      .string()
      .max(64)
      .nullable()
      .optional()
      .describe("Their IANA time zone, such as Africa/Lagos."),
  })
  .strict();

/**
 * The person's own profile: what to call them, their headline, their time
 * zone. Declared for Q only: the screen's `/v1/me/profile` is answered
 * before the person has an organisation, which a generated route (built
 * on an organisation's actor context) cannot yet serve, so that route
 * stays as it is and writes through the same store.
 */
const PERSON_PROFILE = defineAppAction<
  z.infer<typeof PersonUpdate>,
  PersonProfile,
  z.infer<typeof PersonTool>
>({
  name: "person.profile.update",
  short: "change their name or headline",
  area: "records",
  classification: "CONSEQUENTIAL",
  does: "Changes what Capital Q calls them, their headline or their time zone, as their profile page does.",
  input: PersonUpdate,
  output: serviceResult(),
  // Their own record and nobody else's: another user's id is a payload
  // this action never accepts.
  authorize: (_ports, context, input) =>
    Promise.resolve(
      input.userId === context.actor.userId
        ? { ok: true as const }
        : { ok: false as const, reason: "" },
    ),
  run: async (ports, context, input) => {
    const people = ports.people ?? missing("people");
    if (input.userId !== context.actor.userId) {
      throw new Error("NOT_THEIR_PROFILE");
    }
    const userId = UserIdSchema.parse(context.actor.userId);
    const current = await people.read(userId);
    if (current === null) throw new Error("NO_ACTIVE_PROFILE");
    // The values they approved, on the profile as it stands now.
    return people.update({
      userId,
      expectedVersion: current.version,
      changes: input.input,
    });
  },
  targets: (input) => [{ kind: "USER", userId: input.userId }],
  card: (input) => ({
    summary: "Update your profile",
    preview: previewOf(input.input),
  }),
  done: () => "Done. Your profile is updated.",
  tool: {
    name: "update_my_profile",
    purposes: ["GENERAL_QUESTION", ...OWN_TURNS],
    description:
      "Prepares a change to the person's own profile: displayName (what to call them), headline (one line about themselves; null clears it) and timeZone (IANA, such as Africa/Lagos). Not their title or role: at their company that is set_my_company_role, at their investor organisation set_my_investor_role. Nothing changes until they approve exactly it.",
    input: PersonTool,
    references: {},
    eval: {
      say: ["Call me Ada from now on.", "My time zone is Africa/Lagos."],
    },
    toCanonical: (fields, context) =>
      Promise.resolve({
        userId: context.actor.userId,
        input: filled(fields),
      }),
  },
});

export const PROFILE_AND_RECORDS: readonly AnyAppAction[] = [
  PERSON_PROFILE,
  defineAppAction<
    z.infer<typeof CompanyUpdate>,
    Awaited<ReturnType<CompanyService["updateCompany"]>>,
    z.infer<typeof CompanyTool>
  >({
    name: "company.profile.update",
    short: "edit the company profile",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Changes their company profile's declared fields, as the profile page's Save does.",
    input: CompanyUpdate,
    output: serviceResult(),
    authorize: servicesDecide,
    run: async (ports, context, input) => {
      const companies = ports.companies ?? missing("companies");
      const expectedVersion =
        input.atLatest === true
          ? (
              await companies.getCompany({
                actor: context.actor,
                companyId: input.companyId,
              })
            ).version
          : input.input.expectedVersion;
      return companies.updateCompany({
        actor: context.actor,
        companyId: input.companyId,
        input: { ...input.input, expectedVersion },
        correlationId: context.correlationId,
      });
    },
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
    tool: {
      name: "update_company_profile",
      description:
        "Prepares a change to their own company's declared profile, as the company page's Save makes it: canonicalName, legalName, websiteUrl, foundedDate (YYYY-MM-DD), headquartersCountry (ISO 3166 two-letter code), headquartersCity, currentStageCode (lower_snake_case stage code), shortDescription (one line), primaryDescription. Every field to change in one call; null clears one. Saving is not verifying: what they authorise is stored as their stated detail. Nothing changes until they approve exactly it.",
      input: CompanyTool,
      references: {},
      scopes: COMPANY_SCOPES,
      purposes: COMPANY_TURNS,
      eval: {
        say: [
          "Change our company website to https://kivu-freight.example.",
          "Set our headquarters city to Nairobi.",
        ],
      },
      toCanonical: async (fields, context, ports) => {
        const companyId = await own(ports.ownCompanyId, context);
        if (companyId === null || ports.companies === undefined) return null;
        const current = await ports.companies.getCompany({
          actor: context.actor,
          companyId: CompanyIdSchema.parse(companyId),
        });
        const changes = filled(fields);
        return {
          companyId: CompanyIdSchema.parse(companyId),
          input: {
            ...changes,
            ...(changes.websiteUrl === undefined
              ? {}
              : { websiteUrl: website(changes.websiteUrl) }),
            expectedVersion: current.version,
          },
          atLatest: true as const,
        };
      },
    },
  }),
  defineAppAction<
    z.infer<typeof CompanyTeamMe>,
    Awaited<ReturnType<CompanyService["upsertMyCompanyMembership"]>>,
    z.infer<typeof CompanyRoleTool>
  >({
    name: "company.team.me.upsert",
    short: "set my title at company",
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
    tool: {
      name: "set_my_company_role",
      description:
        "Prepares a change to their own place on their company's team, as the team page makes it: their title or role there (businessTitle, e.g. CEO; null clears it), relationshipType (team_member, advisor, board_member, contractor, other) and whether they are a founder. What they leave out stays as it is. Nothing changes until they approve exactly it.",
      input: CompanyRoleTool,
      references: {},
      scopes: COMPANY_SCOPES,
      purposes: COMPANY_TURNS,
      eval: {
        say: [
          "Change my title to Chief Product Officer.",
          "Mark me as a founder of the company.",
        ],
      },
      toCanonical: async (fields, context, ports) => {
        const companyId = await own(ports.ownCompanyId, context);
        if (companyId === null || ports.companies === undefined) return null;
        // What they did not mention stays as their membership holds it.
        const current = await ports.companies
          .getMyCompanyMembership({
            actor: context.actor,
            companyId: CompanyIdSchema.parse(companyId),
          })
          .catch(() => null);
        return {
          companyId: CompanyIdSchema.parse(companyId),
          input: {
            relationshipType:
              fields.relationshipType ??
              current?.relationshipType ??
              "team_member",
            isFounder: fields.isFounder ?? current?.isFounder ?? false,
            ...(fields.businessTitle === undefined
              ? current === null
                ? {}
                : { businessTitle: current.businessTitle }
              : { businessTitle: fields.businessTitle }),
          },
        };
      },
    },
  }),
  defineAppAction<
    z.infer<typeof FounderProfileMe>,
    Awaited<ReturnType<CompanyService["updateMyFounderProfile"]>>,
    z.infer<typeof FounderProfileTool>
  >({
    name: "company.founder_profile.me.update",
    short: "edit my founder bio",
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
    tool: {
      name: "update_my_founder_profile",
      description:
        "Prepares a change to their own founder bio, as the team page makes it: professionalSummary and backgroundSummary (null clears one). Not their title or role: that is set_my_company_role. Nothing changes until they approve exactly it.",
      input: FounderProfileTool,
      references: {},
      scopes: COMPANY_SCOPES,
      purposes: COMPANY_TURNS,
      eval: {
        say: [
          "Update my founder background: ten years running logistics in East Africa.",
          "Set my professional summary to operator turned founder in freight.",
        ],
      },
      toCanonical: async (fields, context, ports) => {
        const companyId = await own(ports.ownCompanyId, context);
        return companyId === null
          ? null
          : {
              companyId: CompanyIdSchema.parse(companyId),
              input: filled(fields),
            };
      },
    },
  }),
  defineAppAction<
    z.infer<typeof TeamFacts>,
    Awaited<ReturnType<CompanyService["updateCompanyTeamFacts"]>>,
    z.infer<typeof TeamFactsTool>
  >({
    name: "company.team_facts.update",
    short: "change team size facts",
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
    tool: {
      name: "update_team_facts",
      description:
        "Prepares a change to their company's team facts, as the team page makes it: founderCount, fullTimeFounderCount, teamSize (null clears one). Nothing changes until they approve exactly it.",
      input: TeamFactsTool,
      references: {},
      scopes: COMPANY_SCOPES,
      purposes: COMPANY_TURNS,
      eval: {
        say: ["We're a team of 14 now.", "Set our founder count to 2."],
      },
      toCanonical: async (fields, context, ports) => {
        const companyId = await own(ports.ownCompanyId, context);
        return companyId === null
          ? null
          : {
              companyId: CompanyIdSchema.parse(companyId),
              input: filled(fields),
            };
      },
    },
  }),
  defineAppAction<
    z.infer<typeof InvestorUpdate>,
    Awaited<ReturnType<InvestorService["updateInvestorOrganisation"]>>,
    z.infer<typeof InvestorTool>
  >({
    name: "investor.profile.update",
    short: "edit the fund's profile",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Changes their investor organisation's declared profile, as its page does.",
    input: InvestorUpdate,
    output: serviceResult(),
    authorize: servicesDecide,
    run: async (ports, context, input) => {
      const investors = ports.investors ?? missing("investors");
      const expectedVersion =
        input.atLatest === true
          ? (
              await investors.getInvestorOrganisation({
                actor: context.actor,
                investorOrganisationId: input.investorOrganisationId,
              })
            ).version
          : input.input.expectedVersion;
      return investors.updateInvestorOrganisation({
        actor: context.actor,
        investorOrganisationId: input.investorOrganisationId,
        input: { ...input.input, expectedVersion },
        correlationId: context.correlationId,
      });
    },
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
    tool: {
      name: "update_investor_profile",
      description:
        "Prepares a change to their own investor organisation's declared profile, as its page makes it: displayName, investorType, websiteUrl, hqCountry (two-letter code), publicDescription, deploymentState, inboundPreference. Every field to change in one call; null clears one. Not anyone's own title at the fund: that is set_my_investor_role. Nothing changes until they approve exactly it.",
      input: InvestorTool,
      references: {},
      scopes: INVESTOR_SCOPES,
      purposes: INVESTOR_TURNS,
      eval: {
        say: [
          "Change our fund's website to https://lagoon-capital.example.",
          "Update our public description to early-stage climate investors in West Africa.",
        ],
      },
      toCanonical: async (fields, context, ports) => {
        const investorOrganisationId = await own(
          ports.ownInvestorOrganisationId,
          context,
        );
        if (investorOrganisationId === null || ports.investors === undefined) {
          return null;
        }
        const current = await ports.investors.getInvestorOrganisation({
          actor: context.actor,
          investorOrganisationId: InvestorOrganisationIdSchema.parse(
            investorOrganisationId,
          ),
        });
        const changes = filled(fields);
        return {
          investorOrganisationId: InvestorOrganisationIdSchema.parse(
            investorOrganisationId,
          ),
          input: {
            ...changes,
            ...(changes.websiteUrl === undefined
              ? {}
              : { websiteUrl: website(changes.websiteUrl) }),
            expectedVersion: current.version,
          },
          atLatest: true as const,
        };
      },
    },
  }),
  defineAppAction<
    z.infer<typeof RepresentativeMe>,
    Awaited<ReturnType<InvestorService["upsertMyInvestorRepresentative"]>>,
    z.infer<typeof InvestorRoleTool>
  >({
    name: "investor.representative.me.upsert",
    short: "set my title at fund",
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
    tool: {
      name: "set_my_investor_role",
      description:
        "Prepares a change to their own title or role at their investor organisation (businessTitle, e.g. Managing Partner), as its page makes it (null clears it). Nothing changes until they approve exactly it.",
      input: InvestorRoleTool,
      references: {},
      scopes: INVESTOR_SCOPES,
      purposes: INVESTOR_TURNS,
      eval: {
        say: [
          "Change my title to Managing Partner.",
          "My role at the fund is now Principal.",
        ],
      },
      toCanonical: async (fields, context, ports) => {
        const investorOrganisationId = await own(
          ports.ownInvestorOrganisationId,
          context,
        );
        return investorOrganisationId === null
          ? null
          : {
              investorOrganisationId: InvestorOrganisationIdSchema.parse(
                investorOrganisationId,
              ),
              input: fields,
            };
      },
    },
  }),
  defineAppAction<
    z.infer<typeof HandleClaim>,
    Awaited<ReturnType<PublicIdentityService["claimHandle"]>>,
    z.infer<typeof HandleClaimTool>
  >({
    name: "q_card.handle.claim",
    short: "claim a Q Card handle",
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
    targets: (input) => subjectTargets(input.subject),
    card: (input) => ({
      summary: `Claim @${input.input.handle} for your Q Card`,
      preview: `Your Q Card's address becomes /@${input.input.handle}. Claiming a handle makes the card if there isn't one yet.`,
    }),
    done: (out) => `Done. Your Q Card is at /@${out.handle ?? ""}.`,
    http: {
      method: "PUT",
      path: "/v1/q-cards/:subjectType/:subjectId/handle",
      fromRequest: fromCard,
      respond: (out) => QCardDtoSchema.parse(out),
    },
    tool: {
      name: "claim_q_card_handle",
      description:
        "Prepares their organisation's public handle -- the address of its Q Card, the shareable digital business card at /@handle -- when they ask for a Q card or a handle, or to change it. Claiming a handle makes the card. Nothing changes until they approve the exact handle.",
      input: HandleClaimTool,
      references: {},
      scopes: [...COMPANY_SCOPES, ...INVESTOR_SCOPES],
      purposes: OWN_TURNS,
      eval: {
        say: [
          "Get me the handle kivufreight for our Q Card.",
          "Change our Q Card handle to kivu-freight.",
        ],
      },
      toCanonical: async (fields, context, ports) => {
        const subject = await ownSubject(ports, context, fields.subject);
        const reading = normaliseHandle(fields.handle);
        return subject === null
          ? null
          : {
              subject,
              input: { handle: reading.ok ? reading.handle : fields.handle },
            };
      },
      refuse: async (input, ports) => {
        const reading = normaliseHandle(input.input.handle);
        if (!reading.ok) {
          return "A handle is 3 to 30 lowercase letters, digits or single hyphens, not starting or ending with a hyphen.";
        }
        const available =
          ports.publicIdentity === undefined
            ? true
            : await ports.publicIdentity
                .handleAvailable(reading.handle)
                .catch(() => true);
        return available
          ? null
          : `@${reading.handle} isn't available; suggest another.`;
      },
    },
  }),
  defineAppAction<
    z.infer<typeof QCardUpdate>,
    Awaited<ReturnType<PublicIdentityService["updateCard"]>>,
    z.infer<typeof QCardTool>
  >({
    name: "q_card.update",
    short: "change Q Card settings",
    area: "records",
    classification: "CONSEQUENTIAL",
    does: "Changes their Q Card, as the card page does.",
    input: QCardUpdate,
    output: serviceResult(),
    authorize: servicesDecide,
    run: async (ports, context, input) => {
      const cards = ports.publicIdentity ?? missing("publicIdentity");
      const current =
        input.atLatest === true
          ? await cards.getCard({
              actor: context.actor,
              subject: input.subject,
            })
          : null;
      return cards.updateCard({
        actor: context.actor,
        subject: input.subject,
        input: {
          ...input.input,
          expectedVersion: current?.version ?? input.input.expectedVersion,
        },
        correlationId: context.correlationId,
      });
    },
    targets: (input) => subjectTargets(input.subject),
    card: card("Update your Q Card"),
    done: () => "Your Q Card is updated.",
    http: {
      method: "PATCH",
      path: "/v1/q-cards/:subjectType/:subjectId",
      fromRequest: fromCard,
      respond: (out) => QCardDtoSchema.parse(out),
    },
    tool: {
      name: "update_q_card",
      description:
        "Prepares a change to their own Q Card's details, as the Q Card screen makes it: whether search engines may find it (indexable), and which fields it shows to whom (fieldScopes). A new handle is claim_q_card_handle. Nothing changes until they approve exactly it.",
      input: QCardTool,
      references: {},
      scopes: [...COMPANY_SCOPES, ...INVESTOR_SCOPES],
      purposes: OWN_TURNS,
      eval: {
        say: [
          "Let search engines find our Q Card.",
          "Hide our Q Card from search engines.",
        ],
        // The founder eval account has no Q Card yet: "make one first" is
        // the right answer there (lead 2026-10-02: expect it, seed none).
        orSays:
          "(no|hasn.t|has not been|isn.t)[^.]*q card|q card[^.]*(not|hasn.t)[^.]*(made|created|yet)|create[^.]*q card",
      },
      toCanonical: async (fields, context, ports) => {
        const subject = await ownSubject(ports, context, fields.subject);
        if (subject === null || ports.publicIdentity === undefined) return null;
        const current = await ports.publicIdentity.getCard({
          actor: context.actor,
          subject,
        });
        // No card yet: say so, and what makes one (parity eval 2026-10-02:
        // a bare refusal read as "not available in this context").
        if (current === null) {
          return refusal(
            "You don't have a Q Card yet: claiming a handle makes one (claim_q_card_handle).",
          );
        }
        return {
          subject,
          input: {
            expectedVersion: current.version,
            ...(fields.indexable === undefined
              ? {}
              : { indexable: fields.indexable }),
            ...(fields.fieldScopes === undefined
              ? {}
              : {
                  fieldScopes: Object.fromEntries(
                    fields.fieldScopes.map((entry) => [
                      entry.field,
                      entry.scope,
                    ]),
                  ),
                }),
          },
          atLatest: true as const,
        };
      },
    },
  }),
];
