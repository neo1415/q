import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";

import {
  authorize,
  freshAuthenticationOf,
  liveStepUp,
  recordAdminAction,
  recordStepUp,
  roleOf,
  type AdminGrant,
} from "./access.js";
import {
  accountDetail,
  isSuspended,
  organisationDetail,
  searchAccounts,
  searchOrganisations,
  setSuspension,
  suspendOrganisationMembers,
} from "./accounts.js";
import { searchAudit } from "./audit-search.js";
import {
  decideBreakGlass,
  listBreakGlass,
  readChatUnderBreakGlass,
  requestBreakGlass,
} from "./break-glass.js";
import {
  createEmailPanel,
  type EmailSenderConfig,
  type DnsTxtResolver,
} from "./email.js";
import { createFlagReader, listFlags, setFlag } from "./flags.js";
import { qErrors, qMonitor, qRunTrace } from "./q-monitor.js";
import { reviewReport, safetyQueue } from "./safety.js";
import { listTeam, revokeTeamRole, setTeamRole } from "./team.js";
import {
  claimTenant,
  kybDocument,
  verificationQueue,
} from "./verification-queue.js";
import {
  decideReview,
  ownReviews,
  requestReview,
  reviewQueue,
} from "./reviews.js";
import type { AdminPermission } from "./permissions.js";

/**
 * Capital Q's own operations (founder direction 2026-09-29/30).
 *
 * The attribution ledger is the evidence Capital Q's facilitation fee rests
 * on: for every relationship, how it began on Capital Q (the first event's
 * source -- Discover, GateQ, search, a recommendation), when both sides
 * connected, the calls held (and recordings declined) through Capital Q,
 * money Q heard, and money both sides confirmed. Every figure comes from
 * the append-only records the owning contexts keep; nothing here writes.
 *
 * Access (ADR 0033): every operation takes an `AdminGrant`, which only
 * `authorize` hands out -- role from `identity.platform_admins`, permission
 * from the versioned table in ./permissions.ts, step-up from
 * `platform_ops.step_ups`.
 */

export type AdminOverview = {
  readonly people: number;
  readonly companies: number;
  readonly investorOrganisations: number;
  readonly relationships: number;
  readonly connected: number;
  readonly meetingsHeld: number;
  readonly recordingsDeclined: number;
  readonly confirmed: readonly { currencyCode: string; amount: string }[];
  readonly applications: number;
  readonly modelSpendUsd30d: string;
};

export type AttributionRow = {
  readonly relationshipId: string;
  readonly companyName: string;
  readonly investorName: string;
  /** How the relationship began on Capital Q. */
  readonly origin: string;
  readonly startedAt: string;
  readonly connectedAt: string | null;
  readonly meetingsHeld: number;
  readonly recordingsDeclined: number;
  readonly detected: number;
  readonly disputed: number;
  readonly confirmed: readonly { currencyCode: string; amount: string }[];
  readonly lastActivityAt: string;
};

export type DisputeRow = {
  readonly commitmentId: string;
  readonly relationshipId: string;
  readonly companyName: string;
  readonly investorName: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly quote: string | null;
  readonly disputedAt: string;
};

type Money = { currency_code: string; amount: string };

function iso(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

function createLedger(sql: DatabaseExecutor) {
  return {
    overview: async (_grant: AdminGrant): Promise<AdminOverview> => {
      const [counts] = await sql<
        {
          people: number;
          companies: number;
          investors: number;
          relationships: number;
          connected: number;
          held: number;
          declined: number;
          applications: number;
          spend: string;
        }[]
      >`
        select
          (select count(*)::int from identity.user_profiles) as people,
          (select count(*)::int from core.companies) as companies,
          (select count(*)::int from core.investor_organisations) as investors,
          (select count(*)::int from network.relationships) as relationships,
          -- Every match, wherever it went after connecting (relationship-state.v2).
          (select count(*)::int from network.relationships
            where current_state in ('CONNECTED', 'MEETING_HELD', 'IN_DILIGENCE',
                                    'PAUSED', 'PASSED', 'INVESTED')) as connected,
          (select count(*)::int from network.relationship_events
            where event_type = 'meeting_held') as held,
          (select count(*)::int from network.relationship_events
            where event_type = 'meeting_recording_declined') as declined,
          (select count(*)::int from gateq.application_submissions) as applications,
          (select coalesce(sum(cost_usd), 0)::text from ai_ops.model_usage
            where occurred_at > now() - interval '30 days') as spend`;
      const confirmed = await sql<Money[]>`
        select currency_code, sum(amount)::text as amount
          from network.commitments
         where status = 'CONFIRMED' and level in ('FIRM', 'INVESTED')
         group by currency_code order by currency_code`;
      return {
        people: counts?.people ?? 0,
        companies: counts?.companies ?? 0,
        investorOrganisations: counts?.investors ?? 0,
        relationships: counts?.relationships ?? 0,
        connected: counts?.connected ?? 0,
        meetingsHeld: counts?.held ?? 0,
        recordingsDeclined: counts?.declined ?? 0,
        confirmed: confirmed.map((row) => ({
          currencyCode: row.currency_code,
          amount: row.amount,
        })),
        applications: counts?.applications ?? 0,
        modelSpendUsd30d: counts?.spend ?? "0",
      };
    },

    attribution: async (
      _grant: AdminGrant,
      limit = 200,
    ): Promise<readonly AttributionRow[]> => {
      const rows = await sql<
        {
          relationship_id: string;
          company_name: string;
          investor_name: string;
          origin: string | null;
          started_at: Date;
          connected_at: Date | null;
          held: number;
          declined: number;
          detected: number;
          disputed: number;
          confirmed: Money[] | null;
          last_at: Date;
        }[]
      >`
        select r.id as relationship_id, c.canonical_name as company_name,
               io.display_name as investor_name,
               (select e.source_type from network.relationship_events e
                 where e.relationship_id = r.id order by e.sequence limit 1) as origin,
               r.first_discovered_at as started_at,
               (select min(e.occurred_at) from network.relationship_events e
                 where e.relationship_id = r.id
                   and e.event_type = 'connection_accepted') as connected_at,
               (select count(*)::int from network.relationship_events e
                 where e.relationship_id = r.id and e.event_type = 'meeting_held') as held,
               (select count(*)::int from network.relationship_events e
                 where e.relationship_id = r.id
                   and e.event_type = 'meeting_recording_declined') as declined,
               (select count(*)::int from network.commitments m
                 where m.relationship_id = r.id and m.source = 'Q_MEETING') as detected,
               (select count(*)::int from network.commitments m
                 where m.relationship_id = r.id and m.status = 'DISPUTED') as disputed,
               (select json_agg(json_build_object('currency_code', t.currency_code,
                                                  'amount', t.amount))
                  from (select m.currency_code, sum(m.amount)::text as amount
                          from network.commitments m
                         where m.relationship_id = r.id and m.status = 'CONFIRMED'
                           and m.level in ('FIRM', 'INVESTED')
                         group by m.currency_code) t) as confirmed,
               coalesce((select max(e.occurred_at) from network.relationship_events e
                          where e.relationship_id = r.id), r.first_discovered_at) as last_at
          from network.relationships r
          join core.companies c on c.id = r.company_id
          join core.investor_organisations io on io.id = r.investor_organisation_id
         order by last_at desc
         limit ${Math.min(limit, 500)}`;
      return rows.map((row) => ({
        relationshipId: row.relationship_id,
        companyName: row.company_name,
        investorName: row.investor_name,
        origin: row.origin ?? "UNKNOWN",
        startedAt: iso(row.started_at),
        connectedAt: row.connected_at === null ? null : iso(row.connected_at),
        meetingsHeld: row.held,
        recordingsDeclined: row.declined,
        detected: row.detected,
        disputed: row.disputed,
        confirmed: (row.confirmed ?? []).map((money) => ({
          currencyCode: money.currency_code,
          amount: money.amount,
        })),
        lastActivityAt: iso(row.last_at),
      }));
    },

    disputes: async (_grant: AdminGrant): Promise<readonly DisputeRow[]> => {
      const rows = await sql<
        {
          id: string;
          relationship_id: string;
          company_name: string;
          investor_name: string;
          amount: string;
          currency_code: string;
          quote: string | null;
          disputed_at: Date;
        }[]
      >`
        select m.id, m.relationship_id, c.canonical_name as company_name,
               io.display_name as investor_name, m.amount::text as amount,
               m.currency_code, m.quote, m.disputed_at
          from network.commitments m
          join network.relationships r on r.id = m.relationship_id
          join core.companies c on c.id = r.company_id
          join core.investor_organisations io on io.id = r.investor_organisation_id
         where m.status = 'DISPUTED'
         order by m.disputed_at desc
         limit 100`;
      return rows.map((row) => ({
        commitmentId: row.id,
        relationshipId: row.relationship_id,
        companyName: row.company_name,
        investorName: row.investor_name,
        amount: row.amount,
        currencyCode: row.currency_code,
        quote: row.quote,
        disputedAt: iso(row.disputed_at),
      }));
    },

    /**
     * Accounts Q paused (founder direction 2026-09-30), newest first, for
     * an operator to look at and reinstate.
     */
    paused: async (_grant: AdminGrant): Promise<readonly PausedRow[]> => {
      const rows = await sql<
        {
          user_id: string;
          display_name: string | null;
          email: string | null;
          strikes: number;
          suspended_at: Date;
          suspended_reason: string | null;
        }[]
      >`
        select s.user_id, p.display_name, u.email::text as email, s.strikes,
               s.suspended_at, s.suspended_reason
          from q_runtime.person_standing s
          join identity.user_profiles p on p.id = s.user_id
          left join auth.users u on u.id = p.auth_user_id
         where s.suspended_at is not null
         order by s.suspended_at desc
         limit 100`;
      return rows.map((row) => ({
        userId: row.user_id,
        name: row.display_name,
        email: row.email,
        strikes: row.strikes,
        pausedAt: iso(row.suspended_at),
        reason: row.suspended_reason,
      }));
    },

    /**
     * An operator reinstates a paused account: the pause is lifted, the
     * strikes start again from zero, and who reinstated it is kept.
     * False when not paused. Audited.
     */
    reinstate: async (
      grant: AdminGrant,
      pausedUserId: string,
    ): Promise<boolean> => {
      const rows = await sql<{ user_id: string }[]>`
        update q_runtime.person_standing
           set suspended_at = null, suspended_reason = null, strikes = 0,
               rounds = 0, streak = 0, q_started = false,
               reinstated_at = clock_timestamp(), reinstated_by = ${grant.userId},
               updated_at = clock_timestamp()
         where user_id = ${pausedUserId} and suspended_at is not null
        returning user_id`;
      if (rows.length > 0) {
        await recordAdminAction(sql, grant, {
          actionType: "account.q_pause.lifted",
          resourceType: "user_profile",
          resourceId: pausedUserId,
        });
      }
      return rows.length > 0;
    },
  };
}

export type PausedRow = {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly strikes: number;
  readonly pausedAt: string;
  readonly reason: string | null;
};

export function createPlatformAdmin(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly email?: EmailSenderConfig | undefined;
  readonly dns?: DnsTxtResolver | undefined;
}) {
  const { sql, transactions } = options;
  const ledger = createLedger(sql);
  const emailPanel = createEmailPanel({
    sql,
    config: options.email ?? { sender: null, provider: "NONE" },
    resolver: options.dns,
  });
  const flags = createFlagReader(sql);
  return {
    authorize: (userId: string, permission: AdminPermission) =>
      authorize(sql, userId, permission),
    roleOf: (userId: string) => roleOf(sql, userId),
    liveStepUp: (userId: string) => liveStepUp(sql, userId),
    recordStepUp: (input: Parameters<typeof recordStepUp>[1]) =>
      recordStepUp(sql, input),
    freshAuthenticationOf,
    isSuspended: (userId: string) => isSuspended(sql, userId),
    isFlagEnabled: flags.isEnabled,
    ...ledger,
    searchAccounts: (grant: AdminGrant, term: string) =>
      searchAccounts(sql, grant, term),
    accountDetail: (grant: AdminGrant, userId: string) =>
      accountDetail(sql, grant, userId),
    setSuspension: (
      grant: AdminGrant,
      input: Parameters<typeof setSuspension>[2],
    ) => setSuspension(transactions, grant, input),
    searchOrganisations: (grant: AdminGrant, term: string) =>
      searchOrganisations(sql, grant, term),
    organisationDetail: (grant: AdminGrant, organisationId: string) =>
      organisationDetail(sql, grant, organisationId),
    suspendOrganisationMembers: (
      grant: AdminGrant,
      input: Parameters<typeof suspendOrganisationMembers>[3],
    ) => suspendOrganisationMembers(sql, transactions, grant, input),
    verificationQueue: (grant: AdminGrant) => verificationQueue(sql, grant),
    claimTenant: (claimId: string) => claimTenant(sql, claimId),
    // ADMIN-3 block
    kybDocument: (grant: AdminGrant, submissionId: string) =>
      kybDocument(sql, grant, submissionId),
    requestReview: (
      requester: Parameters<typeof requestReview>[1],
      input: Parameters<typeof requestReview>[2],
    ) => requestReview(transactions, requester, input),
    ownReviews: (userId: string) => ownReviews(sql, userId),
    reviewQueue: (grant: AdminGrant, includeDecided: boolean) =>
      reviewQueue(sql, grant, { includeDecided }),
    decideReview: (
      grant: AdminGrant,
      input: Parameters<typeof decideReview>[2],
    ) => decideReview(transactions, grant, input),
    // end ADMIN-3 block
    recordAction: (
      grant: AdminGrant,
      action: Parameters<typeof recordAdminAction>[2],
    ) => recordAdminAction(sql, grant, action),
    safetyQueue: (grant: AdminGrant, includeReviewed: boolean) =>
      safetyQueue(sql, grant, { includeReviewed }),
    reviewReport: (
      grant: AdminGrant,
      input: Parameters<typeof reviewReport>[2],
    ) => reviewReport(transactions, grant, input),
    listBreakGlass: (grant: AdminGrant) => listBreakGlass(sql, grant),
    requestBreakGlass: (
      grant: AdminGrant,
      input: Parameters<typeof requestBreakGlass>[2],
    ) => requestBreakGlass(transactions, grant, input),
    decideBreakGlass: (
      grant: AdminGrant,
      input: Parameters<typeof decideBreakGlass>[2],
    ) => decideBreakGlass(transactions, grant, input),
    readChatUnderBreakGlass: (grant: AdminGrant, requestId: string) =>
      readChatUnderBreakGlass(transactions, grant, requestId),
    qMonitor: (grant: AdminGrant, window: Parameters<typeof qMonitor>[2]) =>
      qMonitor(sql, grant, window),
    qErrors: (grant: AdminGrant) => qErrors(sql, grant),
    qRunTrace: (grant: AdminGrant, runId: string) =>
      qRunTrace(transactions, grant, runId),
    searchAudit: (
      grant: AdminGrant,
      query: Parameters<typeof searchAudit>[2],
    ) => searchAudit(sql, grant, query),
    listFlags: (grant: AdminGrant) => listFlags(sql, grant),
    setFlag: (grant: AdminGrant, input: Parameters<typeof setFlag>[2]) =>
      setFlag(transactions, grant, input),
    emailPanel,
    listTeam: (grant: AdminGrant) => listTeam(sql, grant),
    setTeamRole: (
      grant: AdminGrant,
      input: Parameters<typeof setTeamRole>[2],
    ) => setTeamRole(transactions, grant, input),
    revokeTeamRole: (
      grant: AdminGrant,
      input: Parameters<typeof revokeTeamRole>[2],
    ) => revokeTeamRole(transactions, grant, input),
  };
}

export type PlatformAdmin = ReturnType<typeof createPlatformAdmin>;

export * from "./permissions.js";
export {
  freshAuthenticationOf,
  type AdminAccess,
  type AdminActionRecord,
  type AdminGrant,
  type StepUpMethod,
  type StepUpOutcome,
} from "./access.js";
export { isSuspended } from "./accounts.js";
export type {
  AccountDetail,
  AccountRow,
  OrganisationDetail,
  OrganisationRow,
  SuspensionOutcome,
} from "./accounts.js";
export {
  decodeAuditCursor,
  encodeAuditCursor,
  type AuditQuery,
  type AuditRow,
} from "./audit-search.js";
export type {
  BreakGlassChat,
  BreakGlassDecision,
  BreakGlassRow,
  BreakGlassTarget,
} from "./break-glass.js";
export {
  checkSenderDomain,
  recordingEmailSender,
  senderAddressOf,
  type DnsCheck,
  type DnsTxtResolver,
  type EmailPanel,
  type EmailSenderConfig,
} from "./email.js";
export {
  createFlagReader,
  isKillSwitch,
  KILL_SWITCHES,
  type FlagRow,
  type KillSwitch,
} from "./flags.js";
export { firewallDecisionRow, recordingFirewall } from "./firewall-recorder.js";
export {
  isMonitorWindow,
  MONITOR_WINDOWS,
  type MonitorWindow,
  type QErrorItem,
  type QMonitor,
  type QRunTrace,
} from "./q-monitor.js";
export {
  REVIEW_OUTCOMES,
  type BlockRow,
  type ReviewOutcome,
  type ReviewResult,
  type SafetyReportRow,
} from "./safety.js";
export type { TeamChange, TeamMember } from "./team.js";
export type { VerificationQueueRow } from "./verification-queue.js";
// ADMIN-3 block
export {
  MAX_OPEN_REVIEWS,
  REVIEW_DECISIONS,
  REVIEW_SLA_HOURS,
  REVIEW_SUBJECTS,
  type DecideReviewOutcome,
  type OwnReview,
  type RequestReviewOutcome,
  type ReviewDecision,
  type ReviewQueueRow,
  type ReviewRequester,
  type ReviewSubject,
} from "./reviews.js";
// end ADMIN-3 block

// P5 block: brand theming
export {
  createBrandThemeStore,
  isBrandReset,
  type BrandTheme,
  type BrandThemeChange,
  type BrandThemeStore,
} from "./brand-theme.js";
// end P5 block

export const PACKAGE_NAME = "@capital-q/platform-admin" as const;
// ETIQUETTE block (ADR 0050): the platform's business etiquette guide.
export {
  activePlatformEtiquetteGuide,
  createEtiquetteGuideAdminStore,
  type ActivePlatformEtiquetteGuide,
  type EtiquetteGuideAdminStore,
  type NewPlatformEtiquetteVersion,
  type PlatformEtiquetteVersion,
  type PlatformEtiquetteView,
} from "./etiquette-guide.js";
