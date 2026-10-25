import "server-only";

import { z } from "zod";

import {
  discoverCompanies,
  getQWorkSince,
  listInvestorRelationships,
} from "@capital-q/api-client";
import { fitScoreOutOf10, type FitProfileDto } from "@capital-q/contracts";

import { accountDetails } from "@/auth/account-details";
import { chatThreadAction } from "@/features/chat/chat-actions";
import {
  pendingQApprovalsAction,
  readQApprovalAction,
} from "@/features/q/actions";
import { fitProfilesAction } from "@/features/fit/fit-actions";
import { ownDeckReview } from "@/features/company/material/deck-pending-server";
import { ownReadiness } from "@/features/readiness/readiness-data";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";
import { listNoticesAction } from "@/features/work/work-actions";
import { listDoneAction } from "@/features/work/work-page-actions";
import { loadWorkforceAction } from "@/features/work/workforce-actions";

import type { ArrivalData } from "./arrival";
import { readArrival } from "./arrival-read";
import {
  createQApiArrivalSnapshotReader,
  createQApiAttentionReader,
} from "./attention";
import {
  ARRIVAL_MATCHES_MAX,
  matchOpinion,
  newMatchesFor,
  type ArrivalMatches,
} from "./matches";

/**
 * The arrival briefing's read on the server, under the person's own
 * session: the route the browser asks (`/api/q-arrival`) and the server
 * action both come here. Input from the browser is validated here.
 */

const SinceInput = z.string().datetime({ offset: true }).nullable();
const BrowserInput = z
  .object({
    /** Held drafts this browser dismissed on Work (audit D-E6). */
    dismissedHeld: z.array(z.string().max(80)).max(200).optional(),
    /** Companies earlier arrivals showed here; null: none remembered. */
    seenMatches: z.array(z.string().uuid()).max(200).nullable().optional(),
  })
  .strict()
  .optional();
export type ArrivalBrowserInput = z.input<typeof BrowserInput>;

/** The canonical fit out of 10 Q and Discover order by; null when none. */
function scoreOf(profile: FitProfileDto | null): number | null {
  const shown = profile === null ? null : fitScoreOutOf10(profile);
  return shown === null ? null : Number(shown);
}

/** How far into the slate the arrival looks for new matches. */
const SLATE_LOOK = 20;
/** Q.01: the questions put beside Q at once. */
const QUESTIONS_MAX = 5;

/**
 * Investors: the new companies in their own slate that fit their mandate,
 * each with Q's take from its fit profile (one batched read). Null when
 * the slate could not be read; an empty list when nothing is new.
 */
async function readMatches(
  seen: ReadonlySet<string> | null,
): Promise<ArrivalMatches | null> {
  const session = await apiSession();
  if (session === null) return null;
  const [slate, relationships] = await Promise.all([
    discoverCompanies(session, { limit: SLATE_LOOK }).catch(() => null),
    listInvestorRelationships(session).catch(() => null),
  ]);
  if (slate === null) return null;
  const touched = new Set(
    (relationships?.items ?? []).map((item) => item.counterpart.id),
  );
  // Without the relationships read, "not acted on" cannot be claimed.
  if (relationships === null) return null;
  const fresh = newMatchesFor({ items: slate.items, touched, seen });
  const shown = fresh.slice(0, ARRIVAL_MATCHES_MAX);
  const fits =
    shown.length === 0
      ? null
      : await fitProfilesAction(shown.map((item) => item.companyId));
  const profiles = new Map(
    (fits ?? []).map((fit) => [fit.companyId, fit.profile] as const),
  );
  return {
    label: seen === null ? "NOT_LOOKED_AT" : "SINCE_LAST_VISIT",
    total: fresh.length,
    items: shown.map((item) => {
      const profile = profiles.get(item.companyId) ?? null;
      return {
        companyId: item.companyId,
        name: item.canonicalName,
        line: item.shortDescription,
        stage: item.currentStageCode,
        country: item.headquartersCountry,
        band: profile?.band ?? null,
        score: scoreOf(profile),
        take: matchOpinion({ profile, reasons: item.reasons }),
      };
    }),
  };
}

/**
 * Everything the briefing needs (arrival-read.ts puts it together), under
 * the person's own session. A read that fails is absent (null activity,
 * fewer cards) and, for what needs them, named as unread; never an error
 * that stops Q.
 */
export async function readArrivalBriefing(
  /** Browser input, validated here: an ISO time or null. */
  rawSince: unknown,
  /** Browser input, validated here (`ArrivalBrowserInput`). */
  rawBrowser?: unknown,
): Promise<ArrivalData | null> {
  const parsed = SinceInput.safeParse(rawSince);
  const browser = BrowserInput.safeParse(rawBrowser);
  if (!parsed.success || !browser.success) return null;
  const session = await qApiSession();
  if (session === null) return null;
  const now = Date.now();
  const since = parsed.data ?? new Date(now - 24 * 3_600_000).toISOString();
  const timings: Record<string, number> = {};
  // One readiness read serves Q's questions and its first answer.
  let readiness: ReturnType<typeof ownReadiness> | null = null;
  const readinessOnce = () => (readiness ??= ownReadiness());
  const data = await readArrival(
    {
      account: () => accountDetails(),
      workSince: (from) => getQWorkSince(session, from),
      approvals: async () => {
        const result = await pendingQApprovalsAction();
        return result.ok ? result.value : null;
      },
      approval: async (approvalId) => {
        const result = await readQApprovalAction(approvalId);
        return result.ok ? result.value : null;
      },
      workforce: () => loadWorkforceAction(),
      done: async () => {
        const result = await listDoneAction();
        return result.ok ? result.value.items : null;
      },
      notices: async () => {
        const result = await listNoticesAction();
        return result.ok ? result.value.items : null;
      },
      context: () => resolveOwnContext(),
      matches: (seen) => readMatches(seen),
      questions: async () => {
        const readiness = await readinessOnce();
        return readiness === null
          ? null
          : readiness.followUps
              .filter((item) => item.answerable)
              .slice(0, QUESTIONS_MAX);
      },
      deckReview: () => ownDeckReview(),
      // Q's first answer after onboarding reads the same readiness.
      readiness: () => readinessOnce(),
      thread: async (relationshipId) => {
        const result = await chatThreadAction(relationshipId);
        return result.ok ? result.value : null;
      },
      // W1: the one snapshot the welcome, Q's turns and the live voice share.
      snapshot: () => createQApiArrivalSnapshotReader(session)(),
      // RECOVERY B1: the Q API's attention report (every source).
      attention: (from) => createQApiAttentionReader(session)(from),
    },
    {
      now,
      since,
      hoursAway:
        parsed.data === null
          ? null
          : Math.max(0, (now - Date.parse(parsed.data)) / 3_600_000),
      seenMatches: browser.data?.seenMatches,
      dismissedHeld: browser.data?.dismissedHeld ?? [],
      timings,
    },
  );
  // Speed lane 2026-10-20: when each read settled, for the server log (read
  // names and milliseconds only, no content and no ids).
  console.info("[arrival] read timed", {
    totalMs: Date.now() - now,
    cards: data.cards.length,
    ...timings,
  });
  return data;
}
