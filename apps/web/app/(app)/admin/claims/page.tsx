import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listAdminCompanyClaims } from "@capital-q/api-client";
import { ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { ClaimDecision, PublishCompany } from "@/features/admin/claim-controls";
import { when } from "@/features/admin/words";

export const metadata: Metadata = { title: "Company claims · Admin" };

const METHOD_WORDS = {
  WORK_EMAIL: "Work email",
  REGISTRY_DOCUMENT: "Registry document",
  ASK_MEMBERS: "Asked a colleague",
} as const;

/**
 * P14: claims on companies nobody holds yet (a company with members
 * decides its own on Team), and making such a company's profile public.
 */
export default async function AdminClaimsPage() {
  const context = await adminContext();
  if (context === null || !context.can("claims.read")) notFound();
  const claims = await listAdminCompanyClaims(context.session)
    .then((result) => result.claims)
    .catch(() => null);
  return (
    <>
      <PageSection
        id="claims"
        title="Company claims"
        description="People asking to claim a company nobody holds on Capital Q. Approving makes them its first owner. Every decision names who and why."
      >
        {claims === null ? (
          <ErrorState
            title="Claims couldn't load"
            description="Try again in a moment."
          />
        ) : claims.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            No claims waiting.
          </p>
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {claims.map((claim) => (
              <li
                key={claim.requestId}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                data-admin-claim={claim.requestId}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="cq-body font-medium text-(--cq-text-primary)">
                    {claim.companyName}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {claim.requesterName ?? "A person"} ·{" "}
                    {METHOD_WORDS[claim.method]}
                    {claim.workEmailDomain === null
                      ? ""
                      : ` at ${claim.workEmailDomain} · ${claim.emailConfirmed ? "code confirmed" : "code not confirmed"}`}{" "}
                    · {when(claim.requestedAt)}
                  </span>
                </div>
                {context.can("claims.decide") ? (
                  <ClaimDecision
                    requestId={claim.requestId}
                    companyName={claim.companyName}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PageSection>
      {context.can("companies.publish") ? (
        <PageSection
          id="publish"
          title="Public company profiles"
          description="A real company nobody has claimed can be public at its own link, or seen only by people on Capital Q. Public and network are different audiences."
        >
          <PublishCompany />
        </PageSection>
      ) : null}
    </>
  );
}
