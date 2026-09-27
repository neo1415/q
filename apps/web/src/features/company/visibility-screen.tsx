"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type {
  CompanyDto,
  CompanyNetworkPreview,
  MarketplaceReadinessAssessment,
} from "@capital-q/contracts";
import { Badge } from "@capital-q/ui/badge";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { Eye, ICON_SIZE, ICON_STROKE, Lock } from "@capital-q/ui/icons";
import { InlineNotice, Skeleton } from "@capital-q/ui/states";

import { VisibilityCentre } from "./visibility-centre";
import {
  assessMarketplaceReadinessAction,
  loadVisibilityOverviewAction,
  setCompanyVisibilityAction,
} from "./visibility-actions";

/**
 * Visibility & Discovery (CQ-PRE-REC-001 §31-§36).
 *
 * The one place a founder sees who can see what, and decides whether the
 * declared company profile is visible to investors across the network.
 * Every sentence here is derived from the company row and the network
 * projection the API returns; nothing is inferred from onboarding
 * completeness, and finishing onboarding never flips a switch. The preview
 * is the same projection Q serves an investor, so what is shown is what
 * would be seen.
 */

export type VisibilityScreenProps = {
  readonly companyId: string;
};

type Loaded = {
  readonly company: CompanyDto;
  readonly preview: CompanyNetworkPreview;
  readonly readiness: MarketplaceReadinessAssessment | null;
};

export function VisibilityScreen({ companyId }: VisibilityScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadVisibilityOverviewAction(companyId);
    if (result.ok) {
      setLoaded(result.value);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    void loadVisibilityOverviewAction(companyId).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setLoaded(result.value);
        setError(null);
      } else {
        setError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const choose = async (
    visibility: "organisation_private" | "network_visible",
  ) => {
    if (loaded === null) {
      return;
    }
    setBusy(true);
    setSaved(null);
    try {
      const result = await setCompanyVisibilityAction(
        companyId,
        visibility,
        loaded.company.version,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(
        visibility === "network_visible"
          ? "Your company profile is now visible to investors on the Capital Q network."
          : "Your company profile is private to your organisation again.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (error !== null && loaded === null) {
    return (
      <InlineNotice tone="danger" title="Visibility couldn't load">
        {error}
      </InlineNotice>
    );
  }
  if (loaded === null) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading visibility"
        className="flex flex-col gap-4"
      >
        <Skeleton lines={1} className="w-1/2" />
        <Skeleton lines={4} />
      </div>
    );
  }

  const { company, preview, readiness } = loaded;
  const visible = preview.networkVisible;
  const ready = company.marketplaceReadinessState === "marketplace_ready";
  const outstanding =
    readiness?.requirements.filter((r) => r.outcome === "OUTSTANDING") ?? [];

  const checkReadiness = async () => {
    setBusy(true);
    setSaved(null);
    try {
      const result = await assessMarketplaceReadinessAction(companyId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(
        result.value.state === "marketplace_ready"
          ? "Your company meets the requirements for investor recommendations."
          : "Readiness checked. What remains is listed below.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-10" data-visibility-screen>
      {saved !== null ? (
        <InlineNotice tone="positive" title="Saved">
          {saved}
        </InlineNotice>
      ) : null}
      {error !== null ? (
        <InlineNotice tone="danger" title="That didn't go through">
          {error}
        </InlineNotice>
      ) : null}

      {/*
        The state is a dossier panel: the scope it is in, what that means,
        and the one action that changes it. The scope indicator and the
        words carry the meaning; the panel has no wash and no gradient.
      */}
      <section
        aria-labelledby="visibility-status"
        className="cq-panel max-w-(--cq-layout-reading)"
        data-visible={visible ? "true" : "false"}
      >
        <header className="cq-panel-header flex-wrap">
          <h2
            id="visibility-status"
            className="cq-title-md text-(--cq-text-primary)"
          >
            {visible
              ? "Visible to investors on the network"
              : "Private to your organisation"}
          </h2>
          <ContextIndicator
            scope={visible ? "network_visible" : "organisation_private"}
          />
        </header>
        <div className="cq-panel-body flex flex-col gap-4">
          <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
            {visible
              ? "Investors on Capital Q can find your company by name and read the profile below. Everything else you have shared with Q stays private."
              : "Only people in your organisation can see your company. Investors cannot find it, and Q will not mention it to them."}
          </p>
          <p className="cq-status-line">
            {visible ? (
              <Eye
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            ) : (
              <Lock
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            )}
            {visible
              ? "Investors see the profile previewed below, nothing more."
              : "Investors see nothing until you choose otherwise."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {visible ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void choose("organisation_private")}
              >
                Make private again
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void choose("network_visible")}
              >
                Make visible to investors
              </Button>
            )}
            <span className="cq-status-line">
              Finishing setup never changes this on its own. You decide.
            </span>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="visibility-discovery"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <h2
            id="visibility-discovery"
            className="cq-title-md text-(--cq-text-primary)"
          >
            Discovery status
          </h2>
          <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
            {visible
              ? "Discoverable to investors: they can look your company up and ask Q about it."
              : "Not discoverable yet: investors cannot find your company until you make it visible."}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="cq-label text-(--cq-text-primary)">
            Investor recommendations
          </h3>
          <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
            {ready
              ? "Your company meets the requirements and can be included in investor recommendations. Being visible and being recommended are separate: both are needed."
              : "Not in investor recommendations yet. Being visible does not change that on its own; the requirements below decide it."}
          </p>
        </div>
        {readiness === null ? (
          <p className="cq-status-line">
            Readiness couldn&apos;t load. Try again in a moment.
          </p>
        ) : (
          <ul
            className="flex max-w-(--cq-layout-reading) flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)"
            data-marketplace-requirements
          >
            {readiness.requirements
              .filter((r) => r.outcome !== "NOT_APPLICABLE")
              .map((r) => (
                <li
                  key={r.requirement}
                  className="cq-body-sm flex items-start gap-3 py-3 text-(--cq-text-secondary)"
                  data-outcome={r.outcome}
                >
                  {/* The status word in a fixed column, in words as well as
                      tone; the readiness of a requirement is never a colour. */}
                  <span className="w-14 shrink-0" aria-hidden="true">
                    <Badge tone="neutral">
                      {r.outcome === "SATISFIED" ? "Done" : "Next"}
                    </Badge>
                  </span>
                  <span>
                    <span className="sr-only">
                      {r.outcome === "SATISFIED" ? "Done: " : "Still needed: "}
                    </span>
                    {r.description}
                  </span>
                </li>
              ))}
          </ul>
        )}
        {readiness !== null && !readiness.verificationAvailable ? (
          <p className="cq-status-line max-w-(--cq-layout-reading) items-start">
            <span>
              Identity and organisation verification are not yet available on
              Capital Q, so no company is in investor recommendations today.
              Nothing here calls your company verified when it isn&apos;t.
            </span>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void checkReadiness()}
          >
            {outstanding.length === 0 && ready
              ? "Check readiness again"
              : "Check readiness"}
          </Button>
        </div>
      </section>

      {/*
        The visibility control centre (CQ-BIZ-003): who can see each
        thing, the shares with named investors, and the company previewed
        as each audience, all from the server.
      */}
      <VisibilityCentre
        companyId={companyId}
        refreshKey={String(company.version)}
      />

      <section aria-label="Related" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* The pitch video is part of what investors see; it has its own
              flow (CQ-MEDIA), founder-only. */}
          <Link href="/pitch" className={buttonClassName("secondary")}>
            Your pitch video
          </Link>
          {/* Capital Q verifies; the founder asks (CQ-VERIFY-001). */}
          <Link href="/verification" className={buttonClassName("secondary")}>
            Verification
          </Link>
          {/* Changes are asked of Q in one's own words and approved (ADR 0011). */}
          <Link href="/home" className={buttonClassName("quiet")}>
            Ask Q to change it
          </Link>
        </div>
      </section>
    </div>
  );
}

/**
 * No company yet: one sentence and the way in, without a dashed frame
 * around an absence (design/visual-direction.md, "No dashboards").
 */
export function VisibilityUnavailable() {
  return (
    <section
      aria-label="No company to show yet."
      className="flex max-w-(--cq-layout-reading) flex-col gap-3"
      data-state="empty"
    >
      <p className="cq-body text-(--cq-text-primary)">
        No company to show yet.
      </p>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Set up as a founder first. Until then there is nothing investors could
        see.
      </p>
      <div className="pt-1">
        <Link
          href="/onboarding/founder"
          className={buttonClassName("secondary")}
        >
          Set up as a founder
        </Link>
      </div>
    </section>
  );
}
