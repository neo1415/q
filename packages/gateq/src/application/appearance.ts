import { randomUUID } from "node:crypto";

import {
  auditActorFromContext,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import {
  GatewayAppearanceRequestSchema,
  GatewayBrandReasonSchema,
  GatewayBrandSuggestionDtoSchema,
  type GatewayBrandReason,
  type GatewayBrandSuggestionDto,
} from "@capital-q/contracts";
import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import {
  ResourceScopeSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  GatewayIdSchema,
  type Gateway,
  type GatewayId,
  type GatewayPublicId,
} from "../contracts/index.js";
import type { GatewayRepository } from "./ports.js";
import {
  GATEWAY_PUBLISH,
  GATEWAY_VIEW,
  GatewayNotFoundError,
} from "./use-cases.js";

/**
 * B6 / B7 (2026-11-14): the investor organisation's own gateway, branded,
 * placed and paused by its admins, with no operator in the loop.
 *
 *   gateway appearance ≠ the tenant's brand theme (platform admins only)
 *   gateway status ≠ the published policy (its versions are untouched)
 *
 * Authority is GateQ's own, read from the gateway row: seeing the
 * appearance is investor.gateway.view; changing what the public sees (the
 * colour, who may frame the embed, whether the door is open) is
 * investor.gateway.publish, which only the organisation's admins hold. A
 * gateway in another tenant is "not found", exactly as everywhere in GateQ.
 * Every change is a new revision and a material-action audit line with the
 * values before and after; nothing is overwritten.
 */

/** A logo Capital Q keeps for a gateway; ICON: the site's icon, labelled so. */
export type GatewayLogoRef = {
  readonly assetId: string;
  readonly kind: "LOGO" | "ICON";
};

/**
 * A kept logo: PNG or JPEG by magic bytes, or SVG rebuilt from the
 * q-research allow-list (and re-checked each time it is served).
 */
export type GatewayLogoContentType =
  "image/png" | "image/jpeg" | "image/svg+xml";

export type GatewayAppearance = {
  readonly gatewayId: string;
  /** 0: never set. */
  readonly revision: number;
  readonly accentHex: string | null;
  readonly embedOrigins: readonly string[];
  readonly updatedAt: string | null;
  /** Null: the canonical organisation name is shown. */
  readonly displayName: string | null;
  readonly logo: GatewayLogoRef | null;
};

/**
 * Brand from website: logos read from the organisation's own site, kept in
 * Capital Q's storage so the public gateway never hot-links them.
 * Append-only; the same image for the same gateway is one row.
 */
export type GatewayLogoAssetRepository = {
  readonly store: (
    tx: TransactionContext,
    input: {
      readonly gatewayId: string;
      readonly tenantId: string;
      readonly kind: "LOGO" | "ICON";
      readonly contentType: GatewayLogoContentType;
      readonly bytes: Uint8Array;
      readonly sourceUrl: string;
      readonly userId: string;
    },
  ) => Promise<GatewayLogoRef>;
  /** This gateway's asset, or null (another gateway's is null too). */
  readonly find: (
    gatewayId: string,
    assetId: string,
  ) => Promise<GatewayLogoRef | null>;
  readonly bytes: (
    gatewayId: string,
    assetId: string,
  ) => Promise<{
    readonly contentType: GatewayLogoContentType;
    readonly bytes: Uint8Array;
  } | null>;
};

type Found<T> = { readonly status: "FOUND" } & T;
type Missing = { readonly status: "NOT_FOUND"; readonly reason: string };

/**
 * What the organisation's website says about it (the q-research website
 * identity reader, composed by the app): no network in this package.
 */
export type GatewayWebsiteReading = {
  readonly sourceUrl: string | null;
  readonly name:
    | Found<{ readonly value: string; readonly from: GatewayNameSource }>
    | Missing;
  readonly logo:
    | Found<{
        readonly kind: "LOGO" | "ICON";
        readonly bytes: Uint8Array;
        readonly contentType: GatewayLogoContentType;
        readonly sourceUrl: string;
      }>
    | Missing;
  readonly colours:
    | Found<{
        readonly primary: string;
        readonly secondary?: string | undefined;
      }>
    | Missing;
};
type GatewayNameSource =
  | "OG_SITE_NAME"
  | "MANIFEST"
  | "APPLICATION_NAME"
  | "SCHEMA_ORG"
  | "LOGO_LABEL"
  | "TITLE";

export type GatewayBrandSources = {
  /**
   * The investor organisation's canonical record, read as this person
   * through its own service: the website on the record is the only one
   * ever read. Null: not theirs to read.
   */
  readonly canonical: (
    actor: ActorContext,
    investorOrganisationId: string,
  ) => Promise<{
    readonly displayName: string;
    readonly websiteUrl: string | null;
    readonly version: number;
  } | null>;
  readonly readWebsite: (websiteUrl: string) => Promise<GatewayWebsiteReading>;
};

export type GatewayAppearanceRepository = {
  /** The newest revision, or null when none was ever set. */
  readonly current: (gatewayId: string) => Promise<GatewayAppearance | null>;
  /**
   * Appends the next revision, under a lock on the gateway row so two
   * admins saving at once get revisions n+1 and n+2, never a collision.
   */
  readonly append: (
    tx: TransactionContext,
    input: {
      readonly gatewayId: string;
      readonly tenantId: string;
      readonly accentHex: string | null;
      readonly embedOrigins: readonly string[];
      readonly displayName: string | null;
      readonly logoAssetId: string | null;
      readonly userId: string;
    },
  ) => Promise<GatewayAppearance>;
};

type Authorization = Pick<AuthorizationService, "requireCapability">;

export type GatewayAdminDependencies = {
  readonly gateways: GatewayRepository;
  readonly appearances: GatewayAppearanceRepository;
  readonly authorization: Authorization;
  readonly transactions: TransactionManager;
  readonly audit: MaterialActionAuditWriter;
  /** Brand from website; absent, the suggestion is unavailable. */
  readonly logos?: GatewayLogoAssetRepository | undefined;
  readonly brand?: GatewayBrandSources | undefined;
};

export class GatewayBrandUnavailableError extends Error {
  constructor() {
    super("brand from website is not configured");
    this.name = "GatewayBrandUnavailableError";
  }
}

export type GatewayAdminService = {
  readonly appearance: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
  }) => Promise<GatewayAppearance & { readonly canChange: boolean }>;
  readonly setAppearance: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
    readonly accentHex: string | null;
    readonly embedOrigins: readonly string[];
    /** Omitted: unchanged. Null: the canonical name. */
    readonly displayName?: string | null | undefined;
    /** Omitted: unchanged. Null: no logo. Else this gateway's stored logo. */
    readonly logoAssetId?: string | null | undefined;
  }) => Promise<GatewayAppearance>;
  /**
   * Brand from website: reads the organisation's canonical website (never
   * a URL from the request), keeps any logo it finds in Capital Q's
   * storage and suggests name, logo and colours, each FOUND or NOT_FOUND
   * with the reason. Nothing public changes until an admin saves.
   */
  readonly suggestBrand: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
  }) => Promise<GatewayBrandSuggestionDto>;
  /** Anonymous: the open gateway's saved logo bytes, or null. */
  readonly publicLogo: (publicId: GatewayPublicId) => Promise<{
    readonly contentType: GatewayLogoContentType;
    readonly bytes: Uint8Array;
  } | null>;
  readonly setStatus: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
    readonly status: Gateway["status"];
  }) => Promise<Gateway>;
  /**
   * Anonymous: the appearance of an OPEN gateway by its public id. Paused
   * or unknown: null (the caller has already answered 404 for those).
   */
  readonly publicAppearance: (
    publicId: GatewayPublicId,
  ) => Promise<GatewayAppearance | null>;
};

const NEVER_SET = (gatewayId: string): GatewayAppearance => ({
  gatewayId,
  revision: 0,
  accentHex: null,
  embedOrigins: [],
  updatedAt: null,
  displayName: null,
  logo: null,
});

const reasonOf = (reason: string): GatewayBrandReason => {
  const parsed = GatewayBrandReasonSchema.safeParse(reason);
  return parsed.success ? parsed.data : "UNREACHABLE";
};
const missing = (reason: GatewayBrandReason) =>
  ({ status: "NOT_FOUND", reason }) as const;

export function createGatewayAdminService(
  dependencies: GatewayAdminDependencies,
): GatewayAdminService {
  const { gateways, appearances, authorization, transactions, audit, logos } =
    dependencies;

  const scopeOf = (gateway: Gateway) =>
    ResourceScopeSchema.parse({
      kind: "RESOURCE",
      tenantId: gateway.tenantId,
      organisationId: gateway.organisationId,
      resourceType: "investor_gateway",
      resourceId: gateway.id,
    });

  const authorised = async (
    actor: ActorContext,
    gatewayId: GatewayId,
    required: typeof GATEWAY_VIEW,
  ): Promise<Gateway> => {
    const gateway = await gateways.findById(gatewayId);
    if (gateway === null || gateway.tenantId !== actor.tenantId) {
      throw new GatewayNotFoundError();
    }
    await authorization.requireCapability({
      actor,
      capability: required,
      resource: scopeOf(gateway),
    });
    return gateway;
  };

  const record = (
    tx: TransactionContext,
    actor: ActorContext,
    gateway: Gateway,
    actionType: string,
    metadata: Readonly<Record<string, string | number | boolean>>,
  ) =>
    audit.record(tx, {
      auditEventId: randomUUID(),
      ...auditActorFromContext(actor),
      // The gateway's own tenant and organisation, from the row.
      tenantId: gateway.tenantId,
      organisationId: gateway.organisationId,
      actionType,
      resourceType: "investor_gateway",
      resourceId: gateway.id,
      occurredAt: occurredNow(),
      outcome: "SUCCEEDED",
      metadata,
    });

  return {
    appearance: async ({ actor, gatewayId }) => {
      const gateway = await authorised(actor, gatewayId, GATEWAY_VIEW);
      let canChange = true;
      try {
        await authorization.requireCapability({
          actor,
          capability: GATEWAY_PUBLISH,
          resource: scopeOf(gateway),
        });
      } catch {
        canChange = false;
      }
      const current =
        (await appearances.current(gateway.id)) ?? NEVER_SET(gateway.id);
      return { ...current, canChange };
    },

    setAppearance: async ({
      actor,
      gatewayId,
      accentHex,
      embedOrigins,
      displayName,
      logoAssetId,
    }) => {
      // Validated here too, not only at the route: Q's tool reaches this
      // service without HTTP, and the database check is the last line.
      const input = GatewayAppearanceRequestSchema.parse({
        accentHex,
        embedOrigins,
        ...(displayName === undefined ? {} : { displayName }),
        ...(logoAssetId === undefined ? {} : { logoAssetId }),
      });
      const gateway = await authorised(actor, gatewayId, GATEWAY_PUBLISH);
      const before =
        (await appearances.current(gateway.id)) ?? NEVER_SET(gateway.id);
      let logo = before.logo;
      if (input.logoAssetId === null) {
        logo = null;
      } else if (input.logoAssetId !== undefined) {
        // Only a logo kept for this very gateway; anything else is the one
        // refusal, never which of the two it was.
        logo = (await logos?.find(gateway.id, input.logoAssetId)) ?? null;
        if (logo === null) throw new GatewayNotFoundError();
      }
      const name =
        input.displayName === undefined
          ? before.displayName
          : input.displayName;
      return transactions.run(async (tx) => {
        const next = await appearances.append(tx, {
          gatewayId: gateway.id,
          tenantId: gateway.tenantId,
          accentHex: input.accentHex,
          embedOrigins: input.embedOrigins,
          displayName: name,
          logoAssetId: logo?.assetId ?? null,
          userId: actor.userId,
        });
        await record(tx, actor, gateway, "gateq.gateway.appearance_set", {
          revision: next.revision,
          accentBefore: before.accentHex ?? "none",
          accentAfter: next.accentHex ?? "none",
          embedOriginsBefore: before.embedOrigins.join(" ") || "any",
          embedOriginsAfter: next.embedOrigins.join(" ") || "any",
          displayNameBefore: before.displayName ?? "canonical",
          displayNameAfter: next.displayName ?? "canonical",
          logoBefore: before.logo?.assetId ?? "none",
          logoAfter: next.logo?.assetId ?? "none",
        });
        return next;
      });
    },

    suggestBrand: async ({ actor, gatewayId }) => {
      const brand = dependencies.brand;
      if (brand === undefined || logos === undefined) {
        throw new GatewayBrandUnavailableError();
      }
      const gateway = await authorised(actor, gatewayId, GATEWAY_PUBLISH);
      const record = await brand.canonical(
        actor,
        gateway.investorOrganisationId,
      );
      if (record === null) throw new GatewayNotFoundError();
      const base = {
        gatewayId: gateway.id,
        websiteUrl: record.websiteUrl,
        canonicalName: record.displayName,
        investorOrganisationId: gateway.investorOrganisationId,
        profileVersion: record.version,
      };
      if (record.websiteUrl === null) {
        return GatewayBrandSuggestionDtoSchema.parse({
          ...base,
          sourceUrl: null,
          name: missing("NO_WEBSITE"),
          logo: missing("NO_WEBSITE"),
          colours: missing("NO_WEBSITE"),
        });
      }
      // The site is read outside any transaction (bounded by the vetted
      // client); only the logo it found is written, in a short one.
      const reading = await brand.readWebsite(record.websiteUrl);
      let logo: GatewayBrandSuggestionDto["logo"];
      if (reading.logo.status === "FOUND") {
        const found = reading.logo;
        const stored = await transactions.run((tx) =>
          logos.store(tx, {
            gatewayId: gateway.id,
            tenantId: gateway.tenantId,
            kind: found.kind,
            contentType: found.contentType,
            bytes: found.bytes,
            sourceUrl: found.sourceUrl,
            userId: actor.userId,
          }),
        );
        logo = {
          status: "FOUND",
          kind: stored.kind,
          assetId: stored.assetId,
          sourceUrl: found.sourceUrl,
          previewDataUrl: `data:${found.contentType};base64,${Buffer.from(found.bytes).toString("base64")}`,
        };
      } else {
        logo = missing(reasonOf(reading.logo.reason));
      }
      return GatewayBrandSuggestionDtoSchema.parse({
        ...base,
        sourceUrl: reading.sourceUrl,
        name:
          reading.name.status === "FOUND"
            ? {
                status: "FOUND",
                value: reading.name.value,
                from: reading.name.from,
              }
            : missing(reasonOf(reading.name.reason)),
        logo,
        colours:
          reading.colours.status === "FOUND"
            ? {
                status: "FOUND",
                primary: reading.colours.primary,
                ...(reading.colours.secondary === undefined
                  ? {}
                  : { secondary: reading.colours.secondary }),
              }
            : missing(reasonOf(reading.colours.reason)),
      });
    },

    publicLogo: async (publicId) => {
      const gateway = await gateways.findByPublicId(publicId);
      if (gateway === null || gateway.status !== "ACTIVE") return null;
      const current = await appearances.current(gateway.id);
      if (current?.logo == null || logos === undefined) return null;
      return logos.bytes(gateway.id, current.logo.assetId);
    },

    setStatus: async ({ actor, gatewayId, status }) => {
      const gateway = await authorised(actor, gatewayId, GATEWAY_PUBLISH);
      if (gateway.status === status) return gateway;
      return transactions.run(async (tx) => {
        const changed = await gateways.setStatus(tx, gateway.id, status);
        await record(
          tx,
          actor,
          gateway,
          status === "ACTIVE"
            ? "gateq.gateway.reopened"
            : "gateq.gateway.paused",
          { statusBefore: gateway.status, statusAfter: changed.status },
        );
        return changed;
      });
    },

    publicAppearance: async (publicId) => {
      const gateway = await gateways.findByPublicId(publicId);
      if (gateway === null || gateway.status !== "ACTIVE") return null;
      return appearances.current(gateway.id);
    },
  };
}

/** A refusal Q and the route answer alike: never which of the two it was. */
const isRefusal = (error: unknown): boolean =>
  error instanceof GatewayNotFoundError ||
  (error instanceof Error && error.name === "AuthorizationDeniedError");

export type GatewayAdminResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false };

/**
 * The gateway's administration as the declared app actions reach it (ADR
 * 0040): the screen's routes and Q's tools call the same service as the
 * same person. A gateway that is not theirs, or that they may not change,
 * is one refusal. `ownGateway` is the lookup Q needs because it has no
 * screen: their organisation's open gateway, else its paused one.
 */
export function gatewayAdminActionsPort(dependencies: {
  readonly admin: GatewayAdminService;
  readonly listGateways: (command: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
    readonly organisationId: string;
  }) => Promise<readonly Gateway[]>;
  readonly ownInvestorOrganisationId: (
    actor: ActorContext,
  ) => Promise<string | null>;
}) {
  const refusing = async <T>(
    work: () => Promise<T>,
  ): Promise<GatewayAdminResult<T>> => {
    try {
      return { ok: true, value: await work() };
    } catch (error: unknown) {
      if (isRefusal(error)) return { ok: false };
      throw error;
    }
  };
  const idOf = (gatewayId: string): GatewayId | null => {
    const parsed = GatewayIdSchema.safeParse(gatewayId);
    return parsed.success ? parsed.data : null;
  };
  return {
    ownGateway: async (
      actor: ActorContext,
    ): Promise<{
      readonly id: string;
      readonly status: Gateway["status"];
    } | null> => {
      const investorOrganisationId = await dependencies
        .ownInvestorOrganisationId(actor)
        .catch(() => null);
      if (investorOrganisationId === null) return null;
      const gateways = await dependencies
        .listGateways({
          actor,
          investorOrganisationId,
          organisationId: actor.organisationId ?? "",
        })
        .catch(() => []);
      const gateway =
        gateways.find((item) => item.status === "ACTIVE") ?? gateways[0];
      return gateway === undefined
        ? null
        : { id: gateway.id, status: gateway.status };
    },
    appearance: (actor: ActorContext, gatewayId: string) => {
      const id = idOf(gatewayId);
      return id === null
        ? Promise.resolve({ ok: false } as const)
        : refusing(() =>
            dependencies.admin.appearance({ actor, gatewayId: id }),
          );
    },
    setAppearance: (
      actor: ActorContext,
      gatewayId: string,
      input: {
        readonly accentHex: string | null;
        readonly embedOrigins: readonly string[];
        readonly displayName?: string | null | undefined;
        readonly logoAssetId?: string | null | undefined;
      },
    ) => {
      const id = idOf(gatewayId);
      return id === null
        ? Promise.resolve({ ok: false } as const)
        : refusing(() =>
            dependencies.admin.setAppearance({
              actor,
              gatewayId: id,
              accentHex: input.accentHex,
              embedOrigins: input.embedOrigins,
              ...(input.displayName === undefined
                ? {}
                : { displayName: input.displayName }),
              ...(input.logoAssetId === undefined
                ? {}
                : { logoAssetId: input.logoAssetId }),
            }),
          );
    },
    suggestBrand: (actor: ActorContext, gatewayId: string) => {
      const id = idOf(gatewayId);
      return id === null
        ? Promise.resolve({ ok: false } as const)
        : refusing(() =>
            dependencies.admin.suggestBrand({ actor, gatewayId: id }),
          );
    },
    setStatus: (
      actor: ActorContext,
      gatewayId: string,
      status: Gateway["status"],
    ) => {
      const id = idOf(gatewayId);
      return id === null
        ? Promise.resolve({ ok: false } as const)
        : refusing(() =>
            dependencies.admin.setStatus({ actor, gatewayId: id, status }),
          );
    },
  };
}
