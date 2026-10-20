"use client";

import Link from "next/link";
import { Suspense, use } from "react";

import type {
  CompanyDeckView,
  CompanyProfileDto,
  DeckSection,
  RelationshipStateV2,
} from "@capital-q/contracts";
import { Check, ICON_SIZE } from "@capital-q/ui/icons";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "@capital-q/ui/popover";

import { useT } from "@/features/i18n/language";

import { CompanyAvatar } from "../company-avatar";
import { countryLabel, stageLabel } from "../declared-labels";
import { headerRaise, relationshipWords } from "./model";

type Eventually<T> = T | Promise<T>;

/**
 * The company's header (profile option 1, `headHTML`): its name and one
 * line, then the stage, the place, the raise (with where it comes from),
 * where the reader's relationship stands and a way to it. Nothing here is
 * decided; it says what the profile read carries for this reader.
 */
export function BriefHeader({
  profile,
  own,
  investor,
  relationshipState,
  verified,
  deck,
}: {
  readonly profile: CompanyProfileDto;
  readonly own: boolean;
  readonly investor: boolean;
  readonly relationshipState: RelationshipStateV2 | null;
  /** Capital Q's own organisation verification (never the demo attestation). */
  readonly verified: boolean;
  readonly deck: Eventually<CompanyDeckView | null> | null;
}) {
  const t = useT();
  const place = [
    profile.headquartersCity,
    countryLabel(profile.headquartersCountry),
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
  const stage = stageLabel(profile.currentStageCode);
  const chip = investor ? relationshipWords(relationshipState) : null;
  return (
    <header className="cq-brief-head">
      <CompanyAvatar
        companyId={profile.companyId}
        photoUrl={profile.photoUrl}
        size={52}
      />
      <div className="min-w-0 flex-1">
        <h1 id="company-name">{profile.canonicalName}</h1>
        {profile.shortDescription === null ? null : (
          <p className="cq-brief-one">{profile.shortDescription}</p>
        )}
        <div className="cq-brief-facts" data-profile-facts>
          {stage === null ? null : <span>{stage}</span>}
          {place === "" ? null : <span>{place}</span>}
          {profile.overview === null ? null : (
            <Suspense
              fallback={
                <RaiseLink profile={profile} own={own} sections={null} />
              }
            >
              <DeckRaise profile={profile} own={own} deck={deck} />
            </Suspense>
          )}
          {verified ? (
            <span className="cq-brief-tag" data-tone="positive">
              <Check size={ICON_SIZE.compact} aria-hidden="true" />
              {t("Verified by Capital Q")}
            </span>
          ) : null}
          {chip === null ? null : (
            <span className="cq-brief-tag" data-tone="claim" data-relationship-chip>
              {t(chip)}
            </span>
          )}
          {investor ? (
            <Link
              href={`/relationships/company/${encodeURIComponent(profile.companyId)}`}
              className="cq-brief-link"
              data-quiet=""
            >
              {t("Your relationship")}
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function DeckRaise({
  profile,
  own,
  deck: eventually,
}: {
  readonly profile: CompanyProfileDto;
  readonly own: boolean;
  readonly deck: Eventually<CompanyDeckView | null> | null;
}) {
  const deck = eventually instanceof Promise ? use(eventually) : eventually;
  return (
    <RaiseLink
      profile={profile}
      own={own}
      sections={deck?.extraction?.sections ?? null}
    />
  );
}

function RaiseLink({
  profile,
  own,
  sections,
}: {
  readonly profile: CompanyProfileDto;
  readonly own: boolean;
  readonly sections: readonly DeckSection[] | null;
}) {
  const t = useT();
  const raise = headerRaise({ profile, own, deck: sections });
  if (raise.words === null) {
    return (
      <span data-raise-fact="NONE">
        {own ? t("Raise not added yet") : t("Raise not shared with you")}
      </span>
    );
  }
  return (
    <PopoverRoot>
      <PopoverTrigger>
        <button type="button" className="cq-brief-link" data-raise-fact="SHOWN">
          {raise.words}
        </button>
      </PopoverTrigger>
      <PopoverContent title={t("Where the raise comes from")}>
        {raise.source}
      </PopoverContent>
    </PopoverRoot>
  );
}
