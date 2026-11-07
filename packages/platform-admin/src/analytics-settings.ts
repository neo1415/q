import {
  AnalyticsSettingsSchema,
  type AnalyticsSettings,
  type AnalyticsSettingsDto,
} from "@capital-q/contracts";
import {
  jsonbParam,
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";

import { recordAdminAction, type AdminGrant } from "./access.js";

/**
 * Analytics privacy settings (owner, 6 Nov 2026; Q Workspace §8). One typed
 * row in `analytics.platform_settings`; the projection reads the same row
 * through `analytics.settings()`, so changing it here changes what founders
 * see with no deploy. Every change names who and why, keeps a before/after
 * record, and is an audited admin action. The database re-checks every
 * constraint the schema does (stricter is always allowed; the Anonymous
 * override needs paid reveal).
 */

type Row = {
  default_visibility: string;
  allowed_visibilities: string[];
  named_passive_viewers: boolean;
  paid_identity_reveal: boolean;
  paid_reveal_overrides_anonymous: boolean;
  per_person_passive_analytics: boolean;
  passive_view_notifications: boolean;
  intent_signal_notifications: boolean;
  q_uses_passive_signals: boolean;
  headline_floor: number;
  slice_floor: number;
  passive_batch: string;
  version: number;
  updated_by_name: string | null;
  reason: string | null;
  updated_at: Date;
};

function toSettings(row: Row): AnalyticsSettings {
  return AnalyticsSettingsSchema.parse({
    defaultVisibility: row.default_visibility,
    allowedVisibilities: row.allowed_visibilities,
    namedPassiveViewers: row.named_passive_viewers,
    paidIdentityReveal: row.paid_identity_reveal,
    paidRevealOverridesAnonymous: row.paid_reveal_overrides_anonymous,
    perPersonPassiveAnalytics: row.per_person_passive_analytics,
    passiveViewNotifications: row.passive_view_notifications,
    intentSignalNotifications: row.intent_signal_notifications,
    qUsesPassiveSignals: row.q_uses_passive_signals,
    headlineFloor: row.headline_floor,
    sliceFloor: row.slice_floor,
    passiveBatch: row.passive_batch,
  });
}

/** The keys whose values differ, in a stable order. */
export function changedKeys(
  before: AnalyticsSettings,
  after: AnalyticsSettings,
): (keyof AnalyticsSettings)[] {
  return (Object.keys(after) as (keyof AnalyticsSettings)[]).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

export async function readAnalyticsSettings(
  sql: DatabaseExecutor,
  _grant: AdminGrant,
): Promise<AnalyticsSettingsDto> {
  const [row] = await sql<Row[]>`
    select s.*, p.display_name as updated_by_name
      from analytics.platform_settings s
      left join identity.user_profiles p on p.id = s.updated_by
     where s.singleton`;
  if (row === undefined) throw new Error("analytics: settings row missing");
  const history = await sql<
    {
      actor: string | null;
      reason: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      occurred_at: Date;
    }[]
  >`
    select p.display_name as actor, c.reason, c.before, c.after, c.occurred_at
      from analytics.platform_setting_changes c
      left join identity.user_profiles p on p.id = c.actor_user_id
     order by c.occurred_at desc
     limit 20`;
  return {
    settings: toSettings(row),
    version: row.version,
    updatedByName: row.updated_by_name,
    reason: row.reason,
    updatedAt: new Date(row.updated_at).toISOString(),
    history: history.map((change) => ({
      actorName: change.actor,
      reason: change.reason,
      changed: Object.keys(change.after).filter(
        (key) =>
          JSON.stringify(change.before[key]) !==
          JSON.stringify(change.after[key]),
      ),
      at: new Date(change.occurred_at).toISOString(),
    })),
  };
}

export async function updateAnalyticsSettings(
  transactions: TransactionManager,
  grant: AdminGrant,
  input: {
    readonly settings: AnalyticsSettings;
    readonly expectedVersion: number;
    readonly reason: string;
    readonly acknowledgeInvestorTrustRisk?: true | undefined;
  },
): Promise<"CHANGED" | "UNCHANGED" | "STALE" | "NEEDS_ACKNOWLEDGEMENT"> {
  const next = AnalyticsSettingsSchema.parse(input.settings);
  return transactions.run(async (tx) => {
    const [row] = await tx.sql<Row[]>`
      select s.*, null::text as updated_by_name
        from analytics.platform_settings s
       where s.singleton
       for update`;
    if (row === undefined) throw new Error("analytics: settings row missing");
    if (row.version !== input.expectedVersion) return "STALE";
    const before = toSettings(row);
    const changed = changedKeys(before, next);
    if (changed.length === 0) return "UNCHANGED";
    // The Anonymous override is locked: turning it on breaks the promise
    // made to investors, so it needs the admin's explicit acknowledgement
    // on top of the step-up every write already needs.
    if (
      next.paidRevealOverridesAnonymous &&
      !before.paidRevealOverridesAnonymous &&
      input.acknowledgeInvestorTrustRisk !== true
    ) {
      return "NEEDS_ACKNOWLEDGEMENT";
    }
    await tx.sql`
      update analytics.platform_settings
         set default_visibility = ${next.defaultVisibility},
             allowed_visibilities = ${[...next.allowedVisibilities]}::text[],
             named_passive_viewers = ${next.namedPassiveViewers},
             paid_identity_reveal = ${next.paidIdentityReveal},
             paid_reveal_overrides_anonymous = ${next.paidRevealOverridesAnonymous},
             per_person_passive_analytics = ${next.perPersonPassiveAnalytics},
             passive_view_notifications = ${next.passiveViewNotifications},
             intent_signal_notifications = ${next.intentSignalNotifications},
             q_uses_passive_signals = ${next.qUsesPassiveSignals},
             headline_floor = ${next.headlineFloor},
             slice_floor = ${next.sliceFloor},
             passive_batch = ${next.passiveBatch},
             version = version + 1,
             updated_by = ${grant.userId},
             reason = ${input.reason},
             updated_at = clock_timestamp()
       where singleton`;
    await tx.sql`
      insert into analytics.platform_setting_changes (actor_user_id, reason, before, after)
      values (${grant.userId}, ${input.reason},
              ${jsonbParam(tx.sql, before)}, ${jsonbParam(tx.sql, next)})`;
    await recordAdminAction(tx.sql, grant, {
      actionType: "analytics_settings.changed",
      resourceType: "analytics_settings",
      resourceId: "platform",
      reason: input.reason,
      metadata: {
        changed,
        investorTrustRiskAcknowledged:
          input.acknowledgeInvestorTrustRisk === true,
      },
    });
    return "CHANGED";
  });
}
