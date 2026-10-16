import { dealDay } from "./deal-stage-strip";
import type { Decision } from "./decision";

/**
 * The decision on a relationship record (CRM S5): the latest one first,
 * dated, with why and the money in words, then earlier decisions as one
 * quiet line. No badge, no colour carrying meaning.
 */
export function DecisionRecord({ decision }: { readonly decision: Decision }) {
  return (
    <div className="flex flex-col gap-2" data-decision={decision.state}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-(--cq-text-primary)">
        <span className="cq-body font-semibold">{decision.title}</span>
        <time
          dateTime={decision.at}
          className="cq-body-sm cq-numeric text-(--cq-text-secondary)"
        >
          {dealDay(decision.at)}
        </time>
      </p>
      {decision.details.length === 0 ? null : (
        <ul className="cq-body-sm flex max-w-(--cq-layout-reading) flex-col gap-1 border-s-2 border-(--cq-border) ps-3 text-(--cq-text-secondary)">
          {decision.details.map((line) => (
            <li key={line} className="whitespace-pre-wrap">
              {line}
            </li>
          ))}
        </ul>
      )}
      {decision.earlier.length === 0 ? null : (
        <p className="cq-caption text-(--cq-text-tertiary)">
          Earlier:{" "}
          {decision.earlier
            .map((entry) => `${entry.title} ${dealDay(entry.at)}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}
