import { createHash } from "node:crypto";

import { z } from "zod";

import {
  UtcTimestampSchema,
  type RelationshipPipelineDto,
  type RelationshipPipelineQuery,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import type { ActorContext } from "@capital-q/security";

import { RelationshipIdSchema } from "../contracts/index.js";
import {
  RelationshipPipelineLimitError,
  RelationshipPipelineQueryError,
} from "../domain/errors.js";
import { RELATIONSHIP_PROJECTOR_VERSION } from "../domain/state-projector.js";
import {
  createPostgresRelationshipPartyStates,
  type PipelineFilter,
  type PipelineParty,
  type PipelinePageRow,
  type RelationshipPartyStateRepository,
} from "../infrastructure/postgres-relationship-party-states.js";
import type { ExpressInterestDependencies } from "./express-interest.js";
import { readHistory } from "./relationship-history.js";
import { relationshipPipelineScopeBinding } from "./relationship-pipeline.js";
import {
  partyView,
  requireRelationshipListingScope,
} from "./relationship-status.js";

/**
 * The CRM pipeline over its read model (slice 3b, lead-approved
 * 2026-10-15): filter, sort, count and keyset-page in the database instead
 * of folding every relationship in memory behind a 1,000-row ceiling.
 *
 * - The party is the actor's own (requireRelationshipListingScope), the
 *   same authorisation as every relationship list.
 * - Rows are the same per-party fold as a fresh read (`partyView`). A row
 *   that is missing or behind its history is folded again here before the
 *   query, so the page is as fresh as the history. When more rows are
 *   behind than one request should repair (a fresh deployment before its
 *   backfill), the answer is null and the caller keeps the existing
 *   bounded path: never a page silently missing relationships.
 * - Investor side: whether a company is still in the investor's sight is
 *   the disclosure rule's, asked at read time for every row shown or
 *   exported, exactly as before. The count is then exact only when every
 *   candidate was checked; otherwise it is an upper bound and says so.
 * - Cursors keep the established shape {binding, id, key}, bound to the
 *   actor and the query, so a cursor is never authority.
 */

/** Rows one request may fold again before deferring to the existing path. */
export const PIPELINE_REPAIR_LIMIT = 200;
/** At most this many rows in one export; a larger one is refused plainly. */
export const PIPELINE_EXPORT_LIMIT = 5000;

const CursorSchema = z
  .object({
    binding: z.string().length(64),
    id: z.string().uuid(),
    key: z.string().max(240),
  })
  .strict();

type Dependencies = Pick<
  ExpressInterestDependencies,
  | "sql"
  | "repositories"
  | "authorization"
  | "companies"
  | "investorSubject"
  | "companyVisibility"
> & {
  readonly partyStates?: RelationshipPartyStateRepository | undefined;
};

export type PipelinePage = RelationshipPipelineDto & {
  /** False: rows beyond this page were not checked for visibility yet. */
  readonly totalExact: boolean;
};

export type RelationshipPipelineQueryService = {
  /** Null: the read model is not ready for this party; use the existing path. */
  readonly page: (input: {
    readonly actor: ActorContext;
    readonly companyId?: string | undefined;
    readonly query: RelationshipPipelineQuery;
    readonly actorScope: string;
  }) => Promise<PipelinePage | null>;
  /** Every matching row, in order, for an export; null as for `page`. */
  readonly all: (input: {
    readonly actor: ActorContext;
    readonly companyId?: string | undefined;
    readonly query: RelationshipPipelineQuery;
  }) => Promise<readonly RelationshipSummaryDto[] | null>;
};

function bindingOf(query: RelationshipPipelineQuery, actorScope: string) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        actorScope,
        (query.q ?? "").trim().toLowerCase(),
        query.state ?? null,
        query.sort ?? "recent",
        query.pageSize ?? 25,
      ]),
    )
    .digest("hex");
}

function toDto(
  row: PipelinePageRow,
  party: PipelineParty,
): RelationshipSummaryDto {
  return {
    relationshipId: row.relationshipId,
    counterpart: {
      kind: party === "INVESTOR" ? "COMPANY" : "INVESTOR_ORGANISATION",
      id: row.counterpartId,
      name: row.counterpartName,
    },
    state: row.state,
    stateSince: UtcTimestampSchema.parse(row.stateSince),
    nextStep: row.nextStep,
  };
}

export function createRelationshipPipelineQuery(
  dependencies: Dependencies,
): RelationshipPipelineQueryService {
  const states =
    dependencies.partyStates ?? createPostgresRelationshipPartyStates();

  /** Folds this party's stale rows again; false when there are too many. */
  async function repair(party: PipelineParty, partyId: string) {
    const behind = await states.behind(
      dependencies.sql,
      party,
      partyId,
      RELATIONSHIP_PROJECTOR_VERSION,
      PIPELINE_REPAIR_LIMIT + 1,
    );
    if (behind.length > PIPELINE_REPAIR_LIMIT) return false;
    for (const id of behind) {
      const relationshipId = RelationshipIdSchema.parse(id);
      const history = await readHistory(dependencies, relationshipId);
      await states.upsert(dependencies.sql, {
        relationshipId,
        party,
        view: partyView(history, party),
        sourceSequence: history.at(-1)?.sequence ?? 0,
        version: RELATIONSHIP_PROJECTOR_VERSION,
      });
    }
    return true;
  }

  async function prepare(actor: ActorContext, companyId: string | undefined) {
    const scope = await requireRelationshipListingScope(
      dependencies,
      actor,
      companyId,
    );
    const party: PipelineParty = scope.party;
    return (await repair(party, scope.partyId))
      ? { party, partyId: scope.partyId }
      : null;
  }

  const filterOf = (
    party: PipelineParty,
    partyId: string,
    query: RelationshipPipelineQuery,
  ): PipelineFilter => ({
    party,
    partyId,
    q: (query.q ?? "").trim().toLowerCase(),
    state: query.state ?? null,
  });

  /** Rows still in the investor's sight; every company side row is. */
  async function shown(
    actor: ActorContext,
    party: PipelineParty,
    rows: readonly PipelinePageRow[],
  ) {
    if (party === "COMPANY") return rows;
    const checked = await Promise.all(
      rows.map((row) =>
        dependencies.companyVisibility.isVisibleToInvestor(
          actor,
          CompanyIdSchema.parse(row.counterpartId),
        ),
      ),
    );
    return rows.filter((_, at) => checked[at] === true);
  }

  return {
    async page({ actor, companyId, query, actorScope }) {
      const ready = await prepare(actor, companyId);
      if (ready === null) return null;
      const filter = filterOf(ready.party, ready.partyId, query);
      const sort = query.sort ?? "recent";
      const pageSize = query.pageSize ?? 25;
      const binding = bindingOf(query, actorScope);
      let after: { key: string; id: string } | null = null;
      if (query.cursor !== undefined) {
        let cursor: z.infer<typeof CursorSchema>;
        try {
          cursor = CursorSchema.parse(
            JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
          );
        } catch {
          throw new RelationshipPipelineQueryError();
        }
        if (cursor.binding !== binding)
          throw new RelationshipPipelineQueryError();
        after = { key: cursor.key, id: cursor.id };
      }
      const candidates = await states.count(dependencies.sql, filter);
      // Fill the page from batches, dropping rows out of the investor's
      // sight, then look one row ahead to know whether there is a next page.
      const items: PipelinePageRow[] = [];
      let hidden = 0;
      let checkedAll = after === null;
      let seek = after;
      for (;;) {
        const batch = await states.page(
          dependencies.sql,
          filter,
          sort,
          seek,
          pageSize + 1,
        );
        const visible = await shown(actor, ready.party, batch);
        hidden += batch.length - visible.length;
        items.push(...visible);
        const last = batch.at(-1);
        if (batch.length < pageSize + 1 || last === undefined) break;
        if (items.length > pageSize) {
          checkedAll = false;
          break;
        }
        seek = { key: last.sortKey, id: last.relationshipId };
      }
      const page = items.slice(0, pageSize);
      const more = items.length > pageSize;
      const lastShown = page.at(-1);
      const totalExact = checkedAll && !more;
      return {
        items: page.map((row) => toDto(row, ready.party)),
        total: totalExact
          ? page.length
          : Math.max(candidates - hidden, page.length),
        totalExact: ready.party === "COMPANY" || totalExact,
        scope: relationshipPipelineScopeBinding(query, actorScope),
        nextCursor:
          !more || lastShown === undefined
            ? null
            : Buffer.from(
                JSON.stringify({
                  binding,
                  id: lastShown.relationshipId,
                  key: lastShown.sortKey,
                }),
              ).toString("base64url"),
      };
    },

    async all({ actor, companyId, query }) {
      const ready = await prepare(actor, companyId);
      if (ready === null) return null;
      const filter = filterOf(ready.party, ready.partyId, query);
      if (
        (await states.count(dependencies.sql, filter)) > PIPELINE_EXPORT_LIMIT
      )
        throw new RelationshipPipelineLimitError();
      const out: RelationshipSummaryDto[] = [];
      let seek: { key: string; id: string } | null = null;
      for (;;) {
        const batch = await states.page(
          dependencies.sql,
          filter,
          query.sort ?? "recent",
          seek,
          500,
        );
        const visible = await shown(actor, ready.party, batch);
        out.push(...visible.map((row) => toDto(row, ready.party)));
        const last = batch.at(-1);
        if (batch.length < 500 || last === undefined) return out;
        seek = { key: last.sortKey, id: last.relationshipId };
      }
    },
  };
}
