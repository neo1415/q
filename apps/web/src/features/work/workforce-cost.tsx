import type {
  WorkforceJobDetailDto,
  WorkforceOverviewDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

import { costRows, dollars, jobTitle } from "./workforce-view";

/**
 * Work's Cost tab (P7): what Q's work cost this month against the
 * person's limit, by specialist and by job. Numbers, not sentences; the
 * limit's behaviour stated once.
 */
export function WorkforceCost({
  overview,
  jobs,
}: {
  readonly overview: WorkforceOverviewDto;
  readonly jobs: readonly WorkforceJobDetailDto[];
}) {
  const rows = costRows(overview);
  const spent = Number(overview.spentUsd) || 0;
  const limit = overview.limitUsd === null ? null : Number(overview.limitUsd);
  const share =
    limit === null || limit <= 0 ? null : Math.min(100, (spent / limit) * 100);
  const limitWords =
    overview.limitUsd === null
      ? null
      : dollars(overview.limitUsd).replace(".00", "");
  const spending = jobs.filter((job) => Number(job.job.costUsd) > 0);

  return (
    <div className="flex flex-col gap-4" data-workforce-cost>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="cost-month"
          className="rounded-[16px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4.5 py-4"
        >
          <h2 id="cost-month" className="m-0 text-[13px] font-normal text-(--cq-text-secondary)">
            This month
          </h2>
          <p className="cq-numeric my-2 font-(family-name:--cq-font-editorial) text-[34px] leading-none font-medium">
            {dollars(overview.spentUsd)}
          </p>
          {share === null ? null : (
            <div
              role="meter"
              aria-label="Spent of your monthly limit"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share)}
              className="h-2 overflow-hidden rounded-[4px] bg-(--cq-surface-subtle)"
            >
              <div
                className={cx(
                  "h-full rounded-[4px]",
                  overview.paused ? "bg-(--cq-warning)" : "bg-(--cq-accent)",
                )}
                style={{ width: `${String(share)}%` }}
              />
            </div>
          )}
          <p className="mt-2 mb-0 text-[13px] text-(--cq-text-secondary)">
            {limitWords === null
              ? "No monthly limit is set for Q’s work."
              : overview.paused
                ? `Your ${limitWords} limit is reached: Q starts no new work this month until you raise it.`
                : `of your ${limitWords} limit. Q pauses new work and asks you at ${limitWords}.`}
          </p>
        </section>
        <section
          aria-labelledby="cost-role"
          className="rounded-[16px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4.5 py-4"
        >
          <h2 id="cost-role" className="mt-0 mb-2.5 text-[15px] font-semibold">
            By specialist
          </h2>
          {rows.length === 0 ? (
            <p className="cq-body-sm m-0 text-(--cq-text-secondary)">
              Nothing spent yet this month.
            </p>
          ) : (
            <table className="w-full border-collapse text-[14px]">
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <th scope="row" className="w-[120px] py-1.5 text-left font-normal lg:w-[140px]">
                      {row.name}
                    </th>
                    <td className="py-1.5 align-middle">
                      <div className="h-2 rounded-[4px] bg-(--cq-surface-subtle)">
                        <div
                          className="h-full rounded-[4px] bg-(--cq-text-primary)"
                          style={{ width: `${String(row.share)}%` }}
                        />
                      </div>
                    </td>
                    <td className="cq-numeric w-16 py-1.5 text-right">{dollars(row.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {spending.length === 0 ? null : (
        <section
          aria-labelledby="cost-job"
          className="rounded-[16px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4.5 py-4"
        >
          <h2 id="cost-job" className="mt-0 mb-1 text-[15px] font-semibold">
            By job
          </h2>
          <ul className="m-0 list-none p-0">
            {spending.map((job) => (
              <li
                key={job.job.id}
                className="flex justify-between gap-3 border-t border-(--cq-border-subtle) py-3 text-[14px] first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="block truncate">{jobTitle(job.job.goal)}</span>
                  <span className="text-[13px] text-(--cq-text-secondary)">
                    {dollars(job.job.budgetUsd)} budget
                  </span>
                </span>
                <span className="cq-numeric">{dollars(job.job.costUsd)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
