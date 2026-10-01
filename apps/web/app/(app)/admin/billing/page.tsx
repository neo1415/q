import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminFeeLedger } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState, ErrorState, InlineNotice } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { AccrueFees, SetFeeRate } from "@/features/admin/billing-controls";
import { when, words } from "@/features/admin/words";

export const metadata: Metadata = { title: "Billing · Admin" };

/**
 * The facilitation-fee ledger (BILLING, ADR 0034): one entry per
 * commitment the OTHER side confirmed on Capital Q, at the levels the
 * schedule accrues. Until the founder sets a rate (and has the legal
 * opinion the spec asks for) entries are recorded with no fee. Capital Q
 * records and exports; it never moves money. Plans are changed on each
 * organisation's page.
 */
export default async function AdminBillingPage() {
  const context = await adminContext();
  if (context === null || !context.can("billing.fees.read")) notFound();
  const ledger = await getAdminFeeLedger(context.session).catch(() => null);
  if (ledger === null) {
    return (
      <ErrorState
        title="The fee ledger couldn't load"
        description="Try again in a moment."
      />
    );
  }
  const rate = ledger.schedule.rateBps;
  return (
    <div className="flex flex-col gap-8">
      <PageSection
        id="schedule"
        title="Facilitation fee"
        description={`Schedule v${String(ledger.schedule.version)} · ${
          rate === null ? "no rate set" : `${(rate / 100).toFixed(2)}%`
        } of ${ledger.schedule.accrueLevels.map((level) => words(level).toLowerCase()).join(", ")} commitments confirmed by both sides · paid by the ${words(ledger.schedule.payerSide).toLowerCase()}`}
      >
        <div className="flex flex-col gap-4">
          {rate === null ? (
            <InlineNotice tone="warning" title="No rate set">
              Confirmed commitments are recorded below without a fee. A success
              fee on capital raised can need a licence (for example
              broker-dealer rules in the US, or FCA permission in the UK): get
              legal advice before setting a rate or invoicing.
            </InlineNotice>
          ) : null}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            {context.can("billing.fees.rate") ? (
              <SetFeeRate current={rate} />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {context.can("billing.fees.accrue") ? <AccrueFees /> : null}
              <a
                href="/admin/billing/fees.csv"
                className={buttonClassName("secondary", "compact")}
              >
                Download CSV
              </a>
            </div>
          </div>
        </div>
      </PageSection>

      <PageSection id="entries" title="Entries">
        {ledger.entries.length === 0 ? (
          <EmptyState
            compact
            title="No confirmed commitments yet"
            description="An entry appears here when one side states money and the other side confirms it."
          />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {ledger.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="cq-body font-medium text-(--cq-text-primary)">
                    {entry.companyName} · {entry.investorName}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {words(entry.level)} · confirmed {when(entry.confirmedAt)} ·{" "}
                    {words(entry.status)}
                  </span>
                </div>
                <span className="cq-body-sm cq-numeric shrink-0 text-(--cq-text-primary)">
                  {entry.currencyCode} {entry.amount}
                  {entry.feeAmount === null
                    ? " · no fee yet"
                    : ` · fee ${entry.currencyCode} ${entry.feeAmount}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </div>
  );
}
