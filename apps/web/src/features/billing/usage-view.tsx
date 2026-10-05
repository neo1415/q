import type { QUsageDto } from "@capital-q/contracts";

import { RowLink } from "@/features/settings/settings-ui";

import { dollars, taskName, total } from "./usage-words";

type Purpose = QUsageDto["byTask"][number]["purpose"];

/**
 * Settings → Usage (design-48; P5 redesign): the month's figure and what
 * three headline kinds of work cost, as cards, where the money went as a simple bar chart, then
 * the breakdown and the standing instructions against their own limits.
 *
 * Failed and unpriced calls are not shown here (lead decision: they belong
 * to the admin cost view), and neither are model-call counts: a call is
 * not a unit a person recognises. A purpose with nothing recorded says
 * "None yet", and voice minutes, which are not measured, are never shown
 * as a number.
 */
export function UsageView({ usage }: { readonly usage: QUsageDto }) {
  const rows = usage.byTask
    .filter((row) => Number(row.usd) > 0)
    .toSorted((a, b) => Number(b.usd) - Number(a.usd));
  const totalUsd = Number(usage.totalUsd);
  const largest = Math.max(...rows.map((row) => Number(row.usd)), 0);
  const of = (purpose: Purpose) =>
    usage.byTask.find((row) => row.purpose === purpose) ?? null;
  const budgets = usage.instructions.filter(
    (row) => row.budgetUsdMonth !== null,
  );
  const budgetUsd = budgets.reduce(
    (sum, row) => sum + Number(row.budgetUsdMonth),
    0,
  );
  const budgetUsed = budgets.reduce((sum, row) => sum + Number(row.usd), 0);
  const nothing = rows.length === 0 && usage.instructions.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <ul
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label="This month"
      >
        <li className="cq-panel col-span-2 flex min-h-28 flex-col gap-1.5 p-4 lg:col-span-1">
          <span className="cq-label text-(--cq-text-secondary)">
            Q this month
          </span>
          <p className="flex items-baseline gap-1.5" data-usage-total>
            <span className="cq-numeric text-3xl font-semibold tracking-tight text-(--cq-text-primary)">
              {total(usage.totalUsd)}
            </span>
            <span className="cq-body-sm text-(--cq-text-secondary)">USD</span>
            <span className="sr-only">, not charged</span>
          </p>
          {budgets.length === 0 ? (
            <span className="cq-caption text-(--cq-text-tertiary)">
              Approximate · not charged
            </span>
          ) : (
            <>
              <Meter
                label="Standing instruction budgets used"
                value={budgetUsd === 0 ? 0 : (budgetUsed / budgetUsd) * 100}
              />
              <span className="cq-caption text-(--cq-text-tertiary)">
                {dollars(String(budgetUsed))} of {dollars(String(budgetUsd))} in
                instruction budgets
              </span>
            </>
          )}
        </li>
        <Tile
          label="Conversations"
          row={of("CONVERSATION")}
          totalUsd={totalUsd}
        />
        <Tile
          label="Live voice"
          row={of("VOICE_REALTIME")}
          totalUsd={totalUsd}
          note="Minutes not measured yet"
        />
        <Tile label="Documents" row={of("DOCUMENT")} totalUsd={totalUsd} />
      </ul>

      {nothing ? (
        <div className="cq-panel flex flex-col items-start gap-1 p-5">
          <p className="cq-body text-(--cq-text-primary)">
            Nothing used yet this month.
          </p>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Ask Q something and it shows up here.
          </p>
        </div>
      ) : null}

      {rows.length === 0 ? null : (
        <section aria-labelledby="usage-where" className="cq-panel">
          <h2
            id="usage-where"
            className="cq-title-sm border-b border-(--cq-border-subtle) px-5 pt-4 pb-3 text-(--cq-text-primary)"
          >
            Where it went
          </h2>
          <ul className="flex flex-col gap-3 px-5 py-4">
            {rows.map((row) => (
              <li
                key={row.purpose}
                className="cq-body-sm grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[11rem_minmax(0,1fr)_4.5rem]"
              >
                <span className="text-(--cq-text-primary)">
                  {taskName(row.purpose)}
                </span>
                <span
                  aria-hidden="true"
                  className="col-span-2 row-start-2 h-2.5 overflow-hidden rounded-(--cq-radius-xs) bg-(--cq-surface-subtle) sm:col-span-1 sm:row-start-auto"
                >
                  <span
                    className="block h-full rounded-(--cq-radius-xs) bg-(--cq-accent)"
                    style={{
                      width: `${String(Math.max(2, (Number(row.usd) / largest) * 100))}%`,
                    }}
                  />
                </span>
                <span className="cq-numeric text-right text-(--cq-text-secondary)">
                  {dollars(row.usd)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length === 0 ? null : (
        <section
          aria-labelledby="usage-breakdown"
          className="cq-panel overflow-hidden"
        >
          <h2
            id="usage-breakdown"
            className="cq-title-sm border-b border-(--cq-border-subtle) px-5 pt-4 pb-3 text-(--cq-text-primary)"
          >
            Breakdown
          </h2>
          <div className="overflow-x-auto">
            <table className="cq-body-sm w-full border-collapse">
              <thead>
                <tr className="cq-caption text-left text-(--cq-text-secondary)">
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    Purpose
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-right font-medium"
                  >
                    Cost
                  </th>
                  <th
                    scope="col"
                    className="px-5 py-2.5 text-right font-medium"
                  >
                    Share
                  </th>
                </tr>
              </thead>
              <tbody className="cq-numeric">
                {rows.map((row) => (
                  <tr
                    key={row.purpose}
                    className="border-t border-(--cq-border-subtle)"
                  >
                    <th
                      scope="row"
                      className="px-5 py-3 text-left font-normal text-(--cq-text-primary)"
                    >
                      {taskName(row.purpose)}
                    </th>
                    <td className="px-3 py-3 text-right text-(--cq-text-primary)">
                      {dollars(row.usd)}
                    </td>
                    <td className="px-5 py-3 text-right text-(--cq-text-secondary)">
                      {totalUsd > 0
                        ? `${String(Math.round((Number(row.usd) / totalUsd) * 100))}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {usage.instructions.length === 0 ? null : (
        <section aria-labelledby="usage-instructions" className="cq-panel">
          <h2
            id="usage-instructions"
            className="cq-title-sm border-b border-(--cq-border-subtle) px-5 pt-4 pb-3 text-(--cq-text-primary)"
          >
            Standing instructions
          </h2>
          <dl className="cq-panel-rows">
            {usage.instructions.map((row) => (
              <div
                key={row.instructionId}
                className="flex min-h-12 items-center justify-between gap-6 px-5 py-2.5"
                data-usage-instruction
              >
                <dt className="cq-body line-clamp-1 min-w-0 text-(--cq-text-primary)">
                  {row.goal}
                </dt>
                <dd className="cq-body-sm cq-numeric shrink-0 text-(--cq-text-secondary)">
                  {dollars(row.usd)}
                  {row.budgetUsdMonth === null
                    ? " · no limit"
                    : ` of ${dollars(row.budgetUsdMonth)}`}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="cq-caption text-(--cq-text-tertiary)">
          Amounts are approximate and nothing here is charged.
        </p>
        <div className="flex gap-2">
          {usage.plan === null ? null : (
            <RowLink href="/settings/plan">Plan allowances</RowLink>
          )}
          <RowLink href="/settings/billing">Billing</RowLink>
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  row,
  totalUsd,
  note,
}: {
  readonly label: string;
  readonly row: QUsageDto["byTask"][number] | null;
  readonly totalUsd: number;
  readonly note?: string | undefined;
}) {
  const usd = row === null ? 0 : Number(row.usd);
  return (
    <li className="cq-panel flex min-h-28 flex-col gap-1.5 p-4">
      <span className="cq-label text-(--cq-text-secondary)">{label}</span>
      {row === null || usd <= 0 ? (
        <span className="cq-body pt-2 text-(--cq-text-secondary)">
          None yet
        </span>
      ) : (
        <span className="cq-numeric text-3xl font-semibold tracking-tight text-(--cq-text-primary)">
          {dollars(row.usd)}
        </span>
      )}
      <span className="cq-caption text-(--cq-text-tertiary)">
        {[
          usd > 0 && totalUsd > 0
            ? `${String(Math.round((usd / totalUsd) * 100))}% of the month`
            : null,
          note ?? null,
        ]
          .filter((part) => part !== null)
          .join(" · ") || "Nothing recorded this month"}
      </span>
    </li>
  );
}

function Meter({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className="mt-1 block h-1.5 overflow-hidden rounded-full bg-(--cq-surface-strong)"
    >
      <span
        className="block h-full rounded-full bg-(--cq-accent)"
        style={{ width: `${String(clamped)}%` }}
      />
    </span>
  );
}
