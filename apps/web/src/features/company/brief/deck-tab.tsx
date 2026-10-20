"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import type { CompanyDeckView } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  ICON_SIZE,
  Lock,
  Maximize2,
  Plus,
} from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

import { Watermark } from "../material/file-viewer";
import { openDeckAction, type OpenedFile } from "../material/material-actions";
import type { PitchProfileSection } from "../pitch-profile";
import { useBrief } from "./brief-context";
import { plural } from "./model";
import { BriefGrid, ClaimLine, Hatch, QMark, QReadCard } from "./parts";

const longDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));

/**
 * The Pitch deck tab as the decision brief (ptabs "Pitch deck"): the deck
 * in a viewer, view only with the reader's name on every slide unless the
 * founder allowed downloads, then Q's read section by section. Picking a
 * section turns the viewer to its slide; a gap says the question Q would
 * ask, and one tap adds it to the reader's questions. Nothing is signed
 * until the reader opens the deck: opening is a view the founders see.
 */
export function DeckBrief({
  companyId,
  companyName,
  view,
  sections,
  investor,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly view: CompanyDeckView;
  readonly sections: readonly PitchProfileSection[];
  readonly investor: boolean;
}) {
  const t = useT();
  const params = useSearchParams();
  const autoOpen = params?.get("open") === "1";
  const sub = params?.get("sub")?.toLowerCase() ?? null;
  const askedAt =
    sub === null ? -1 : sections.findIndex((s) => s.sectionKey === sub);
  const [picked, setPicked] = useState<number | null>(null);
  const index = picked ?? (askedAt >= 0 ? askedAt : firstProvided(sections));
  const [file, setFile] = useState<OpenedFile | null>(null);
  const [slide, setSlide] = useState(() => sections[index]?.pages[0] ?? 1);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const frame = useRef<HTMLDivElement>(null);
  const { deck, extraction } = view;

  const open = useCallback(
    () =>
      start(async () => {
        const result = await openDeckAction(companyId);
        if (result.ok) setFile(result.value);
        else setMessage(result.message);
      }),
    [companyId],
  );
  // Q was asked to open the deck: the server authorises it as for a click.
  const asked = useRef(false);
  useEffect(() => {
    if (!autoOpen || asked.current || deck === null) return;
    asked.current = true;
    open();
  }, [autoOpen, open, deck]);

  if (deck === null) {
    return (
      <div className="flex flex-col gap-2 py-6" data-deck="empty">
        <p className="cq-body text-(--cq-text-primary)">
          {companyName} hasn&rsquo;t shared a deck with you yet.
        </p>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t("When they do, it appears here with Q’s read of it.")}
        </p>
      </div>
    );
  }
  const total = deck.pageCount;
  const move = (by: number) =>
    setSlide((now) => Math.max(1, Math.min(total ?? now + by, now + by)));
  const choose = (at: number) => {
    setPicked(at);
    const page = sections[at]?.pages[0];
    if (page !== undefined) setSlide(page);
  };
  const section = sections[index];
  const provided = sections.filter((s) => s.provided);
  const gaps = sections.filter((s) => !s.provided);
  const owner = view.viewer === "OWNER";

  const main = (
    <>
      <div className="flex flex-col" data-deck-viewer>
        <div className="cq-brief-sframe" ref={frame}>
          {file === null ? (
            <button
              type="button"
              className="cq-brief-slide"
              onClick={open}
              disabled={pending}
              aria-busy={pending}
            >
              <span className="cq-brief-label">{deck.title}</span>
              <span className="cq-brief-title" style={{ fontSize: 20 }}>
                {pending ? t("Opening…") : `Open the deck at slide ${String(slide)}`}
              </span>
              <span className="cq-brief-label">
                {deck.downloadable || owner
                  ? t("Opens here.")
                  : t("Opens here, view only, with your name on every slide.")}
              </span>
            </button>
          ) : (
            <div className="cq-brief-slide" data-open="">
              <iframe
                key={slide}
                src={`${file.url}#page=${String(slide)}&toolbar=0&navpanes=0&view=Fit`}
                title={`${deck.title}, slide ${String(slide)}`}
                referrerPolicy="no-referrer"
              />
              {file.watermark === null ? null : <Watermark words={file.watermark} />}
            </div>
          )}
        </div>
        <div className="cq-brief-vbar">
          <button
            type="button"
            className="cq-brief-iconbtn"
            onClick={() => move(-1)}
            disabled={slide === 1}
            aria-label={t("Previous slide")}
          >
            <ChevronLeft size={ICON_SIZE.compact} aria-hidden="true" />
          </button>
          <span className="tabular-nums" aria-live="polite">
            Slide {slide}
            {total === null ? "" : ` of ${String(total)}`}
          </span>
          <button
            type="button"
            className="cq-brief-iconbtn"
            onClick={() => move(1)}
            disabled={total !== null && slide >= total}
            aria-label={t("Next slide")}
          >
            <ChevronRight size={ICON_SIZE.compact} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cq-brief-iconbtn"
            disabled={file === null}
            aria-label={t("Full screen")}
            onClick={() =>
              void frame.current?.requestFullscreen?.().catch(() => undefined)
            }
          >
            <Maximize2 size={ICON_SIZE.compact} aria-hidden="true" />
          </button>
          <span className="cq-brief-label ms-auto inline-flex items-center gap-1.5">
            {file?.downloadable === true && !owner ? (
              <a
                href={file.downloadUrl ?? file.url}
                download
                className="cq-brief-link inline-flex items-center gap-1.5"
              >
                <Download size={ICON_SIZE.compact} aria-hidden="true" />
                {t("Download the deck")}
              </a>
            ) : (
              <>
                <Lock size={ICON_SIZE.compact} aria-hidden="true" />
                {deck.downloadable
                  ? t("Can be downloaded once open")
                  : t("View only, with your name on every slide")}
              </>
            )}
          </span>
        </div>
        {message === null ? null : (
          <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
            {message}
          </p>
        )}
      </div>
      {extraction === null || section === undefined ? (
        <p className="cq-body-sm rounded-(--cq-radius-lg) bg-(--cq-surface-subtle) p-4 text-(--cq-text-secondary)">
          {owner
            ? "Q hasn't read this version yet. Its sections appear here when it has."
            : `Q's read of the deck appears once ${companyName} confirms it.`}
        </p>
      ) : (
        <section
          className="cq-brief-card"
          aria-live="polite"
          data-deck-carousel=""
          data-deck-section={section.sectionKey}
        >
          <div className="cq-brief-secdetail" key={section.sectionKey} style={{ paddingTop: 0, minHeight: 0 }}>
            <DeckSectionDetail
              section={section}
              companyName={companyName}
              investor={investor}
            />
          </div>
        </section>
      )}
      {extraction === null ? null : (
        <QReadCard>
          <p data-size="sm">
            {gaps.length === 0
              ? `The deck covers every section, from problem to the ask.`
              : `${plural(provided.length, "section")} of ${String(sections.length)} are covered. ${gaps
                  .slice(0, 4)
                  .map((g) => g.label)
                  .join(", ")}${gaps.length > 4 ? ` and ${String(gaps.length - 4)} more` : ""} ${gaps.length === 1 ? "is" : "are"} missing.`}
          </p>
          <p className="qual">
            Every figure in it is the company’s own. Q read it on{" "}
            {longDay(extraction.readAt)}, from version {extraction.versionNumber}.
          </p>
        </QReadCard>
      )}
    </>
  );

  const rail = (
    <>
      <section className="cq-brief-card" data-deck={owner ? "owner-preview" : "investor"}>
        <h3 id="deck-title">
          {companyName} deck, version {deck.versionNumber}
        </h3>
        <div className="cq-brief-title" style={{ fontSize: 15, fontWeight: 500, marginTop: -4 }}>
          {deck.title}
        </div>
        <span className="cq-brief-label" style={{ marginTop: -8 }}>
          {[
            total === null ? null : plural(total, "slide"),
            `Updated ${longDay(deck.uploadedAt)}`,
            deck.downloadable ? "Can be downloaded" : "View only",
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </span>
        {deck.scanned ? null : (
          <span className="cq-brief-label">{t("Not virus-scanned yet.")}</span>
        )}
      </section>
      {extraction === null ? null : (
        <section className="cq-brief-card" style={{ gap: 8 }} data-deck-read>
          <div className="cq-brief-row">
            <h3 className="cq-brief-card-h">
              <QMark />
              {t("Q’s read, section by section")}
            </h3>
            <span className="cq-brief-label">
              {provided.length} of {sections.length}
            </span>
          </div>
          <div className="cq-brief-legend">
            <span>
              <i data-k="ok" aria-hidden="true" />
              {t("In the deck")}
            </span>
            <span>
              <i data-k="gap" aria-hidden="true" />
              {t("Not in the deck yet")}
            </span>
          </div>
          <div className="cq-brief-dsecs" role="list">
            {sections.map((s, at) => (
              <button
                key={s.sectionKey}
                type="button"
                role="listitem"
                className="cq-brief-dsec"
                data-gap={s.provided ? undefined : ""}
                aria-current={at === index ? "true" : undefined}
                onClick={() => choose(at)}
                data-deck-section-pick={s.sectionKey}
              >
                <span className="dbar" aria-hidden="true" />
                <span className="dn2">{s.label}</span>
                <span className="cq-brief-label tabular-nums">
                  {s.provided
                    ? s.pages[0] === undefined
                      ? "From the pitch"
                      : `Slide ${String(s.pages[0])}`
                    : "Not in the deck"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
  return <BriefGrid main={main} rail={rail} />;
}

function firstProvided(sections: readonly PitchProfileSection[]): number {
  return Math.max(
    0,
    sections.findIndex((s) => s.provided && s.pages.length > 0),
  );
}

function DeckSectionDetail({
  section,
  companyName,
  investor,
}: {
  readonly section: PitchProfileSection;
  readonly companyName: string;
  readonly investor: boolean;
}) {
  const t = useT();
  const brief = useBrief();
  if (!section.provided) {
    const added = brief?.hasGap(section.sectionKey) ?? false;
    return (
      <>
        <h4>
          {section.label}
          <span className="cq-brief-tag" data-tone="gap">
            <Hatch />
            {t("Not in the deck yet")}
          </span>
        </h4>
        <p data-muted="">
          The deck doesn’t cover this. It stays unknown, and doesn’t count
          against {companyName}.
        </p>
        {section.gapQuestion === null ? null : (
          <div className="cq-brief-askq">
            <QMark />
            <span>Q will ask: “{section.gapQuestion}”</span>
          </div>
        )}
        {investor && brief !== null && section.gapQuestion !== null ? (
          <div>
            {added ? (
              <span className="cq-brief-tag" data-tone="positive">
                <Check size={ICON_SIZE.compact} aria-hidden="true" />
                {t("Added to your questions")}
              </span>
            ) : (
              <button
                type="button"
                className={buttonClassName("secondary", "compact")}
                onClick={() =>
                  brief.addGap(
                    section.sectionKey,
                    section.label,
                    section.gapQuestion ?? "",
                  )
                }
                data-gap-question={section.sectionKey}
              >
                <Plus size={ICON_SIZE.compact} aria-hidden="true" />
                {t("Add to your questions")}
              </button>
            )}
          </div>
        ) : null}
      </>
    );
  }
  const facts = section.facts.filter((f) => f.value !== null).slice(0, 6);
  const page = section.pages[0];
  return (
    <>
      <h4>
        {section.label}
        <span className="cq-brief-tag" data-tone="positive">
          <FileText size={ICON_SIZE.compact} aria-hidden="true" />
          {page === undefined ? t("From the pitch") : `In the deck, slide ${String(page)}`}
        </span>
      </h4>
      {section.summary === null ? null : <p>{section.summary}</p>}
      {facts.length === 0 ? null : (
        <dl className="cq-brief-kv">
          {facts.map((fact) => (
            <div key={fact.key}>
              <dt className="cq-brief-label">{fact.label}</dt>
              <dd className="m-0">
                <b style={{ fontSize: 16 }}>{fact.value}</b>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <ClaimLine>
        {t("Founder’s claim, not verified. Q extracted this from the slide.")}
      </ClaimLine>
    </>
  );
}
