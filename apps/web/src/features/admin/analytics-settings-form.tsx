"use client";

import { useId, useState } from "react";

import {
  ANALYTICS_SETTING_DESCRIPTIONS,
  VIEWING_VISIBILITIES,
  type AnalyticsSettings,
  type ViewingVisibility,
} from "@capital-q/contracts";

import { updateAnalyticsSettingsAction } from "./console-actions";
import { ReasonAction } from "./console-ui";
import { useT } from "@/features/i18n/language";

/**
 * The analytics privacy settings (Q Workspace §8). Every setting says in
 * plain words what it does, and a setting whose current value goes beyond
 * the Product Specification §6.7 says so beside it. Saving sends the whole
 * set with the version on screen and asks for a reason; the API re-checks
 * every rule the database enforces.
 */

const LEVEL_LABEL: Record<ViewingVisibility, string> = {
  FULL_IDENTITY: "Full identity (name and organisation)",
  ORGANISATION_ONLY: 'Organisation only ("Someone from Apex Capital")',
  ANONYMOUS: "Anonymous (nothing identifying)",
};

const rank = (v: ViewingVisibility) =>
  v === "FULL_IDENTITY" ? 0 : v === "ORGANISATION_ONLY" ? 1 : 2;

const BOOLEAN_KEYS = [
  "paidIdentityReveal",
  "namedPassiveViewers",
  "paidRevealOverridesAnonymous",
  "perPersonPassiveAnalytics",
  "passiveViewNotifications",
  "intentSignalNotifications",
  "qUsesPassiveSignals",
] as const satisfies readonly (keyof AnalyticsSettings)[];

function BeyondSpec({ on }: { readonly on: boolean }) {
  const t = useT();
  if (!on) return null;
  return (
    <span className="cq-caption font-medium text-(--cq-text-primary)">
      {t("Beyond the product specification §6.7")}
    </span>
  );
}

export function AnalyticsSettingsForm({
  initial,
  version,
  canWrite,
}: {
  readonly initial: AnalyticsSettings;
  readonly version: number;
  readonly canWrite: boolean;
}) {
  const t = useT();
  const [settings, setSettings] = useState<AnalyticsSettings>(initial);
  const defaultId = useId();
  const batchId = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  const changed = JSON.stringify(settings) !== JSON.stringify(initial);
  // The Anonymous override is locked: turning it on needs its own
  // acknowledgement of the investor-trust risk, on top of the reason.
  const unlocking =
    settings.paidRevealOverridesAnonymous &&
    !initial.paidRevealOverridesAnonymous;

  const setDefault = (level: ViewingVisibility) => {
    // The default and everything more private are always allowed.
    const allowed = new Set(settings.allowedVisibilities);
    for (const v of VIEWING_VISIBILITIES)
      if (rank(v) >= rank(level)) allowed.add(v);
    setSettings({
      ...settings,
      defaultVisibility: level,
      allowedVisibilities: VIEWING_VISIBILITIES.filter((v) => allowed.has(v)),
    });
  };
  const toggleAllowed = (level: ViewingVisibility, on: boolean) => {
    const allowed = new Set(settings.allowedVisibilities);
    if (on) allowed.add(level);
    else allowed.delete(level);
    setSettings({
      ...settings,
      allowedVisibilities: VIEWING_VISIBILITIES.filter((v) => allowed.has(v)),
    });
  };
  const toggle = (key: (typeof BOOLEAN_KEYS)[number], on: boolean) => {
    const next = { ...settings, [key]: on };
    // The Anonymous override cannot exist without paid reveal.
    if (key === "paidIdentityReveal" && !on)
      next.paidRevealOverridesAnonymous = false;
    setSettings(next);
  };

  const describe = ANALYTICS_SETTING_DESCRIPTIONS;
  return (
    <div className="flex flex-col gap-6">
      <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        <li className="flex flex-col gap-2 py-4">
          <label
            htmlFor={defaultId}
            className="cq-body font-medium text-(--cq-text-primary)"
          >
            {t(describe.defaultVisibility.title)}
          </label>
          <span className="cq-caption text-(--cq-text-secondary)">
            {t(describe.defaultVisibility.description)}
          </span>
          <select
            id={defaultId}
            className="cq-body min-h-11 max-w-md rounded-(--cq-radius-md) border border-(--cq-border-strong) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary)"
            value={settings.defaultVisibility}
            disabled={!canWrite}
            onChange={(event) => {
              const value = VIEWING_VISIBILITIES.find(
                (v) => v === event.target.value,
              );
              if (value !== undefined) setDefault(value);
            }}
          >
            {VIEWING_VISIBILITIES.map((level) => (
              <option key={level} value={level}>
                {t(LEVEL_LABEL[level])}
              </option>
            ))}
          </select>
          <BeyondSpec
            on={describe.defaultVisibility.beyondSpec(
              settings.defaultVisibility,
            )}
          />
        </li>
        <li className="flex flex-col gap-2 py-4">
          <span className="cq-body font-medium text-(--cq-text-primary)">
            {t(describe.allowedVisibilities.title)}
          </span>
          <span className="cq-caption text-(--cq-text-secondary)">
            {t(describe.allowedVisibilities.description)}
          </span>
          {VIEWING_VISIBILITIES.map((level) => {
            const locked = rank(level) >= rank(settings.defaultVisibility);
            return (
              <label
                key={level}
                className="flex min-h-11 items-center gap-3 cq-body text-(--cq-text-primary)"
              >
                <input
                  type="checkbox"
                  className="size-5"
                  checked={settings.allowedVisibilities.includes(level)}
                  disabled={!canWrite || locked}
                  onChange={(event) =>
                    toggleAllowed(level, event.target.checked)
                  }
                />
                {t(LEVEL_LABEL[level])}
                {locked ? (
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {t("(always allowed)")}
                  </span>
                ) : null}
              </label>
            );
          })}
        </li>
        {BOOLEAN_KEYS.map((key) => {
          const text = describe[key];
          const needsReveal =
            key === "paidRevealOverridesAnonymous" &&
            !settings.paidIdentityReveal;
          return (
            <li key={key} className="flex flex-col gap-2 py-4">
              <label className="flex min-h-11 items-center gap-3 cq-body font-medium text-(--cq-text-primary)">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={settings[key]}
                  disabled={!canWrite || needsReveal}
                  onChange={(event) => toggle(key, event.target.checked)}
                />
                {t(text.title)} · {settings[key] ? t("On") : t("Off")}
              </label>
              <span className="cq-caption text-(--cq-text-secondary)">
                {t(text.description)}
              </span>
              <BeyondSpec on={text.beyondSpec(settings[key])} />
              {key === "paidRevealOverridesAnonymous" && unlocking ? (
                <label className="flex min-h-11 items-center gap-3 cq-body text-(--cq-text-primary)">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  {t(
                    "I understand this breaks the anonymity promise made to investors and can end their trust in Capital Q.",
                  )}
                </label>
              ) : null}
            </li>
          );
        })}
        {(["headlineFloor", "sliceFloor"] as const).map((key) => {
          const text = describe[key];
          const minimum = key === "headlineFloor" ? 3 : 5;
          return (
            <li key={key} className="flex flex-col gap-2 py-4">
              <label className="flex min-h-11 items-center gap-3 cq-body font-medium text-(--cq-text-primary)">
                {t(text.title)}
                <input
                  type="number"
                  min={minimum}
                  max={100}
                  className="cq-body min-h-11 w-24 rounded-(--cq-radius-md) border border-(--cq-border-strong) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary)"
                  value={settings[key]}
                  disabled={!canWrite}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (Number.isFinite(value)) {
                      setSettings({
                        ...settings,
                        [key]: Math.min(100, Math.max(minimum, value)),
                      });
                    }
                  }}
                />
              </label>
              <span className="cq-caption text-(--cq-text-secondary)">
                {t(text.description)}
              </span>
            </li>
          );
        })}
        <li className="flex flex-col gap-2 py-4">
          <label
            htmlFor={batchId}
            className="cq-body font-medium text-(--cq-text-primary)"
          >
            {t(describe.passiveBatch.title)}
          </label>
          <span className="cq-caption text-(--cq-text-secondary)">
            {t(describe.passiveBatch.description)}
          </span>
          <select
            id={batchId}
            className="cq-body min-h-11 max-w-md rounded-(--cq-radius-md) border border-(--cq-border-strong) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary)"
            value={settings.passiveBatch}
            disabled={!canWrite}
            onChange={(event) =>
              setSettings({
                ...settings,
                passiveBatch:
                  event.target.value === "DAILY" ? "DAILY" : "WEEKLY",
              })
            }
          >
            <option value="WEEKLY">{t("Weekly")}</option>
            <option value="DAILY">{t("Daily")}</option>
          </select>
          <BeyondSpec
            on={describe.passiveBatch.beyondSpec(settings.passiveBatch)}
          />
        </li>
      </ul>
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <ReasonAction
            label={t("Save changes")}
            title={t("Save analytics settings?")}
            description={t(
              "These change what founders can see about investors, platform-wide, at once. Name why.",
            )}
            confirm="Save"
            variant="primary"
            disabled={!changed || (unlocking && !acknowledged)}
            run={(reason) =>
              updateAnalyticsSettingsAction({
                settings,
                expectedVersion: version,
                reason,
                ...(unlocking && acknowledged
                  ? { acknowledgeInvestorTrustRisk: true }
                  : {}),
              })
            }
          />
          {changed ? (
            <button
              type="button"
              className="cq-body min-h-11 px-3 text-(--cq-text-secondary) underline"
              onClick={() => {
                setSettings(initial);
                setAcknowledged(false);
              }}
            >
              {t("Discard")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
