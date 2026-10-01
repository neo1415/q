import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminAccount } from "@capital-q/api-client";
import { EmptyState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { AccountSuspension } from "@/features/admin/suspension-controls";
import { ROLE_WORDS, when, words } from "@/features/admin/words";

export const metadata: Metadata = { title: "Account · Admin" };

export default async function AdminAccountPage({
  params,
}: {
  readonly params: Promise<{ readonly userId: string }>;
}) {
  const context = await adminContext();
  if (context === null || !context.can("accounts.read")) notFound();
  const { userId } = await params;
  const account = await getAdminAccount(context.session, userId).catch(
    () => null,
  );
  if (account === null) notFound();
  const name = account.name ?? "Unnamed member";
  const facts = [
    { term: "Email", value: account.email ?? "Not stated" },
    { term: "Country", value: account.country ?? "Not stated" },
    { term: "Joined", value: when(account.createdAt) },
    { term: "Standing", value: account.suspended ? "Suspended" : "Active" },
    {
      term: "Q's pause",
      value:
        account.qPaused === null
          ? "Not paused"
          : `Paused ${when(account.qPaused.at)}`,
    },
    { term: "Q runs", value: String(account.counts.qRuns) },
    { term: "Documents", value: String(account.counts.documents) },
    { term: "Rehearsals", value: String(account.counts.rehearsals) },
    ...(account.adminRole === null
      ? []
      : [
          {
            term: "Console role",
            value: ROLE_WORDS[account.adminRole] ?? account.adminRole,
          },
        ]),
  ];
  return (
    <div className="flex flex-col gap-8">
      <PageSection id="account" title={name}>
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {facts.map((fact) => (
              <div key={fact.term} className="flex flex-col gap-1">
                <dt className="cq-caption text-(--cq-text-secondary)">
                  {fact.term}
                </dt>
                <dd className="cq-body text-(--cq-text-primary)">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
          {context.can("accounts.suspend") ? (
            <AccountSuspension
              userId={account.userId}
              suspended={account.suspended}
              name={name}
            />
          ) : null}
        </div>
      </PageSection>

      <PageSection id="memberships" title="Organisations">
        {account.memberships.length === 0 ? (
          <EmptyState compact title="No organisation yet" />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {account.memberships.map((membership) => (
              <li key={membership.organisationId}>
                <Link
                  href={`/admin/organisations/${membership.organisationId}`}
                  className="flex min-h-11 flex-col gap-0.5 py-3 hover:bg-(--cq-surface-subtle)"
                >
                  <span className="cq-body text-(--cq-text-primary)">
                    {membership.organisationName}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {words(membership.organisationType)} ·{" "}
                    {words(membership.status)}
                    {membership.roles.length === 0
                      ? ""
                      : ` · ${membership.roles.map(words).join(", ")}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection id="suspensions" title="Suspension history">
        {account.suspensions.length === 0 ? (
          <EmptyState compact title="Never suspended" />
        ) : (
          <ul className="flex flex-col gap-2">
            {account.suspensions.map((entry) => (
              <li
                key={`${entry.occurredAt}-${entry.action}`}
                className="cq-body-sm text-(--cq-text-primary)"
              >
                {entry.action === "SUSPENDED" ? "Suspended" : "Lifted"}{" "}
                {when(entry.occurredAt)} by {entry.actorName ?? "an admin"}:{" "}
                {entry.reason}
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </div>
  );
}
