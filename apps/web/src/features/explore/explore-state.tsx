import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import {
  CircleAlert,
  ICON_SIZE,
  LayoutDashboard,
  RotateCw,
  Search,
  ShieldCheck,
} from "@capital-q/ui/icons";

import { searchHref } from "./explore-search-view";
import { FitGlyph } from "./fit-glyph";

/**
 * Explore's states, in plain words. No counts anywhere: the end of the
 * slate is said, not tallied.
 */
type Props =
  | {
      readonly kind: "error";
      readonly what: "Explore" | "Search";
      readonly retryHref?: string | undefined;
      readonly onRetry?: (() => void) | undefined;
    }
  | {
      readonly kind: "empty";
      readonly onShowEverything?: (() => void) | undefined;
    }
  | {
      readonly kind: "no-results";
      readonly query: string;
      readonly suggestions: readonly string[];
    };

function Block({
  icon,
  title,
  body,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly body: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <div
      className="flex max-w-[520px] flex-col items-start gap-3 py-7"
      role="status"
    >
      <span className="grid size-11 place-items-center rounded-xl bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
        {icon}
      </span>
      <h2 className="cq-title-sm">{title}</h2>
      <p className="cq-body-sm text-(--cq-text-secondary)">{body}</p>
      {children === undefined ? null : (
        <div className="flex flex-wrap gap-2">{children}</div>
      )}
    </div>
  );
}

export function ExploreState(props: Props) {
  if (props.kind === "error") {
    return (
      <Block
        icon={<CircleAlert size={ICON_SIZE.prominent} aria-hidden="true" />}
        title={`${props.what} didn't load`}
        body="The connection dropped before it finished. Nothing you did was lost."
      >
        {props.onRetry !== undefined ? (
          <button
            type="button"
            className={buttonClassName("secondary")}
            onClick={props.onRetry}
          >
            <RotateCw size={ICON_SIZE.compact} aria-hidden="true" />
            Try again
          </button>
        ) : (
          <Link
            href={props.retryHref ?? "/explore"}
            className={buttonClassName("secondary")}
          >
            <RotateCw size={ICON_SIZE.compact} aria-hidden="true" />
            Try again
          </Link>
        )}
      </Block>
    );
  }
  if (props.kind === "empty") {
    return (
      <Block
        icon={<LayoutDashboard size={ICON_SIZE.prominent} aria-hidden="true" />}
        title="You're up to date"
        body="You've seen every new pitch that fits your mandate this week. Switch to Everything to see the whole network."
      >
        {props.onShowEverything === undefined ? null : (
          <button
            type="button"
            className={buttonClassName("primary")}
            onClick={props.onShowEverything}
          >
            Show everything
          </button>
        )}
      </Block>
    );
  }
  return (
    <Block
      icon={<Search size={ICON_SIZE.prominent} aria-hidden="true" />}
      title={`Nothing matches “${props.query}”`}
      body={
        props.suggestions.length === 0
          ? "No company, investor or pitch you can see fits. Try fewer words."
          : "No company, investor or pitch you can see fits all of it. Try removing one:"
      }
    >
      {props.suggestions.map((suggestion) => (
        <Link
          key={suggestion}
          href={searchHref(suggestion)}
          className="inline-flex min-h-9 items-center rounded-(--cq-radius-full) border border-(--cq-border) bg-(--cq-surface-raised) px-3.5 text-sm text-(--cq-text-secondary)"
        >
          {suggestion}
        </Link>
      ))}
    </Block>
  );
}

/** The end of the slate: said once, then a choice, never more scroll. */
export function ExploreEndNote({
  mode,
  onKeepBrowsing,
}: {
  readonly mode: "FOR_YOU" | "EVERYTHING";
  readonly onKeepBrowsing: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-2.5 pt-7 pb-2 text-center"
      data-explore-end
    >
      <FitGlyph kind="fit" className="size-4" />
      <p className="cq-title-sm">You&apos;re up to date</p>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {mode === "FOR_YOU"
          ? "That's every new pitch for your mandate. The rest of the network is under Everything."
          : "That's every pitch on the network you can see right now."}
      </p>
      {mode === "FOR_YOU" ? (
        <button
          type="button"
          className={buttonClassName("secondary")}
          onClick={onKeepBrowsing}
        >
          Keep browsing
        </button>
      ) : null}
    </div>
  );
}

/** Some pitches are shared with verified investors only. */
export function ExploreLimitedBanner({
  organisationName,
  verifyHref = "/verification",
}: {
  readonly organisationName: string;
  readonly verifyHref?: string;
}) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-3.5 py-3 text-sm text-(--cq-text-secondary)"
      data-explore-limited
    >
      <ShieldCheck
        size={ICON_SIZE.compact}
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      />
      <span>
        You&apos;re seeing pitches open to everyone. Verify {organisationName}{" "}
        to see the ones founders share with verified investors only.{" "}
        <Link href={verifyHref} className="underline">
          Verify now
        </Link>
      </span>
    </div>
  );
}
