import { randomUUID } from "node:crypto";

import { FEATURE_AI_IMAGES } from "@capital-q/billing";

import {
  Q_GENERATED_IMAGE_SCHEME,
  QSlideImageSchema,
  type QSlideImage,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ImageGateway } from "@capital-q/model-gateway/images";
import type { Logger } from "@capital-q/observability";
import type { IllustrationPort } from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

/**
 * Generated images for documents (DOCS; ADR 0031 addendum).
 *
 * The gateway makes the picture; this files it: bytes into the private
 * `cq-document-images` bucket, provenance into artifacts.document_images
 * (AI-generated, provider, model, the exact prompt, cost), and a
 * `cq-image:<id>` reference into the document. Delivery is a short-lived
 * signed URL straight from storage to the browser, or the bytes read here
 * for a PDF or PowerPoint file; never through the web app.
 *
 * Budgets are counted from the provenance table before every call: per
 * document (one Q run), per organisation per UTC day, and across Capital Q
 * per UTC day (the founder's credit ceiling). A spent budget is a quiet
 * "no picture", never a failed document.
 */

export const DOCUMENT_IMAGE_BUCKET = "cq-document-images";
const SIGNED_URL_TTL_SECONDS = 600;

export type DocumentImageStore = {
  readonly put: (
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Promise<boolean>;
  readonly get: (key: string) => Promise<Uint8Array | null>;
  readonly sign: (key: string, ttlSeconds: number) => Promise<string | null>;
};

/** Supabase Storage, with the server's secret key, never a browser's. */
export function createSupabaseDocumentImageStore(options: {
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly fetch?: typeof fetch | undefined;
}): DocumentImageStore {
  const base = `${options.supabaseUrl.replace(/\/+$/, "")}/storage/v1`;
  const call = options.fetch ?? fetch;
  const headers = {
    authorization: `Bearer ${options.secretKey}`,
    apikey: options.secretKey,
  };
  const path = (key: string) =>
    `${DOCUMENT_IMAGE_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return {
    put: async (key, bytes, contentType) => {
      try {
        const response = await call(`${base}/object/${path(key)}`, {
          method: "POST",
          headers: {
            ...headers,
            "content-type": contentType,
            "x-upsert": "false",
          },
          body: Buffer.from(bytes),
          signal: AbortSignal.timeout(20_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    get: async (key) => {
      try {
        const response = await call(`${base}/object/${path(key)}`, {
          headers,
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        return null;
      }
    },
    sign: async (key, ttlSeconds) => {
      try {
        const response = await call(`${base}/object/sign/${path(key)}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ expiresIn: ttlSeconds }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return null;
        const body: unknown = await response.json().catch(() => null);
        const signed: unknown = Reflect.get(Object(body), "signedURL");
        return typeof signed === "string" && signed.startsWith("/object/sign/")
          ? `${base}${signed}`
          : null;
      } catch {
        return null;
      }
    },
  };
}

export type DocumentImageBudgets = {
  readonly perDocument: number;
  readonly perOrganisationPerDay: number;
  readonly platformPerDay: number;
};

export type DocumentImages = {
  readonly enabled: boolean;
  /** The illustration port for one Q run, as this actor. */
  readonly illustrationsFor: (input: {
    readonly actor: ActorContext;
    readonly runId: string;
    readonly correlationId?: string | undefined;
  }) => IllustrationPort | undefined;
  /** Bytes for a file export, only for the actor's own organisation. */
  readonly bytesFor: (
    actor: ActorContext,
    imageId: string,
  ) => Promise<Uint8Array | null>;
  /** A short-lived signed URL straight from storage, same rule. */
  readonly signedUrlFor: (
    actor: ActorContext,
    imageId: string,
  ) => Promise<string | null>;
};

const count = (rows: readonly unknown[]): number => {
  const value: unknown = Reflect.get(Object(rows[0]), "n");
  return typeof value === "number"
    ? value
    : typeof value === "string" || typeof value === "bigint"
      ? Number(value)
      : 0;
};

export function createDocumentImages(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly gateway: ImageGateway;
  readonly store: DocumentImageStore | undefined;
  readonly budgets: DocumentImageBudgets;
  readonly logger?: Logger | undefined;
  readonly newId?: (() => string) | undefined;
  // BILLING block (ADR 0034): each picture draws one unit of the plan's
  // AI images. A refusal makes no picture (the document is still built,
  // with stock or none); a picture that is not made gives the unit back.
  readonly meter?:
    | {
        readonly consume: (
          actor: ActorContext,
          feature: string,
          idempotencyKey: string,
        ) => Promise<{ readonly allowed: boolean }>;
        readonly release: (
          actor: ActorContext,
          feature: string,
          idempotencyKey: string,
        ) => Promise<void>;
      }
    | undefined;
  // end BILLING block
}): DocumentImages {
  const { sql, gateway, store, budgets } = dependencies;
  const newId = dependencies.newId ?? randomUUID;
  const enabled = gateway.enabled && store !== undefined;

  const keyOf = async (
    actor: ActorContext,
    imageId: string,
  ): Promise<string | null> => {
    if (actor.organisationId === undefined) return null;
    const rows = await sql`
      select storage_key from artifacts.document_images
       where id = ${imageId}
         and tenant_id = ${actor.tenantId}
         and organisation_id = ${actor.organisationId}
       limit 1`;
    const key: unknown = Reflect.get(Object(rows[0]), "storage_key");
    return typeof key === "string" ? key : null;
  };

  /** Whether one more picture fits every budget right now. */
  const withinBudget = async (
    actor: ActorContext & { readonly organisationId: string },
    runId: string,
  ): Promise<boolean> => {
    if (
      budgets.perDocument <= 0 ||
      budgets.perOrganisationPerDay <= 0 ||
      budgets.platformPerDay <= 0
    ) {
      return false;
    }
    const [run, organisation, platform] = await Promise.all([
      sql`select count(*)::int as n from artifacts.document_images
           where q_run_id = ${runId}`,
      sql`select count(*)::int as n from artifacts.document_images
           where tenant_id = ${actor.tenantId}
             and organisation_id = ${actor.organisationId}
             and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
      sql`select count(*)::int as n from artifacts.document_images
           where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
    ]);
    return (
      count(run) < budgets.perDocument &&
      count(organisation) < budgets.perOrganisationPerDay &&
      count(platform) < budgets.platformPerDay
    );
  };

  return {
    enabled,
    illustrationsFor: ({ actor, runId, correlationId }) => {
      const organisationId = actor.organisationId;
      if (!enabled || store === undefined || organisationId === undefined) {
        return undefined;
      }
      const owner = { ...actor, organisationId };
      return {
        illustrate: async (input): Promise<QSlideImage | null> => {
          if (!(await withinBudget(owner, runId))) return null;
          const imageId = newId();
          // BILLING block
          const meter = dependencies.meter;
          const meterKey = `document-image:${imageId}`;
          if (
            meter !== undefined &&
            !(await meter.consume(actor, FEATURE_AI_IMAGES, meterKey)).allowed
          ) {
            return null;
          }
          const giveBack = () =>
            meter
              ?.release(actor, FEATURE_AI_IMAGES, meterKey)
              .catch(() => undefined);
          // end BILLING block
          const generated = await gateway.generate({
            prompt: input.prompt,
            // Slides are 16:9; a landscape picture fills its side best.
            shape: "LANDSCAPE",
            attribution: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              qRunId: runId,
              correlationId,
            },
            signal: input.signal,
          });
          if (generated.status !== "GENERATED") {
            await giveBack();
            return null;
          }
          const extension =
            generated.image.contentType === "image/png" ? "png" : "jpg";
          const key = `${organisationId}/${imageId}.${extension}`;
          if (
            !(await store.put(
              key,
              generated.image.bytes,
              generated.image.contentType,
            ))
          ) {
            dependencies.logger?.warn(
              { qRunId: runId },
              "generated document image could not be stored",
            );
            await giveBack();
            return null;
          }
          await sql`
            insert into artifacts.document_images (
              id, tenant_id, organisation_id, q_run_id, storage_key,
              content_type, byte_size, provider_code, model_code, prompt,
              purpose, cost_usd, created_by_user_id)
            values (
              ${imageId}, ${actor.tenantId}, ${organisationId}, ${runId},
              ${key}, ${generated.image.contentType},
              ${generated.image.bytes.byteLength}, ${generated.providerCode},
              ${generated.modelCode}, ${generated.prompt.slice(0, 1_500)},
              ${input.purpose}, ${generated.costUsd}, ${actor.userId})`;
          return QSlideImageSchema.parse({
            url: `${Q_GENERATED_IMAGE_SCHEME}${imageId}`,
            alt: input.alt,
            credit: "AI-generated image · Capital Q",
            provenance: "AI_GENERATED",
          });
        },
      };
    },
    bytesFor: async (actor, imageId) => {
      if (store === undefined) return null;
      const key = await keyOf(actor, imageId);
      return key === null ? null : store.get(key);
    },
    signedUrlFor: async (actor, imageId) => {
      if (store === undefined) return null;
      const key = await keyOf(actor, imageId);
      return key === null ? null : store.sign(key, SIGNED_URL_TTL_SECONDS);
    },
  };
}
