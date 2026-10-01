import type { DatabaseExecutor } from "@capital-q/database";

import type { AppEmailPort } from "../schedule/service.js";
import type { PushSubscriptionKeys, WebPushSender } from "./web-push.js";

/**
 * Notice delivery beyond the app (AUTO, ADR 0030; spec auto.md §3.5).
 *
 * In-app notices always show. On top of that:
 * - Web Push: every notice is pushed once, to each of the person's devices,
 *   when they keep push on. A device whose push service says "gone" is
 *   revoked.
 * - Email: a "Needs you" notice still unread after ten minutes is emailed
 *   once, when they keep email on. Updates are never emailed (no noise).
 *
 * Delivery marks are columns on the notice (pushed_at, emailed_at), so a
 * restarted worker never sends a notice twice and never loses one.
 */

const PUSH_WINDOW_MS = 24 * 3_600_000;
const EMAIL_AFTER_MS = 10 * 60_000;
const EMAIL_WINDOW_MS = 48 * 3_600_000;
/** A device failing this often in a row is put to rest. */
const MAX_FAILURES = 20;

/** Who is acting: the person's own resolved context (ActorContext fits). */
type Owner = { readonly tenantId: string; readonly userId: string };

type DueNotice = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link_path: string | null;
  priority: "NEEDS_YOU" | "UPDATE";
  created_at: Date;
};

export type NotificationSettings = {
  readonly push: boolean;
  readonly email: boolean;
  /** Devices with push on (count only; endpoints never leave the server). */
  readonly devices: number;
};

export function createPushSubscriptionStore(sql: DatabaseExecutor) {
  return {
    subscribe: async (
      actor: Owner,
      subscription: PushSubscriptionKeys & {
        readonly userAgent: string | null;
      },
    ): Promise<void> => {
      // An endpoint belongs to one browser profile: whoever subscribes it
      // last owns it (a shared device switching accounts moves with them).
      await sql`
        insert into communication.push_subscriptions
          (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
        values (${actor.tenantId}, ${actor.userId}, ${subscription.endpoint},
                ${subscription.p256dh}, ${subscription.auth},
                ${subscription.userAgent?.slice(0, 300) ?? null})
        on conflict (endpoint) do update
          set tenant_id = excluded.tenant_id, user_id = excluded.user_id,
              p256dh = excluded.p256dh, auth = excluded.auth,
              user_agent = excluded.user_agent, failures = 0, revoked_at = null`;
    },
    unsubscribe: async (actor: Owner, endpoint: string): Promise<void> => {
      await sql`
        update communication.push_subscriptions
           set revoked_at = clock_timestamp()
         where endpoint = ${endpoint} and user_id = ${actor.userId}
           and revoked_at is null`;
    },
    settings: async (actor: Owner): Promise<NotificationSettings> => {
      const [settings, devices] = await Promise.all([
        sql<{ push: boolean; email: boolean }[]>`
          select push, email from communication.notification_settings
           where user_id = ${actor.userId}`,
        sql<{ count: number }[]>`
          select count(*)::int as count from communication.push_subscriptions
           where user_id = ${actor.userId} and revoked_at is null`,
      ]);
      return {
        push: settings[0]?.push ?? true,
        email: settings[0]?.email ?? true,
        devices: devices[0]?.count ?? 0,
      };
    },
    saveSettings: async (
      actor: Owner,
      settings: { readonly push: boolean; readonly email: boolean },
    ): Promise<void> => {
      await sql`
        insert into communication.notification_settings (user_id, tenant_id, push, email)
        values (${actor.userId}, ${actor.tenantId}, ${settings.push}, ${settings.email})
        on conflict (user_id) do update
          set push = excluded.push, email = excluded.email,
              updated_at = clock_timestamp()`;
    },
  };
}
export type PushSubscriptionStore = ReturnType<
  typeof createPushSubscriptionStore
>;

export function createNotificationDelivery(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly push: WebPushSender;
  readonly email: AppEmailPort;
  readonly emailOf: (userId: string) => Promise<string | null>;
  readonly appOrigin: string | null;
  readonly now?: () => Date;
  readonly logger?: {
    readonly warn: (
      fields: Readonly<Record<string, unknown>>,
      message: string,
    ) => void;
  };
}) {
  const { sql, push, email, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  const settingsOf = async (userId: string) => {
    const rows = await sql<{ push: boolean; email: boolean }[]>`
      select push, email from communication.notification_settings
       where user_id = ${userId}`;
    return { push: rows[0]?.push ?? true, email: rows[0]?.email ?? true };
  };

  const pushOne = async (notice: DueNotice): Promise<void> => {
    const settings = await settingsOf(notice.user_id);
    if (push.available && settings.push) {
      const devices = await sql<
        { id: string; endpoint: string; p256dh: string; auth: string }[]
      >`
        select id, endpoint, p256dh, auth from communication.push_subscriptions
         where user_id = ${notice.user_id} and revoked_at is null
         limit 10`;
      for (const device of devices) {
        const outcome = await push.send(device, {
          title: notice.title,
          body: notice.body,
          path: notice.link_path,
          tag: notice.id,
          urgent: notice.priority === "NEEDS_YOU",
        });
        if (outcome === "SENT") {
          await sql`
            update communication.push_subscriptions
               set last_success_at = clock_timestamp(), failures = 0
             where id = ${device.id}`;
        } else {
          await sql`
            update communication.push_subscriptions
               set failures = least(failures + 1, 1000),
                   revoked_at = case when ${outcome === "GONE"} or failures + 1 >= ${MAX_FAILURES}
                                     then clock_timestamp() else revoked_at end
             where id = ${device.id}`;
        }
      }
    }
    // Marked whatever happened: a push is a nudge, not a guarantee, and
    // the notice is always in the app.
    await sql`
      update communication.notifications set pushed_at = clock_timestamp()
       where id = ${notice.id} and pushed_at is null`;
  };

  const emailOne = async (notice: DueNotice): Promise<boolean> => {
    const settings = await settingsOf(notice.user_id);
    const to = settings.email
      ? await dependencies.emailOf(notice.user_id)
      : null;
    if (to !== null && email.available) {
      const link =
        dependencies.appOrigin === null || notice.link_path === null
          ? null
          : `${dependencies.appOrigin}${notice.link_path}`;
      await email.send({
        to,
        subject: notice.title.replace(/[\r\n]+/g, " "),
        text: [
          notice.title,
          notice.body ?? "",
          "",
          link === null ? "Open Capital Q to act on it." : `Open it: ${link}`,
          "",
          "You get this because Q needs you. Turn emails off in Settings, Notifications.",
        ]
          .filter((line, index) => index !== 1 || line.length > 0)
          .join("\n"),
      });
    }
    await sql`
      update communication.notifications set emailed_at = clock_timestamp()
       where id = ${notice.id} and emailed_at is null`;
    return to !== null && email.available;
  };

  return {
    /** One delivery pass; bounded. Returns what was sent. */
    tick: async (
      limit = 50,
    ): Promise<{ readonly pushed: number; readonly emailed: number }> => {
      const current = now();
      const toPush = await sql<DueNotice[]>`
        select id, user_id, title, body, link_path, priority, created_at
          from communication.notifications
         where pushed_at is null and read_at is null
           and created_at > ${new Date(current.getTime() - PUSH_WINDOW_MS)}
         order by created_at
         limit ${limit}`;
      let pushed = 0;
      for (const notice of toPush) {
        try {
          await pushOne(notice);
          pushed += 1;
        } catch (error: unknown) {
          logger?.warn(
            {
              noticeId: notice.id,
              errorName: error instanceof Error ? error.name : typeof error,
            },
            "push delivery failed",
          );
        }
      }
      const toEmail = await sql<DueNotice[]>`
        select id, user_id, title, body, link_path, priority, created_at
          from communication.notifications
         where priority = 'NEEDS_YOU' and emailed_at is null and read_at is null
           and created_at < ${new Date(current.getTime() - EMAIL_AFTER_MS)}
           and created_at > ${new Date(current.getTime() - EMAIL_WINDOW_MS)}
         order by created_at
         limit ${limit}`;
      let emailed = 0;
      for (const notice of toEmail) {
        try {
          if (await emailOne(notice)) emailed += 1;
        } catch (error: unknown) {
          // Retried next pass; the notice is in the app meanwhile.
          logger?.warn(
            {
              noticeId: notice.id,
              errorName: error instanceof Error ? error.name : typeof error,
            },
            "notice email failed",
          );
        }
      }
      return { pushed, emailed };
    },
  };
}
export type NotificationDelivery = ReturnType<
  typeof createNotificationDelivery
>;
