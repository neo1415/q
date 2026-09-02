import type { ReactNode } from "react";

import { ChevronRight, ICON_SIZE, ICON_STROKE } from "../icons/index.js";
import { cx } from "../primitives/class-names.js";
import { EmptyState, Skeleton } from "../components/states.js";

/**
 * "What should I do next" as a short, divided list -- not a card grid and
 * not a feed. Three states; the data behind it belongs to the domains that
 * will produce priorities, not to this component.
 */

export type PriorityItem = {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly meta?: string | undefined;
  readonly href?: string | undefined;
};

export type PriorityListProps =
  | { readonly state: "loading"; readonly className?: string | undefined }
  | {
      readonly state: "empty";
      readonly title?: string | undefined;
      readonly description?: string | undefined;
      readonly action?: ReactNode | undefined;
      readonly className?: string | undefined;
    }
  | {
      readonly state: "content";
      readonly items: readonly PriorityItem[];
      /** Renders a navigable row; the application supplies its own Link. */
      readonly renderLink: (
        item: PriorityItem,
        children: ReactNode,
        className: string,
      ) => ReactNode;
      readonly className?: string | undefined;
    };

const rowClass =
  "flex min-h-14 items-center gap-3 px-1 py-3 text-(--cq-text-primary) transition-colors duration-(--cq-motion-fast)";

export function PriorityList(props: PriorityListProps) {
  if (props.state === "loading") {
    return (
      <div
        aria-busy="true"
        aria-label="Loading priorities"
        className={cx(
          "flex flex-col divide-y divide-(--cq-border-subtle)",
          props.className,
        )}
      >
        {[0, 1, 2].map((index) => (
          <div key={index} className="py-3">
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
    );
  }

  if (props.state === "empty") {
    return (
      <EmptyState
        compact
        title={props.title ?? "Nothing needs your attention yet."}
        description={
          props.description ??
          "Q lists what matters once it knows what you're raising, deploying or building."
        }
        action={props.action}
        className={props.className}
      />
    );
  }

  return (
    <ol
      className={cx(
        "flex flex-col divide-y divide-(--cq-border-subtle)",
        props.className,
      )}
    >
      {props.items.map((item) => {
        const body = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="cq-body font-medium">{item.title}</span>
              {item.description !== undefined ? (
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  {item.description}
                </span>
              ) : null}
              {item.meta !== undefined ? (
                <span className="cq-caption text-(--cq-text-tertiary)">
                  {item.meta}
                </span>
              ) : null}
            </span>
            {item.href !== undefined ? (
              <ChevronRight
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
                className="shrink-0 text-(--cq-text-tertiary)"
              />
            ) : null}
          </>
        );
        return (
          <li key={item.id}>
            {item.href !== undefined ? (
              props.renderLink(
                item,
                body,
                cx(rowClass, "hover:bg-(--cq-surface-subtle)"),
              )
            ) : (
              <div className={rowClass}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
