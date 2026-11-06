import {
  ANALYTICS_SETTINGS_DEFAULTS,
  AnalyticsSettingsSchema,
  type AnalyticsSettings,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * The one resolver for the admin analytics settings in application code. It
 * reads `analytics.settings()`, the same function every projection uses, so
 * SQL enforcement and application behaviour (notifications, Q) cannot
 * disagree. Cached briefly. If the settings cannot be read the answer is
 * the specification defaults: a failure never turns on anything beyond §6.7.
 */

export type AnalyticsSettingsReader = {
  readonly read: () => Promise<AnalyticsSettings>;
};

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
};

export function settingsFromRow(row: Row): AnalyticsSettings {
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
  });
}

export function createAnalyticsSettingsReader(
  sql: DatabaseExecutor,
  options: { readonly ttlMs?: number; readonly now?: () => number } = {},
): AnalyticsSettingsReader {
  const ttl = options.ttlMs ?? 5_000;
  const now = options.now ?? Date.now;
  let cached: { value: AnalyticsSettings; at: number } | null = null;
  return {
    read: async () => {
      if (cached !== null && now() - cached.at < ttl) return cached.value;
      let value: AnalyticsSettings;
      try {
        const [row] = await sql<Row[]>`select * from analytics.settings()`;
        value =
          row === undefined
            ? ANALYTICS_SETTINGS_DEFAULTS
            : settingsFromRow(row);
      } catch {
        value = ANALYTICS_SETTINGS_DEFAULTS;
      }
      cached = { value, at: now() };
      return value;
    },
  };
}
