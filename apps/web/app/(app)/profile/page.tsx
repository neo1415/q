import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense, type ReactNode } from "react";

import type { KybDto, ProfileImageSubjectType } from "@capital-q/contracts";
import { getKyb, getThesisReading } from "@capital-q/api-client";

import { getSessionUser } from "@/auth/session";
import { SignOutButton } from "@/features/auth";
import {
  AnswersKvSection,
  type AnswersKvEditable,
} from "@/features/profile/answers-kv";
import {
  EditableSection,
  ProfileSectionShell,
} from "@/features/profile/editable-section";
import {
  FoundSection,
  type FoundSubject,
} from "@/features/profile/found-section";
import type {
  AnswerLine,
  ProfileJourney,
} from "@/features/profile/profile-answers";
import { editableOf } from "@/features/profile/profile-answers-view";
import {
  loadProfileAnswers,
  loadProfileFindings,
  loadProfileImages,
  loadProfilePage,
  type AnswersState,
} from "@/features/profile/profile-data";
import {
  COMPANY_FIELDS,
  INVESTOR_FIELDS,
  PERSON_FIELDS,
  displayValue,
  type FieldSpec,
} from "@/features/profile/profile-fields";
import { FounderBackgroundSection } from "@/features/profile/founder-background-section";
import { OwnProfileHero } from "@/features/profile/profile-header";
import { ProfileImageEditor } from "@/features/profile/profile-image-editor";
import {
  VerificationSection,
  type VerificationLine,
} from "@/features/profile/verification-section";
import { VisibilityLabel } from "@/features/profile/visibility-label";
import { QCardSection } from "@/features/q-card/q-card-section";
import { ProfileTeamSection } from "@/features/team/profile-team";
import { ThesisSection } from "@/features/investor/thesis-section";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";
import { QPageSubject } from "@/features/q/q-subject";
import { serverT } from "@/features/i18n/server";
import { qPitchEnabled } from "@/features/q-pitch/flag";
import { AccountToastProvider } from "@/features/settings/account-kit";
import { accountButton } from "@/features/settings/account-styles";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

/**
 * Your profile (BIZ-002; chosen design "One page, edit in place",
 * 2026-10-21): one column, every section editable where it stands, each
 * saying who can see it -- only your company or firm, Capital Q members,
 * or anyone with your link. The mandate is shown as declared and is never
 * rewritten from what the person watches or saves; what Q found in public
 * waits for the person's approval, with its source and "Not verified";
 * how Q reads the thesis is labelled a reading.
 *
 * Every value is the API's answer under the person's own session; every
 * edit goes through the same write path Q's approved actions use. Photos
 * and logos go browser -> storage directly on a signed upload and are
 * shown from short-lived signed URLs.
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

/** What a declared field is, on the three axes, in words. */
const DECLARED = "Your statement · self-reported";

/** One read of the onboarding answers per request, shared by every section. */
const pageAnswers = cache(async () => {
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  return loadProfileAnswers(session, context);
});

const STANDING_WORDS: Readonly<
  Record<
    KybDto["standing"],
    { readonly words: string; readonly state: VerificationLine["state"] }
  >
> = {
  VERIFIED: { words: "Verified by Capital Q", state: "VERIFIED" },
  PENDING: { words: "Requested, with Capital Q", state: "WAITING" },
  NOT_REQUESTED: { words: "Not requested", state: "NONE" },
  EXPIRED: { words: "Expired, ask again", state: "NONE" },
  REVOKED: { words: "Declined", state: "NONE" },
};

export default async function ProfilePage() {
  const t = await serverT();
  const [user, session, context] = await Promise.all([
    getSessionUser(),
    apiSession(),
    resolveOwnContext(),
  ]);
  const [data, kyb] = await Promise.all([
    loadProfilePage(session, context),
    session === null || context.kind === "NONE"
      ? Promise.resolve(null)
      : getKyb(session).catch(() => null),
  ]);
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

  const journey: ProfileJourney | null =
    company !== null ? "founder" : investor !== null ? "investor" : null;
  const side = company !== null ? "company" : "firm";
  const vis = (scope: "private" | "members" | "link") => (
    <VisibilityLabel scope={scope} side={side} translate={t} />
  );

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
  const facts: ReactNode[] = [
    company?.canonicalName ?? investor?.displayName ?? null,
    location,
    user?.email ?? null,
  ].filter((fact): fact is string => fact !== null && fact !== "");

  const identityLabel =
    journey === "investor" ? "Investor identity" : "Founder identity";
  const identity =
    kyb === null
      ? null
      : {
          words:
            kyb.person.standing === "VERIFIED"
              ? t(`${identityLabel}: verified by Capital Q`)
              : kyb.person.standing === "PENDING"
                ? t(`${identityLabel}: with Capital Q`)
                : t(`${identityLabel}: not verified`),
          verified: kyb.person.standing === "VERIFIED",
        };
  const verificationLines: VerificationLine[] =
    kyb === null
      ? []
      : [
          {
            key: "IDENTITY",
            label: identityLabel,
            ...STANDING_WORDS[kyb.person.standing],
          },
          {
            key: "ORGANISATION",
            label: "Organisation",
            ...STANDING_WORDS[kyb.standing],
          },
        ];

  const answers = journey === null ? null : await pageAnswers();
  const kv = (include: readonly string[]) =>
    answers === null || journey === null
      ? { lines: [] as readonly AnswerLine[], editable: null }
      : answerRows(journey, answers, include);

  const foundSubjects = (
    subjects: readonly Omit<FoundSubject, "findings">[],
  ) => (
    <Suspense
      fallback={
        <FoundSection
          visibility={vis("private")}
          subjects={subjects.map((subject) => ({
            ...subject,
            findings: { status: "LOADING" },
          }))}
        />
      }
    >
      <FoundRead subjects={subjects} visibility={vis("private")} />
    </Suspense>
  );
  const subjects: Omit<FoundSubject, "findings">[] = [
    ...(company !== null
      ? [
          {
            subjectType: "COMPANY" as const,
            subjectId: company.id,
            label: company.canonicalName,
            hasWebsite: Boolean(company.websiteUrl),
            version: company.version,
          },
        ]
      : investor !== null
        ? [
            {
              subjectType: "INVESTOR_ORGANISATION" as const,
              subjectId: investor.id,
              label: investor.displayName,
              hasWebsite: Boolean(investor.websiteUrl),
              version: investor.version,
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
            hasWebsite: false,
            version: person.version,
          },
        ]),
  ];

  const mandate = kv([
    "mandate",
    "cheque",
    "focus",
    "criteria",
    "founder_fit",
    "exclusions",
    "discovery",
    "thesis",
  ]);
  const traction = kv(["traction", "raise"]);
  // An investor's role answers; a founder's background has its own rows.
  const role = journey === "investor" ? kv(["role"]) : kv([]);

  return (
    <AccountToastProvider>
      <div className="mx-auto w-full max-w-[calc(820px+4rem)] px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8">
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

        <OwnProfileHero
          name={name ?? user?.email ?? t("Your profile")}
          headline={person?.headline ?? null}
          facts={facts}
          identity={identity}
          photo={{
            subjectId: person?.userId ?? "",
            url: personImages?.avatar?.url ?? null,
            editable: person !== null,
          }}
        />

        <div className="flex flex-col gap-3.5">
          {company !== null ? (
            <>
              <EditableSection
                id="about"
                variant="brief"
                title={t("In your words")}
                visibility={vis("members")}
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
                variant="brief"
                title={t("Your company")}
                visibility={vis("members")}
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
                  name={company.canonicalName}
                  avatarUrl={orgImages?.avatar?.url ?? null}
                  coverUrl={orgImages?.cover?.url ?? null}
                />
              </EditableSection>
              <AnswersKvSection
                id="traction"
                title={t("Traction and raise")}
                journey="founder"
                lines={traction.lines}
                editable={traction.editable}
                setupHref="/onboarding/founder?review=1"
                visibility={vis("private")}
                intro={t(
                  "Your own statements from setup. Nothing here is marked verified until it is checked.",
                )}
                saveLabel="Save"
                savedToast="Saved. Your profile shows it now."
                emptyText="Traction and your raise appear here once you tell Q about them."
              />
              {foundSubjects(subjects)}
            </>
          ) : investor !== null ? (
            <>
              <EditableSection
                id="about"
                variant="brief"
                title={t("In your words")}
                visibility={vis("members")}
                profile={{
                  kind: "INVESTOR_ORGANISATION",
                  subjectId: investor.id,
                  fields: pick(INVESTOR_FIELDS, ["publicDescription"]),
                  values: fieldValues(INVESTOR_FIELDS, investor),
                  version: investor.version,
                  provenance: DECLARED,
                }}
              />
              <AnswersKvSection
                id="mandate"
                title={t("Investment mandate")}
                journey="investor"
                lines={mandate.lines}
                editable={mandate.editable}
                setupHref="/onboarding/investor?review=1"
                visibility={vis("private")}
                intro={t(
                  "This is your mandate as you declared it. Discover works from it, and it is never rewritten from what you watch or save.",
                )}
                saveLabel="Save mandate"
                savedToast="Done. Your mandate is updated, and your feed follows it."
                saveNote="Your feed follows the saved mandate."
                emptyText="Your mandate appears here once you tell Q how you invest."
              />
              {foundSubjects(subjects)}
              <EditableSection
                id="firm"
                variant="brief"
                title={t("Your firm")}
                visibility={vis("members")}
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
                  name={investor.displayName}
                  avatarUrl={orgImages?.avatar?.url ?? null}
                  coverUrl={orgImages?.cover?.url ?? null}
                />
              </EditableSection>
            </>
          ) : context.kind === "NONE" && context.unavailable !== true ? (
            <ProfileSectionShell
              id="organisation"
              variant="brief"
              title={t("Company or investor organisation")}
              description={t(
                "You haven't set one up yet. Onboarding creates it, and it appears here to edit.",
              )}
            >
              <Link
                href="/welcome"
                className={accountButton("secondary", "sm", "self-start")}
              >
                {t("Set up")}
              </Link>
            </ProfileSectionShell>
          ) : context.kind !== "NONE" ? (
            <Unavailable what="your organisation's profile" />
          ) : null}

          {person === null ? (
            <Unavailable what="your profile" />
          ) : (
            <EditableSection
              id="you"
              variant="brief"
              title={t("Education and background")}
              visibility={vis("members")}
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
              {role.lines.length === 0 ? null : (
                <dl className="m-0 flex flex-col border-t border-(--cq-border-subtle)">
                  {role.lines.map((line) => (
                    <div
                      key={line.stepKey}
                      className="flex flex-col gap-0.5 border-t border-(--cq-border-subtle) py-2.5 first:border-t-0 sm:grid sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-0"
                    >
                      <dt className="text-[13px] text-(--cq-text-secondary)">
                        {t(line.title)}
                      </dt>
                      <dd className="m-0 text-sm text-(--cq-text-primary)">
                        {line.items !== undefined &&
                        line.items !== null &&
                        line.items.length > 0
                          ? line.items.join(", ")
                          : (line.value ?? (
                              <span className="text-(--cq-text-tertiary)">
                                {t("Not added")}
                              </span>
                            ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {journey === "founder" && company !== null ? (
                <Suspense fallback={null}>
                  <FounderBackgroundSection companyId={company.id} />
                </Suspense>
              ) : null}
            </EditableSection>
          )}

          {investor !== null ? (
            <Suspense fallback={null}>
              <ThesisSlot investorOrganisationId={investor.id} />
            </Suspense>
          ) : null}

          {journey === null ? null : (
            <VerificationSection
              lines={verificationLines}
              href="/verification"
              translate={t}
              request={
                company !== null &&
                data.verification.status === "READ" &&
                data.verification.standings.some(
                  (standing) =>
                    standing.status === "NOT_REQUESTED" ||
                    standing.status === "EXPIRED",
                )
                  ? { companyId: company.id, requestKey: randomUUID() }
                  : null
              }
            />
          )}

          {/* G2: the company or firm as a team. */}
          <Suspense fallback={null}>
            <ProfileTeamSection />
          </Suspense>

          {/* The shareable identity (BIZ-004). */}
          {company !== null || investor !== null ? (
            <ProfileSectionShell
              id="q-card"
              variant="brief"
              title={t("Q Card")}
              visibility={vis("link")}
            >
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

          <div className="flex flex-wrap items-center gap-2.5 border-t border-(--cq-border-subtle) pt-5">
            {journey === null ? null : (
              <Link
                href="/company/visibility"
                className={accountButton("quiet", "sm")}
              >
                {t("Who sees what")}
              </Link>
            )}
            {/* Q Pitch lives here, not in the sidebar (owner 2026-10-17). */}
            {qPitchEnabled() ? (
              <Link
                href="/q-pitch"
                className={accountButton("secondary", "sm")}
                data-profile-q-pitch
              >
                {t("Q Pitch")}
              </Link>
            ) : null}
            <span className="ms-auto">
              <SignOutButton />
            </span>
          </div>
        </div>
      </div>
    </AccountToastProvider>
  );
}

/**
 * Setup answers as label-and-value rows for one section: the included
 * groups' lines in order, and the steps it may edit in place (a completed
 * setup's revisable steps, ADR 0024), or null when setup is where they
 * change.
 */
function answerRows(
  journey: ProfileJourney,
  state: AnswersState,
  include: readonly string[],
): {
  readonly lines: readonly AnswerLine[];
  readonly editable: AnswersKvEditable | null;
} {
  if (state.status !== "READ") return { lines: [], editable: null };
  const groups = include.flatMap((id) => {
    const group = state.groups.find((candidate) => candidate.id === id);
    return group === undefined ? [] : [group];
  });
  const lines = groups.flatMap((group) => group.lines);
  const editables = groups.flatMap((group) => {
    const editable = editableOf(journey, group, state);
    return editable === null ? [] : [editable];
  });
  const first = editables[0];
  return {
    lines,
    editable:
      first === undefined
        ? null
        : {
            stepKeys: [
              ...new Set(editables.flatMap((editable) => editable.stepKeys)),
            ],
            responses: first.responses,
            labels: first.labels,
          },
  };
}

/**
 * The organisation's own logo and cover: what its Q Card shows (through
 * the card's photo and cover settings). Each opens a sheet to upload,
 * replace or remove it.
 */
function OrganisationImages({
  subjectType,
  subjectId,
  name,
  avatarUrl,
  coverUrl,
}: {
  readonly subjectType: ProfileImageSubjectType;
  readonly subjectId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly coverUrl: string | null;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 border-t border-(--cq-border-subtle) py-2.5 sm:grid sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-0"
      data-organisation-images
    >
      <span className="text-[13px] text-(--cq-text-secondary) sm:pt-2.5">
        Logo and cover
      </span>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <div className="size-14 overflow-hidden rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle)">
            {avatarUrl === null ? null : (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
              <img
                src={avatarUrl}
                alt="Logo"
                className="size-full object-cover"
              />
            )}
          </div>
          <div className="absolute -end-1.5 -bottom-1.5">
            <ProfileImageEditor
              subjectType={subjectType}
              subjectId={subjectId}
              kind="AVATAR"
              label="logo"
              hasImage={avatarUrl !== null}
              previewUrl={avatarUrl}
              previewName={name}
              square
              compact
            />
          </div>
        </div>
        <div className="relative aspect-[4/1] h-14 min-w-0 overflow-hidden rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-strong)">
          {coverUrl === null ? null : (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
            <img src={coverUrl} alt="" className="size-full object-cover" />
          )}
          <div className="absolute top-1/2 end-2 -translate-y-1/2">
            <ProfileImageEditor
              subjectType={subjectType}
              subjectId={subjectId}
              kind="COVER"
              label="cover"
              hasImage={coverUrl !== null}
              previewUrl={coverUrl}
              compact
            />
          </div>
        </div>
      </div>
    </div>
  );
}

async function FoundRead({
  subjects,
  visibility,
}: {
  readonly subjects: readonly Omit<FoundSubject, "findings">[];
  readonly visibility: ReactNode;
}) {
  const findings = await Promise.all(
    subjects.map((subject) =>
      loadProfileFindings(subject.subjectType, subject.subjectId),
    ),
  );
  return (
    <FoundSection
      visibility={visibility}
      subjects={subjects.map((subject, at) => ({
        ...subject,
        findings: findings[at] ?? { status: "UNAVAILABLE" },
      }))}
    />
  );
}

function Unavailable({ what }: { readonly what: string }) {
  return (
    <p className="m-0 text-sm text-(--cq-text-secondary)">
      Couldn&apos;t load {what} just now. Nothing is wrong with your account;
      reload in a moment.
    </p>
  );
}

/**
 * Q.02: the investor's own thesis reading, from the Q API (the same read
 * as Q's thesis_reading). Nothing shows when it cannot be read: the
 * declared mandate stays the source of truth either way.
 */
async function ThesisSlot({
  investorOrganisationId,
}: {
  readonly investorOrganisationId: string;
}) {
  const session = await qApiSession();
  const reading =
    session === null ? null : await getThesisReading(session).catch(() => null);
  return reading === null ? null : (
    <ThesisSection
      reading={reading}
      investorOrganisationId={investorOrganisationId}
    />
  );
}
