import type { InvestorViewingDto } from "@capital-q/contracts";
import { PageSection } from "@/components/app-shell/page-container";

type T = (text: string) => string;

const LIST =
  "divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)";
const ROW = "flex flex-col gap-1 py-3";
const MAIN = "cq-body text-(--cq-text-primary)";
const NOTE = "cq-caption text-(--cq-text-secondary)";

function sliceWords(dimension: "STAGE" | "GEOGRAPHY", slice: string): string {
  if (slice === "UNKNOWN") return "Not stated";
  if (slice === "NOT_A_COMPANY") return "Not a company";
  if (dimension === "GEOGRAPHY") return slice;
  const words = slice.replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Who viewed the investor (owner live test 7 Nov 2026): aggregates only,
 * as the projection decided them (completed weeks, at least `floor` founder
 * organisations, slices of at least `sliceFloor` with complementary
 * suppression). No names, no times. Viewing is not interest and not
 * permission to contact (§6.7.14).
 */
export function InvestorViewers({
  data,
  t,
}: {
  readonly data: InvestorViewingDto;
  readonly t: T;
}) {
  const below = `${t("Fewer than")} ${String(data.floor)} ${t("founder organisations viewed your profile in a completed week.")}`;
  return (
    <PageSection
      id="who-viewed-you"
      title={t("Who viewed you")}
      description={t(
        "Founders who opened your firm's profile, by completed week. Shown together, never by name; viewing is not interest.",
      )}
    >
      <div className="flex flex-col gap-6" data-investor-viewers>
        {data.periods.length === 0 ? (
          <p className={NOTE}>{below}</p>
        ) : (
          <ul className={LIST}>
            {data.periods.map((week) => (
              <li key={week.periodStart} className={ROW}>
                <span className={MAIN}>
                  {t("Week of")} {week.periodStart}
                </span>
                <span className={NOTE}>
                  {String(week.organisations)} {t("founder organisations")} ·{" "}
                  {String(week.profileViews)} {t("profile views")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.slices.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <h3 className="cq-label text-(--cq-text-primary)">
              {t("By stage and country")}
            </h3>
            <p className={NOTE}>
              {t("Groups under")} {String(data.sliceFloor)}{" "}
              {t("organisations are combined so no one can be singled out.")}
            </p>
            <ul className={LIST}>
              {data.slices.map((slice) => (
                <li key={`${slice.dimension}-${slice.slice}`} className={ROW}>
                  <span className={MAIN}>
                    {slice.suppressed
                      ? t("Others")
                      : t(sliceWords(slice.dimension, slice.slice))}
                  </span>
                  <span className={NOTE}>
                    {slice.suppressed
                      ? t("Too few to show")
                      : `${String(slice.organisations ?? 0)} ${t("organisations")}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PageSection>
  );
}
