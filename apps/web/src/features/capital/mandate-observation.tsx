import Link from "next/link";

import {
  getFitProfiles,
  listSavedCompanies,
} from "@capital-q/api-client";
import {
  FIT_IDS_MAX,
  type FitProfileDto,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { apiSession, qApiSession } from "@/features/q/context";
import { serverT } from "@/features/i18n/server";

import { KeepMandate } from "./mandate-observation-keep";

/**
 * "What Q noticed" beside the mandate (design 2026-10-20): observed
 * behaviour said as an observation, never folded into the declared
 * mandate. It counts the companies this investor is in touch with that
 * their own declared mandate does not cover, from the Q API's fit (rules,
 * not a model). Nothing here changes the mandate; "Keep as is" only hides
 * the note for this month on this device, and the mandate changes only
 * when they change it.
 */

type Dimension = "SECTOR" | "GEOGRAPHY" | "STAGE";

const WORDS: Readonly<Record<Dimension, { one: string; many: string }>> = {
  SECTOR: {
    one: "1 company you're in touch with is outside your declared sectors.",
    many: "companies you're in touch with are outside your declared sectors.",
  },
  GEOGRAPHY: {
    one: "1 company you're in touch with is outside your declared geography.",
    many: "companies you're in touch with are outside your declared geography.",
  },
  STAGE: {
    one: "1 company you're in touch with is outside your declared stages.",
    many: "companies you're in touch with are outside your declared stages.",
  },
};

/** The dimension most of their pipeline falls outside, with the count. */
export function mandateObservation(
  profiles: readonly FitProfileDto[],
): { readonly dimension: Dimension; readonly count: number } | null {
  let best: { dimension: Dimension; count: number } | null = null;
  for (const dimension of ["SECTOR", "GEOGRAPHY", "STAGE"] as const) {
    const count = profiles.filter((profile) =>
      profile.parameters.some(
        (parameter) =>
          parameter.parameter === dimension &&
          parameter.applicable &&
          parameter.outcome === "MISMATCH",
      ),
    ).length;
    if (count > 0 && (best === null || count > best.count))
      best = { dimension, count };
  }
  return best;
}

async function fitOf(
  items: readonly RelationshipSummaryDto[],
): Promise<readonly FitProfileDto[]> {
  const ids = [
    ...new Set(
      items
        .filter(
          (item) =>
            item.counterpart.kind === "COMPANY" &&
            item.state !== "PASSED" &&
            item.state !== "DECLINED",
        )
        .map((item) => item.counterpart.id),
    ),
  ];
  const session = await qApiSession();
  if (session === null || ids.length === 0) return [];
  const batches: string[][] = [];
  for (let at = 0; at < ids.length; at += FIT_IDS_MAX)
    batches.push(ids.slice(at, at + FIT_IDS_MAX));
  const read = await Promise.all(
    batches.map((batch) =>
      getFitProfiles(session, batch)
        .then((list) => list.items.map((item) => item.profile))
        .catch(() => []),
    ),
  );
  return read.flat();
}

export async function MandateObservation({
  relationships,
}: {
  readonly relationships: readonly RelationshipSummaryDto[] | undefined;
}) {
  const t = await serverT();
  if (relationships === undefined) return null;
  const seen = mandateObservation(await fitOf(relationships));
  if (seen === null) return null;
  const words = WORDS[seen.dimension];
  return (
    <KeepMandate
      signature={`${seen.dimension}:${String(seen.count)}`}
      title={t("What Q noticed")}
      kept={t("Kept. Q won't raise this again this month.")}
      keep={t("Keep as is")}
      review={t(
        seen.dimension === "SECTOR"
          ? "Review sectors"
          : seen.dimension === "GEOGRAPHY"
            ? "Review geography"
            : "Review stages",
      )}
    >
      <span>
        {seen.count === 1
          ? t(words.one)
          : t(`${String(seen.count)} ${words.many}`)}
      </span>
      <span className="text-xs text-(--cq-text-tertiary)">
        {t(
          "Being in touch is not a change of mandate. Your mandate only changes if you change it.",
        )}
      </span>
    </KeepMandate>
  );
}

/** Saved companies, as a card that opens them; unknown is not "0 saved". */
export async function SavedCompaniesCard() {
  const t = await serverT();
  const session = await apiSession();
  const saved =
    session === null
      ? null
      : await listSavedCompanies(session)
          .then((list) => list.companyIds.length)
          .catch(() => null);
  return (
    <Link
      href="/discover/saved"
      className="flex items-center gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
      data-saved-companies
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[13px] font-medium text-(--cq-text-secondary)">
          {t("Saved companies")}
        </span>
        <span className="text-sm text-(--cq-text-primary)">
          {saved === null
            ? t("Couldn't be read just now")
            : saved === 1
              ? t("1 saved")
              : t(`${String(saved)} saved`)}
        </span>
      </span>
      <ChevronRight
        size={ICON_SIZE.compact}
        aria-hidden="true"
        className="text-(--cq-text-tertiary)"
      />
    </Link>
  );
}
