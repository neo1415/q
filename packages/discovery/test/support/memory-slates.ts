import {
  RecommendationItemSchema,
  RecommendationSlateSchema,
  type NewRecommendationItem,
  type RecommendationItem,
  type RecommendationSlate,
} from "../../src/slates/contracts.js";
import {
  SlateBuildInProgressError,
  type SlateKey,
  type SlateRepository,
} from "../../src/slates/ports.js";

// ---------------------------------------------------------------------------
// An in-memory slate store with the lifecycle rules of the real one.
// ---------------------------------------------------------------------------

export type Stored = {
  slate: RecommendationSlate;
  items: RecommendationItem[];
};

export function memorySlates(options: { readonly failPublish?: boolean } = {}) {
  const rows = new Map<string, Stored>();
  let n = 0;
  const nextId = () =>
    `55555555-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
  const sameKey = (s: RecommendationSlate, key: SlateKey) =>
    s.tenantId === key.tenantId &&
    s.investorOrganisationId === key.investorOrganisationId &&
    s.mandateId === key.mandateId &&
    s.mode === key.mode;
  const byStatus = (key: SlateKey, status: string) =>
    [...rows.values()].find(
      (r) => sameKey(r.slate, key) && r.slate.status === status,
    );
  const repo: SlateRepository = {
    beginBuild: (input) => {
      if (byStatus(input, "BUILDING") !== undefined) {
        return Promise.reject(new SlateBuildInProgressError());
      }
      const slate = RecommendationSlateSchema.parse({
        id: nextId(),
        tenantId: input.tenantId,
        investorOrganisationId: input.investorOrganisationId,
        mandateId: input.mandateId,
        mandateVersion: input.mandateVersion,
        mode: input.mode,
        status: "BUILDING",
        ...input.versions,
        generationFingerprint: null,
        itemCount: 0,
        diagnostics: null,
        generatedAt: input.generatedAt,
        publishedAt: null,
        expiresAt: null,
        invalidatedAt: null,
        invalidationReason: null,
        supersededAt: null,
        supersedesSlateId: null,
        failureCode: null,
      });
      rows.set(slate.id, { slate, items: [] });
      return Promise.resolve(slate);
    },
    insertItems: (
      slateId,
      _tenantId,
      items: readonly NewRecommendationItem[],
    ) => {
      const row = rows.get(slateId);
      if (row === undefined || row.slate.status !== "BUILDING") {
        return Promise.reject(new Error("items only while BUILDING"));
      }
      for (const item of items) {
        row.items.push(
          RecommendationItemSchema.parse({
            ...item,
            id: nextId(),
            slateId,
            createdAt: row.slate.generatedAt,
          }),
        );
      }
      return Promise.resolve(items.length);
    },
    publish: (_transactions, input) => {
      if (options.failPublish === true) {
        return Promise.reject(new Error("publish exploded"));
      }
      const row = rows.get(input.slateId);
      if (row === undefined || row.slate.status !== "BUILDING") {
        return Promise.reject(new Error("not BUILDING"));
      }
      const previous = byStatus(row.slate, "CURRENT");
      if (previous !== undefined) {
        previous.slate = {
          ...previous.slate,
          status: "SUPERSEDED",
          supersededAt: input.publishedAt,
        };
      }
      row.slate = {
        ...row.slate,
        status: "CURRENT",
        generationFingerprint: input.generationFingerprint,
        itemCount: input.itemCount,
        diagnostics: input.diagnostics,
        publishedAt: input.publishedAt,
        expiresAt: input.expiresAt,
        supersedesSlateId: previous?.slate.id ?? null,
      };
      return Promise.resolve({
        slate: row.slate,
        supersededSlateId: previous?.slate.id ?? null,
      });
    },
    fail: (slateId, failureCode) => {
      const row = rows.get(slateId);
      if (row !== undefined && row.slate.status === "BUILDING") {
        row.slate = { ...row.slate, status: "FAILED", failureCode };
      }
      return Promise.resolve();
    },
    invalidate: (slateId, reason, at) => {
      const row = rows.get(slateId);
      if (row === undefined || row.slate.status !== "CURRENT") {
        return Promise.resolve(false);
      }
      row.slate = {
        ...row.slate,
        status: "INVALIDATED",
        invalidatedAt: at,
        invalidationReason: reason,
      };
      return Promise.resolve(true);
    },
    expire: (slateId) => {
      const row = rows.get(slateId);
      if (row === undefined || row.slate.status !== "CURRENT") {
        return Promise.resolve(false);
      }
      row.slate = { ...row.slate, status: "EXPIRED" };
      return Promise.resolve(true);
    },
    findById: (slateId) => Promise.resolve(rows.get(slateId)?.slate ?? null),
    findCurrent: (key) =>
      Promise.resolve(byStatus(key, "CURRENT")?.slate ?? null),
    findCurrentContaining: (companyId) =>
      Promise.resolve(
        [...rows.values()]
          .filter(
            (r) =>
              r.slate.status === "CURRENT" &&
              r.items.some((i) => i.companyId === companyId),
          )
          .map((r) => r.slate),
      ),
    findCurrentForInvestor: (input) =>
      Promise.resolve(
        [...rows.values()]
          .filter(
            (r) =>
              r.slate.status === "CURRENT" &&
              r.slate.tenantId === input.tenantId &&
              r.slate.investorOrganisationId === input.investorOrganisationId,
          )
          .map((r) => r.slate),
      ),
    listCurrent: (limit) =>
      Promise.resolve(
        [...rows.values()]
          .filter((r) => r.slate.status === "CURRENT")
          .map((r) => r.slate)
          .slice(0, limit),
      ),
    pageItems: (input) =>
      Promise.resolve(
        (rows.get(input.slateId)?.items ?? [])
          .filter((i) => i.rank > input.afterRank)
          .sort((a, b) => a.rank - b.rank)
          .slice(0, input.limit),
      ),
    listHistory: (key) =>
      Promise.resolve(
        [...rows.values()]
          .filter((r) => sameKey(r.slate, key))
          .map((r) => r.slate),
      ),
  };
  return { repo, rows };
}
