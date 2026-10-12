import {
  FIT_CONTEXT_SOURCE_LABELS,
  type FitParameterContext,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

/**
 * What is known beside a fit row (2026-10-12, Tensorgate): the values
 * themselves, prominent, each with its source in small text ("From pitch",
 * "From deck", "Your mandate"), then what is still open on its own line,
 * so an unknown conclusion never reads as an unknown value. Shared by the
 * profile's fit panel and the "See why" breakdown. Display only: the fit
 * scores none of it.
 */
export function FitContextValues({
  context,
  className,
}: {
  readonly context: FitParameterContext;
  readonly className?: string | undefined;
}) {
  return (
    <div className={cx("flex flex-col gap-1", className)} data-fit-context>
      {context.items.length === 0 ? null : (
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
          {context.items.map((item) => (
            <li
              key={`${item.label}-${item.source}-${item.value}`}
              className="flex flex-col"
              data-fit-context-source={item.source}
            >
              <span className="text-sm font-medium text-(--cq-text-primary)">
                {item.value}
              </span>
              <span className="cq-caption text-(--cq-text-tertiary)">
                {item.label} · {FIT_CONTEXT_SOURCE_LABELS[item.source]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {context.open === null ? null : (
        <p
          className="cq-caption text-(--cq-text-secondary)"
          data-fit-context-open
        >
          {context.open}
        </p>
      )}
    </div>
  );
}
