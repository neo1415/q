import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import { UuidSchema, type QSensitivityClass } from "@capital-q/contracts";
import { actorPrincipal } from "@capital-q/permissions";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope, boundScopeFor } from "../plan.js";
import type {
  CompanyFigure,
  CompanyFigureScope,
  CompanyFiguresPort,
  QToolPorts,
} from "../ports.js";

/**
 * read_company_figures (owner, 2026-10-23: "you can't see any company
 * figures, that's not good").
 *
 * The company's current figures (revenue, growth, customers, margins, team
 * size, the raise target, market size) as the company stated them, so Q can
 * answer "tell me about X" with numbers instead of "no authorised record".
 *
 * Admission is get_company's, unchanged: a company the plan bound a
 * COMPANY_PROFILE scope to (owner with company.view, or disclosure), or any
 * other company only under the actor-wide NETWORK_VISIBLE_DATA scope when
 * disclosure says it is network-visible or public. A company the run is
 * about whose profile the firewall denied stays denied.
 *
 * What is returned never exceeds what the company itself published: only
 * claims at network_visible or public_external (public_external only when
 * disclosure admitted a bound company some other way, such as one
 * relationship), each no more sensitive than the grant. Nothing organisation-private, founder-private or shared with
 * one relationship ever reaches this tool -- the same rule as the Q Card.
 * The claims are read in the company's own tenant through the evidence
 * context's query port; the viewer's tenant never widens to it.
 *
 * Truth class and evidence status stay separate fields. A self-reported
 * figure is the company's claim, never verified by being returned. No
 * figure is UNKNOWN, never zero.
 */

export const READ_COMPANY_FIGURES = "company.figures.read" as const;

const FIGURES_MAX = 40;
const STATEMENT_MAX = 600;

const InputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The canonical company identifier (UUID), as given in the conversation context.",
    ),
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z
  .object({
    companyId: UuidSchema,
    figures: z
      .array(
        z
          .object({
            key: z.string(),
            statement: z.string().max(STATEMENT_MAX),
            value: z.record(z.string(), z.unknown()).nullable(),
            asOf: z.string().nullable(),
            truthClass: z.string(),
            evidenceStatus: z.string(),
          })
          .strict(),
      )
      .max(FIGURES_MAX),
    /** NONE: the company has published no figures; unknown, not zero. */
    status: z.enum(["AVAILABLE", "NONE"]),
  })
  .strict();
type Output = z.infer<typeof OutputSchema>;

/** A claim's sensitivity may not exceed the grant's. */
const WITHIN: Readonly<Record<QSensitivityClass, ReadonlySet<string>>> = {
  PUBLIC: new Set(["PUBLIC"]),
  NETWORK_VISIBLE: new Set(["PUBLIC", "NETWORK_VISIBLE"]),
  INTERNAL: new Set(["PUBLIC", "NETWORK_VISIBLE"]),
  CONFIDENTIAL: new Set(["PUBLIC", "NETWORK_VISIBLE"]),
  HIGHLY_CONFIDENTIAL: new Set(["PUBLIC", "NETWORK_VISIBLE"]),
  RESTRICTED: new Set(["PUBLIC", "NETWORK_VISIBLE"]),
};

type Grant = {
  readonly companyId: string;
  readonly tenantId: string;
  readonly scopes: readonly CompanyFigureScope[];
  readonly sensitivity: QSensitivityClass;
};

const NETWORK: readonly CompanyFigureScope[] = [
  "network_visible",
  "public_external",
];
const PUBLIC_ONLY: readonly CompanyFigureScope[] = ["public_external"];

/** Only what the grant reaches leaves the tool, whatever the port returned. */
export function shapeCompanyFigures(
  companyId: string,
  figures: readonly CompanyFigure[],
  scopes: readonly CompanyFigureScope[],
  sensitivity: QSensitivityClass,
): Output {
  const reach = new Set<string>(scopes);
  const within = WITHIN[sensitivity];
  const kept = figures
    .filter(
      (f) => reach.has(f.visibilityScope) && within.has(f.sensitivityClass),
    )
    .slice(0, FIGURES_MAX)
    .map((f) => ({
      key: f.claimKey,
      statement: f.statement.slice(0, STATEMENT_MAX),
      value: f.structuredValue,
      asOf: f.validFrom,
      truthClass: f.truthClass,
      evidenceStatus: f.evidenceStatus,
    }));
  return {
    companyId,
    figures: kept,
    status: kept.length === 0 ? "NONE" : "AVAILABLE",
  };
}

export function createReadCompanyFiguresTool(
  ports: QToolPorts & { readonly companyFigures: CompanyFiguresPort },
): AnyQToolDefinition {
  return defineQTool<Input, Output, Grant>({
    id: READ_COMPANY_FIGURES,
    version: 1,
    status: "ACTIVE",
    providerName: "read_company_figures",
    description:
      "Reads a company's current figures as the company published them: revenue (MRR, ARR), growth, customers and users, margins, team size, the raise target and market size, each with its date, truth class and evidence status. Call it for any question about a company's traction, numbers, raise or performance, and when describing a company. Every figure is the company's own claim unless its evidence status says otherwise: say \"self-reported\" and never call it verified. NONE means the company has published no figures: say they are not known, never zero.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("company.view")],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "RELATIONSHIP_QUESTION",
      "COMPARISON",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["COMPANY_PROFILE", "NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: InputSchema,
    output: OutputSchema,
    // The same admission as get_company (company.get v1): see its notes.
    authorize: async (input, context) => {
      const { actor, plan } = context;
      const profile = await ports.companies.findCanonicalCompanyProfile(
        CompanyIdSchema.parse(input.companyId),
      );
      if (profile === null) return deny("NOT_AVAILABLE");
      const grant = (
        scopes: readonly CompanyFigureScope[],
        sensitivity: QSensitivityClass,
      ) =>
        allow(sensitivity, {
          companyId: profile.id,
          tenantId: profile.tenantId,
          scopes,
          sensitivity,
        });
      const bound = boundScopeFor(
        plan,
        "COMPANY_PROFILE",
        (filter) => filter.companyId === profile.id,
      );
      if (bound !== undefined) {
        const owner =
          actor.organisationId !== undefined &&
          actor.tenantId === profile.tenantId &&
          actor.organisationId === profile.organisationId;
        if (owner) {
          const decision = await ports.authorization.authorize({
            actor,
            capability: capability("company.view"),
            resource: {
              kind: "RESOURCE",
              tenantId: profile.tenantId,
              organisationId: profile.organisationId,
              resourceType: "company",
              resourceId: profile.id,
            },
          });
          // The owner sees what investors see: the published figures.
          return decision.outcome === "ALLOW"
            ? grant(NETWORK, bound.sensitivity)
            : deny("NOT_AVAILABLE");
        }
        const disclosed = await ports.disclosure.canDisclose({
          principal: actorPrincipal(actor),
          resource: { type: "company", id: profile.id },
          requestedAccess: "view",
        });
        if (disclosed.outcome !== "ALLOW") return deny("NOT_AVAILABLE");
        // Network figures only when the company itself is network-visible;
        // admitted any other way (e.g. one relationship), public ones only.
        return disclosed.reasonCode === "NETWORK_VISIBLE" ||
          disclosed.reasonCode === "PUBLIC_EXTERNAL"
          ? grant(NETWORK, bound.sensitivity)
          : grant(PUBLIC_ONLY, bound.sensitivity);
      }
      const isSubject = plan.subjects.some(
        (subject) =>
          subject.kind === "COMPANY" && subject.companyId === profile.id,
      );
      const network = actorWideScope(plan, "NETWORK_VISIBLE_DATA");
      if (isSubject || network === undefined) return deny("NOT_AVAILABLE");
      const disclosed = await ports.disclosure.canDisclose({
        principal: actorPrincipal(actor),
        resource: { type: "company", id: profile.id },
        requestedAccess: "view",
      });
      if (disclosed.outcome !== "ALLOW") return deny("NOT_AVAILABLE");
      if (disclosed.reasonCode === "NETWORK_VISIBLE") {
        return grant(NETWORK, "NETWORK_VISIBLE");
      }
      // A public company is network-visible too; Q only runs for signed-in
      // members, who are the network. The sensitivity ceiling stays PUBLIC.
      if (disclosed.reasonCode === "PUBLIC_EXTERNAL") {
        return grant(NETWORK, "PUBLIC");
      }
      return deny("NOT_AVAILABLE");
    },
    execute: async (_input, _context, g) => {
      const figures = await ports.companyFigures.current(
        { tenantId: g.tenantId, companyId: g.companyId },
        g.scopes,
      );
      return shapeCompanyFigures(g.companyId, figures, g.scopes, g.sensitivity);
    },
  });
}
