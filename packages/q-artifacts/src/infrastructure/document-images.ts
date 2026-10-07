import { randomUUID } from "node:crypto";

import {
  Q_GENERATED_IMAGE_SCHEME,
  QSlideImageSchema,
  type QSlideImage,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

/**
 * Images for documents (DOCS; ADR 0031 addendum; Q room W5).
 *
 * Moved here from the Q API (Q room W5) so the worker that makes
 * documents files pictures through the same code. The gateway makes a
 * picture; this files it: bytes into the private `cq-document-images`
 * bucket, provenance into artifacts.document_images (AI-generated or the
 * person's own upload, provider, model, the exact prompt, cost), and a
 * `cq-image:<id>` reference into the document. Delivery is a short-lived
 * signed URL straight from storage to the browser, or the bytes read here
 * for a PDF or PowerPoint file; never through the web app.
 *
 * Budgets are counted from the provenance table before every generated
 * picture: per document (one Q run), per organisation per UTC day, per
 * person per UTC day in dollars, and across Capital Q per UTC day (the
 * founder's credit ceiling). A spent budget, or a billing refusal, is a
 * quiet "no picture", never a failed document; after a billing refusal
 * the port asks no more for that document.
 */

export const DOCUMENT_IMAGE_BUCKET = "cq-document-images";
const SIGNED_URL_TTL_SECONDS = 600;
/** The meter's feature for generated images (billing, ADR 0034). */
export const AI_IMAGES_FEATURE = "documents.ai_images";

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
  /** Q room W5: dollars one person may spend on pictures per UTC day. */
  readonly perUserPerDayUsd?: number | undefined;
};

/**
 * The image gateway, structurally (model-gateway/images ImageGateway):
 * this package never imports a provider or the gateway itself.
 */
export type DocumentImageGateway = {
  readonly enabled: boolean;
  readonly generate: (request: {
    readonly prompt: string;
    readonly shape: "LANDSCAPE" | "SQUARE";
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly qRunId?: string | undefined;
      readonly correlationId?: string | undefined;
    };
    readonly signal?: AbortSignal | undefined;
  }) => Promise<
    | {
        readonly status: "GENERATED";
        readonly image: {
          readonly bytes: Uint8Array;
          readonly contentType: "image/png" | "image/jpeg";
        };
        readonly providerCode: string;
        readonly modelCode: string;
        readonly prompt: string;
        readonly costUsd: number;
      }
    | {
        readonly status: "UNAVAILABLE" | "FAILED";
        readonly reason?: "BILLING" | undefined;
      }
  >;
};

/** One generated picture for a slide (q-specialists' IllustrationPort). */
export type DocumentIllustrationPort = {
  readonly illustrate: (input: {
    readonly prompt: string;
    readonly purpose: "COVER" | "SLIDE";
    readonly alt: string;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QSlideImage | null>;
};

export type DocumentImages = {
  readonly enabled: boolean;
  /** The illustration port for one Q run, as this actor. */
  readonly illustrationsFor: (input: {
    readonly actor: ActorContext;
    readonly runId: string;
    readonly correlationId?: string | undefined;
  }) => DocumentIllustrationPort | undefined;
  /**
   * Q room W5: the person's own picture, already read from their own
   * upload as them, filed as OWN_UPLOAD. Null when it could not be stored.
   */
  readonly fileOwnPicture: (input: {
    readonly actor: ActorContext;
    readonly bytes: Uint8Array;
    readonly contentType: "image/png" | "image/jpeg";
    readonly sourceDocumentId: string;
    readonly alt: string;
  }) => Promise<QSlideImage | null>;
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
  readonly gateway: DocumentImageGateway;
  readonly store: DocumentImageStore | undefined;
  readonly budgets: DocumentImageBudgets;
  readonly logger?: Logger | undefined;
  readonly newId?: (() => string) | undefined;
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
  /** The meter's feature name; billing's AI images unless the caller says. */
  readonly meterFeature?: string | undefined;
}): DocumentImages {
  const { sql, gateway, store, budgets } = dependencies;
  const newId = dependencies.newId ?? randomUUID;
  const feature = dependencies.meterFeature ?? AI_IMAGES_FEATURE;
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

  /** Whether one more generated picture fits every budget right now. */
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
    // Only generated pictures spend: the person's own uploads are free.
    const [run, organisation, platform, person] = await Promise.all([
      sql`select count(*)::int as n from artifacts.document_images
           where q_run_id = ${runId} and provenance = 'AI_GENERATED'`,
      sql`select count(*)::int as n from artifacts.document_images
           where tenant_id = ${actor.tenantId}
             and organisation_id = ${actor.organisationId}
             and provenance = 'AI_GENERATED'
             and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
      sql`select count(*)::int as n from artifacts.document_images
           where provenance = 'AI_GENERATED'
             and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
      budgets.perUserPerDayUsd === undefined
        ? Promise.resolve([{ n: 0 }])
        : sql`select coalesce(sum(cost_usd), 0)::float8 as n
                from artifacts.document_images
               where created_by_user_id = ${actor.userId}
                 and provenance = 'AI_GENERATED'
                 and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
    ]);
    return (
      count(run) < budgets.perDocument &&
      count(organisation) < budgets.perOrganisationPerDay &&
      count(platform) < budgets.platformPerDay &&
      (budgets.perUserPerDayUsd === undefined ||
        count(person) < budgets.perUserPerDayUsd)
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
      // Q room W5: after a billing refusal this document asks no more.
      let refused = false;
      return {
        illustrate: async (input): Promise<QSlideImage | null> => {
          if (refused) return null;
          if (!(await withinBudget(owner, runId))) return null;
          const imageId = newId();
          const meter = dependencies.meter;
          const meterKey = `document-image:${imageId}`;
          if (
            meter !== undefined &&
            !(await meter.consume(actor, feature, meterKey)).allowed
          ) {
            return null;
          }
          const giveBack = () =>
            meter?.release(actor, feature, meterKey).catch(() => undefined);
          const generated = await gateway.generate({
            prompt: input.prompt,
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
            if (generated.reason === "BILLING") {
              refused = true;
              dependencies.logger?.warn(
                { qRunId: runId },
                "document images refused on billing: falling back to stock photos and placeholders",
              );
            }
            await giveBack();
            return null;
          }
          dependencies.logger?.info(
            {
              qRunId: runId,
              providerCode: generated.providerCode,
              modelCode: generated.modelCode,
              costUsd: generated.costUsd,
            },
            "document image generated",
          );
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
    fileOwnPicture: async (input) => {
      const organisationId = input.actor.organisationId;
      if (store === undefined || organisationId === undefined) return null;
      if (input.bytes.byteLength < 8 || input.bytes.byteLength > 5_242_880) {
        return null;
      }
      const imageId = newId();
      const extension = input.contentType === "image/png" ? "png" : "jpg";
      const key = `${organisationId}/${imageId}.${extension}`;
      if (!(await store.put(key, input.bytes, input.contentType))) return null;
      await sql`
        insert into artifacts.document_images (
          id, tenant_id, organisation_id, q_run_id, storage_key,
          content_type, byte_size, provenance, provider_code, model_code,
          prompt, purpose, cost_usd, created_by_user_id, source_document_id)
        values (
          ${imageId}, ${input.actor.tenantId}, ${organisationId}, null,
          ${key}, ${input.contentType}, ${input.bytes.byteLength},
          'OWN_UPLOAD', 'upload', 'own-upload',
          ${"The person's own picture, dropped on a placeholder."}, 'UPLOAD',
          0, ${input.actor.userId}, ${input.sourceDocumentId})`;
      return QSlideImageSchema.parse({
        url: `${Q_GENERATED_IMAGE_SCHEME}${imageId}`,
        alt: input.alt.slice(0, 200),
        credit: "Your upload",
        provenance: "OWN_UPLOAD",
      });
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
