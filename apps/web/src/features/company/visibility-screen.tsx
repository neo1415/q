"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { discoverabilityNotes } from "./discoverability";
import type {
  CompanyDto,
  CompanyNetworkPreview,
  MarketplaceReadinessAssessment,
  MarketplaceReadinessRequirement,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import { CircleHelp, Compass, Eye, Lock } from "@capital-q/ui/icons";
import { InlineNotice, Skeleton } from "@capital-q/ui/states";

import { Tick } from "@/features/investors/match-marks";
import {
  CrmSheet,
  CrmToastProvider,
  ProgressButton,
  QLine,
  crmButton,
  useCrmToast,
} from "@/features/relationships/crm-kit";

import { VisibilityCentre } from "./visibility-centre";
import {
  assessMarketplaceReadinessAction,
  loadVisibilityOverviewAction,
  setCompanyVisibilityAction,
  type VisibilityOverview,
} from "./visibility-actions";
import { useT } from "@/features/i18n/language";

/**
 * Visibility (CQ-PRE-REC-001 §31-§36; app prototype "visibility", option
 * 3, "Visible and recommended, separately").
 *
 * Two states side by side, never one: whether investors on the network can
 * find the company (its declared profile, network_visible), and whether it
 * can be included in investor recommendations (marketplace readiness, a
 * derived assessment). Every sentence is derived from the company row, its
 * network projection and the readiness the API returns; finishing setup
 * never flips anything. Network-visible is signed-in Capital Q investors
 * only; a public web address (public_external) is the Q Card's own choice
 * and is never implied here (ADR-001).
 */

export type VisibilityScreenProps = {
  readonly companyId: string;
  /**
   * Design review only (/dev/discovery-review): the overview, given, so
   * the first render is complete without a session. The visibility centre
   * below the chosen design reads under a session of its own and is left
   * out then.
   */
  readonly review?: VisibilityOverview | undefined;
};

type Loaded = {
  readonly company: CompanyDto;
  readonly preview: CompanyNetworkPreview;
  readonly readiness: MarketplaceReadinessAssessment | null;
};

/** Requirements a person meets through verification. */
const VERIFICATION: ReadonlySet<MarketplaceReadinessRequirement> = new Set([
  "FOUNDER_IDENTITY_VERIFIED",
  "ORGANISATION_VERIFIED",
]);

export function VisibilityScreen(props: VisibilityScreenProps) {
  return (
    <CrmToastProvider>
      <Screen {...props} />
    </CrmToastProvider>
  );
}

function Screen({ companyId, review }: VisibilityScreenProps) {
  const t = useT();
  const toast = useCrmToast();
  const [loaded, setLoaded] = useState<Loaded | null>(review ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "pending" | "done">("idle");
  const [checking, setChecking] = useState<"idle" | "pending" | "done">("idle");
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const result = await loadVisibilityOverviewAction(companyId);
    if (result.ok) {
      setLoaded(result.value);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [companyId]);

  const reviewing = review !== undefined;
  useEffect(() => {
    if (reviewing) return;
    let cancelled = false;
    void loadVisibilityOverviewAction(companyId).then((result) => {
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
  }, [companyId, reviewing]);

  const choose = async (
    visibility: "organisation_private" | "network_visible",
  ) => {
    if (loaded === null) return;
    setSaving("pending");
    setError(null);
    const result = await setCompanyVisibilityAction(
      companyId,
      visibility,
      loaded.company.version,
    ).catch(() => null);
    if (result === null || !result.ok) {
      setSaving("idle");
      setError(
        result?.message ?? "That didn't go through. Reload and try again.",
      );
      return;
    }
    setConfirming(false);
    toast(
      visibility === "network_visible"
        ? t(
            "Your company profile is now visible to investors on the Capital Q network.",
          )
        : t("Your company profile is private to your organisation again."),
    );
    await load();
    setSaving("idle");
  };

  const checkReadiness = async () => {
    setChecking("pending");
    setError(null);
    const result = await assessMarketplaceReadinessAction(companyId).catch(
      () => null,
    );
    if (result === null || !result.ok) {
      setChecking("idle");
      setError(result?.message ?? "Readiness couldn't be checked. Try again.");
      return;
    }
    await load();
    setChecking("done");
    toast(
      result.value.state === "marketplace_ready"
        ? t("Your company meets the requirements for investor recommendations.")
        : t("Readiness checked. What remains is listed below."),
    );
    setTimeout(() => setChecking("idle"), 1600);
  };

  if (error !== null && loaded === null) {
    return (
      <InlineNotice tone="danger" title={t("Visibility couldn't load")}>
        {error}
      </InlineNotice>
    );
  }
  if (loaded === null) {
    return (
      <div
        aria-busy="true"
        aria-label={t("Loading visibility")}
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
  const rows = (readiness?.requirements ?? []).filter(
    (r) => r.outcome !== "NOT_APPLICABLE",
  );
  const still = rows.filter((r) => r.outcome !== "SATISFIED");
  const notes =
    readiness === null ? [] : discoverabilityNotes(readiness.discoverability);

  return (
    <div className="flex flex-col gap-4" data-visibility-screen>
      {error === null ? null : (
        <InlineNotice tone="danger" title={t("That didn't go through")}>
          {error}
        </InlineNotice>
      )}

      <div className="grid gap-3.5 md:grid-cols-2">
        <div className="flex flex-col gap-3.5">
          <Stat
            on={visible}
            icon={
              visible ? (
                <Eye size={20} aria-hidden="true" />
              ) : (
                <Lock size={20} aria-hidden="true" />
              )
            }
            title={
              visible ? t("Discoverable") : t("Private to your organisation")
            }
            body={
              visible
                ? t("Investors can look your company up and ask Q about it.")
                : t(
                    "Only people in your organisation can see your company. Investors cannot find it, and Q will not mention it to them.",
                  )
            }
            data-stat="visible"
          />
          {visible ? (
            <button
              type="button"
              className={crmButton("secondary", "self-start")}
              onClick={() => setConfirming(true)}
              data-make-private
            >
              {t("Make private again")}
            </button>
          ) : (
            <ProgressButton
              phase={saving}
              pendingLabel={t("Saving…")}
              idle={t("Make visible to investors")}
              done={t("Visible")}
              onClick={() => void choose("network_visible")}
              className="self-start"
              data-make-visible
            />
          )}
          <span className="cq-caption text-(--cq-text-tertiary)">
            {t(
              "Visible to signed-in Capital Q investors only, never at a public web address.",
            )}
          </span>
        </div>
        <Stat
          on={ready}
          icon={<Compass size={20} aria-hidden="true" />}
          title={
            ready
              ? t("Can be included in recommendations")
              : t("Not in investor recommendations yet")
          }
          body={
            ready
              ? t(
                  "Your company meets the requirements for investor recommendations.",
                )
              : t(
                  "Being visible does not change that on its own; the requirements below decide it.",
                )
          }
          data-stat="recommended"
        />
      </div>

      <section
        aria-labelledby="visibility-requirements"
        className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="visibility-requirements"
            className="cq-body-sm font-medium text-(--cq-text-secondary)"
          >
            {t("Requirements for recommendations")}
          </h2>
          <ProgressButton
            variant="secondary"
            phase={checking}
            pendingLabel={t("Checking…")}
            idle={t("Check readiness again")}
            done={t("Checked")}
            onClick={() => void checkReadiness()}
            data-check-readiness
          />
        </div>
        {readiness === null ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t("Readiness couldn't load. Try again in a moment.")}
          </p>
        ) : (
          <ul data-marketplace-requirements>
            {rows.map((r) => (
              <li
                key={r.requirement}
                className="flex flex-wrap items-center gap-2.5 border-t border-(--cq-border-subtle) py-3 text-sm text-(--cq-text-primary) first:border-t-0"
                data-outcome={r.outcome}
              >
                {r.outcome === "SATISFIED" ? (
                  <Tick />
                ) : (
                  <CircleHelp
                    size={18}
                    aria-hidden="true"
                    className="flex-none text-(--cq-text-tertiary)"
                  />
                )}
                <span className="sr-only">
                  {r.outcome === "SATISFIED"
                    ? t("Done: ")
                    : t("Still needed: ")}
                </span>
                <span className="min-w-0 flex-1">{r.description}</span>
                {r.outcome !== "SATISFIED" &&
                VERIFICATION.has(r.requirement) &&
                readiness.verificationAvailable ? (
                  <Link
                    href="/verification"
                    className={cx(crmButton("primary"), "max-sm:ms-[30px]")}
                  >
                    {t("Verify you and")} {company.canonicalName}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <span className="cq-caption text-(--cq-text-tertiary)" role="status">
          {readiness === null
            ? null
            : still.length === 0
              ? t(
                  "Your company meets the requirements and can be included in investor recommendations.",
                )
              : `${t("Still needed:")} ${still
                  .map((r) => r.description.replace(/\.$/u, ""))
                  .join("; ")}.`}
        </span>
        {readiness !== null && !readiness.verificationAvailable ? (
          <p className="cq-caption text-(--cq-text-secondary)">
            {t(
              "Identity and organisation verification are not yet available on Capital Q, so no company is in investor recommendations today. Nothing here calls your company verified when it isn't.",
            )}
          </p>
        ) : null}
        {notes.length === 0 ? null : (
          <ul
            className="flex flex-col gap-1.5 border-t border-(--cq-border-subtle) pt-3"
            data-discoverability
          >
            {notes.map((note) => (
              <li
                key={note.fact}
                className="cq-caption text-(--cq-text-secondary)"
              >
                {note.text}{" "}
                <Link href={note.href} className="underline underline-offset-4">
                  {t("Add it")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <QLine small={t("The requirements are the same for every company.")}>
        {t(
          "Recommendations rank companies by fit and evidence. No one can pay to be recommended.",
        )}
      </QLine>

      {/*
        The visibility control centre (CQ-BIZ-003): who can see each thing,
        the shares with named investors, and the company as each audience
        sees it, all from the server. Kept under the chosen design.
      */}
      {reviewing ? null : (
        <div className="pt-6">
          <VisibilityCentre
            companyId={companyId}
            refreshKey={String(company.version)}
          />
        </div>
      )}

      <CrmSheet
        open={confirming}
        onOpenChange={setConfirming}
        title={t("Make your company private again?")}
        sub={company.canonicalName}
        data-make-private-sheet
      >
        <p className="cq-body text-(--cq-text-primary)">
          {t(
            "Investors will no longer find your company, and Q will not mention it to them. Conversations you already have stay open.",
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={crmButton("secondary")}
            onClick={() => setConfirming(false)}
          >
            {t("Keep it visible")}
          </button>
          <ProgressButton
            phase={saving}
            pendingLabel={t("Saving…")}
            idle={t("Make private")}
            done={t("Private")}
            onClick={() => void choose("organisation_private")}
            data-confirm-private
          />
        </div>
      </CrmSheet>
    </div>
  );
}

function Stat({
  on,
  icon,
  title,
  body,
  ...rest
}: {
  readonly on: boolean;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly body: string;
} & { readonly [data: `data-${string}`]: string | undefined }) {
  return (
    <div
      className="cq-crm-swap flex items-center gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4"
      data-on={on ? "true" : "false"}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cx(
          "grid size-11 flex-none place-items-center rounded-full",
          on
            ? "bg-(--cq-positive-soft) text-(--cq-positive)"
            : "bg-(--cq-surface-subtle) text-(--cq-text-secondary)",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <b className="block text-base font-semibold text-(--cq-text-primary)">
          {title}
        </b>
        <span className="text-[13px] text-(--cq-text-secondary)">{body}</span>
      </div>
    </div>
  );
}

/**
 * No company yet: one sentence and the way in, without a dashed frame
 * around an absence (design/visual-direction.md, "No dashboards").
 */
export function VisibilityUnavailable() {
  const t = useT();
  return (
    <section
      aria-label={t("No company to show yet.")}
      className="flex max-w-(--cq-layout-reading) flex-col gap-3"
      data-state="empty"
    >
      <p className="cq-body text-(--cq-text-primary)">
        {t("No company to show yet.")}
      </p>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t(
          "Set up as a founder first. Until then there is nothing investors could see.",
        )}
      </p>
      <div className="pt-1">
        <Link
          href="/onboarding/founder"
          className={buttonClassName("secondary")}
        >
          {t("Set up as a founder")}
        </Link>
      </div>
    </section>
  );
}
