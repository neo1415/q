import {
  discoverCompanies,
  passCompany,
  saveCompany,
  unsaveCompany,
  type ApiSession,
} from "@capital-q/api-client";

import type { FeedTransport } from "./feed-transport";

/**
 * The real wire behind the feed controller (CQ-WEB-021).
 *
 * The controller names two operations and knows nothing else; this is the
 * one place that turns them into the discovery endpoints. Keeping the
 * adapter here rather than inside the hook is what let the reducer and the
 * hook be tested against a double, and it is what will let a surface swap
 * in a server action later without the feed noticing.
 *
 * `surface` is fixed to `RECOMMENDATION_FEED` because that is what this
 * adapter is: a decision taken anywhere else — a profile, the saved list —
 * is a different surface and belongs to whichever adapter serves it. It is
 * reported so the server can attribute the interaction, never so the
 * client can claim a context it is not in.
 */
export function apiFeedTransport(session: ApiSession): FeedTransport {
  return {
    loadSlate: ({ cursor }) =>
      discoverCompanies(session, cursor === undefined ? {} : { cursor }),

    decide: ({ companyId, intent, slateId, clientEventId }) => {
      // `slateId` is optional on the wire and omitted rather than sent as
      // null: the request schema is strict, and "I was not in a slate" is
      // a different statement from "I was in slate null".
      const body = {
        clientEventId,
        surface: "RECOMMENDATION_FEED",
        ...(slateId === null ? {} : { slateId }),
      } as const;

      switch (intent) {
        case "SAVE":
          return saveCompany(session, companyId, body);
        case "UNSAVE":
          return unsaveCompany(session, companyId, body);
        case "PASS":
          // No reason is sent. Doc 17 §67: pass is fast, and a mandatory
          // feedback modal after every pass is explicitly not wanted.
          return passCompany(session, companyId, body);
      }
    },
  };
}
