import type { ActorContext } from "@capital-q/security";

import type { CompanyEngagementReader } from "./postgres-engagement-reader.js";
import type { MyEngagementReader } from "./postgres-my-engagement-reader.js";
import type { EngagementRepository } from "./postgres-engagement-repository.js";

/**
 * Q's read of engagement (Q Workspace §8 A5), as the read_my "engagement"
 * kind: the person's own viewing privacy, and, for a founder, their
 * company's engagement exactly as the founder page shows it. Every identity
 * is already decided by the projection (each viewer's level, the plan, the
 * floors, the weekly batch); this only words it. Nothing here suggests
 * contacting anyone: viewing is not contact permission (§6.7.14).
 */

export type EngagementReadItem = {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly at: string | null;
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
};

const LEVEL_WORDS = {
  FULL_IDENTITY: "their name and organisation",
  ORGANISATION_ONLY: "their organisation only",
  ANONYMOUS: "nothing identifying",
} as const;

const RULE =
  "Viewing is not interest and not permission to contact; never suggest contacting someone because they viewed. Intent (saves, interest, connection and data-room requests) comes first.";

const VIEWER_ITEMS_MAX = 20;

export async function ownEngagementItems(
  deps: {
    readonly reader: CompanyEngagementReader;
    readonly repository: Pick<EngagementRepository, "privacyFor">;
    /** The investor's own views and founders' answers (A4). */
    readonly mine?: MyEngagementReader | undefined;
    /**
     * The admin setting q_uses_passive_signals: off, Q reads intent only.
     * Absent: on (the specification default).
     */
    readonly usesPassiveSignals?: (() => Promise<boolean>) | undefined;
  },
  actor: ActorContext,
  companyId: string | null,
): Promise<readonly EngagementReadItem[]> {
  const items: EngagementReadItem[] = [];
  const privacy = await deps.repository.privacyFor(actor.userId);
  items.push({
    id: "viewing-privacy",
    title: "Your viewing visibility",
    status: `founders see ${LEVEL_WORDS[privacy.visibility]} when you view their company`,
    at: null,
    facts: {
      level: privacy.visibility,
      chosen: privacy.chosen,
      platformDefault: privacy.defaultVisibility,
      canChoose: privacy.allowedVisibilities.join(", "),
    },
  });
  if (companyId === null) {
    if (deps.mine === undefined) return items;
    const mine = await deps.mine.read({
      actorUserId: actor.userId,
      organisationId: actor.organisationId ?? null,
    });
    for (const response of mine.responses.slice(0, 10)) {
      items.push({
        id: `response-${response.companyId}-${response.kind}-${response.askedAt}`,
        title: `${response.companyName}: ${response.kind === "INTEREST" ? "connection request" : "data-room request"}`,
        status:
          response.state === "WAITING"
            ? "waiting for the founder"
            : response.state === "ACCEPTED"
              ? "accepted"
              : "declined",
        at: response.answeredAt ?? response.askedAt,
        facts: { kind: response.kind, state: response.state },
      });
    }
    for (const company of mine.viewed.slice(0, 15)) {
      items.push({
        id: `viewed-${company.companyId}`,
        title: company.companyName,
        status: `you viewed it ${String(company.views)} times`,
        at: company.lastViewedAt,
        facts: { views: company.views, deckMinutes: company.deckMinutes },
      });
    }
    return items.slice(0, 30);
  }

  const engagement = await deps.reader.read({
    actorUserId: actor.userId,
    companyId,
    since: null,
  });
  if (engagement === null) return items;

  // Intent first (§6.7.12): real time, every plan, no floor.
  for (const signal of engagement.intent.slice(0, 10)) {
    const who =
      signal.viewerName !== null && signal.organisationName !== null
        ? `${signal.viewerName} (${signal.organisationName})`
        : signal.organisationName !== null
          ? `Someone from ${signal.organisationName}`
          : "An investor";
    items.push({
      id: `intent-${signal.type}-${signal.occurredAt}`,
      title: who,
      status:
        signal.type === "SAVE"
          ? "saved your company"
          : signal.type === "INTEREST"
            ? "asked to connect"
            : "asked for data-room access",
      at: signal.occurredAt,
      facts: { signal: signal.type, shownAs: signal.visibility },
    });
  }
  const passive = (await deps.usesPassiveSignals?.()) ?? true;
  if (!passive) return items.slice(0, 30);

  const period = engagement.passiveBatch === "WEEKLY" ? "week" : "day";
  const latest = engagement.periods.at(-1);
  items.push({
    id: "engagement-summary",
    title: "Investor viewing of your company",
    status: engagement.floorMet
      ? `${String(latest?.organisations ?? 0)} investor organisations viewed in the latest completed ${period}`
      : `Fewer than ${String(engagement.floor)} investor organisations viewed; figures appear from ${String(engagement.floor)}`,
    at: latest?.periodStart ?? null,
    facts: {
      completedPeriodsOnly: true,
      perViewer: engagement.perViewer,
      planIncludesViewerIdentity: engagement.entitled,
      profileViews: latest?.profileViews ?? null,
      deckOpens: latest?.deckOpens ?? null,
      videoWatches: latest?.videoWatches ?? null,
      qCardViews: latest?.qCardViews ?? null,
      dataRoomDocumentViews: latest?.dataRoomDocumentViews ?? null,
      rule: RULE,
    },
  });

  for (const viewer of engagement.viewers.slice(0, VIEWER_ITEMS_MAX)) {
    const who =
      viewer.visibility === "FULL_IDENTITY"
        ? `${viewer.viewerName ?? "A named investor"}${viewer.organisationName === null ? "" : ` (${viewer.organisationName})`}`
        : viewer.visibility === "ORGANISATION_ONLY"
          ? `Someone from ${viewer.organisationName ?? "an investor organisation"}`
          : viewer.visibility === "ANONYMOUS"
            ? `Investors who chose to stay anonymous (${String(viewer.organisations)} organisations)`
            : `Investors (${String(viewer.organisations)} organisations, shown together on this plan)`;
    items.push({
      id: `viewer-${viewer.viewerUserId ?? viewer.viewerOrganisationId ?? viewer.visibility}`,
      title: who,
      status: `${String(viewer.events)} views`,
      at: viewer.lastPeriodStart,
      facts: {
        shownAs: viewer.visibility,
        revealedByPlanOverride: viewer.basis === "PAID_REVEAL",
        profileViews: viewer.profileViews,
        deckOpens: viewer.deckOpens,
        qCardViews: viewer.qCardViews,
        dataRoomDocumentViews: viewer.dataRoomDocumentViews,
        deckMinutes:
          viewer.deckDwellMs === null
            ? null
            : Math.round(viewer.deckDwellMs / 60_000),
      },
    });
  }
  for (const slice of engagement.slices) {
    items.push({
      id: `slice-${slice.dimension}-${slice.slice}`,
      title: `${slice.dimension === "INVESTOR_TYPE" ? "Investor type" : "Geography"}: ${slice.suppressed ? "others (too few to show)" : slice.slice}`,
      status: slice.suppressed
        ? `hidden below ${String(engagement.sliceFloor)} organisations`
        : `${String(slice.organisations ?? 0)} organisations`,
      at: null,
      facts: { dimension: slice.dimension, suppressed: slice.suppressed },
    });
  }
  return items.slice(0, 30);
}
