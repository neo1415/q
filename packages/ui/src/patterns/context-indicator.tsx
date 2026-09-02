import type { ComponentType } from "react";

import {
  Building2,
  Eye,
  Globe,
  ICON_SIZE,
  ICON_STROKE,
  Lock,
  Users,
} from "../icons/index.js";
import { cx } from "../primitives/class-names.js";
import type { ContextScope } from "../tokens/index.js";

/**
 * Compact indicator of the visibility context a surface is operating in
 * (ADR-001 scopes). Presentation only: it renders whatever scope the caller
 * has already resolved server-side and asserts nothing itself. With no
 * authoritative context it says so, rather than inventing one.
 */

type ScopePresentation = {
  readonly label: string;
  readonly Icon: ComponentType<{
    readonly size?: number;
    readonly strokeWidth?: number;
    readonly className?: string;
    readonly "aria-hidden"?: boolean | "true";
  }>;
};

const presentation: Record<ContextScope, ScopePresentation> = {
  personal_private: { label: "Private to you", Icon: Lock },
  organisation_private: { label: "Private to organisation", Icon: Building2 },
  founder_private: { label: "Founder private", Icon: Lock },
  investor_private: { label: "Investor private", Icon: Lock },
  relationship_shared: { label: "Relationship shared", Icon: Users },
  specifically_shared: { label: "Shared with specific parties", Icon: Users },
  network_visible: { label: "Network visible", Icon: Eye },
  public_external: { label: "Public", Icon: Globe },
  unset: { label: "No context set", Icon: Building2 },
};

export type ContextIndicatorProps = {
  readonly scope: ContextScope;
  /** Optional trailing detail, e.g. an organisation name. */
  readonly detail?: string | undefined;
  readonly className?: string | undefined;
};

export function ContextIndicator({
  scope,
  detail,
  className,
}: ContextIndicatorProps) {
  const { label, Icon } = presentation[scope];
  return (
    <span
      data-scope={scope}
      className={cx(
        "inline-flex min-h-8 min-w-0 max-w-full shrink items-center gap-1.5 overflow-hidden rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-2.5 cq-caption font-medium text-(--cq-text-secondary)",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
        className="shrink-0"
      />
      <span className="truncate">
        {label}
        {detail !== undefined ? (
          <span className="text-(--cq-text-tertiary)"> · {detail}</span>
        ) : null}
      </span>
    </span>
  );
}

export function contextScopeLabel(scope: ContextScope): string {
  return presentation[scope].label;
}
