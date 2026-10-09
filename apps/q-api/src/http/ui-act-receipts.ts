import type { FastifyInstance } from "fastify";

import {
  parseContract,
  Q_UI_ACT_RECEIPTS_PATH,
  QUiActReceiptsRequestSchema,
  QUiActReceiptsResponseSchema,
  type QNavigationFailure,
  type QNavigationReceipt,
  type QPageManifest,
  type QUiActReport,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * RECOVERY-2026-10 (workstream C, docs/recovery/specs/C-app-control.md
 * §3.2): what came of Q's UI acts on the person's screen.
 *
 * Q's answer carries a UI act; the browser performs it after the answer
 * lands and reports one receipt per act here. The next turn reads them
 * (`recentUiActReceipts`), so Q says "that tab isn't on this page" rather
 * than "done" -- a success claim needs a DONE receipt.
 *
 * Screen state is ephemeral, like the Q room feed: kept in this process,
 * bounded per person and for minutes. Keyed by the tenant and user this
 * service resolved, never by anything the request names, so one person
 * can neither read nor write another's receipts.
 */

export const UI_ACT_RECEIPTS_PER_PERSON = 32;
export const UI_ACT_RECEIPT_TTL_MS = 10 * 60_000;

export type StoredUiActReport = QUiActReport & { readonly at: number };
export type StoredNavigation = QNavigationReceipt & { readonly at: number };

export type UiActReceiptLedger = {
  readonly record: (
    actor: Pick<ActorContext, "tenantId" | "userId">,
    reports: readonly QUiActReport[],
    manifest: QPageManifest | undefined,
    /** INC-1: Q's moves and whether the router settled on them. */
    navigations?: readonly QNavigationReceipt[],
  ) => number;
  /** The person's navigation receipts within the TTL, oldest first. */
  readonly recentNavigations: (
    actor: Pick<ActorContext, "tenantId" | "userId">,
  ) => readonly StoredNavigation[];
  /** The person's receipts within the TTL, oldest first. */
  readonly recent: (
    actor: Pick<ActorContext, "tenantId" | "userId">,
  ) => readonly StoredUiActReport[];
  /** The page as the browser last reported it with receipts, within the TTL. */
  readonly lastManifest: (
    actor: Pick<ActorContext, "tenantId" | "userId">,
  ) => QPageManifest | undefined;
};

export function createUiActReceiptLedger(
  options: { readonly now?: () => number; readonly maxPeople?: number } = {},
): UiActReceiptLedger {
  const now = options.now ?? Date.now;
  const maxPeople = options.maxPeople ?? 10_000;
  const people = new Map<
    string,
    {
      reports: StoredUiActReport[];
      navigations: StoredNavigation[];
      manifest: { readonly value: QPageManifest; readonly at: number } | null;
    }
  >();
  const keyOf = (actor: Pick<ActorContext, "tenantId" | "userId">) =>
    `${actor.tenantId}:${actor.userId}`;
  const fresh = (at: number) => now() - at <= UI_ACT_RECEIPT_TTL_MS;

  return {
    record: (actor, reports, manifest, navigations = []) => {
      const key = keyOf(actor);
      const held = people.get(key) ?? {
        reports: [],
        navigations: [],
        manifest: null,
      };
      const at = now();
      const known = new Set(held.reports.map((one) => one.receipt.actId));
      let accepted = 0;
      for (const report of reports) {
        // One receipt per act: a retried post never counts twice.
        if (known.has(report.receipt.actId)) continue;
        known.add(report.receipt.actId);
        held.reports.push({ ...report, at });
        accepted += 1;
      }
      held.reports = held.reports
        .filter((one) => fresh(one.at))
        .slice(-UI_ACT_RECEIPTS_PER_PERSON);
      const moves = new Set(
        held.navigations.flatMap((one) =>
          one.intentId === undefined ? [] : [one.intentId],
        ),
      );
      for (const navigation of navigations) {
        // R3: one receipt per move -- a retried post never counts twice.
        if (navigation.intentId !== undefined) {
          if (moves.has(navigation.intentId)) continue;
          moves.add(navigation.intentId);
        }
        held.navigations.push({ ...navigation, at });
        accepted += 1;
      }
      held.navigations = held.navigations
        .filter((one) => fresh(one.at))
        .slice(-UI_ACT_RECEIPTS_PER_PERSON);
      if (manifest !== undefined) held.manifest = { value: manifest, at };
      // Refreshed people go to the back; the stalest leave first.
      people.delete(key);
      people.set(key, held);
      while (people.size > maxPeople) {
        const oldest = people.keys().next().value;
        if (oldest === undefined) break;
        people.delete(oldest);
      }
      return accepted;
    },
    recentNavigations: (actor) =>
      (people.get(keyOf(actor))?.navigations ?? []).filter((one) =>
        fresh(one.at),
      ),
    recent: (actor) =>
      (people.get(keyOf(actor))?.reports ?? []).filter((one) => fresh(one.at)),
    lastManifest: (actor) => {
      const held = people.get(keyOf(actor))?.manifest ?? null;
      return held !== null && fresh(held.at) ? held.value : undefined;
    },
  };
}

/** `POST /v1/q/ui-act-receipts`: a normal protected request. */
export function registerUiActReceiptRoutes(
  app: FastifyInstance,
  dependencies: ActorContextDependencies & {
    readonly identity?: ApplicationIdentityLookup | undefined;
    readonly receipts: UiActReceiptLedger;
  },
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });

  app.post(
    Q_UI_ACT_RECEIPTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = parseContract(
        QUiActReceiptsRequestSchema,
        request.body ?? {},
        "Those receipts are not valid.",
      );
      const accepted = dependencies.receipts.record(
        getActorContext(request),
        body.reports,
        body.manifest,
        body.navigations ?? [],
      );
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(QUiActReceiptsResponseSchema.parse({ accepted }));
    },
  );
}

/**
 * The receipts as facts for the next turn (workstream B places them):
 * which act, on which control id, and what came of it. Code's words over
 * ids and closed values only -- no page text ever reaches them.
 */
export function receiptFacts(
  reports: readonly QUiActReport[],
  max = 6,
): readonly string[] {
  return reports.slice(-max).map(({ intent, receipt }) => {
    const on = intent.target === undefined ? "the page" : intent.target;
    const item = intent.index === undefined ? "" : ` #${String(intent.index)}`;
    const meaning =
      receipt.status === "DONE"
        ? "done on their screen"
        : receipt.status === "TARGET_MISSING"
          ? "NOT done: that control is not on their screen"
          : receipt.status === "NOT_APPLICABLE"
            ? "NOT done: that control cannot do that"
            : "NOT done: it failed on their screen";
    return `${intent.act} ${on}${item}: ${meaning} (${receipt.status}).`;
  });
}

/**
 * Q's recent moves as facts for the next turn: where it went and whether
 * the page actually opened. Routes are ids and fixed segments only.
 */
export function navigationFacts(
  navigations: readonly QNavigationReceipt[],
  max = 3,
): readonly string[] {
  return navigations
    .slice(-max)
    .map((navigation) =>
      navigation.status === "DONE"
        ? `Opened ${navigation.route} on their screen (DONE).`
        : navigation.reason === undefined
          ? `NOT done: ${navigation.expected ?? "the page"} never opened on their screen (FAILED).`
          : `NOT done: ${navigation.expected ?? "the page"} did not open on their screen (FAILED: ${NAVIGATION_FAILURE_MEANING[navigation.reason]}).`,
    );
}

/**
 * R3: what each closed failure reason means, for Q's next turn (code's
 * words; the browser's lifecycle chose the reason).
 */
const NAVIGATION_FAILURE_MEANING: Readonly<Record<QNavigationFailure, string>> =
  {
    NOT_FOUND: "that page does not exist or is not there for this record",
    UNAUTHORIZED: "that page is not available to their account",
    NO_ROUTER: "the screen could not move without ending the call",
    NOT_LANDED: "the page never finished opening",
    CONTROL_MISSING: "the page opened but the part asked for is not on it",
    SUPERSEDED: "a newer move replaced it",
  };

/** The person's recent receipts, for whoever composes the next turn. */
export function recentUiActReceipts(
  ledger: UiActReceiptLedger,
  actor: Pick<ActorContext, "tenantId" | "userId">,
): readonly QUiActReport[] {
  return ledger.recent(actor).map(({ intent, receipt }) => ({
    intent,
    receipt,
  }));
}
