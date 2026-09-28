import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense, type ReactNode } from "react";

import type {
  ProfileFindingSubjectType,
  ProfileImageSubjectType,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { getSessionUser } from "@/auth/session";
import { PageContainer } from "@/components/app-shell/page-container";
import { SignOutButton } from "@/features/auth";
import {
  EditableSection,
  ProfileSectionShell,
} from "@/features/profile/editable-section";
import type { ProfileJourney } from "@/features/profile/profile-answers";
import { ProfileAnswers } from "@/features/profile/profile-answers-view";
import {
  loadProfileAnswers,
  loadProfileFindings,
  loadProfileImages,
  loadProfilePage,
} from "@/features/profile/profile-data";
import {
  ProfileFindings,
  ProfileQEntry,
  ProfileVerification,
} from "@/features/profile/profile-enrichment";
import {
  COMPANY_FIELDS,
  INVESTOR_FIELDS,
  PERSON_FIELDS,
  displayValue,
  type FieldSpec,
} from "@/features/profile/profile-fields";
import { ProfileHero } from "@/features/profile/profile-header";
import { ProfileImageEditor } from "@/features/profile/profile-image-editor";
import { QCardSection } from "@/features/q-card/q-card-section";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QPageSubject } from "@/features/q/q-subject";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

/**
 * Profile (BIZ-002), laid out the LinkedIn way (founder directive
 * 2026-09-28): a header block -- cover, the round photo overlapping it,
 * name, headline, location, key facts, actions -- then clean sections
 * (About, Company or Mandate, Team, Traction and raise, Activity and
 * relationships, Documents), each with its own Edit, and a right rail with
 * what Q found and what Capital Q verified, kept apart on ADR-001's axes.
 *
 * Every value is the API's answer under the person's own session; every
 * edit goes through the same write path Q's approved actions use. Photos
 * go browser -> storage directly on a signed upload and are shown from
 * short-lived signed URLs.
 */

/** The declared values a profile's fields edit, and nothing else of the DTO. */
function fieldValues<F extends string>(
  fields: readonly { readonly field: F }[],
  record: { readonly [K in F]: string | null },
): Record<string, string | null> {
  return Object.fromEntries(fields.map(({ field }) => [field, record[field]]));
}

function pick<F extends string>(
  fields: readonly FieldSpec<F>[],
  wanted: readonly F[],
): FieldSpec<F>[] {
  return fields.filter((spec) => wanted.includes(spec.field));
}

function omit<F extends string>(
  fields: readonly FieldSpec<F>[],
  unwanted: readonly F[],
): FieldSpec<F>[] {
  return fields.filter((spec) => !unwanted.includes(spec.field));
}

/** A stored value as it reads (country code -> country, stage code -> stage). */
function shown<F extends string>(
  fields: readonly FieldSpec<F>[],
  field: F,
  value: string | null,
): string | null {
  const spec = fields.find((candidate) => candidate.field === field);
  return spec === undefined ? value : displayValue(spec.input, value);
}

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
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

/** One read of the onboarding answers per request, shared by every section. */
const pageAnswers = cache(async () => {
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  return loadProfileAnswers(session, context);
});

export default async function ProfilePage() {
  const [user, session, context] = await Promise.all([
    getSessionUser(),
    apiSession(),
    resolveOwnContext(),
  ]);
  const data = await loadProfilePage(session, context);
  const { person, company, investor } = data;
  const name = person?.displayName ?? null;
  const [personImages, orgImages] = await Promise.all([
    person === null
      ? Promise.resolve(null)
      : loadProfileImages(session, "PERSON", person.userId),
    company !== null
      ? loadProfileImages(session, "COMPANY", company.id)
      : investor !== null
        ? loadProfileImages(session, "INVESTOR_ORGANISATION", investor.id)
        : Promise.resolve(null),
  ]);

  const location =
    company !== null
      ? [
          company.headquartersCity,
          shown(
            COMPANY_FIELDS,
            "headquartersCountry",
            company.headquartersCountry,
          ),
        ]
          .filter((part): part is string => part !== null)
          .join(", ") || null
      : investor !== null
        ? shown(INVESTOR_FIELDS, "hqCountry", investor.hqCountry)
        : null;

  const website = company?.websiteUrl ?? investor?.websiteUrl ?? null;
  const facts: ReactNode[] = [
    ...(company !== null
      ? [
          company.canonicalName,
          shown(COMPANY_FIELDS, "currentStageCode", company.currentStageCode),
        ]
      : investor !== null
        ? [
            investor.displayName,
            shown(INVESTOR_FIELDS, "investorType", investor.investorType),
            shown(INVESTOR_FIELDS, "deploymentState", investor.deploymentState),
          ]
        : []),
  ].filter((fact): fact is string => fact !== null && fact !== undefined);
  const host = hostOf(website);
  if (website !== null && host !== null) {
    facts.push(
      <a
        href={website}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="font-semibold text-(--cq-text-primary) underline decoration-(--cq-border-strong) underline-offset-4 hover:decoration-(--cq-text-primary)"
      >
        {host}
      </a>,
    );
  }

  const journey: ProfileJourney | null =
    company !== null ? "founder" : investor !== null ? "investor" : null;

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

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
        <div className="flex min-w-0 flex-col gap-8">
          <ProfileHero
            name={name ?? user?.email ?? "Your profile"}
            headline={person?.headline ?? null}
            location={location}
            facts={facts}
            images={{
              subjectType: "PERSON",
              subjectId: person?.userId ?? "",
              avatarUrl: personImages?.avatar?.url ?? null,
              coverUrl: personImages?.cover?.url ?? null,
              editable: person !== null,
              avatarLabel: "profile photo",
            }}
            actions={
              <>
                <a href="#you" className={buttonClassName("primary")}>
                  Edit profile
                </a>
                {company !== null || investor !== null ? (
                  <a href="#q-card" className={buttonClassName("secondary")}>
                    Share Q Card
                  </a>
                ) : null}
                {company !== null ? (
                  <Link href="/pitch" className={buttonClassName("secondary")}>
                    Pitch &amp; media
                  </Link>
                ) : null}
              </>
            }
          />

          {company !== null ? (
            <>
              <EditableSection
                id="about"
                title="About"
                profile={{
                  kind: "COMPANY",
                  subjectId: company.id,
                  fields: pick(COMPANY_FIELDS, [
                    "shortDescription",
                    "primaryDescription",
                  ]),
                  values: fieldValues(COMPANY_FIELDS, company),
                  version: company.version,
                  provenance: DECLARED,
                }}
              />
              <EditableSection
                id="company"
                title="Company"
                description="Your company's declared profile: what investors see once you make it visible."
                profile={{
                  kind: "COMPANY",
                  subjectId: company.id,
                  fields: omit(COMPANY_FIELDS, [
                    "shortDescription",
                    "primaryDescription",
                  ]),
                  values: fieldValues(COMPANY_FIELDS, company),
                  version: company.version,
                  provenance: DECLARED,
                }}
              >
                <OrganisationImages
                  subjectType="COMPANY"
                  subjectId={company.id}
                  avatarUrl={orgImages?.avatar?.url ?? null}
                  coverUrl={orgImages?.cover?.url ?? null}
                />
                <AnswersSlot
                  journey="founder"
                  include={["sector"]}
                  provenance={false}
                  emptyText="Your sector appears here once you tell Q about it."
                />
                <p className="cq-caption text-(--cq-text-tertiary)">
                  Updated {dayOf(company.updatedAt)}
                </p>
              </EditableSection>
            </>
          ) : investor !== null ? (
            <>
              <EditableSection
                id="about"
                title="About"
                profile={{
                  kind: "INVESTOR_ORGANISATION",
                  subjectId: investor.id,
                  fields: pick(INVESTOR_FIELDS, ["publicDescription"]),
                  values: fieldValues(INVESTOR_FIELDS, investor),
                  version: investor.version,
                  provenance: DECLARED,
                }}
              />
              <EditableSection
                id="mandate"
                title="Mandate"
                description="How you invest, as you declared it. Discover works from it."
                profile={{
                  kind: "INVESTOR_ORGANISATION",
                  subjectId: investor.id,
                  fields: omit(INVESTOR_FIELDS, ["publicDescription"]),
                  values: fieldValues(INVESTOR_FIELDS, investor),
                  version: investor.version,
                  provenance: DECLARED,
                }}
              >
                <OrganisationImages
                  subjectType="INVESTOR_ORGANISATION"
                  subjectId={investor.id}
                  avatarUrl={orgImages?.avatar?.url ?? null}
                  coverUrl={orgImages?.cover?.url ?? null}
                />
                <AnswersSlot
                  journey="investor"
                  include={[
                    "cheque",
                    "stages",
                    "geography",
                    "sectors",
                    "thesis",
                    "preferences",
                    "exclusions",
                    "discovery",
                  ]}
                />
                <p className="cq-caption text-(--cq-text-tertiary)">
                  Updated {dayOf(investor.updatedAt)}
                </p>
              </EditableSection>
            </>
          ) : context.kind === "NONE" && context.unavailable !== true ? (
            <ProfileSectionShell
              id="organisation"
              title="Company or investor organisation"
              description="You haven't set one up yet. Onboarding creates it, and it appears here to edit."
            >
              <div>
                <Link href="/welcome" className={buttonClassName("secondary")}>
                  Set up
                </Link>
              </div>
            </ProfileSectionShell>
          ) : context.kind !== "NONE" ? (
            <Unavailable what="your organisation's profile" />
          ) : null}

          {person === null ? (
            <Unavailable what="your profile" />
          ) : (
            <EditableSection
              id="you"
              title={
                journey === "investor"
                  ? "You and your role"
                  : "You and your team"
              }
              description="What Capital Q and the people you work with see about you."
              profile={{
                kind: "PERSON",
                fields: PERSON_FIELDS,
                values: {
                  displayName: person.displayName,
                  headline: person.headline,
                },
                version: person.version,
                provenance: DECLARED,
              }}
            >
              {journey === null ? null : (
                <AnswersSlot
                  journey={journey}
                  include={journey === "founder" ? ["team"] : ["role"]}
                  provenance={false}
                  emptyText={
                    journey === "founder"
                      ? "Your team appears here once you tell Q about it."
                      : "Your role appears here once you tell Q about it."
                  }
                />
              )}
              <p className="cq-caption text-(--cq-text-tertiary)">
                Signed in as{" "}
                <span className="break-all">{user?.email ?? "you"}</span>
                {` · updated ${dayOf(person.updatedAt)}`}
              </p>
            </EditableSection>
          )}

          {journey === "founder" ? (
            <ProfileSectionShell
              id="traction"
              title="Traction and raise"
              action={
                <Link
                  href="/capital"
                  className={buttonClassName("quiet", "regular", "shrink-0")}
                >
                  Open Capital
                </Link>
              }
            >
              <AnswersSlot journey="founder" include={["traction", "raise"]} />
            </ProfileSectionShell>
          ) : null}

          {journey === null ? null : (
            <ProfileSectionShell
              id="activity"
              title="Activity and relationships"
              description={
                journey === "founder"
                  ? "Investors who expressed interest, and where each conversation stands."
                  : "Companies you are in conversation with, and where each stands."
              }
              action={
                <Link
                  href="/relationships"
                  className={buttonClassName("quiet", "regular", "shrink-0")}
                >
                  Open Relationships
                </Link>
              }
            >
              {null}
            </ProfileSectionShell>
          )}

          {company !== null ? (
            <ProfileSectionShell
              id="documents"
              title="Documents and pitch"
              description="Your pitch video and the documents Q links as evidence: upload, replace, preview, publish or withdraw."
              action={
                <Link
                  href="/pitch"
                  className={buttonClassName("quiet", "regular", "shrink-0")}
                >
                  Manage
                </Link>
              }
            >
              {null}
            </ProfileSectionShell>
          ) : null}

          {/* The shareable identity (BIZ-004). */}
          {company !== null || investor !== null ? (
            <ProfileSectionShell
              id="q-card"
              title="Q Card"
              description="Your shareable digital business card: a link and QR that open a page showing only what you choose."
            >
              {company !== null ? (
                <QCardSection
                  subjectType="COMPANY"
                  subjectId={company.id}
                  name={company.canonicalName}
                  tagline={company.shortDescription}
                />
              ) : investor !== null ? (
                <QCardSection
                  subjectType="INVESTOR_ORGANISATION"
                  subjectId={investor.id}
                  name={investor.displayName}
                  tagline={investor.publicDescription}
                />
              ) : null}
            </ProfileSectionShell>
          ) : null}

          <ProfileSectionShell
            id="visibility"
            title="Visibility and discovery"
            description="Who can see your profile on the network, what they see, and the one switch that changes it."
            action={
              <Link
                href="/company/visibility"
                className={buttonClassName("quiet", "regular", "shrink-0")}
              >
                Manage
              </Link>
            }
          >
            {null}
          </ProfileSectionShell>

          <div className="border-t border-(--cq-border-subtle) pt-6">
            <SignOutButton />
          </div>
        </div>

        <aside
          aria-label="What else is known"
          className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6 lg:self-start"
        >
          {company !== null ? (
            <>
              <FindingsSlot
                subjectType="COMPANY"
                subjectId={company.id}
                subjectLabel={company.canonicalName}
                hasWebsite={Boolean(company.websiteUrl)}
              />
              <ProfileVerification state={data.verification} />
              <ProfileQEntry
                subject="your company"
                editDraft={`Update ${company.canonicalName}'s profile: `}
                askDraft={`What is missing or weak in ${company.canonicalName}'s profile, from an investor's point of view?`}
              />
            </>
          ) : investor !== null ? (
            <>
              <FindingsSlot
                subjectType="INVESTOR_ORGANISATION"
                subjectId={investor.id}
                subjectLabel={investor.displayName}
                hasWebsite={Boolean(investor.websiteUrl)}
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
          ) : null}
          {person === null ? null : (
            <>
              <FindingsSlot
                subjectType="PERSON"
                subjectId={person.userId}
                subjectLabel="me"
              />
              <ProfileQEntry
                subject="your profile"
                editDraft="Change my headline to "
                askDraft="What does my profile say about me, and what would make it clearer?"
              />
            </>
          )}
        </aside>
      </div>
    </PageContainer>
  );
}

/**
 * The organisation's own logo and cover: what its Q Card shows (through
 * the card's photo and cover settings). Edited here, beside the profile
 * they belong to.
 */
function OrganisationImages({
  subjectType,
  subjectId,
  avatarUrl,
  coverUrl,
}: {
  readonly subjectType: ProfileImageSubjectType;
  readonly subjectId: string;
  readonly avatarUrl: string | null;
  readonly coverUrl: string | null;
}) {
  return (
    <div
      className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-4"
      data-organisation-images
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="cq-label text-(--cq-text-primary)">Logo and cover</h3>
        <p className="cq-caption text-(--cq-text-secondary)">
          Shown on your Q Card when its photo and cover are switched on.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <div className="size-16 overflow-hidden rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle)">
            {avatarUrl === null ? null : (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
              <img
                src={avatarUrl}
                alt="Logo"
                className="size-full object-cover"
              />
            )}
          </div>
          <div className="absolute -right-2 -bottom-2">
            <ProfileImageEditor
              subjectType={subjectType}
              subjectId={subjectId}
              kind="AVATAR"
              label="logo"
              hasImage={avatarUrl !== null}
            />
          </div>
        </div>
        <div className="relative aspect-[4/1] h-16 min-w-0 overflow-hidden rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-strong)">
          {coverUrl === null ? null : (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
            <img src={coverUrl} alt="" className="size-full object-cover" />
          )}
          <div className="absolute top-1/2 right-2 -translate-y-1/2">
            <ProfileImageEditor
              subjectType={subjectType}
              subjectId={subjectId}
              kind="COVER"
              label="company cover"
              hasImage={coverUrl !== null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * What Q found, streamed: the declared profile paints at once and the
 * findings arrive when the Q API has planned and read them.
 */
function FindingsSlot(props: {
  readonly subjectType: ProfileFindingSubjectType;
  readonly subjectId: string;
  readonly subjectLabel: string;
  readonly hasWebsite?: boolean | undefined;
}) {
  return (
    <Suspense
      fallback={
        <ProfileFindings
          subjectLabel={props.subjectLabel}
          state={{ status: "LOADING" }}
          hasWebsite={props.hasWebsite}
        />
      }
    >
      <FindingsRead {...props} />
    </Suspense>
  );
}

async function FindingsRead({
  subjectType,
  subjectId,
  subjectLabel,
  hasWebsite,
}: {
  readonly subjectType: ProfileFindingSubjectType;
  readonly subjectId: string;
  readonly subjectLabel: string;
  readonly hasWebsite?: boolean | undefined;
}) {
  const state = await loadProfileFindings(subjectType, subjectId);
  return (
    <ProfileFindings
      subjectLabel={subjectLabel}
      state={state}
      hasWebsite={hasWebsite}
    />
  );
}

/**
 * The onboarding answers (R25) a section shows, streamed: the declared
 * fields paint at once, and the answers arrive when the onboarding session
 * (and its taxonomy labels) have been read -- once per request.
 */
function AnswersSlot({
  journey,
  include,
  emptyText,
  provenance,
}: {
  readonly journey: ProfileJourney;
  readonly include: readonly string[];
  readonly emptyText?: string | undefined;
  readonly provenance?: boolean | undefined;
}) {
  return (
    <div className="pt-2">
      <Suspense
        fallback={
          <p
            className="cq-body-sm text-(--cq-text-tertiary)"
            data-answers="loading"
          >
            Reading what you told Q…
          </p>
        }
      >
        <AnswersRead
          journey={journey}
          include={include}
          emptyText={emptyText}
          provenance={provenance}
        />
      </Suspense>
    </div>
  );
}

async function AnswersRead({
  journey,
  include,
  emptyText,
  provenance,
}: {
  readonly journey: ProfileJourney;
  readonly include: readonly string[];
  readonly emptyText?: string | undefined;
  readonly provenance?: boolean | undefined;
}) {
  const state = await pageAnswers();
  return (
    <ProfileAnswers
      journey={journey}
      state={state}
      include={include}
      emptyText={emptyText}
      provenance={provenance}
    />
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
