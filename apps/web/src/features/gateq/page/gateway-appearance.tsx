"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { GatewayAppearanceDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import {
  brandPalette,
  DEFAULT_BRAND_HEX,
  normaliseHex,
} from "@/features/brand-theme/brand-colour";
import { useT } from "@/features/i18n/language";

import { appearanceAction, gatewayStatusAction } from "./gateq-actions";
import { GatewayLogoWithName } from "../gateway-logo-name";

import {
  GatewayBrandFromWebsite,
  type ChosenBrand,
} from "./gateway-brand-from-website";

const PREVIEW_NAME =
  "truncate text-base font-semibold text-(--cq-text-primary)";

/**
 * B6 / B7 (2026-11-14): an investor organisation's admins brand, place and
 * pause their own gateway here, with no operator. The colour goes through
 * the same AA derivation the public page uses (brandPalette), so what the
 * preview shows is what founders see. Every write is a declared app action
 * (gateway.appearance.set, gateway.status.set) that Q can prepare too; the
 * API decides who may, and a member who may not sees the settings read-only.
 */
export function GatewayAppearancePanel({
  gatewayId,
  open,
  previewHref,
  appearance,
  organisationName,
}: {
  readonly gatewayId: string;
  readonly open: boolean;
  /** The public page's path, for a preview in a new tab. */
  readonly previewHref: string;
  readonly appearance: GatewayAppearanceDto | null;
  /** The canonical organisation name, when known. */
  readonly organisationName?: string | null | undefined;
}) {
  const t = useT();
  const router = useRouter();
  const ids = useId();
  const canChange = appearance?.canChange ?? false;
  const [hexText, setHexText] = useState(appearance?.accentHex ?? "");
  const [sites, setSites] = useState(
    (appearance?.embedOrigins ?? []).join("\n"),
  );
  const [message, setMessage] = useState<string | null>(null);
  // Brand from website: the name and logo the gateway shows. A saved logo
  // is drawn from Capital Q's copy through the authenticated settings
  // route, which serves it while the gateway is paused too.
  const [nameText, setNameText] = useState(appearance?.displayName ?? "");
  const [logo, setLogo] = useState<ChosenBrand["logo"]>(
    appearance?.logo == null
      ? null
      : {
          ...appearance.logo,
          src: `/gateq/logo/${gatewayId}?v=${appearance.logo.assetId}`,
        },
  );
  const [isOpen, setIsOpen] = useState(open);
  const [pending, startTransition] = useTransition();
  // Pause and save run separately so one never shows the other's progress.
  const [toggling, startToggle] = useTransition();

  const hex = hexText.trim() === "" ? null : normaliseHex(hexText);
  const palette = hex === null ? null : brandPalette(hex);
  const invalidColour = hexText.trim() !== "" && hex === null;

  const save = () => {
    if (invalidColour) {
      setMessage("Use a colour like #0f766e.");
      return;
    }
    startTransition(async () => {
      setMessage(null);
      const done = await appearanceAction(gatewayId, {
        accentHex: hex,
        sites,
        displayName: nameText.trim() === "" ? null : nameText.trim(),
        logoAssetId: logo?.assetId ?? null,
      });
      if (done.ok) {
        setSites(done.value.embedOrigins.join("\n"));
        router.refresh();
      }
      // A paused gateway's public page is not found until it is reopened,
      // so "shows it now" would not be true.
      setMessage(
        done.ok
          ? isOpen
            ? "Saved. Your public gateway shows it now."
            : "Saved. Founders will see it when you reopen your gateway."
          : done.message,
      );
    });
  };

  const toggle = () => {
    const next = isOpen ? "DISABLED" : "ACTIVE";
    startToggle(async () => {
      setMessage(null);
      const done = await gatewayStatusAction(gatewayId, { status: next });
      if (done.ok) {
        setIsOpen(done.value.status === "ACTIVE");
        router.refresh();
      }
      setMessage(
        done.ok
          ? done.value.status === "ACTIVE"
            ? "Your gateway is open again."
            : "Your gateway is paused. Its page and embed no longer take applications."
          : done.message,
      );
    });
  };

  const useBrand = (chosen: ChosenBrand) => {
    if (chosen.accentHex !== undefined) setHexText(chosen.accentHex);
    setNameText(chosen.displayName ?? "");
    setLogo(chosen.logo);
  };

  const shownName =
    nameText.trim() === "" ? (organisationName ?? t("Your firm")) : nameText;

  const colourId = `${ids}-colour`;
  const hexId = `${ids}-hex`;
  const sitesId = `${ids}-sites`;
  const hintId = `${ids}-hint`;

  return (
    <section
      className="gq2-card"
      aria-labelledby={`${ids}-title`}
      data-gateway-appearance
    >
      <h3 id={`${ids}-title`}>{t("Your gateway")}</h3>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="cq-body text-(--cq-text-primary)" data-gateway-status>
          {isOpen ? t("Open to applications") : t("Paused")}
        </p>
        {canChange ? (
          <Button
            variant={isOpen ? "secondary" : "primary"}
            size="compact"
            disabled={pending || toggling}
            onClick={toggle}
          >
            {isOpen ? t("Pause gateway") : t("Reopen gateway")}
          </Button>
        ) : null}
      </div>
      {isOpen ? (
        <a
          href={previewHref}
          target="_blank"
          rel="noreferrer"
          className="cq-body-sm inline-flex min-h-11 items-center self-start text-(--cq-accent) underline underline-offset-2"
        >
          {t("Preview your public gateway")}
        </a>
      ) : (
        <p className="cq-caption gq-t2">
          {t(
            "While paused, your link shows founders that the page isn't available, and nobody can apply. Your rules and applications are kept.",
          )}
        </p>
      )}

      {/* The gateway's bar as founders see it: name, logo, accent. */}
      <div
        className="flex min-h-14 items-center gap-3 overflow-hidden rounded-(--cq-radius-md) border border-t-2 border-(--cq-border-subtle) bg-(--cq-canvas) px-3"
        style={
          palette === null
            ? undefined
            : { borderTopColor: palette.light.accent }
        }
        data-gateway-header-preview
        aria-label={t("Preview of your gateway's header")}
        role="group"
      >
        {logo?.kind === "LOGO" ? (
          // As the public bar draws it: a wordmark is not followed by the
          // name it already spells.
          <GatewayLogoWithName
            src={logo.src}
            name={shownName}
            imageClassName="h-8 max-w-40 flex-none object-contain"
            nameClassName={PREVIEW_NAME}
            imageData={{ "data-preview-logo-kind": "LOGO" }}
          />
        ) : (
          <>
            {logo === null ? (
              <span className="grid size-8 flex-none place-items-center rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-strong) text-sm font-semibold text-(--cq-text-primary)">
                {shownName.slice(0, 1).toUpperCase()}
              </span>
            ) : (
              // Capital Q's stored copy (a data URL or our logo route).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo.src}
                alt=""
                className="size-8 flex-none rounded-full object-cover"
                data-preview-logo-kind={logo.kind}
              />
            )}
            <span className={PREVIEW_NAME}>{shownName}</span>
          </>
        )}
      </div>

      {canChange ? (
        <GatewayBrandFromWebsite gatewayId={gatewayId} onUse={useBrand} />
      ) : null}

      <form
        data-q-editing
        className="flex flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <fieldset className="flex flex-col gap-2" disabled={!canChange}>
          <label
            htmlFor={`${ids}-name`}
            className="cq-label text-(--cq-text-primary)"
          >
            {t("Name on your gateway")}
          </label>
          <input
            id={`${ids}-name`}
            className="gq-input min-h-11"
            style={{ maxWidth: 360 }}
            maxLength={120}
            placeholder={organisationName ?? ""}
            aria-describedby={`${ids}-name-hint`}
            value={nameText}
            onChange={(event) => setNameText(event.target.value)}
          />
          <p id={`${ids}-name-hint`} className="cq-caption gq-t3">
            {t("Leave empty to show your firm's name from its profile.")}
          </p>
          {logo === null ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="cq-body-sm text-(--cq-text-primary)">
                {logo.kind === "LOGO"
                  ? t("Your website's logo is shown.")
                  : t("Your website's icon is shown (not a full logo).")}
              </p>
              <Button
                type="button"
                variant="quiet"
                size="compact"
                className="min-h-11"
                onClick={() => setLogo(null)}
              >
                {t("Remove logo")}
              </Button>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2" disabled={!canChange}>
          <legend className="cq-label mb-1 text-(--cq-text-primary)">
            {t("Accent colour")}
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={colourId}
              type="color"
              className="size-11 cursor-pointer rounded-(--cq-radius-sm) border border-(--cq-border-subtle) bg-transparent p-1"
              aria-label={t("Pick a colour")}
              value={hex ?? DEFAULT_BRAND_HEX}
              onChange={(event) => setHexText(event.target.value)}
            />
            <label htmlFor={hexId} className="sr-only">
              {t("Colour as hex")}
            </label>
            <input
              id={hexId}
              className="gq-input"
              style={{ width: 120 }}
              placeholder="#0f766e"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={invalidColour}
              aria-describedby={hintId}
              value={hexText}
              onChange={(event) => setHexText(event.target.value)}
            />
            {hexText === "" ? null : (
              <Button
                type="button"
                variant="quiet"
                size="compact"
                onClick={() => setHexText("")}
              >
                {t("Use Capital Q's colour")}
              </Button>
            )}
          </div>
          <p id={hintId} className="cq-caption gq-t3">
            {t(
              "Capital Q keeps your hue and adjusts the shade so buttons and links stay readable (WCAG AA) in light and dark.",
            )}
          </p>
          {palette === null ? null : (
            <div
              className="flex flex-wrap items-center gap-3"
              data-gateway-accent-preview
            >
              <span
                className="inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-4 text-sm font-semibold text-(--cq-text-inverse)"
                style={{ backgroundColor: palette.light.accent }}
              >
                {t("Apply")}
              </span>
              <span
                className="cq-body-sm font-semibold"
                style={{ color: palette.light.accent }}
              >
                {t("Link text")}
              </span>
              <span className="cq-caption gq-t3">
                {`${palette.light.fillContrast.toFixed(1)}:1 · ${palette.light.textContrast.toFixed(1)}:1`}
              </span>
            </div>
          )}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label
            htmlFor={sitesId}
            className="cq-label text-(--cq-text-primary)"
          >
            {t("Websites that may embed your gateway")}
          </label>
          <textarea
            id={sitesId}
            className="gq-input"
            rows={3}
            disabled={!canChange}
            aria-describedby={`${sitesId}-hint`}
            placeholder="example.com"
            spellCheck={false}
            value={sites}
            onChange={(event) => setSites(event.target.value)}
          />
          <p id={`${sitesId}-hint`} className="cq-caption gq-t3">
            {t(
              "One per line, up to 10. Leave empty to let any website embed it.",
            )}
          </p>
        </div>

        {canChange ? (
          <Button
            type="submit"
            size="compact"
            className="self-start"
            disabled={pending || toggling || invalidColour}
          >
            {pending ? t("Saving…") : t("Save")}
          </Button>
        ) : (
          <p className="cq-caption gq-t2">
            {t("Only admins of your firm can change how your gateway looks.")}
          </p>
        )}
      </form>
      {message === null ? null : (
        <p className="cq-caption gq-t2" role="status">
          {t(message)}
        </p>
      )}
    </section>
  );
}
