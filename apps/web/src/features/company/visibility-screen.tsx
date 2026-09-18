"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type {
  CompanyDto,
  CompanyNetworkPreview,
  MarketplaceReadinessAssessment,
} from "@capital-q/contracts";
import { COUNTRY_OPTIONS, STAGE_OPTIONS } from "@capital-q/founder-onboarding";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { EmptyState, InlineNotice, Skeleton } from "@capital-q/ui/states";

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

// The labels investors read come from the same definition the founder
// answered against, so a code never reaches the screen as a code.
const STAGE_LABELS: ReadonlyMap<string, string> = new Map(
  STAGE_OPTIONS.map((option) => [option.optionKey, option.label]),
);
const COUNTRY_LABELS: ReadonlyMap<string, string> = new Map(
  COUNTRY_OPTIONS.map((option) => [option.optionKey, option.label]),
);

function stageLabel(code: string | null): string | null {
  return code === null
    ? null
    : (STAGE_LABELS.get(code) ?? code.replace(/_/g, " "));
}

function countryLabel(code: string | null): string | null {
  return code === null
    ? null
    : (COUNTRY_LABELS.get(code.toLowerCase()) ?? code);
}

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
          ? "Your company meets the marketplace requirements."
          : "Readiness checked. What remains is listed below.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8" data-visibility-screen>
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

      <section
        aria-labelledby="visibility-status"
        className="flex flex-col gap-3"
      >
        <h2
          id="visibility-status"
          className="cq-title-md text-(--cq-text-primary)"
        >
          {visible
            ? "Visible to investors on the network"
            : "Private to your organisation"}
        </h2>
        <p className="cq-body max-w-(--cq-layout-narrow) text-(--cq-text-secondary)">
          {visible
            ? "Investors on Capital Q can find your company by name and read the profile below. Everything else you have shared with Q stays private."
            : "Only people in your organisation can see your company. Investors cannot find it, and Q will not mention it to them."}
        </p>
        <div className="flex flex-wrap gap-2">
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
              disabled={busy}
              onClick={() => void choose("network_visible")}
            >
              Make visible to investors
            </Button>
          )}
        </div>
        <p className="cq-caption text-(--cq-text-tertiary)">
          Finishing setup never changes this on its own. You decide.
        </p>
      </section>

      <section
        aria-labelledby="visibility-summary"
        className="flex flex-col gap-3"
      >
        <h2
          id="visibility-summary"
          className="cq-title-md text-(--cq-text-primary)"
        >
          Who can see what
        </h2>
        <dl className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
          <div className="flex flex-col gap-1 py-3">
            <dt className="cq-label text-(--cq-text-primary)">
              Private to you and your organisation
            </dt>
            <dd className="cq-body-sm text-(--cq-text-secondary)">
              Your setup answers, uploaded documents, what Q read from them,
              your conversations with Q, and your capital objective. None of
              this is visible to investors, whatever you choose below.
            </dd>
          </div>
          <div className="flex flex-col gap-1 py-3">
            <dt className="cq-label text-(--cq-text-primary)">
              Visible to investors{" "}
              {visible ? "now" : "once you choose to publish"}
            </dt>
            <dd className="cq-body-sm text-(--cq-text-secondary)">
              The company profile as previewed here: name, website, where you
              are based, stage, founding date, status and your descriptions.
            </dd>
          </div>
          <div className="flex flex-col gap-1 py-3">
            <dt className="cq-label text-(--cq-text-primary)">
              Shared with a specific investor
            </dt>
            <dd className="cq-body-sm text-(--cq-text-secondary)">
              Not available yet. Sharing documents with one investor arrives
              with relationships and the data room; nothing is shared that way
              today.
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="visibility-discovery"
        className="flex flex-col gap-3"
      >
        <h2
          id="visibility-discovery"
          className="cq-title-md text-(--cq-text-primary)"
        >
          Discovery status
        </h2>
        <p className="cq-body max-w-(--cq-layout-narrow) text-(--cq-text-secondary)">
          {visible
            ? "Discoverable to investors: they can look your company up and ask Q about it."
            : "Not discoverable yet: investors cannot find your company until you make it visible."}
        </p>
        <h3 className="cq-label text-(--cq-text-primary)">
          Investor recommendations
        </h3>
        <p className="cq-body max-w-(--cq-layout-narrow) text-(--cq-text-secondary)">
          {ready
            ? "Your company meets the marketplace requirements and can be included in investor recommendations. Being visible and being recommended are separate: both are needed."
            : "Not in investor recommendations yet. Being visible does not change that on its own; the marketplace requirements below decide it."}
        </p>
        {readiness === null ? (
          <p className="cq-caption text-(--cq-text-tertiary)">
            Readiness couldn&apos;t be read just now.
          </p>
        ) : (
          <ul
            className="flex max-w-(--cq-layout-narrow) flex-col gap-2"
            data-marketplace-requirements
          >
            {readiness.requirements
              .filter((r) => r.outcome !== "NOT_APPLICABLE")
              .map((r) => (
                <li
                  key={r.requirement}
                  className="cq-body-sm flex gap-2 text-(--cq-text-secondary)"
                  data-outcome={r.outcome}
                >
                  <span
                    aria-hidden="true"
                    className="cq-caption mt-0.5 w-5 shrink-0 text-(--cq-text-tertiary)"
                  >
                    {r.outcome === "SATISFIED" ? "Done" : "Next"}
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
          <p className="cq-caption max-w-(--cq-layout-narrow) text-(--cq-text-tertiary)">
            Identity and organisation verification are not yet available on
            Capital Q, so no company is in investor recommendations today.
            Nothing here calls your company verified when it isn&apos;t.
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

      <section
        aria-labelledby="visibility-preview"
        className="flex flex-col gap-3"
      >
        <h2
          id="visibility-preview"
          className="cq-title-md text-(--cq-text-primary)"
        >
          What investors will see
        </h2>
        <p className="cq-caption text-(--cq-text-tertiary)">
          This is the exact profile Q gives an investor who asks about your
          company{visible ? "." : " once it is visible."}
        </p>
        <dl
          className="flex flex-col gap-2 rounded-lg border border-(--cq-border-subtle) p-4"
          data-network-preview
        >
          <PreviewRow label="Company" value={preview.canonicalName} />
          <PreviewRow label="Legal name" value={preview.legalName} />
          <PreviewRow label="Website" value={preview.websiteUrl} />
          <PreviewRow
            label="Based in"
            value={
              [
                preview.headquartersCity,
                countryLabel(preview.headquartersCountry),
              ]
                .filter((part): part is string => part !== null)
                .join(", ") || null
            }
          />
          <PreviewRow
            label="Stage"
            value={stageLabel(preview.currentStageCode)}
          />
          <PreviewRow label="Founded" value={preview.foundedDate} />
          <PreviewRow label="In short" value={preview.shortDescription} />
          <PreviewRow label="Description" value={preview.primaryDescription} />
        </dl>
        <div>
          {/* Changes are asked of Q in one's own words and approved (ADR 0011). */}
          <Link href="/home" className={buttonClassName("quiet", "compact")}>
            Ask Q to change it
          </Link>
        </div>
      </section>
    </div>
  );
}

function PreviewRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="cq-caption text-(--cq-text-tertiary)">{label}</dt>
      <dd className="cq-body text-(--cq-text-primary)">
        {value === null || value.length === 0 ? (
          <span className="text-(--cq-text-tertiary)">Not shared</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export function VisibilityUnavailable() {
  return (
    <EmptyState
      title="No company to show yet."
      description="Set up as a founder first. Until then there is nothing investors could see."
      action={
        <Link
          href="/onboarding/founder"
          className={buttonClassName("secondary")}
        >
          Set up as a founder
        </Link>
      }
    />
  );
}
