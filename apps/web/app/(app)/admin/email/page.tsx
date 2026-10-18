import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminEmail } from "@capital-q/api-client";
import { EmptyState, ErrorState, InlineNotice } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { when, words } from "@/features/admin/words";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Email · Admin") };
}

const STATUS_WORDS = {
  PASS: "Set up",
  MISSING: "Missing",
  WEAK: "Needs work",
  UNKNOWN: "Couldn't check",
} as const;
const PROVIDER_WORDS = {
  BREVO_API: "Brevo (HTTPS)",
  SMTP: "SMTP relay",
  NONE: "Not configured",
} as const;

export default async function AdminEmailPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly refresh?: string | undefined }>;
}) {
  const t = await serverT();

  const context = await adminContext();
  if (context === null || !context.can("email.read")) notFound();
  const refresh = (await searchParams).refresh === "1";
  const panel = await getAdminEmail(context.session, refresh).catch(() => null);
  if (panel === null) {
    return (
      <ErrorState
        title={t("Email status couldn't load")}
        description={t("Try again in a moment.")}
      />
    );
  }
  return (
    <div className="flex flex-col gap-10">
      <PageSection
        id="sender"
        title={t("Sender")}
        description={t(
          "Capital Q's own emails: reminders, briefs and notices.",
        )}
      >
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="cq-caption text-(--cq-text-secondary)">
                {t("From")}
              </dt>
              <dd className="cq-body break-all text-(--cq-text-primary)">
                {panel.sender ?? t("Not stated")}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="cq-caption text-(--cq-text-secondary)">
                {t("Sent through")}
              </dt>
              <dd className="cq-body text-(--cq-text-primary)">
                {t(PROVIDER_WORDS[panel.provider])}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="cq-caption text-(--cq-text-secondary)">
                {t("Domain checked")}
              </dt>
              <dd className="cq-body text-(--cq-text-primary)">
                {t(when(panel.checkedAt))}
              </dd>
            </div>
          </dl>
          {panel.freeMailbox ? (
            <InlineNotice
              tone="warning"
              title={t("Emails are likely to land in spam")}
            >
              {t(
                "The sender is a free mailbox. Verify a domain you own in Brevo (SPF, DKIM, DMARC) and set SMTP_SENDER to an address on it.",
              )}
            </InlineNotice>
          ) : null}
          {panel.checks.length === 0 ? null : (
            <ul className="flex flex-col gap-2">
              {panel.checks.map((check) => (
                <li key={check.name} className="flex flex-col gap-0.5">
                  <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                    {check.name}: {t(STATUS_WORDS[check.status])}
                  </span>
                  <span className="cq-caption break-all text-(--cq-text-secondary)">
                    {t(check.detail)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/admin/email?refresh=1"
            className="cq-body-sm inline-flex min-h-11 items-center self-start underline underline-offset-4"
          >
            {t("Check DNS again")}
          </Link>
        </div>
      </PageSection>

      <PageSection id="deliveries" title={t("Last 30 days")}>
        {panel.deliveries.length === 0 ? (
          <EmptyState
            compact
            title={t("No emails recorded yet")}
            description={t("Sends are counted from when this panel was added.")}
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {panel.deliveries.map((row) => (
              <li
                key={row.source}
                className="cq-body-sm flex justify-between gap-3 text-(--cq-text-primary)"
              >
                <span>{t(words(row.source))}</span>
                <span className="tabular-nums">
                  {row.sent} {t("sent ·")} {row.failed} {t("failed")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection id="failures" title={t("Recent failures")}>
        {panel.recentFailures.length === 0 ? (
          <EmptyState compact title={t("No failures")} />
        ) : (
          <ul className="flex flex-col gap-1">
            {panel.recentFailures.map((row, index) => (
              <li
                key={`${row.at}-${String(index)}`}
                className="cq-body-sm text-(--cq-text-primary)"
              >
                {t(words(row.source))} {t("to")} {t(row.recipientDomain)}:{" "}
                {t(words(row.errorClass))} · {t(when(row.at))}
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </div>
  );
}
