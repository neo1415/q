import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getAdminBillingAccount,
  getAdminOrganisation,
} from "@capital-q/api-client";
import { EmptyState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { OrganisationSuspension } from "@/features/admin/suspension-controls";
import { AssignPlan, OverrideLimit } from "@/features/admin/billing-controls";
import { allowanceLine, sourceLine } from "@/features/billing/plan-words";
import { when, words } from "@/features/admin/words";

export const metadata: Metadata = { title: "Organisation · Admin" };

const KIND_WORDS = {
  COMPANY: "Company",
  INVESTOR: "Investor",
  OTHER: "Organisation",
} as const;

export default async function AdminOrganisationPage({
  params,
}: {
  readonly params: Promise<{ readonly organisationId: string }>;
}) {
  const context = await adminContext();
  if (context === null || !context.can("accounts.read")) notFound();
  const { organisationId } = await params;
  const org = await getAdminOrganisation(context.session, organisationId).catch(
    () => null,
  );
  if (org === null) notFound();
  // BILLING block (ADR 0034)
  const billing = context.can("billing.read")
    ? await getAdminBillingAccount(context.session, organisationId).catch(
        () => null,
      )
    : null;
  const canChangePlan = context.can("billing.write");
  // end BILLING block
  const facts = [
    { term: "Kind", value: KIND_WORDS[org.kind] },
    { term: "Country", value: org.country ?? "Not stated" },
    { term: "Website", value: org.website ?? "Not stated" },
    { term: "Active members", value: String(org.members) },
    { term: "Relationships", value: String(org.relationships) },
    { term: "Created", value: when(org.createdAt) },
  ];
  return (
    <div className="flex flex-col gap-8">
      <PageSection id="organisation" title={org.name}>
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {facts.map((fact) => (
              <div key={fact.term} className="flex flex-col gap-1">
                <dt className="cq-caption text-(--cq-text-secondary)">
                  {fact.term}
                </dt>
                <dd className="cq-body break-words text-(--cq-text-primary)">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
          {context.can("accounts.suspend") ? (
            <OrganisationSuspension
              organisationId={org.organisationId}
              name={org.name}
            />
          ) : null}
        </div>
      </PageSection>

      {/* BILLING block (ADR 0034) */}
      {billing === null ? null : (
        <PageSection
          id="plan"
          title="Plan and usage"
          description={sourceLine({
            source: billing.current.source,
            planName: billing.current.plan.name,
            endsAt: billing.current.endsAt,
          })}
        >
          <div className="flex flex-col gap-6">
            {canChangePlan ? (
              <AssignPlan
                organisationId={billing.organisationId}
                currentKey={billing.current.plan.key}
                plans={billing.plans}
              />
            ) : null}
            <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
              {billing.current.features.map((feature) => (
                <li
                  key={feature.key}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="cq-body font-medium text-(--cq-text-primary)">
                      {feature.name}
                    </span>
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {allowanceLine(feature)}
                      {feature.overridden ? " · set for this organisation" : ""}
                    </span>
                  </div>
                  {canChangePlan ? (
                    <OverrideLimit
                      organisationId={billing.organisationId}
                      feature={feature}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            {billing.history.length === 0 ? null : (
              <ul className="flex flex-col gap-1">
                {billing.history.map((row) => (
                  <li
                    key={`${row.startsAt}-${row.planKey}`}
                    className="cq-caption text-(--cq-text-secondary)"
                  >
                    {row.planName} ({words(row.source)}) from{" "}
                    {when(row.startsAt)}
                    {row.supersededAt === null
                      ? ""
                      : ` until ${when(row.supersededAt)}`}
                    {row.reason === null ? "" : `: ${row.reason}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PageSection>
      )}
      {/* end BILLING block */}

      <PageSection id="verification" title="Verification">
        {org.verification.length === 0 ? (
          <EmptyState
            compact
            title="Not requested"
            description="Nobody has asked Capital Q to verify this organisation."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {org.verification.map((entry) => (
              <li
                key={`${entry.claimType}-${entry.at}`}
                className="cq-body-sm text-(--cq-text-primary)"
              >
                {words(entry.claimType)}: {words(entry.status)}
                {entry.method === null
                  ? ""
                  : ` (${words(entry.method)})`} · {when(entry.at)}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection id="members" title="Members">
        {org.memberList.length === 0 ? (
          <EmptyState compact title="No members" />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {org.memberList.map((member) => (
              <li key={member.userId}>
                <Link
                  href={`/admin/accounts/${member.userId}`}
                  className="flex min-h-11 items-center justify-between gap-3 py-3 hover:bg-(--cq-surface-subtle)"
                >
                  <span className="cq-body text-(--cq-text-primary)">
                    {member.name ?? "Unnamed member"}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {words(member.status)}
                    {member.suspended ? " · Suspended" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </div>
  );
}
