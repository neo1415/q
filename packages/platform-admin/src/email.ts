import { createHash } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

import type { DatabaseExecutor } from "@capital-q/database";

import type { AdminGrant } from "./access.js";

/**
 * Email deliverability (spec §4): is Capital Q's own sender set up so its
 * emails land in the inbox, and did they go out. The panel reads the
 * sender from configuration, the sender domain's public DNS (SPF, DKIM,
 * DMARC) and the delivery log. The log keeps the recipient's domain and a
 * hash only -- never the address, subject or body.
 */

export type DnsTxtResolver = (name: string) => Promise<string[][]>;

export type EmailSenderConfig = {
  /** "Capital Q <q@example.com>" or a bare address; null when unset. */
  readonly sender: string | null;
  readonly provider: "BREVO_API" | "SMTP" | "NONE";
};

/** Public free-mail providers: a sender here cannot be given SPF/DKIM/DMARC by us. */
const FREE_MAILBOX_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const DKIM_SELECTORS = ["brevo1", "brevo2", "mail"] as const;

export type DnsCheck = {
  readonly name: string;
  readonly status: "PASS" | "MISSING" | "WEAK" | "UNKNOWN";
  readonly detail: string;
};

export type EmailPanel = {
  readonly sender: string | null;
  readonly senderDomain: string | null;
  readonly provider: "BREVO_API" | "SMTP" | "NONE";
  readonly freeMailbox: boolean;
  readonly checks: readonly DnsCheck[];
  readonly checkedAt: string | null;
  readonly deliveries: readonly {
    readonly source: string;
    readonly sent: number;
    readonly failed: number;
  }[];
  readonly recentFailures: readonly {
    readonly source: string;
    readonly errorClass: string;
    readonly recipientDomain: string;
    readonly at: string;
  }[];
};

export function senderAddressOf(sender: string | null): string | null {
  if (sender === null) return null;
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(sender);
  const address = (angle?.[1] ?? sender).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) ? address : null;
}

function flat(records: string[][]): string[] {
  return records.map((chunks) => chunks.join(""));
}

async function txt(
  resolver: DnsTxtResolver,
  name: string,
): Promise<string[] | null> {
  try {
    return flat(await resolver(name));
  } catch (error: unknown) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return [];
    return null;
  }
}

export async function checkSenderDomain(
  domain: string,
  resolver: DnsTxtResolver = resolveTxt,
): Promise<readonly DnsCheck[]> {
  const [root, dmarc, ...dkim] = await Promise.all([
    txt(resolver, domain),
    txt(resolver, `_dmarc.${domain}`),
    ...DKIM_SELECTORS.map((selector) =>
      txt(resolver, `${selector}._domainkey.${domain}`),
    ),
  ]);
  const checks: DnsCheck[] = [];
  if (root === null) {
    checks.push({
      name: "SPF",
      status: "UNKNOWN",
      detail: "DNS lookup failed; try again.",
    });
  } else {
    const spf = root.find((record) =>
      record.toLowerCase().startsWith("v=spf1"),
    );
    if (spf === undefined) {
      checks.push({
        name: "SPF",
        status: "MISSING",
        detail: "No SPF record on the sender domain.",
      });
    } else if (/include:(spf\.)?(brevo|sendinblue)\.com/i.test(spf)) {
      checks.push({ name: "SPF", status: "PASS", detail: spf });
    } else {
      checks.push({
        name: "SPF",
        status: "WEAK",
        detail: `SPF does not include Brevo: ${spf}`,
      });
    }
  }
  const found = DKIM_SELECTORS.filter((_, index) => {
    const records = dkim[index];
    return (
      records !== null &&
      records !== undefined &&
      records.some((r) => /p=/.test(r))
    );
  });
  const dkimUnknown = dkim.every((records) => records === null);
  checks.push(
    dkimUnknown
      ? {
          name: "DKIM",
          status: "UNKNOWN",
          detail: "DNS lookup failed; try again.",
        }
      : found.length > 0
        ? {
            name: "DKIM",
            status: "PASS",
            detail: `Key published at ${found.map((s) => `${s}._domainkey`).join(", ")}.`,
          }
        : {
            name: "DKIM",
            status: "MISSING",
            detail: "No Brevo DKIM key (brevo1/brevo2/mail._domainkey).",
          },
  );
  if (dmarc === null) {
    checks.push({
      name: "DMARC",
      status: "UNKNOWN",
      detail: "DNS lookup failed; try again.",
    });
  } else {
    const record = dmarc.find((r) => r.toUpperCase().startsWith("V=DMARC1"));
    const policy =
      record === undefined
        ? null
        : (/;\s*p=([a-z]+)/i.exec(record)?.[1] ?? null);
    checks.push(
      record === undefined
        ? {
            name: "DMARC",
            status: "MISSING",
            detail: "No DMARC record at _dmarc.",
          }
        : policy === null || policy.toLowerCase() === "none"
          ? {
              name: "DMARC",
              status: "WEAK",
              detail: `Policy is monitoring only: ${record}`,
            }
          : { name: "DMARC", status: "PASS", detail: record },
    );
  }
  return checks;
}

export function createEmailPanel(options: {
  readonly sql: DatabaseExecutor;
  readonly config: EmailSenderConfig;
  readonly resolver?: DnsTxtResolver | undefined;
  readonly cacheMs?: number | undefined;
}) {
  const cacheMs = options.cacheMs ?? 10 * 60_000;
  let cached: { at: number; checks: readonly DnsCheck[] } | null = null;
  return async (_grant: AdminGrant, refresh: boolean): Promise<EmailPanel> => {
    const address = senderAddressOf(options.config.sender);
    const domain = address?.split("@")[1] ?? null;
    const freeMailbox = domain !== null && FREE_MAILBOX_DOMAINS.has(domain);
    if (
      domain !== null &&
      !freeMailbox &&
      (refresh || cached === null || Date.now() - cached.at > cacheMs)
    ) {
      cached = {
        at: Date.now(),
        checks: await checkSenderDomain(domain, options.resolver),
      };
    }
    const deliveries = await options.sql<
      { source: string; sent: number; failed: number }[]
    >`
      select source,
             (count(*) filter (where outcome = 'SENT'))::int as sent,
             (count(*) filter (where outcome = 'FAILED'))::int as failed
        from platform_ops.email_deliveries
       where occurred_at > now() - interval '30 days'
       group by source order by source`;
    const failures = await options.sql<
      {
        source: string;
        error_class: string;
        recipient_domain: string;
        occurred_at: Date;
      }[]
    >`
      select source, error_class, recipient_domain, occurred_at
        from platform_ops.email_deliveries
       where outcome = 'FAILED'
       order by occurred_at desc limit 20`;
    return {
      sender: options.config.sender,
      senderDomain: domain,
      provider: options.config.provider,
      freeMailbox,
      checks:
        domain === null
          ? []
          : freeMailbox
            ? [
                {
                  name: "Sender domain",
                  status: "WEAK",
                  detail: `${domain} is a free mailbox; mail from it fails DMARC alignment through a relay. Verify a domain you own in Brevo and set SMTP_SENDER to an address on it.`,
                },
              ]
            : (cached?.checks ?? []),
      checkedAt:
        cached === null || freeMailbox
          ? null
          : new Date(cached.at).toISOString(),
      deliveries,
      recentFailures: failures.map((row) => ({
        source: row.source,
        errorClass: row.error_class,
        recipientDomain: row.recipient_domain,
        at: new Date(row.occurred_at).toISOString(),
      })),
    };
  };
}

// --- delivery log ------------------------------------------------------------

type SenderLike<M extends { readonly to: string }> = {
  readonly available: boolean;
  readonly send: (message: M) => Promise<void>;
};

function errorClassOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    const normalised = code
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .slice(0, 32);
    if (normalised.length > 0) return normalised;
  }
  return "SEND_FAILED";
}

/**
 * Wraps Capital Q's own email sender so every send leaves an outcome row.
 * Recording never changes the send: a logging failure is swallowed, and
 * the send's own error is rethrown unchanged for the caller's retry.
 */
export function recordingEmailSender<M extends { readonly to: string }>(
  sender: SenderLike<M>,
  options: {
    readonly sql: DatabaseExecutor;
    readonly source: string;
    readonly provider: "BREVO_API" | "SMTP";
    readonly onRecordError?: ((error: unknown) => void) | undefined;
  },
): SenderLike<M> {
  const record = async (
    to: string,
    outcome: "SENT" | "FAILED",
    errorClass: string | null,
  ) => {
    const address = to.trim().toLowerCase();
    const domain =
      (address.split("@")[1] ?? "unknown").slice(0, 253) || "unknown";
    const hash = createHash("sha256").update(address).digest("hex");
    try {
      await options.sql`
        insert into platform_ops.email_deliveries
          (source, provider, outcome, error_class, recipient_domain, recipient_hash)
        values (${options.source}, ${options.provider}, ${outcome}, ${errorClass}, ${domain}, ${hash})`;
    } catch (error: unknown) {
      options.onRecordError?.(error);
    }
  };
  return {
    available: sender.available,
    send: async (message) => {
      try {
        await sender.send(message);
      } catch (error: unknown) {
        await record(message.to, "FAILED", errorClassOf(error));
        throw error;
      }
      await record(message.to, "SENT", null);
    },
  };
}
