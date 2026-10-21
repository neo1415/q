import { PageContainer } from "@/components/app-shell/page-container";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

import { Shortlist, type ShortlistTab } from "./shortlist";
import { loadShortlist } from "./shortlist-data";

/**
 * The one page behind /discover/saved, /discover/passed and
 * /discover/saved/compare (app prototype "shortlist", option 1): the same
 * three tabs whichever address opened it, so switching is instant and each
 * address still lands on its own tab.
 */
export async function ShortlistPage({
  tab,
  compareIds,
}: {
  readonly tab: ShortlistTab;
  readonly compareIds?: string | undefined;
}) {
  const t = await serverT();
  const list = await loadShortlist(compareIds);
  const refs = (
    tab === "PASSED" ? (list.passed ?? []) : (list.saved ?? [])
  ).slice(0, 12);
  return (
    <PageContainer>
      <QSection
        id={
          tab === "PASSED" ? "passed" : tab === "COMPARE" ? "compare" : "saved"
        }
        kind="COMPANY_LIST"
        refs={refs.map((row) => ({
          kind: "COMPANY" as const,
          id: row.companyId,
        }))}
        total={refs.length}
        label={
          tab === "PASSED"
            ? t("companies you passed")
            : tab === "COMPARE"
              ? t("companies side by side")
              : t("companies you saved")
        }
      >
        <h1 className="cq-title-xl mb-2.5 text-(--cq-text-primary)">
          {t("Saved")}
        </h1>
        <Shortlist
          initialTab={tab}
          saved={list.saved}
          passed={list.passed}
          top={list.top}
          picked={list.picked}
        />
      </QSection>
    </PageContainer>
  );
}
