import type { Metadata } from "next";

import { ContextIndicator } from "@capital-q/ui/context-indicator";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";

export const metadata: Metadata = { title: "Profile" };

/**
 * Profile shell. Shows the structure of account and context without
 * fabricating any of it: there is no session on this build, so nothing here
 * claims a role, a membership, a verification or an organisation.
 */
export default function ProfilePage() {
  return (
    <PageContainer width="reading">
      <PageHeader
        title="Profile"
        description="Your account, the context you're working in, and how Capital Q looks."
      />
      <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        <ProfileRow term="Account">
          <span className="text-(--cq-text-secondary)">Not signed in</span>
        </ProfileRow>
        <ProfileRow term="Organisation context">
          <ContextIndicator scope="unset" />
        </ProfileRow>
        <ProfileRow term="Appearance">
          <span className="text-(--cq-text-secondary)">
            Follows your device
          </span>
        </ProfileRow>
      </dl>
      <p className="cq-body-sm pt-5 text-(--cq-text-secondary)">
        Sign-in, verification and organisation membership are managed by Capital
        Q and appear here once your account is connected.
      </p>
    </PageContainer>
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
    <div className="flex flex-col gap-1.5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="cq-label text-(--cq-text-primary)">{term}</dt>
      <dd className="cq-body-sm min-w-0">{children}</dd>
    </div>
  );
}
