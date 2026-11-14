"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type {
  GatewayBrandReason,
  GatewayBrandSuggestionDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { useT } from "@/features/i18n/language";

import {
  brandSuggestionAction,
  saveProfileWebsiteAction,
} from "./gateq-actions";

/** What the admin chose to carry into the gateway preview. */
export type ChosenBrand = {
  /** Undefined: leave the colour as it is. */
  readonly accentHex?: string | undefined;
  /** Null: the profile's name. */
  readonly displayName: string | null;
  /** Null: no logo. */
  readonly logo: {
    readonly assetId: string;
    readonly kind: "LOGO" | "ICON";
    readonly src: string;
  } | null;
};

/** Each reason in plain words: what went wrong, never a code. */
const REASON: Readonly<Record<GatewayBrandReason, string>> = {
  NO_WEBSITE: "Your firm's profile has no website yet.",
  INVALID_URL:
    "The website on your profile isn't an address Capital Q can read.",
  BLOCKED_ADDRESS:
    "Your website points to a private network address, so Capital Q didn't read it.",
  OFF_SITE_REDIRECT:
    "Your website sent Capital Q to a different site, so it stopped there.",
  DNS_FAILED: "Your website's address couldn't be found.",
  TIMEOUT: "Your website took too long to answer.",
  UNREACHABLE: "Your website couldn't be reached.",
  HTTP_ERROR: "Your website answered with an error.",
  TOO_LARGE: "Your website's page was too large to read.",
  TOO_MANY_REDIRECTS: "Your website redirected too many times.",
  NOT_HTML: "Your website's address didn't return a web page.",
  NO_NAME: "No name was found on your website.",
  NO_LOGO: "No logo was found on your website.",
  UNSUPPORTED_LOGO_FORMAT:
    "Your website's logo isn't a PNG or JPEG, so Capital Q can't use it yet.",
  NO_COLOURS: "No brand colour was found on your website.",
};

/**
 * Brand from website (owner 2026-11-14). Capital Q reads the website on
 * the firm's canonical profile (only that one) for its name, logo and
 * colours; the admin keeps or corrects each item, and the choice goes into
 * the gateway preview above it. Nothing public changes until they press
 * Save there (gateway.appearance.set). A site icon is shown as an icon and
 * is off unless they turn it on; no logo is ever invented.
 */
export function GatewayBrandFromWebsite({
  gatewayId,
  onUse,
}: {
  readonly gatewayId: string;
  readonly onUse: (chosen: ChosenBrand) => void;
}) {
  const t = useT();
  const router = useRouter();
  const ids = useId();
  const [suggestion, setSuggestion] =
    useState<GatewayBrandSuggestionDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  const [useSiteName, setUseSiteName] = useState(false);
  const [useLogo, setUseLogo] = useState(false);
  const [useColour, setUseColour] = useState(false);
  const [pending, startTransition] = useTransition();

  const read = () => {
    startTransition(async () => {
      setMessage(null);
      const done = await brandSuggestionAction(gatewayId);
      if (!done.ok) {
        setMessage(done.message);
        return;
      }
      const found = done.value;
      setSuggestion(found);
      // Defaults: the profile's name stays; a real logo and a found colour
      // are on, a site icon is off until the admin chooses it.
      setUseSiteName(false);
      setUseLogo(found.logo.status === "FOUND" && found.logo.kind === "LOGO");
      setUseColour(found.colours.status === "FOUND");
    });
  };

  const saveWebsite = () => {
    if (suggestion === null) return;
    startTransition(async () => {
      setMessage(null);
      const saved = await saveProfileWebsiteAction({
        investorOrganisationId: suggestion.investorOrganisationId,
        expectedVersion: suggestion.profileVersion,
        website,
      });
      if (!saved.ok) {
        setMessage(saved.message);
        return;
      }
      router.refresh();
      const done = await brandSuggestionAction(gatewayId);
      if (!done.ok) {
        setMessage(done.message);
        return;
      }
      setSuggestion(done.value);
      setUseLogo(
        done.value.logo.status === "FOUND" && done.value.logo.kind === "LOGO",
      );
      setUseColour(done.value.colours.status === "FOUND");
    });
  };

  const apply = () => {
    if (suggestion === null) return;
    const { name, logo, colours } = suggestion;
    onUse({
      ...(useColour && colours.status === "FOUND"
        ? { accentHex: colours.primary }
        : {}),
      displayName: useSiteName && name.status === "FOUND" ? name.value : null,
      logo:
        useLogo && logo.status === "FOUND"
          ? { assetId: logo.assetId, kind: logo.kind, src: logo.previewDataUrl }
          : null,
    });
    setMessage("Added to the preview. Press Save to show it on your gateway.");
  };

  const reason = (why: GatewayBrandReason) => (
    <p className="cq-caption gq-t2" data-brand-reason={why}>
      {t(REASON[why])}
    </p>
  );

  const noWebsite = suggestion !== null && suggestion.websiteUrl === null;
  const siteNameDiffers =
    suggestion?.name.status === "FOUND" &&
    suggestion.name.value.toLowerCase() !==
      suggestion.canonicalName.toLowerCase();

  return (
    <div
      className="flex flex-col gap-2.5 border-t border-(--cq-border-subtle) pt-3"
      data-gateway-brand-from-website
    >
      <p className="cq-label text-(--cq-text-primary)">
        {t("Brand from your website")}
      </p>
      <p className="cq-caption gq-t3">
        {t(
          "Capital Q reads the website on your firm's profile for its name, logo and colours. You can correct anything before you save.",
        )}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="compact"
        className="min-h-11 self-start"
        disabled={pending}
        onClick={read}
      >
        {pending
          ? t("Reading your website…")
          : suggestion === null
            ? t("Brand from website")
            : t("Read your website again")}
      </Button>

      {noWebsite ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            saveWebsite();
          }}
        >
          <label
            htmlFor={`${ids}-website`}
            className="cq-body-sm text-(--cq-text-primary)"
          >
            {t(
              "Your firm's profile has no website yet. Add it, and Capital Q reads it from your profile.",
            )}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`${ids}-website`}
              className="gq-input min-h-11"
              style={{ width: 260, maxWidth: "100%" }}
              placeholder="yourfirm.com"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
            <Button
              type="submit"
              size="compact"
              className="min-h-11"
              disabled={pending || website.trim() === ""}
            >
              {t("Save to profile and read")}
            </Button>
          </div>
        </form>
      ) : null}

      {suggestion === null || noWebsite ? null : (
        <div className="flex flex-col gap-3" data-brand-suggestion>
          {suggestion.sourceUrl === null ? null : (
            <p className="cq-caption gq-t3 break-all">
              {t("Read from")} {suggestion.sourceUrl}
            </p>
          )}

          <fieldset className="flex flex-col gap-1.5" data-brand-field="name">
            <legend className="cq-body-sm font-semibold text-(--cq-text-primary)">
              {t("Name")}
            </legend>
            {suggestion.name.status === "NOT_FOUND" ? (
              <>
                {reason(suggestion.name.reason)}
                <p className="cq-caption gq-t2">
                  {t("Your profile's name is shown:")}{" "}
                  {suggestion.canonicalName}
                </p>
              </>
            ) : siteNameDiffers ? (
              <>
                <label className="flex min-h-11 items-center gap-2 cq-body-sm">
                  <input
                    type="radio"
                    name={`${ids}-name`}
                    className="size-5"
                    checked={!useSiteName}
                    onChange={() => setUseSiteName(false)}
                  />
                  <span>
                    {suggestion.canonicalName}{" "}
                    <span className="gq-t3">{t("(your profile)")}</span>
                  </span>
                </label>
                <label className="flex min-h-11 items-center gap-2 cq-body-sm">
                  <input
                    type="radio"
                    name={`${ids}-name`}
                    className="size-5"
                    checked={useSiteName}
                    onChange={() => setUseSiteName(true)}
                  />
                  <span>
                    {suggestion.name.value}{" "}
                    <span className="gq-t3">{t("(your website)")}</span>
                  </span>
                </label>
                <p className="cq-caption gq-t3">
                  {t(
                    "Your profile's name stays your firm's name everywhere else on Capital Q.",
                  )}
                </p>
              </>
            ) : (
              <p className="cq-caption gq-t2">
                {t("Your website uses your profile's name:")}{" "}
                {suggestion.canonicalName}
              </p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-1.5" data-brand-field="logo">
            <legend className="cq-body-sm font-semibold text-(--cq-text-primary)">
              {t("Logo")}
            </legend>
            {suggestion.logo.status === "NOT_FOUND" ? (
              <>
                {reason(suggestion.logo.reason)}
                <p className="cq-caption gq-t2">
                  {t("Your gateway shows your firm's initial instead.")}
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  {/* Our stored copy, as a data URL: never the site's own file. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={suggestion.logo.previewDataUrl}
                    alt={
                      suggestion.logo.kind === "LOGO"
                        ? t("Logo found on your website")
                        : t("Icon found on your website")
                    }
                    className="h-10 max-w-40 rounded-(--cq-radius-sm) border border-(--cq-border-subtle) bg-(--cq-surface-strong) object-contain p-1"
                    data-brand-logo-kind={suggestion.logo.kind}
                  />
                  {suggestion.logo.kind === "ICON" ? (
                    <p
                      className="cq-caption gq-t2"
                      style={{ maxWidth: "40ch" }}
                    >
                      {t(
                        "Only your website's icon was found, not a full logo. Use it only if it represents your firm well.",
                      )}
                    </p>
                  ) : null}
                </div>
                <label className="flex min-h-11 items-center gap-2 cq-body-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={useLogo}
                    onChange={(event) => setUseLogo(event.target.checked)}
                  />
                  {suggestion.logo.kind === "LOGO"
                    ? t("Use this logo")
                    : t("Use this icon")}
                </label>
              </>
            )}
          </fieldset>

          <fieldset
            className="flex flex-col gap-1.5"
            data-brand-field="colours"
          >
            <legend className="cq-body-sm font-semibold text-(--cq-text-primary)">
              {t("Colour")}
            </legend>
            {suggestion.colours.status === "NOT_FOUND" ? (
              <>
                {reason(suggestion.colours.reason)}
                <p className="cq-caption gq-t2">
                  {t("Your current colour stays. You can pick one above.")}
                </p>
              </>
            ) : (
              <label className="flex min-h-11 items-center gap-2 cq-body-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={useColour}
                  onChange={(event) => setUseColour(event.target.checked)}
                />
                <span
                  aria-hidden="true"
                  className="inline-block size-6 rounded-(--cq-radius-sm) border border-(--cq-border-subtle)"
                  style={{ backgroundColor: suggestion.colours.primary }}
                />
                <span>
                  {t("Use this colour")} {suggestion.colours.primary}
                </span>
              </label>
            )}
          </fieldset>

          <Button
            type="button"
            size="compact"
            className="min-h-11 self-start"
            onClick={apply}
          >
            {t("Use in preview")}
          </Button>
        </div>
      )}

      {message === null ? null : (
        <p className="cq-caption gq-t2" role="status">
          {t(message)}
        </p>
      )}
    </div>
  );
}
