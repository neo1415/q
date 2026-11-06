import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Alerts for Capital Q's own operators (Premium Plan P1): a provider's
 * credit ran out, a key was refused, a balance will last fewer than about
 * seven days. Delivered the way an operator notice already is (the paused
 * account notice in q-api): one structured ERROR log line an operator can
 * alert on, and an email to every platform admin with an address.
 *
 * The same alert is sent at most once per `repeatAfterMs` per key in this
 * process, so a probe that finds the account still shut every half-minute
 * does not mail the owner every half-minute. Nothing here reads or sends
 * customer content: subjects and texts are built from provider names and
 * figures by the caller.
 */

export type OperatorAlert = {
  /** De-duplication key, e.g. `provider-blocked:openai`. */
  readonly key: string;
  readonly subject: string;
  readonly text: string;
};

export type OperatorAlertLogger = {
  readonly error: (fields: Record<string, unknown>, message: string) => void;
  readonly warn: (fields: Record<string, unknown>, message: string) => void;
};

export type OperatorAlertEmail = {
  readonly available: boolean;
  readonly send: (message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
  }) => Promise<void>;
};

/** Six hours: a still-shut account is said again twice a working day. */
export const OPERATOR_ALERT_REPEAT_MS = 6 * 60 * 60 * 1000;

export function createOperatorAlerts(options: {
  /** Reads the platform admins' addresses; absent, log only. */
  readonly operatorEmails?: (() => Promise<readonly string[]>) | undefined;
  readonly email: OperatorAlertEmail;
  readonly logger: OperatorAlertLogger;
  readonly repeatAfterMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
}): {
  /** Resolves true when the alert was sent now, false when de-duplicated. */
  readonly alert: (alert: OperatorAlert) => Promise<boolean>;
} {
  const repeatAfterMs = options.repeatAfterMs ?? OPERATOR_ALERT_REPEAT_MS;
  const now = options.now ?? (() => new Date());
  const lastSent = new Map<string, number>();
  return {
    alert: async (alert) => {
      const at = now().getTime();
      const previous = lastSent.get(alert.key);
      if (previous !== undefined && at - previous < repeatAfterMs) {
        return false;
      }
      lastSent.set(alert.key, at);
      options.logger.error(
        { qAlert: "OPERATOR", alertKey: alert.key, subject: alert.subject },
        alert.text,
      );
      if (!options.email.available || options.operatorEmails === undefined) {
        return true;
      }
      let recipients: readonly string[];
      try {
        recipients = await options.operatorEmails();
      } catch (error: unknown) {
        options.logger.warn(
          { err: error, alertKey: alert.key },
          "operator alert: platform admins could not be read; logged only",
        );
        return true;
      }
      for (const to of recipients) {
        await options.email
          .send({ to, subject: alert.subject, text: alert.text })
          .catch((error: unknown) => {
            options.logger.warn(
              { err: error, alertKey: alert.key },
              "operator alert email not sent",
            );
          });
      }
      return true;
    },
  };
}

/** Every platform admin's sign-in address (identity.platform_admins). */
export function createPostgresOperatorEmails(
  sql: DatabaseExecutor,
): () => Promise<readonly string[]> {
  return async () => {
    const rows = await sql<{ email: string | null }[]>`
      select u.email
        from identity.platform_admins a
        join identity.user_profiles p on p.id = a.user_id
        left join auth.users u on u.id = p.auth_user_id`;
    return rows.flatMap((row) =>
      row.email === null || row.email === "" ? [] : [row.email],
    );
  };
}
