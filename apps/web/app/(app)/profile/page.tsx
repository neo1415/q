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
  SignalsAndVerification,
  type VerificationState,
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
                {journey === null ? null : (
                  <Link
                    href="/company/visibility"
                    className={buttonClassName("quiet")}
                  >
                    Visibility
                  </Link>
                )}
              </>
            }
          />

          {journey === null ? null : (
            <Suspense fallback={<StatRowSkeleton />}>
              <StatRow journey={journey} />
            </Suspense>
          )}

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
                title="Your organisation"
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
                <p className="cq-caption text-(--cq-text-tertiary)">
                  Updated {dayOf(investor.updatedAt)}
                </p>
              </EditableSection>
              {/* The mandate, one card per part, each edited in place (ADR 0024). */}
              <AnswersSlot
                journey="investor"
                bare={false}
                include={[
                  "mandate",
                  "cheque",
                  "focus",
                  "criteria",
                  "founder_fit",
                  "exclusions",
                  "discovery",
                  "thesis",
                ]}
              />
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

          {/* The shareable identity (BIZ-004). */}
          {company !== null || investor !== null ? (
            <ProfileSectionShell id="q-card" title="Q Card">
              {company !== null ? (
                <QCardSection
                  subjectType="COMPANY"
                  subjectId={company.id}
                  name={company.canonicalName}
                  tagline={company.shortDescription}
                  values={{
                    ...fieldValues(COMPANY_FIELDS, company),
                    photo:
                      (orgImages?.avatar ?? null) === null ? null : "Added",
                    cover: (orgImages?.cover ?? null) === null ? null : "Added",
                  }}
                />
              ) : investor !== null ? (
                <QCardSection
                  subjectType="INVESTOR_ORGANISATION"
                  subjectId={investor.id}
                  name={investor.displayName}
                  tagline={investor.publicDescription}
                  values={{
                    ...fieldValues(INVESTOR_FIELDS, investor),
                    photo:
                      (orgImages?.avatar ?? null) === null ? null : "Added",
                    cover: (orgImages?.cover ?? null) === null ? null : "Added",
                  }}
                />
              ) : null}
            </ProfileSectionShell>
          ) : null}

          <div className="border-t border-(--cq-border-subtle) pt-6">
            <SignOutButton />
          </div>
        </div>

        <aside
          aria-label="What else is known"
          className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6 lg:self-start"
        >
          <SignalsSlot
            subjects={[
              ...(company !== null
                ? [
                    {
                      subjectType: "COMPANY" as const,
                      subjectId: company.id,
                      label: company.canonicalName,
                      heading: "Your company",
                      hasWebsite: Boolean(company.websiteUrl),
                    },
                  ]
                : investor !== null
                  ? [
                      {
                        subjectType: "INVESTOR_ORGANISATION" as const,
                        subjectId: investor.id,
                        label: investor.displayName,
                        heading: "Your organisation",
                        hasWebsite: Boolean(investor.websiteUrl),
                      },
                    ]
                  : []),
              ...(person === null
                ? []
                : [
                    {
                      subjectType: "PERSON" as const,
                      subjectId: person.userId,
                      label: "me",
                      heading: "You",
                      hasWebsite: false,
                    },
                  ]),
            ]}
            verification={company !== null ? data.verification : null}
            verificationHref={company !== null ? "/verification" : null}
          />
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

type SignalsSubjectRef = {
  readonly subjectType: ProfileFindingSubjectType;
  readonly subjectId: string;
  readonly label: string;
  readonly heading: string;
  readonly hasWebsite: boolean;
};

type SignalsProps = {
  readonly subjects: readonly SignalsSubjectRef[];
  readonly verification: VerificationState | null;
  readonly verificationHref: string | null;
};

/**
 * Signals & verification, streamed: the declared profile paints at once
 * and what Q found arrives when the Q API has read it, for every subject
 * in one card (the organisation, then the person).
 */
function SignalsSlot(props: SignalsProps) {
  return (
    <Suspense
      fallback={
        <SignalsAndVerification
          {...props}
          subjects={props.subjects.map((subject) => ({
            ...subject,
            findings: { status: "LOADING" },
          }))}
        />
      }
    >
      <SignalsRead {...props} />
    </Suspense>
  );
}

async function SignalsRead(props: SignalsProps) {
  const findings = await Promise.all(
    props.subjects.map((subject) =>
      loadProfileFindings(subject.subjectType, subject.subjectId),
    ),
  );
  return (
    <SignalsAndVerification
      {...props}
      subjects={props.subjects.map((subject, at) => ({
        ...subject,
        findings: findings[at] ?? { status: "UNAVAILABLE" },
      }))}
    />
  );
}

/** The hero's key facts, in the person's own answers (founder design). */
async function StatRow({ journey }: { readonly journey: ProfileJourney }) {
  const state = await pageAnswers();
  if (state.status !== "READ") return null;
  const line = (stepKey: string) =>
    state.groups
      .flatMap((group) => group.lines)
      .find((candidate) => candidate.stepKey === stepKey);
  const listOf = (stepKey: string, max = 3) => {
    const found = line(stepKey);
    const items = found?.items ?? (found?.value == null ? [] : [found.value]);
    return items.length === 0
      ? null
      : items.slice(0, max).join(", ") +
          (items.length > max ? ` +${String(items.length - max)}` : "");
  };
  const stats: readonly {
    readonly label: string;
    readonly value: string | null;
  }[] =
    journey === "investor"
      ? [
          {
            label: "Typical cheque",
            value: line("I2.cheque_typical")?.value ?? null,
          },
          { label: "Stages", value: listOf("I2.stages") },
          { label: "Key sectors", value: listOf("I3.sectors") },
        ]
      : [
          { label: "Sector", value: listOf("F1.categories", 2) },
          { label: "Team", value: line("F4.team_size")?.value ?? null },
          {
            label: "Raise",
            value:
              line("F6.target_amount")?.value ??
              line("objective.stage")?.value ??
              null,
          },
        ];
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-profile-stats>
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col gap-1 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-3"
        >
          <dt className="cq-caption text-(--cq-text-secondary)">
            {stat.label}
          </dt>
          <dd
            className={
              stat.value === null
                ? "cq-body text-(--cq-text-tertiary)"
                : "cq-title-sm cq-numeric text-(--cq-text-primary)"
            }
          >
            {stat.value ?? "Not added"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StatRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((key) => (
        <div
          key={key}
          className="h-16 animate-pulse rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle) motion-reduce:animate-none"
        />
      ))}
    </div>
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
  bare = true,
}: {
  readonly journey: ProfileJourney;
  readonly include: readonly string[];
  readonly emptyText?: string | undefined;
  readonly provenance?: boolean | undefined;
  /** Inside a section card (the default); false for free-standing cards. */
  readonly bare?: boolean | undefined;
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
          bare={bare}
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
  bare,
}: {
  readonly journey: ProfileJourney;
  readonly include: readonly string[];
  readonly emptyText?: string | undefined;
  readonly provenance?: boolean | undefined;
  readonly bare: boolean;
}) {
  const state = await pageAnswers();
  return (
    <ProfileAnswers
      journey={journey}
      state={state}
      include={include}
      emptyText={emptyText}
      provenance={provenance}
      bare={bare}
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
