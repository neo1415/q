"use client";

import { useEffect, useState, type RefObject } from "react";

import { ApplicationContactDtoSchema } from "@capital-q/contracts";
import type {
  ApplicationContactDto,
  ApplicationCoverageDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  Check,
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
  RotateCw,
} from "@capital-q/ui/icons";

import { coverageAction } from "../apply-actions";
import { FitGlyph } from "../fit-glyph";
import {
  maySubmit,
  MISSING_REASON_WORDS,
  REVIEW_PROVENANCE_WORDS,
} from "./form-model";
import { useT } from "@/features/i18n/language";

/**
 * GateQ slice 1: the review before Submit.
 *
 * Reads the API's deterministic coverage check: what was answered (and
 * where it came from), what is unknown, declined or never covered, what
 * disagrees, and GATE-001's own access answer. It shows exactly what the
 * investor will receive. Submit here is the only way an application is
 * sent; the API refuses it without a confirmed contact (409), which sends
 * the founder back to the contact step.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

export function ReviewStep({
  headingRef,
  fund,
  sessionToken,
  contact,
  sharedDocuments,
  hasNote,
  pending,
  submissionStarted = false,
  onSubmit,
  onContact,
  onInterview,
  preview,
}: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly fund: string;
  readonly sessionToken: string | null;
  readonly contact: ApplicationContactDto | null;
  /** Names of the documents the founder ticked (signed in only). */
  readonly sharedDocuments: readonly string[];
  readonly hasNote: boolean;
  readonly pending: boolean;
  readonly submissionStarted?: boolean;
  readonly onSubmit: () => void;
  readonly onContact: () => void;
  readonly onInterview: () => void;
  readonly preview?: ApplicationCoverageDto | undefined;
}) {
  const t = useT();

  const [coverage, setCoverage] = useState<ApplicationCoverageDto | null>(
    preview ?? null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (preview !== undefined || sessionToken === null) return;
    let current = true;
    void coverageAction(sessionToken)
      .then((result) => {
        if (!current) return;
        if (!result.ok) {
          setProblem(result.message);
          return;
        }
        setCoverage(result.coverage);
      })
      .catch(() => {
        if (current)
          setProblem("The connection was interrupted. Please try again.");
      });
    return () => {
      current = false;
    };
  }, [sessionToken, preview, reads]);

  const heading = (
    <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
      {t("Review before you submit")}
    </h1>
  );

  if (coverage === null) {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        {problem === null ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <div className="gq-sk" style={{ width: "60%", height: 20 }} />
            <div className="gq-sk" style={{ width: "100%", height: 120 }} />
          </div>
        ) : (
          <div className="gq-banner gq-banner-err" role="alert">
            <CircleAlert {...icon} />
            <span>
              <b>{t("Couldn't load your review.")}</b> {t(problem)}{" "}
              <Button
                size="compact"
                className="ms-1.5"
                onClick={() => {
                  setProblem(null);
                  setReads((n) => n + 1);
                }}
              >
                <RotateCw {...icon} />
                {t("Try again")}
              </Button>
            </span>
          </div>
        )}
      </div>
    );
  }

  const c = coverage.coverage;
  const contactRead = ApplicationContactDtoSchema.safeParse(
    Reflect.get(coverage.contact, "details"),
  );
  const actualContact = contactRead.success ? contactRead.data : contact;
  const contactBlocks =
    coverage.contact.required && !coverage.contact.confirmed;
  const ready = maySubmit(coverage);

  return (
    <div className="flex flex-col gap-5">
      {heading}
      <p className="cq-body gq-t2">
        {t(
          `This is everything ${fund} will receive. Nothing has been sent yet.`,
        )}
      </p>

      {contactBlocks ? (
        <div className="gq-banner" role="status">
          <CircleAlert {...icon} />
          <span>
            {t(`Confirm your contact email first, so ${fund} can reach you.`)}{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={onContact}
            >
              {t("Confirm my email")}
            </button>
          </span>
        </div>
      ) : null}

      {c.access === "MAY_APPLY" ? null : (
        <div className="gq-banner" role="status">
          <CircleAlert {...icon} />
          <span>
            {c.access === "MAY_NOT_APPLY"
              ? t(`${fund}'s rules don't admit this application`)
              : t(`${fund}'s rules still need an answer`)}
            {[...c.unmet, ...c.stillNeeded].length > 0
              ? t(`: ${[...c.unmet, ...c.stillNeeded].join(", ")}.`)
              : "."}
          </span>
        </div>
      )}

      <section className="gq-sect" aria-labelledby="gq-rv-answered">
        <h2 id="gq-rv-answered" className="cq-title-sm">
          {t("What you've told them")}
        </h2>
        {c.answered.length === 0 ? (
          <p className="cq-body-sm gq-t2">{t("Nothing answered yet.")}</p>
        ) : (
          <ul className="gq-hair">
            {c.answered.map((fact) => (
              <li key={fact.dimension} className="flex flex-col gap-0.5 py-2">
                <span className="flex flex-wrap items-baseline gap-2">
                  <b className="font-medium">{t(fact.label)}</b>
                  <span className="gq-prefill">
                    {t(REVIEW_PROVENANCE_WORDS[fact.provenance])}
                  </span>
                </span>
                <span className="cq-body-sm gq-t2">{t(fact.summary)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="cq-caption gq-t3">
          {t("They see these as your answers. Capital Q hasn't verified them.")}
        </p>
      </section>

      {c.contradictions.length === 0 ? null : (
        <section className="gq-sect" aria-labelledby="gq-rv-contra">
          <h2 id="gq-rv-contra" className="cq-title-sm">
            {t("Answers that disagree")}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {c.contradictions.map((line) => (
              <li key={line} className="cq-body-sm flex items-start gap-2">
                <FitGlyph kind="part" />
                <span>{t(line)}</span>
              </li>
            ))}
          </ul>
          <p className="cq-body-sm gq-t2">
            {t(`Both versions go to ${fund} as they are.`)}{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={onInterview}
            >
              {t("Clear it up with Q")}
            </button>
          </p>
        </section>
      )}

      {c.missing.length + c.unknown.length + c.declined.length === 0 ? null : (
        <section className="gq-sect" aria-labelledby="gq-rv-gaps">
          <h2 id="gq-rv-gaps" className="cq-title-sm">
            {t("Still open")}
          </h2>
          <ul className="gq-hair">
            {c.missing.map((gap) => (
              <li
                key={`m-${gap.dimension}`}
                className="flex items-center gap-2 py-2"
              >
                <FitGlyph kind="unk" />
                <span className="flex-1">{t(gap.label)}</span>
                <span className="gq-status">
                  {t("Missing ·")} {t(MISSING_REASON_WORDS[gap.reason])}
                </span>
              </li>
            ))}
            {c.unknown.map((gap) => (
              <li
                key={`u-${gap.dimension}`}
                className="flex items-center gap-2 py-2"
              >
                <FitGlyph kind="unk" />
                <span className="flex-1">{t(gap.label)}</span>
                <span className="gq-status">{t("You don't know yet")}</span>
              </li>
            ))}
            {c.declined.map((gap) => (
              <li
                key={`d-${gap.dimension}`}
                className="flex items-center gap-2 py-2"
              >
                <FitGlyph kind="unk" />
                <span className="flex-1">{t(gap.label)}</span>
                <span className="gq-status">{t("You'd rather not say")}</span>
              </li>
            ))}
          </ul>
          <p className="cq-caption gq-t3">
            {t(`Unknown isn't a no. ${fund} sees these as open.`)}{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={onInterview}
            >
              {t("Answer more with Q")}
            </button>
          </p>
        </section>
      )}

      <section className="gq-sect" aria-labelledby="gq-rv-disclose">
        <h2 id="gq-rv-disclose" className="cq-title-sm">
          {t(`Exactly what ${fund} receives`)}
        </h2>
        <ul className="flex flex-col gap-1.5">
          <li className="cq-body-sm flex items-start gap-2">
            <Check {...icon} />
            <span>
              {t("Your contact details")}
              {actualContact === null
                ? ""
                : t(
                    `: ${[
                      actualContact.name,
                      actualContact.role,
                      actualContact.companyName,
                      actualContact.email,
                      actualContact.phone,
                    ]
                      .filter((part) => part !== null && part !== "")
                      .join(", ")}`,
                  )}
              {coverage.contact.confirmed ? t(" (email confirmed)") : ""}
            </span>
          </li>
          <li className="cq-body-sm flex items-start gap-2">
            <Check {...icon} />
            <span>
              {t(
                `Your answers above, and how they stand against ${fund}'s published rules`,
              )}
            </span>
          </li>
          {hasNote ? (
            <li className="cq-body-sm flex items-start gap-2">
              <Check {...icon} />
              <span>{t("Your note")}</span>
            </li>
          ) : null}
          <li className="cq-body-sm flex items-start gap-2">
            <Check {...icon} />
            <span>
              {coverage.transcriptTurns === 0
                ? t("No interview: you skipped it")
                : t(
                    `Your interview with Q, word for word (${coverage.transcriptTurns} turns)`,
                  )}
            </span>
          </li>
          <li className="cq-body-sm flex items-start gap-2">
            <Check {...icon} />
            <span>
              {sharedDocuments.length > 0
                ? t(`Documents you ticked: ${sharedDocuments.join(", ")}`)
                : coverage.documentCount > 0
                  ? t(
                      `${coverage.documentCount} document${coverage.documentCount === 1 ? "" : "s"} you shared`,
                    )
                  : t("No documents")}
            </span>
          </li>
          <li className="cq-body-sm flex items-start gap-2">
            <Check {...icon} />
            <span>{t("What's still open, listed as open")}</span>
          </li>
        </ul>
        <p className="cq-caption gq-t3">
          {t("Nothing else from your Capital Q account goes with it.")}
        </p>
      </section>

      <div className="gq-formbar">
        <Button
          variant="quiet"
          onClick={onInterview}
          disabled={pending || submissionStarted}
        >
          {t("Back to the interview")}
        </Button>
        <Button
          variant="primary"
          style={{ minWidth: 160 }}
          onClick={onSubmit}
          disabled={pending || !ready}
        >
          {pending ? t("Submitting…") : t(`Submit to ${fund}`)}
        </Button>
      </div>
    </div>
  );
}
