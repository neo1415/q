import type { Metadata } from "next";
import Link from "next/link";

import { Avatar } from "@capital-q/ui/avatar";
import { buttonClassName } from "@capital-q/ui/button";

import { getSessionUser } from "@/auth/session";
import {
  PageContainer,
  PageSection,
} from "@/components/app-shell/page-container";
import { ThemeToggle } from "@/features/appearance/theme-toggle";
import { SignOutButton } from "@/features/auth";
import { EditableProfile } from "@/features/profile/editable-profile";
import { loadProfilePage } from "@/features/profile/profile-data";
import {
  ProfileFindings,
  ProfileQEntry,
  ProfileVerification,
} from "@/features/profile/profile-enrichment";
import {
  COMPANY_FIELDS,
  INVESTOR_FIELDS,
  PERSON_FIELDS,
} from "@/features/profile/profile-fields";
import { QMotionToggle } from "@/features/q-aperture";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QPageSubject } from "@/features/q/q-subject";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

/**
 * Profile (BIZ-002): the person, and the company or investor organisation
 * they act for, each editable in place and each shown with what else is
 * known about it -- what Q found on the public web, and what Capital Q
 * verified -- kept apart on ADR-001's axes.
 *
 * Every value is the API's answer under the person's own session; every
 * edit goes through the same write path Q's approved actions use. The page
 * leaves seams for what comes next rather than building it: visibility
 * (BIZ-003), the handle and Q Card (BIZ-004) and the brand kit (BIZ-005).
 */

/** The declared values a profile's fields edit, and nothing else of the DTO. */
function fieldValues<F extends string>(
  fields: readonly { readonly field: F }[],
  record: { readonly [K in F]: string | null },
): Record<string, string | null> {
  return Object.fromEntries(fields.map(({ field }) => [field, record[field]]));
}

/** What a declared field is, on the three axes, in words. */
const DECLARED = "Your statement · self-reported";

function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function ProfilePage() {
  const [user, session, context] = await Promise.all([
    getSessionUser(),
    apiSession(),
    resolveOwnContext(),
  ]);
  const data = await loadProfilePage(session, context);
  const { person, company, investor } = data;
  const name = person?.displayName ?? null;

  return (
    <PageContainer>
      {company !== null ? (
        <QPageSubject
          subject={{
            kind: "COMPANY",
            companyId: company.id,
            label: company.canonicalName,
            scope: "organisation_private",
          }}
        />
      ) : investor !== null ? (
        <QPageSubject
          subject={{
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: investor.id,
            label: investor.displayName,
            scope: "organisation_private",
          }}
        />
      ) : null}

      <header className="flex flex-col gap-4 pb-8 sm:flex-row sm:items-center sm:gap-5">
        <Avatar name={name ?? user?.email ?? "?"} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="cq-title-xl break-words text-(--cq-text-primary)">
            {name ?? "Your profile"}
          </h1>
          <p className="cq-body text-(--cq-text-secondary)">
            {[person?.headline, company?.canonicalName ?? investor?.displayName]
              .filter(
                (part): part is string => part !== null && part !== undefined,
              )
              .join(" · ") ||
              "Tell Capital Q who you are, here or by asking Q."}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-12">
        <ProfileBlock
          id="you"
          title="You"
          description="What Capital Q and the people you work with see about you."
          main={
            person === null ? (
              <Unavailable what="your profile" />
            ) : (
              <EditableProfile
                kind="PERSON"
                fields={PERSON_FIELDS}
                values={{
                  displayName: person.displayName,
                  headline: person.headline,
                }}
                version={person.version}
                provenance={DECLARED}
              />
            )
          }
          aside={
            <>
              <ProfileFindings subjectLabel="me" state={data.personFindings} />
              <ProfileQEntry
                subject="your profile"
                editDraft="Change my headline to "
                askDraft="What does my profile say about me, and what would make it clearer?"
              />
            </>
          }
          footer={
            <p className="cq-caption text-(--cq-text-tertiary)">
              Signed in as{" "}
              <span className="break-all">{user?.email ?? "you"}</span>
              {person === null ? "" : ` · updated ${dayOf(person.updatedAt)}`}
            </p>
          }
        />

        {company !== null ? (
          <ProfileBlock
            id="company"
            title={company.canonicalName}
            description="Your company's declared profile: what investors see once you make it visible."
            main={
              <EditableProfile
                kind="COMPANY"
                subjectId={company.id}
                fields={COMPANY_FIELDS}
                values={fieldValues(COMPANY_FIELDS, company)}
                version={company.version}
                provenance={DECLARED}
              />
            }
            aside={
              <>
                <ProfileFindings
                  subjectLabel={company.canonicalName}
                  state={data.organisationFindings}
                />
                <ProfileVerification state={data.verification} />
                <ProfileQEntry
                  subject="your company"
                  editDraft={`Update ${company.canonicalName}'s profile: `}
                  askDraft={`What is missing or weak in ${company.canonicalName}'s profile, from an investor's point of view?`}
                />
              </>
            }
            footer={
              <p className="cq-caption text-(--cq-text-tertiary)">
                Updated {dayOf(company.updatedAt)}
              </p>
            }
          />
        ) : investor !== null ? (
          <ProfileBlock
            id="organisation"
            title={investor.displayName}
            description="Your investor organisation's declared profile: what founders see once you make it visible."
            main={
              <EditableProfile
                kind="INVESTOR_ORGANISATION"
                subjectId={investor.id}
                fields={INVESTOR_FIELDS}
                values={fieldValues(INVESTOR_FIELDS, investor)}
                version={investor.version}
                provenance={DECLARED}
              />
            }
            aside={
              <>
                <ProfileFindings
                  subjectLabel={investor.displayName}
                  state={data.organisationFindings}
                />
                <section aria-labelledby="investor-verified">
                  <h3
                    id="investor-verified"
                    className="cq-label text-(--cq-text-primary)"
                  >
                    What Capital Q verified
                  </h3>
                  <p className="cq-body-sm pt-2 text-(--cq-text-secondary)">
                    {investor.verificationState === "unverified"
                      ? "Nothing verified yet. Verification is claim by claim, and says exactly what was checked."
                      : investor.verificationState.replace(/_/g, " ")}
                  </p>
                </section>
                <ProfileQEntry
                  subject="your investor organisation"
                  editDraft={`Update ${investor.displayName}'s profile: `}
                  askDraft={`What would founders want to know about ${investor.displayName} that our profile doesn't say yet?`}
                />
              </>
            }
            footer={
              <p className="cq-caption text-(--cq-text-tertiary)">
                Updated {dayOf(investor.updatedAt)}
              </p>
            }
          />
        ) : context.kind === "NONE" && context.unavailable !== true ? (
          <PageSection
            id="organisation"
            title="Company or investor organisation"
            description="You haven't set one up yet. Onboarding creates it, and it appears here to edit."
          >
            <div>
              <Link href="/welcome" className={buttonClassName("secondary")}>
                Set up
              </Link>
            </div>
          </PageSection>
        ) : context.kind !== "NONE" ? (
          <Unavailable what="your organisation's profile" />
        ) : null}

        {/* BIZ-003 (visibility centre) and BIZ-004 (handle and Q Card) take
            this slot: who sees which field, and the shareable identity. */}
        <PageSection
          id="visibility"
          title="Visibility & Discovery"
          description="Who can see your profile on the network, what they see, and the one switch that changes it."
        >
          <div>
            <Link
              href="/company/visibility"
              className={buttonClassName("secondary")}
            >
              Manage visibility
            </Link>
          </div>
        </PageSection>

        <PageSection
          id="appearance"
          title="Appearance"
          description="How Capital Q looks on this device."
        >
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            <SettingRow term="Theme">
              <ThemeToggle />
            </SettingRow>
            <SettingRow term="Q motion">
              <QMotionToggle />
            </SettingRow>
          </dl>
        </PageSection>

        <div>
          <SignOutButton />
        </div>
      </div>
    </PageContainer>
  );
}

/**
 * One profile: the declared fields on the left, what else is known on the
 * right (below on a phone). Hairlines, not cards: the columns are the
 * structure.
 */
function ProfileBlock({
  id,
  title,
  description,
  main,
  aside,
  footer,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly main: React.ReactNode;
  readonly aside: React.ReactNode;
  readonly footer?: React.ReactNode;
}) {
  return (
    <PageSection id={id} title={title} description={description}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-3">
          {main}
          {footer}
        </div>
        <aside
          aria-label={`More about ${title}`}
          className="flex min-w-0 flex-col gap-6 lg:border-l lg:border-(--cq-border-subtle) lg:pl-8"
        >
          {aside}
        </aside>
      </div>
    </PageSection>
  );
}

function SettingRow({
  term,
  children,
}: {
  readonly term: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-4 sm:flex-row sm:items-center sm:gap-6">
      <dt className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-40">
        {term}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function Unavailable({ what }: { readonly what: string }) {
  return (
    <p className="cq-body-sm text-(--cq-text-secondary)">
      Couldn&apos;t load {what} just now. Nothing is wrong with your account;
      reload in a moment.
    </p>
  );
}
