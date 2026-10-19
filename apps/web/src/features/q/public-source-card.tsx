"use client";

import { useId, useState } from "react";

import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";

import { formatDay } from "@/components/date-format";
import { useT } from "@/features/i18n/language";

import type { QTurnPublicSource } from "./conversation";

/**
 * A public web page Q read for an answer, as a card that opens in place
 * (Q home voice room, owner 2026-10-19: artifacts from the public internet
 * behave like Capital Q's own -- they expand smoothly and show how they
 * work). Closed, it says what the page is and that it is unverified;
 * open, the full address, when it was published and read, and the two
 * things a person does with a page: open it, or copy its link.
 *
 * Only the contract's public fields are shown (R23): no snippet is
 * invented, and "unverified" is always in words, never colour alone.
 */
export function PublicSourceCard({
  source,
}: {
  readonly source: QTurnPublicSource;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panel = useId();
  const dated =
    source.publishedOn === null
      ? `${t("read")} ${formatDay(source.retrievedOn)}`
      : formatDay(source.publishedOn);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(source.url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_600);
      })
      .catch(() => undefined);
  };
  return (
    <div
      className="cq-source-card"
      data-open={open ? "" : undefined}
      data-q-public-source={source.domain}
    >
      <button
        type="button"
        className="cq-source-card-head"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true" className="cq-source-card-mark">
          <Globe size={ICON_SIZE.compact} strokeWidth={ICON_STROKE} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-start">
          <span className="cq-body-sm line-clamp-2 font-medium text-(--cq-text-primary)">
            {source.title}
          </span>
          <span className="cq-caption truncate text-(--cq-text-secondary)">
            {source.domain} · {dated} · {t("Public, unverified")}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="cq-source-card-chevron"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
      </button>
      <div id={panel} className="cq-source-card-panel" inert={!open}>
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-3 px-3 pb-3">
            <p className="cq-caption break-all text-(--cq-text-secondary)">
              {source.url}
            </p>
            <dl className="cq-caption grid grid-cols-2 gap-2">
              <div className="flex flex-col">
                <dt className="text-(--cq-text-tertiary)">{t("Published")}</dt>
                <dd className="text-(--cq-text-primary)">
                  {source.publishedOn === null
                    ? t("Not dated")
                    : formatDay(source.publishedOn)}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-(--cq-text-tertiary)">
                  {t("Read by Capital Q")}
                </dt>
                <dd className="text-(--cq-text-primary)">
                  {formatDay(source.retrievedOn)}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="cq-stage-control"
                data-q-public-source-open
              >
                <ExternalLink
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
                {t("Open page")}
              </a>
              <button
                type="button"
                className="cq-stage-quiet"
                onClick={copy}
                data-q-public-source-copy
              >
                {copied ? (
                  <Check
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                  />
                ) : (
                  <Copy
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                  />
                )}
                <span aria-live="polite">
                  {copied ? t("Link copied") : t("Copy link")}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Every public page an answer read, six at first and the rest one press
 * away -- never silently dropped.
 */
export function PublicSourceList({
  sources,
  first = 6,
}: {
  readonly sources: readonly QTurnPublicSource[];
  readonly first?: number;
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, first);
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((source) => (
          <li key={source.url}>
            <PublicSourceCard source={source} />
          </li>
        ))}
      </ul>
      {sources.length > first ? (
        <button
          type="button"
          className="cq-stage-quiet self-start"
          aria-expanded={all}
          onClick={() => setAll((was) => !was)}
        >
          {all ? t("Show fewer") : `${t("Show all")} ${String(sources.length)}`}
        </button>
      ) : null}
    </div>
  );
}
