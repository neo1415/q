import { z } from "zod";

import {
  CompanyIdSchema,
  toCompanyDto,
  type Company,
} from "@capital-q/companies";
import {
  COMPANIES_PATH,
  COMPANY_SHARE_REVOKE_PATH,
  COMPANY_SHARES_PATH,
  COMPANY_VISIBILITY_SEGMENT,
  CompanyDtoSchema,
  CreateVisibilityShareRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  INVESTOR_VISIBILITY_SEGMENT,
  INVESTORS_PATH,
  InvestorOrganisationDtoSchema,
  InvestorVisibilityChoiceSchema,
  SetCompanyVisibilityRequestSchema,
  SetInvestorVisibilityRequestSchema,
  UuidSchema,
  VisibilityRevokeResultDtoSchema,
  VisibilityShareResultDtoSchema,
  type QSubjectRef,
  type VisibilityRevokeResultDto,
  type VisibilityShareResultDto,
} from "@capital-q/contracts";
import {
  InvestorOrganisationIdSchema,
  toInvestorOrganisationDto,
  type InvestorOrganisation,
} from "@capital-q/investors";

import {
  defineAppAction,
  portMissing,
  type AnyAppAction,
  type AppActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Visibility and shares (ADR 0040 checklist). Who can see their company
 * or investor organisation, and sharing their raise with one investor
 * they have a relationship with, each declared once with its route.
 *
 * Q takes the company's visibility through the turn reader's
 * SET_VISIBILITY hand (its owner retires the hand; `qCapability` names it
 * until then); the investor organisation's visibility and the shares
 * through tools generated here, each prepared for the person's approval.
 */

const missing = portMissing;

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The owning services authorise (company.edit, investor.edit, disclosure.manage). */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const onCompany = (input: {
  readonly companyId: string;
}): readonly QSubjectRef[] => [{ kind: "COMPANY", companyId: input.companyId }];

const WHO: Readonly<
  Record<"organisation_private" | "network_visible", string>
> = {
  network_visible: "visible on Capital Q",
  organisation_private: "private to your organisation",
};

const CompanyVisibility = z
  .object({
    companyId: CompanyIdSchema,
    input: SetCompanyVisibilityRequestSchema,
  })
  .strict();

const COMPANY_VISIBILITY = defineAppAction<
  z.infer<typeof CompanyVisibility>,
  Company
>({
  name: "company.visibility.set",
  supersedes: true,
  short: "set company visibility",
  area: "visibility",
  classification: "CONSEQUENTIAL",
  does: "Sets who can see their company on Capital Q, as the visibility page does.",
  input: CompanyVisibility,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    (ports.companies ?? missing("companies")).setCompanyVisibility({
      actor: context.actor,
      companyId: input.companyId,
      input: input.input,
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary: `Make your company ${WHO[input.input.visibility]}`,
    preview: "Applied exactly as shown once approved.",
  }),
  done: (_out, input) =>
    `Done. Your company is ${WHO[input.input.visibility]}.`,
  http: {
    method: "POST",
    path: `${COMPANIES_PATH}/:companyId${COMPANY_VISIBILITY_SEGMENT}`,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      input: body,
    }),
    respond: async (out, input, ports) =>
      CompanyDtoSchema.parse({
        ...toCompanyDto(out),
        pitch:
          ports.companyPitch === undefined
            ? null
            : await ports.companyPitch(input.companyId).catch(() => null),
      }),
  },
  qCapability: "hand.set_visibility",
});

const InvestorVisibility = z
  .object({
    investorOrganisationId: InvestorOrganisationIdSchema,
    input: SetInvestorVisibilityRequestSchema,
    atLatest: z.literal(true).optional(),
  })
  .strict();

const InvestorVisibilityTool = z
  .object({
    visibility: InvestorVisibilityChoiceSchema.describe(
      "network_visible: founders on Capital Q can find it and read its declared profile; organisation_private: only its own people.",
    ),
  })
  .strict();

const INVESTOR_VISIBILITY = defineAppAction<
  z.infer<typeof InvestorVisibility>,
  InvestorOrganisation,
  z.infer<typeof InvestorVisibilityTool>
>({
  name: "investor.visibility.set",
  supersedes: true,
  short: "set fund visibility",
  area: "visibility",
  classification: "CONSEQUENTIAL",
  does: "Sets who can see their investor organisation on Capital Q, as its page does.",
  input: InvestorVisibility,
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
    return investors.setInvestorVisibility({
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
  card: (input) =>
    input.input.visibility === "network_visible"
      ? {
          summary:
            "Make your investor organisation visible to founders on Capital Q",
          preview:
            "Founders on Capital Q can find your organisation and read its declared profile. Your mandate, portfolio and activity stay private.",
        }
      : {
          summary: "Make your investor organisation private",
          preview:
            "Only people in your organisation can see it. Founders can no longer find it.",
        },
  done: (_out, input) =>
    input.input.visibility === "network_visible"
      ? "Done. Founders on Capital Q can now find your organisation."
      : "Done. Your organisation is private again.",
  http: {
    method: "POST",
    path: `${INVESTORS_PATH}/:investorOrganisationId${INVESTOR_VISIBILITY_SEGMENT}`,
    fromRequest: (params, body) => ({
      investorOrganisationId: params["investorOrganisationId"],
      input: body,
    }),
    respond: (out) =>
      InvestorOrganisationDtoSchema.parse(toInvestorOrganisationDto(out)),
  },
  tool: {
    name: "set_investor_visibility",
    description:
      "Prepares who can see their own investor organisation on Capital Q -- visible to founders on the network, or private -- as the profile's visibility control does. Nothing changes until they approve exactly it.",
    input: InvestorVisibilityTool,
    references: {},
    scopes: ["INVESTOR_PROFILE"],
    purposes: ["INVESTOR_QUESTION", "ACTION_PREPARATION"],
    eval: {
      say: [
        "Make our fund visible to founders on Capital Q.",
        "Hide our investor profile from founders.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const own = await ports
        .ownInvestorOrganisationId?.(context.actor)
        .catch(() => null);
      if (own === null || own === undefined || ports.investors === undefined) {
        return null;
      }
      const investorOrganisationId = InvestorOrganisationIdSchema.parse(own);
      const current = await ports.investors.getInvestorOrganisation({
        actor: context.actor,
        investorOrganisationId,
      });
      return {
        investorOrganisationId,
        input: {
          visibility: tool.visibility,
          expectedVersion: current.version,
        },
        atLatest: true as const,
      };
    },
  },
});

/** Their own company, for the raise's shares. */
async function ownCompany(ports: AppActionPorts, context: AppActionContext) {
  const own = await ports.ownCompanyId?.(context.actor).catch(() => null);
  return own === null || own === undefined ? null : CompanyIdSchema.parse(own);
}

const Share = z
  .object({
    companyId: CompanyIdSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: CreateVisibilityShareRequestSchema,
    /** Q's card names the investor; the screen's route never sets it. */
    recipientName: z.string().max(200).optional(),
  })
  .strict();

const ShareTool = z
  .object({
    investor: z
      .string()
      .max(200)
      .describe(
        "The investor to share with, as they named them (a relationship of theirs).",
      ),
  })
  .strict();

const SHARE_RAISE = defineAppAction<
  z.infer<typeof Share>,
  VisibilityShareResultDto,
  z.infer<typeof ShareTool>
>({
  name: "disclosure.raise.share",
  consequence: "TERMS",
  supersedes: true,
  short: "share the raise",
  area: "visibility",
  classification: "CONSEQUENTIAL",
  does: "Shares their company's raise (target, instrument, stage and close date; never the use of funds) with one investor they have a relationship with, as the visibility page does.",
  input: Share,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    (ports.visibility ?? missing("visibility")).share({
      actor: context.actor,
      companyId: input.companyId,
      object: input.input.object,
      relationshipId: input.input.relationshipId,
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary: `Share your raise with ${input.recipientName ?? "this investor"}`,
    preview:
      "They will see your raise's target, instrument, stage and close date. Not your use of funds.",
  }),
  done: (out, input) =>
    out.outcome === "REDUNDANT"
      ? "They can already see your raise; nothing new was shared."
      : `Done. ${input.recipientName ?? "They"} can now see your raise.`,
  http: {
    method: "POST",
    path: COMPANY_SHARES_PATH,
    fromRequest: (params, body, headers) => ({
      companyId: params["companyId"],
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
      input: body,
    }),
    status: (out) => (out.outcome === "CREATED" ? 201 : 200),
    respond: (out) => VisibilityShareResultDtoSchema.parse(out),
  },
  tool: {
    name: "share_my_raise",
    description:
      "Prepares sharing their company's raise (target, instrument, stage and close date; never the use of funds) with one investor they have a relationship with, named as they said it. Nothing is shared until they approve exactly it.",
    input: ShareTool,
    references: { investor: "RELATIONSHIP" },
    scopes: ["COMPANY_PROFILE"],
    purposes: [
      "OWN_COMPANY_QUESTION",
      "ACTION_PREPARATION",
      "RELATIONSHIP_QUESTION",
    ],
    eval: {
      say: ["Share our raise with {name}.", "Let {name} see our round."],
      names: "RELATIONSHIP",
    },
    toCanonical: async (tool, context, ports) => {
      const companyId = await ownCompany(ports, context);
      if (companyId === null || ports.visibility === undefined) return null;
      const state = await ports.visibility.state({
        actor: context.actor,
        companyId,
      });
      const relationship = state.relationships.find(
        (candidate) => candidate.relationshipId === tool.investor,
      );
      if (relationship === undefined) return null;
      return {
        companyId,
        idempotencyKey: context.idempotencyKey,
        input: {
          object: "CAPITAL_OBJECTIVE" as const,
          relationshipId: relationship.relationshipId,
        },
        recipientName: relationship.name,
      };
    },
    // What the page would not offer, said before anyone is asked: no raise
    // to share yet, or one they can already see.
    refuse: async (input, ports, context) => {
      if (ports.visibility === undefined) return null;
      const state = await ports.visibility.state({
        actor: context.actor,
        companyId: input.companyId,
      });
      if (
        !state.objects.some(
          (object) => object.object === "CAPITAL_OBJECTIVE" && object.shareable,
        )
      ) {
        return "Your company has no raise to share yet: set one up first.";
      }
      return state.shares.some(
        (share) =>
          share.object === "CAPITAL_OBJECTIVE" &&
          share.relationshipId === input.input.relationshipId,
      )
        ? `${input.recipientName ?? "They"} can already see your raise.`
        : null;
    },
  },
});

const Revoke = z
  .object({
    companyId: CompanyIdSchema,
    policyId: UuidSchema,
    recipientName: z.string().max(200).optional(),
  })
  .strict();

const RevokeTool = z
  .object({
    investor: z
      .string()
      .max(200)
      .describe(
        "The investor to stop sharing the raise with, as they named them.",
      ),
  })
  .strict();

const REVOKE_SHARE = defineAppAction<
  z.infer<typeof Revoke>,
  VisibilityRevokeResultDto,
  z.infer<typeof RevokeTool>
>({
  name: "disclosure.share.revoke",
  consequence: "TERMS",
  supersedes: true,
  short: "stop sharing the raise",
  area: "visibility",
  classification: "CONSEQUENTIAL",
  does: "Stops sharing their raise with one investor, as the visibility page does; what they already saw cannot be recalled.",
  input: Revoke,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    (ports.visibility ?? missing("visibility")).revoke({
      actor: context.actor,
      companyId: input.companyId,
      policyId: input.policyId,
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary: `Stop sharing your raise with ${input.recipientName ?? "this investor"}`,
    preview:
      "They lose access from now on. What they already saw cannot be recalled.",
  }),
  done: (out, input) =>
    out.outcome === "ALREADY_REVOKED"
      ? "That share was already stopped."
      : `Done. ${input.recipientName ?? "They"} can no longer see your raise.`,
  http: {
    method: "POST",
    path: COMPANY_SHARE_REVOKE_PATH,
    fromRequest: (params) => ({
      companyId: params["companyId"],
      policyId: params["policyId"],
    }),
    respond: (out) => VisibilityRevokeResultDtoSchema.parse(out),
  },
  tool: {
    name: "stop_sharing_my_raise",
    description:
      "Prepares stopping one share of their company's raise with an investor, named as they said it. Nothing changes until they approve exactly it; what the investor already saw cannot be recalled.",
    input: RevokeTool,
    references: { investor: "RELATIONSHIP" },
    scopes: ["COMPANY_PROFILE"],
    purposes: [
      "OWN_COMPANY_QUESTION",
      "ACTION_PREPARATION",
      "RELATIONSHIP_QUESTION",
    ],
    eval: {
      say: [
        "Stop sharing our raise with {name}.",
        "Take our round away from {name}.",
      ],
      names: "RELATIONSHIP",
    },
    toCanonical: async (tool, context, ports) => {
      const companyId = await ownCompany(ports, context);
      if (companyId === null || ports.visibility === undefined) return null;
      const state = await ports.visibility.state({
        actor: context.actor,
        companyId,
      });
      const share = state.shares.find(
        (candidate) =>
          candidate.object === "CAPITAL_OBJECTIVE" &&
          candidate.relationshipId === tool.investor,
      );
      return share === undefined
        ? null
        : {
            companyId,
            policyId: share.policyId,
            ...(share.recipientName === null
              ? {}
              : { recipientName: share.recipientName }),
          };
    },
  },
});

export const VISIBILITY_ACTIONS: readonly AnyAppAction[] = [
  COMPANY_VISIBILITY,
  INVESTOR_VISIBILITY,
  SHARE_RAISE,
  REVOKE_SHARE,
];
