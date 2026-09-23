import type {
  DiscoveryCompanySlateDto,
  InteractionRecordedDto,
} from "@capital-q/contracts";

import type { FeedDecisionIntent } from "./feed-state";

/**
 * What the controller needs from the outside world, and nothing else.
 *
 * The feed is provider-independent by construction: it names two
 * operations in terms of the discovery contract and never learns how they
 * are performed. That is what makes the reducer testable without a
 * network, and it is what lets the surface that composes the feed decide
 * whether these run as server actions or as direct calls -- a choice
 * CQ-WEB-021/022 make when they build the screen.
 *
 * Both return contract DTOs. Validation belongs to the adapter, at the
 * trust boundary where the bytes arrive; by the time a value reaches this
 * type it has already been parsed.
 */
export type FeedTransport = {
  /**
   * `GET /v1/discovery/companies`, cursor-paged.
   *
   * No offset, ever: the contract has `nextCursor` and nothing else, and
   * an offset into a slate that can be rebuilt mid-session would silently
   * skip or repeat companies.
   */
  loadSlate(input: {
    readonly cursor?: string;
    readonly signal: AbortSignal;
  }): Promise<DiscoveryCompanySlateDto>;

  /**
   * One of `POST /v1/discovery/companies/:companyId/{save,unsave,pass}`.
   *
   * Three paths, one port: the intent selects the path, so no request can
   * change its own meaning. `slateId` is passed because the server reads
   * the rank from it; the client never sends a rank, a ranking version or
   * an organisation id, because those are the server's answers.
   */
  decide(input: {
    readonly companyId: string;
    readonly intent: FeedDecisionIntent;
    readonly slateId: string | null;
    readonly clientEventId: string;
  }): Promise<InteractionRecordedDto>;
};
