import type {
  CompanyDto,
  CompanyEditableField,
  InvestorEditableField,
  InvestorOrganisationDto,
  MyOrganisationDto,
  ProfileImagesDto,
  TeamRole,
} from "@capital-q/contracts";

import { EditableSection } from "@/features/profile/editable-section";
import { OrganisationImages } from "@/features/profile/organisation-images";
import {
  COMPANY_FIELDS,
  INVESTOR_FIELDS,
  type FieldSpec,
} from "@/features/profile/profile-fields";
import { QSection } from "@/features/q/q-section";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { teamWords } from "@/features/team/team-words";

import { CAP } from "./role-words";

const DECLARED = "Your statement · self-reported";

const ROLE_WORD: Readonly<Record<TeamRole, string>> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

/** The company fields General edits; the rest stay on the profile page. */
export const COMPANY_GENERAL: readonly CompanyEditableField[] = [
  "canonicalName",
  "websiteUrl",
  "headquartersCountry",
  "headquartersCity",
  "shortDescription",
  "primaryDescription",
];

/**
 * The investor organisation fields General edits. Its declared profile has
 * no headquarters city and no action writes one, so General does not offer
 * it (a new field needs its own contract and migration).
 */
export const INVESTOR_GENERAL: readonly InvestorEditableField[] = [
  "displayName",
  "websiteUrl",
  "hqCountry",
  "publicDescription",
];

function pick<F extends string>(
  fields: readonly FieldSpec<F>[],
  wanted: readonly F[],
): FieldSpec<F>[] {
  return wanted.flatMap((field) =>
    fields.filter((spec) => spec.field === field),
  );
}

function valuesOf<F extends string>(
  fields: readonly F[],
  record: { readonly [K in F]: string | null },
): Record<string, string | null> {
  return Object.fromEntries(fields.map((field) => [field, record[field]]));
}

/**
 * Organisation → General (decisions 109 and 110): the organisation's own
 * name, website, description, logo, headquarters and country. Each field
 * saves through the same owning-context command Q's approved actions use
 * (company.profile.update or investor.profile.update), with the version the
 * page read: a change made meanwhile, by a colleague or by Q, is a
 * conflict, never overwritten. Owners and admins edit; a member reads, and
 * the API refuses their write whatever the page renders.
 */
export function OrgGeneralView({
  t,
  organisation,
  role,
  canManage,
  company,
  investor,
  images,
  unavailable = false,
}: {
  readonly t: (english: string) => string;
  readonly organisation: MyOrganisationDto;
  readonly role: TeamRole;
  readonly canManage: boolean;
  readonly company: CompanyDto | null;
  readonly investor: InvestorOrganisationDto | null;
  readonly images: ProfileImagesDto | null;
  readonly unavailable?: boolean | undefined;
}) {
  const facts: readonly (readonly [string, string])[] = [
    ["Kind", teamWords(organisation.kind).label],
    [
      "Members",
      organisation.memberCount === 1
        ? "Just you"
        : `${String(organisation.memberCount)} people`,
    ],
    ["Your role", ROLE_WORD[role]],
  ];
  return (
    <AccountColumn>
      <QSection id="organisation" kind="TEAM" label={t("your organisation")}>
        <AccountHead
          title={t("General")}
          sub={t(
            canManage
              ? `${organisation.name}'s own details. Each change saves on its own; what you enter is your statement, not a verified fact.`
              : `${organisation.name}'s own details. Owners and admins change them.`,
          )}
        />
        <div className="flex flex-col gap-3.5" data-org-general>
          {company !== null ? (
            <EditableSection
              id="org-general"
              variant="brief"
              title={t("Company details")}
              capability={CAP.COMPANY_EDIT}
              profile={{
                kind: "COMPANY",
                subjectId: company.id,
                fields: pick(COMPANY_FIELDS, COMPANY_GENERAL),
                values: valuesOf(COMPANY_GENERAL, company),
                version: company.version,
                provenance: DECLARED,
              }}
            >
              <OrganisationImages
                subjectType="COMPANY"
                subjectId={company.id}
                name={company.canonicalName}
                avatarUrl={images?.avatar?.url ?? null}
                coverUrl={images?.cover?.url ?? null}
              />
            </EditableSection>
          ) : investor !== null ? (
            <EditableSection
              id="org-general"
              variant="brief"
              title={t("Firm details")}
              capability={CAP.INVESTOR_EDIT}
              profile={{
                kind: "INVESTOR_ORGANISATION",
                subjectId: investor.id,
                fields: pick(INVESTOR_FIELDS, INVESTOR_GENERAL),
                values: valuesOf(INVESTOR_GENERAL, investor),
                version: investor.version,
                provenance: DECLARED,
              }}
            >
              <OrganisationImages
                subjectType="INVESTOR_ORGANISATION"
                subjectId={investor.id}
                name={investor.displayName}
                avatarUrl={images?.avatar?.url ?? null}
                coverUrl={images?.cover?.url ?? null}
              />
            </EditableSection>
          ) : (
            <p className="m-0 max-w-[60ch] cq-body-sm text-(--cq-text-secondary)">
              {t(
                unavailable
                  ? "The organisation's details couldn't load. Reload in a moment."
                  : "This organisation has no company or firm profile to edit yet.",
              )}
            </p>
          )}
          <dl
            className="m-0 grid max-w-[60ch] grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-6 gap-y-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
            data-org-facts
          >
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="cq-body-sm text-(--cq-text-secondary)">
                  {t(label)}
                </dt>
                <dd className="m-0 cq-body-sm text-(--cq-text-primary)">
                  {t(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </QSection>
    </AccountColumn>
  );
}
