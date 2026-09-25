import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";

import { ThemeToggle } from "@/features/appearance/theme-toggle";
import { ContextIndicator } from "@capital-q/ui/context-indicator";

import { getCurrentIdentity } from "@/auth/current-identity";
import { getSessionUser } from "@/auth/session";
import { SignOutButton } from "@/features/auth";
import { QMotionToggle } from "@/features/q-aperture";
import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";

export const metadata: Metadata = { title: "Profile" };

/**
 * Profile: the signed-in account, the person Capital Q knows, and the
 * organisation context the server resolved. Every value on this page is
 * server-derived -- the email from the verified provider identity, the
 * Person and context from `GET /v1/me` -- and absence is shown as absence.
 */
export default async function ProfilePage() {
  const [user, identity] = await Promise.all([
    getSessionUser(),
    getCurrentIdentity(),
  ]);

  return (
    <PageContainer width="reading">
      <PageHeader
        title="Profile"
        description="Your account, the context you're working in, and how Capital Q looks."
      />
      <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        <ProfileRow term="Account">
          <span className="break-all text-(--cq-text-primary)">
            {user?.email ?? "Signed in"}
          </span>
        </ProfileRow>
        <ProfileRow term="Name">
          {identity.status === "AVAILABLE" ? (
            <span className="text-(--cq-text-primary)">
              {identity.me.user.displayName ?? "Not set yet"}
            </span>
          ) : (
            <span className="text-(--cq-text-secondary)">Not available</span>
          )}
        </ProfileRow>
        <ProfileRow term="Organisation context">
          <OrganisationContext identity={identity} />
        </ProfileRow>
        <ProfileRow term="Appearance">
          <ThemeToggle />
        </ProfileRow>
        <ProfileRow term="Q motion">
          <QMotionToggle />
        </ProfileRow>
      </dl>
      <div className="flex flex-col gap-10 pt-10">
        <PageSection
          id="visibility"
          title="Visibility & Discovery"
          description="Who can see you on the network, what they see, and the one switch that changes it."
        >
          <div>
            <Link
              href="/company/visibility"
              className={buttonClassName("secondary", "regular")}
            >
              Manage visibility
            </Link>
          </div>
        </PageSection>
        <div className="flex flex-col gap-4">
          <p className="cq-status-line">
            Verification and organisation membership are managed by Capital Q
            and appear here once they exist.
          </p>
          <SignOutButton />
        </div>
      </div>
    </PageContainer>
  );
}

function OrganisationContext({
  identity,
}: {
  readonly identity: Awaited<ReturnType<typeof getCurrentIdentity>>;
}) {
  if (identity.status === "AVAILABLE") {
    if (identity.me.context.status === "RESOLVED") {
      return (
        <span className="text-(--cq-text-primary)">
          Active organisation membership
        </span>
      );
    }
    return (
      <span className="flex flex-col gap-1">
        <ContextIndicator scope="unset" />
        <span className="cq-caption text-(--cq-text-secondary)">
          You don&apos;t belong to an organisation yet. Onboarding sets one up.
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <ContextIndicator scope="unset" />
      <span className="cq-caption text-(--cq-text-secondary)">
        {identity.status === "NOT_CONFIGURED"
          ? "Not available on this build."
          : "Couldn't be loaded right now."}
      </span>
    </span>
  );
}

function ProfileRow({
  term,
  children,
}: {
  readonly term: string;
  readonly children: React.ReactNode;
}) {
  return (
    // Values sit beside their labels, left-aligned, so the list reads as a
    // profile rather than a settings table (design/visual-debt.md, Profile).
    <div className="flex flex-col gap-1.5 py-4 sm:flex-row sm:items-start sm:gap-6">
      <dt className="cq-label shrink-0 text-(--cq-text-primary) sm:w-44 sm:pt-0.5">
        {term}
      </dt>
      <dd className="cq-body-sm min-w-0 flex-1">{children}</dd>
    </div>
  );
}
