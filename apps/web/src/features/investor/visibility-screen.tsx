"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type {
  InvestorNetworkPreview,
  InvestorOrganisationDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { Eye, ICON_SIZE, ICON_STROKE, Lock } from "@capital-q/ui/icons";
import { InlineNotice, Skeleton } from "@capital-q/ui/states";

import {
  loadInvestorVisibilityAction,
  setInvestorVisibilityAction,
} from "./visibility-actions";

/**
 * Visibility & Discovery, investor side.
 *
 * The mirror of the founder's screen: who can see the declared investor
 * profile, exactly what they would see, and one switch to change it. The
 * preview is the projection the API returns, so what is shown is what
 * would be seen — the mandate, the portfolio and anything observed are
 * deliberately absent from it and from this screen.
 */

export type InvestorVisibilityScreenProps = {
  readonly investorOrganisationId: string;
};

type Loaded = {
  readonly investor: InvestorOrganisationDto;
  readonly preview: InvestorNetworkPreview;
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  ANGEL: "Angel",
  VC: "Venture fund",
  FAMILY_OFFICE: "Family office",
  CVC: "Corporate venture",
  SYNDICATE: "Syndicate",
  ACCELERATOR: "Accelerator",
  SCOUT: "Scout",
  INSTITUTIONAL: "Institutional",
  OTHER: "Investor",
};

function typeLabel(code: string): string {
  return TYPE_LABELS[code] ?? code.replace(/_/g, " ").toLowerCase();
}

const DEPLOYMENT_LABELS: Readonly<Record<string, string>> = {
  ACTIVELY_INVESTING: "Actively investing",
  SELECTIVE: "Investing selectively",
  PAUSED: "Paused",
  EXPLORING_ONLY: "Exploring only",
};

function deploymentLabel(state: string | null): string | null {
  return state === null
    ? null
    : (DEPLOYMENT_LABELS[state] ?? state.replace(/_/g, " ").toLowerCase());
}

export function InvestorVisibilityScreen({
  investorOrganisationId,
}: InvestorVisibilityScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadInvestorVisibilityAction(investorOrganisationId);
    if (result.ok) {
      setLoaded(result.value);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [investorOrganisationId]);

  useEffect(() => {
    let cancelled = false;
    void loadInvestorVisibilityAction(investorOrganisationId).then((result) => {
      if (cancelled) return;
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
  }, [investorOrganisationId]);

  const choose = async (
    visibility: "organisation_private" | "network_visible",
  ) => {
    if (loaded === null) return;
    setBusy(true);
    setSaved(null);
    try {
      const result = await setInvestorVisibilityAction(
        investorOrganisationId,
        visibility,
        loaded.investor.version,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(
        visibility === "network_visible"
          ? "Founders on Capital Q can now find your profile."
          : "Your profile is private to your organisation again.",
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

  const { investor, preview } = loaded;
  const visible = preview.networkVisible;

  return (
    <div className="flex flex-col gap-10" data-investor-visibility-screen>
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
        words carry the meaning; no wash, no gradient.
      */}
      <section
        aria-labelledby="investor-visibility-status"
        className="cq-panel max-w-(--cq-layout-reading)"
        data-visible={visible ? "true" : "false"}
      >
        <header className="cq-panel-header">
          <h2
            id="investor-visibility-status"
            className="cq-title-md text-(--cq-text-primary)"
          >
            {visible ? "Founders can find you" : "Private to your organisation"}
          </h2>
          <ContextIndicator
            scope={visible ? "network_visible" : "organisation_private"}
          />
        </header>
        <div className="cq-panel-body flex flex-col gap-4">
          <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
            {visible
              ? "Founders on Capital Q can find your profile and ask Q about you. Your mandate, portfolio and everything you have told Q stay private."
              : "Only people in your organisation can see this profile. Founders cannot find you, and Q will not mention you to them."}
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
              ? "Founders see the profile previewed below, nothing more."
              : "Founders see nothing until you choose otherwise."}
          </p>
          <div className="flex flex-wrap gap-2">
            {visible ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void choose("organisation_private")}
              >
                Make private
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void choose("network_visible")}
              >
                Let founders find me
              </Button>
            )}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="investor-preview"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="investor-preview"
            className="cq-title-md text-(--cq-text-primary)"
          >
            What founders will see
          </h2>
          <p className="cq-body-sm max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
            This is the whole profile. Your mandate, cheque size, portfolio and
            anything you have discussed with Q are not part of it.
          </p>
        </div>
        <dl className="cq-panel cq-panel-rows max-w-(--cq-layout-reading)">
          <PreviewRow label="Investor" value={preview.displayName} />
          <PreviewRow label="Type" value={typeLabel(preview.investorType)} />
          <PreviewRow label="Website" value={preview.websiteUrl} />
          <PreviewRow label="Based in" value={preview.hqCountry} />
          <PreviewRow
            label="Deploying"
            value={deploymentLabel(preview.deploymentState)}
          />
          <PreviewRow label="In short" value={preview.publicDescription} />
        </dl>
        <div>
          <Link
            href="/onboarding/investor?review=1"
            className={buttonClassName("quiet", "compact")}
          >
            Change what the profile says
          </Link>
        </div>
      </section>

      <p className="cq-status-line">
        Profile version{" "}
        <span className="cq-numeric">{String(investor.version)}</span>. Changing
        visibility is recorded; nothing else about you is shared by it.
      </p>
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
    <div className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:gap-4">
      <dt className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-32">
        {label}
      </dt>
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

/**
 * No investor profile yet: one sentence and the way in, without a dashed
 * frame around an absence.
 */
export function InvestorVisibilityUnavailable() {
  return (
    <section
      aria-label="No investor profile to show yet."
      className="flex max-w-(--cq-layout-reading) flex-col gap-3"
      data-state="empty"
    >
      <p className="cq-body text-(--cq-text-primary)">
        No investor profile to show yet.
      </p>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Set up your mandate first. Until then there is nothing founders could
        see.
      </p>
      <div className="pt-1">
        <Link
          href="/onboarding/investor"
          className={buttonClassName("secondary")}
        >
          Set up your mandate
        </Link>
      </div>
    </section>
  );
}
