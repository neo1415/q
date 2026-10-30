"use client";

import { useId, useState, type RefObject } from "react";

import type { PublicGatewayDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  Check,
  CircleAlert,
  CircleHelp,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  RotateCw,
  X,
} from "@capital-q/ui/icons";

import { monogram } from "../page/inbox-model";
import {
  COUNTRY_CHOICES,
  CURRENCIES,
  DECLINED,
  dimensionWord,
  MORE_COUNTRIES,
  normaliseAmount,
  questionCountWords,
  SECTOR_CHOICES,
  STAGE_CHOICES,
  standingWords,
  type FormAnswers,
  type Material,
  type RuleLine,
  type StepErrors,
  type Verdict,
} from "./form-model";
import { useT, useUiLanguage } from "@/features/i18n/language";
import { countryName } from "@capital-q/taxonomy/countries";

/**
 * Design gatepub-1 (2026-10-21), "Form with live rule standing": every
 * question on one page, and beside it how the founder stands against the
 * investor's PUBLISHED rules, updated as they answer.
 *
 * The standing is never computed here. Each change is saved to the
 * application and the API's deterministic engine (GATE-001, the gateway's
 * frozen policy, no model) answers with the labels it found unmet or still
 * unknown; the page only shows that answer back. The browser never holds a
 * rule's configuration, so nothing the investor did not publish can show.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

type SetAnswer = <K extends keyof FormAnswers>(
  field: K,
  value: FormAnswers[K],
) => void;

export function GateHero({
  gateway,
  questions,
}: {
  readonly gateway: PublicGatewayDto;
  readonly questions: number;
}) {
  const t = useT();
  const fund = gateway.organisationDisplayName;
  return (
    <div className="gqp-hero">
      <span className="gqp-logo" aria-hidden>
        {gateway.organisationPhotoUrl ? (
          // Signed URL from the API; the investor's own public card image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={gateway.organisationPhotoUrl} alt="" />
        ) : (
          monogram(fund)
        )}
      </span>
      <div className="min-w-0">
        <h1>{t(`Apply to ${fund}`)}</h1>
        <p>
          {t(
            `${questionCountWords(questions)} short questions, then an optional conversation with Q. You review everything before it goes.`,
          )}
        </p>
      </div>
    </div>
  );
}

/** How the founder stands, rule by rule, as the engine last answered. */
export function StandingPanel({
  lines,
  checking,
}: {
  readonly lines: readonly RuleLine[];
  readonly checking: boolean;
}) {
  const t = useT();
  return (
    <aside
      className="gqp-stand"
      aria-labelledby="gqp-stand-title"
      aria-busy={checking}
      data-gateq-standing
    >
      <h2 id="gqp-stand-title">{t("How you stand against their rules")}</h2>
      {lines.length === 0 ? (
        <p className="cq-body-sm gq-t2">
          {t(
            "No published rules yet: nothing is checked, and every founder can apply.",
          )}
        </p>
      ) : (
        <div aria-live="polite">
          {lines.map((line) => (
            <div
              key={line.label}
              className="gqp-srule"
              data-standing={line.standing ?? "NOT_ANSWERED"}
            >
              {line.standing === "MEETS" ? (
                <span className="gq-tick">
                  <Check {...icon} size={12} strokeWidth={2.4} />
                </span>
              ) : line.standing === "DOES_NOT_MEET" ? (
                <span className="gq-unk-ic">
                  <X {...icon} size={18} />
                </span>
              ) : (
                <span className="gq-unk-ic">
                  <CircleHelp {...icon} size={18} />
                </span>
              )}
              <span>
                {t(line.label)}
                <small>{t(standingWords(line))}</small>
              </span>
            </div>
          ))}
        </div>
      )}
      <span className="cq-caption gq-t3">
        {t(
          "Their published bar, not their private thesis. Meeting it is not a promise of interest.",
        )}
      </span>
    </aside>
  );
}

function Pills({
  label,
  options,
  value,
  onChange,
  error,
  decline = true,
}: {
  readonly label: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly decline?: boolean;
}) {
  const t = useT();
  const id = useId();
  return (
    <>
      <span className="gqp-qt" id={id}>
        {t(label)}
      </span>
      <div className="gqp-opts" role="radiogroup" aria-labelledby={id}>
        {[
          ...options,
          ...(decline
            ? [{ value: DECLINED, label: "Preferred not to say" }]
            : []),
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className="gqp-pill"
            onClick={() => onChange(option.value)}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
      {error === undefined ? null : <p className="gq-err">{t(error)}</p>}
    </>
  );
}

export function AnswersPage({
  headingRef,
  gateway,
  answers,
  errors,
  fromProfile,
  materials,
  lines,
  verdict,
  checking,
  pending,
  problem,
  compact,
  set,
  onContinue,
}: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly gateway: PublicGatewayDto;
  readonly answers: FormAnswers;
  readonly errors: StepErrors;
  readonly fromProfile: ReadonlySet<keyof FormAnswers>;
  readonly materials: readonly Material[];
  readonly lines: readonly RuleLine[];
  readonly verdict: Verdict | null;
  readonly checking: boolean;
  readonly pending: boolean;
  readonly problem: string | null;
  readonly compact: boolean;
  readonly set: SetAnswer;
  readonly onContinue: () => void;
}) {
  const t = useT();
  const language = useUiLanguage();
  const fund = gateway.organisationDisplayName;
  const sectors = answers.sectors === DECLINED ? [] : answers.sectors;
  const [other, setOther] = useState(answers.otherSector !== "");
  const inList = COUNTRY_CHOICES.some((c) => c.value === answers.country);
  const [elsewhere, setElsewhere] = useState(
    answers.country !== "" && answers.country !== DECLINED && !inList,
  );
  const sectorId = useId();
  const countryId = useId();
  // The note is optional, so it is not counted as a question.
  const questions = 5 + (materials.length > 0 ? 1 : 0);
  const miss = lines.find(
    (line) => line.standing === "DOES_NOT_MEET" && line.required,
  );
  const unanswered = lines.filter(
    (line) => line.standing === "NOT_ANSWERED" && line.required,
  );
  const amountOk =
    answers.amount.trim() === "" || normaliseAmount(answers.amount) !== null;

  return (
    <div className="gqp-wrap">
      <GateHero gateway={gateway} questions={questions} />
      <div className={`gqp-form${compact ? " gqp-compact" : ""}`}>
        <form
          className="gqp-card"
          aria-label={t(`Apply to ${fund}`)}
          onSubmit={(event) => {
            event.preventDefault();
            onContinue();
          }}
          noValidate
        >
          <div className="gqp-q">
            <h2 ref={headingRef} tabIndex={-1} className="gqp-qt outline-none">
              {t("Your company")}
            </h2>
            <div className="gqp-row2">
              <div className="gq-field">
                <label className="gq-label" htmlFor="gq-name">
                  {t("Company name")}
                </label>
                <input
                  id="gq-name"
                  className="gq-input"
                  value={answers.companyName}
                  maxLength={200}
                  autoComplete="organization"
                  onChange={(e) => set("companyName", e.target.value)}
                  aria-invalid={errors.companyName !== undefined}
                />
                {errors.companyName ? (
                  <p className="gq-err">{t(errors.companyName)}</p>
                ) : null}
              </div>
              <div className="gq-field">
                <label className="gq-label" htmlFor="gq-reach">
                  {t("Best way to reach you")}
                </label>
                <input
                  id="gq-reach"
                  className="gq-input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  placeholder={t("Your email")}
                  value={answers.contactEmail}
                  onChange={(e) => set("contactEmail", e.target.value)}
                  aria-invalid={errors.contactEmail !== undefined}
                />
                {errors.contactEmail ? (
                  <p className="gq-err">{t(errors.contactEmail)}</p>
                ) : null}
              </div>
            </div>
            <div className="gq-field">
              <label className="gq-label" htmlFor="gq-line">
                {t("What it does, in one line")}{" "}
                <span className="gq-t3 font-normal">{t("(optional)")}</span>
              </label>
              <input
                id="gq-line"
                className="gq-input"
                value={answers.oneLiner}
                maxLength={280}
                onChange={(e) => set("oneLiner", e.target.value)}
              />
            </div>
            <small className="cq-caption gq-t3">
              {fromProfile.size > 0
                ? t(
                    "Filled in from your profile. Change anything that's out of date.",
                  )
                : t(
                    "They reply to this email. Nothing goes to them until you submit.",
                  )}
            </small>
          </div>

          <div className="gqp-q">
            <Pills
              label="What stage are you at?"
              options={STAGE_CHOICES}
              value={answers.stage}
              onChange={(value) => set("stage", value)}
              error={errors.stage}
            />
          </div>

          <div className="gqp-q">
            <span className="gqp-qt" id={sectorId}>
              {t("Your sector, in a few words")}
            </span>
            <div className="gqp-opts" role="group" aria-labelledby={sectorId}>
              {SECTOR_CHOICES.map((choice) => {
                const on = sectors.includes(choice.value);
                return (
                  <button
                    key={choice.value}
                    type="button"
                    aria-pressed={on}
                    className="gqp-pill"
                    onClick={() =>
                      set(
                        "sectors",
                        on
                          ? sectors.filter((s) => s !== choice.value)
                          : [...sectors, choice.value].slice(0, 5),
                      )
                    }
                  >
                    {t(choice.label)}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={other}
                className="gqp-pill"
                onClick={() => {
                  if (answers.sectors === DECLINED) set("sectors", []);
                  setOther(!other);
                  if (other) set("otherSector", "");
                }}
              >
                {t("Something else")}
              </button>
              <button
                type="button"
                aria-pressed={answers.sectors === DECLINED}
                className="gqp-pill"
                onClick={() => {
                  setOther(false);
                  set("otherSector", "");
                  set("sectors", answers.sectors === DECLINED ? [] : DECLINED);
                }}
              >
                {t("Preferred not to say")}
              </button>
            </div>
            {other ? (
              <input
                className="gq-input"
                aria-label={t("Your sector, in a few words")}
                placeholder={t("In a few words, like insurance software")}
                maxLength={120}
                value={answers.otherSector}
                onChange={(e) => set("otherSector", e.target.value)}
              />
            ) : null}
            {errors.sectors ? (
              <p className="gq-err">{t(errors.sectors)}</p>
            ) : null}
          </div>

          <div className="gqp-q">
            <span className="gqp-qt">{t("How much are you raising?")}</span>
            <div className="gq-field">
              <label className="gq-label" htmlFor="gq-amount">
                {t("Exact amount")}
              </label>
              <div className="flex gap-2">
                <select
                  className="gq-input"
                  style={{ width: 96 }}
                  aria-label={t("Currency")}
                  value={answers.currency}
                  onChange={(e) => set("currency", e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{t(c)}</option>
                  ))}
                </select>
                <input
                  id="gq-amount"
                  className="gq-input"
                  inputMode="decimal"
                  placeholder={t("Exact amount, like 1,200,000")}
                  value={answers.amount}
                  aria-invalid={errors.amount !== undefined || !amountOk}
                  aria-describedby="gq-amount-hint"
                  onChange={(e) => {
                    set("amount", e.target.value);
                    if (answers.band === DECLINED) set("band", "");
                  }}
                />
              </div>
              {errors.amount ? (
                <p className="gq-err">{t(errors.amount)}</p>
              ) : null}
              <small id="gq-amount-hint" className="cq-caption gq-t3">
                {t(
                  "Add the exact amount so the round-size rule can be checked. Without it, that rule stays unanswered.",
                )}
              </small>
            </div>
          </div>

          <div className="gqp-q">
            <span className="gqp-qt" id={countryId}>
              {t("Where are you based?")}
            </span>
            <div
              className="gqp-opts"
              role="radiogroup"
              aria-labelledby={countryId}
            >
              {COUNTRY_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={answers.country === choice.value}
                  className="gqp-pill"
                  onClick={() => {
                    setElsewhere(false);
                    set("country", choice.value);
                  }}
                >
                  {countryName(choice.value, language) ?? t(choice.label)}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={elsewhere}
                className="gqp-pill"
                onClick={() => {
                  setElsewhere(true);
                  if (inList || answers.country === DECLINED)
                    set("country", "");
                }}
              >
                {t("Elsewhere")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={answers.country === DECLINED}
                className="gqp-pill"
                onClick={() => {
                  setElsewhere(false);
                  set("country", DECLINED);
                }}
              >
                {t("Preferred not to say")}
              </button>
            </div>
            {elsewhere ? (
              <select
                className="gq-input"
                aria-label={t("Country")}
                value={
                  inList || answers.country === DECLINED ? "" : answers.country
                }
                onChange={(e) => set("country", e.target.value)}
              >
                <option value="">{t("Choose a country")}</option>
                {MORE_COUNTRIES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {countryName(choice.value, language) ?? t(choice.label)}
                  </option>
                ))}
              </select>
            ) : null}
            {errors.country ? (
              <p className="gq-err">{t(errors.country)}</p>
            ) : null}
          </div>

          {materials.length === 0 ? null : (
            <div className="gqp-q">
              <span className="gqp-qt">{t("What to share")}</span>
              <p className="cq-body-sm gq-t2">
                {t(
                  `Pick what ${fund} should see. They only get what you tick.`,
                )}
              </p>
              <ul className="gq-hair">
                {materials.map((material) => (
                  <li key={material.id}>
                    <label className="gq-mat">
                      <input
                        type="checkbox"
                        checked={answers.materials.includes(material.id)}
                        onChange={(e) =>
                          set(
                            "materials",
                            e.target.checked
                              ? [...answers.materials, material.id]
                              : answers.materials.filter(
                                  (id) => id !== material.id,
                                ),
                          )
                        }
                      />
                      <span className="flex-1">
                        <b className="block font-medium">{material.name}</b>
                        <span className="cq-caption gq-t2">
                          {t(material.detail)}
                        </span>
                      </span>
                      <FileText {...icon} size={ICON_SIZE.regular} />
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="gqp-q">
            <label className="gqp-qt" htmlFor="gq-msg">
              {t(`A note to ${fund}`)}{" "}
              <span className="gq-t3 text-sm font-normal">
                {t("(optional)")}
              </span>
            </label>
            <textarea
              id="gq-msg"
              className="gq-input"
              rows={3}
              maxLength={2050}
              value={answers.note}
              aria-invalid={errors.note !== undefined}
              onChange={(e) => set("note", e.target.value)}
            />
            {errors.note ? <p className="gq-err">{t(errors.note)}</p> : null}
          </div>

          <div className="gqp-q">
            {problem === null ? null : (
              <div className="gq-banner gq-banner-err" role="alert">
                <CircleAlert {...icon} />
                <span>
                  <b>{t("Not saved.")}</b> {t(problem)}{" "}
                  {t("Your answers are still here.")}{" "}
                  <Button
                    size="compact"
                    className="ms-1.5"
                    onClick={onContinue}
                    disabled={pending}
                  >
                    <RotateCw {...icon} />
                    {t("Try again")}
                  </Button>
                </span>
              </div>
            )}
            {verdict === "NOT_A_FIT" && miss !== undefined ? (
              <div className="gq-banner" role="status">
                <CircleAlert {...icon} />
                <span>
                  {t(
                    `${fund} only takes companies that meet "${miss.label}". That's about fit, not quality.`,
                  )}{" "}
                  {compact ? null : (
                    <a
                      href="/discover?tab=investors"
                      className="underline underline-offset-4"
                    >
                      {t("Find investors who fit")}
                    </a>
                  )}
                </span>
              </div>
            ) : verdict === "NEEDS_ANSWERS" && unanswered.length > 0 ? (
              <div className="gq-banner" role="status">
                <CircleAlert {...icon} />
                <span>
                  {t("Unanswered isn't a no, but this gate needs")}{" "}
                  {t(
                    unanswered
                      .map((line) =>
                        dimensionWord(line.dimension).toLowerCase(),
                      )
                      .join(" and "),
                  )}{" "}
                  {t("to decide.")}
                </span>
              </div>
            ) : null}
            <Button
              variant="primary"
              type="submit"
              className="self-start"
              disabled={pending || verdict === "NOT_A_FIT"}
            >
              {pending ? t("Checking…") : t("Continue to interview")}
            </Button>
            <span className="cq-caption gq-t3">
              {t(
                "Next, a few questions from Q, then you review everything before it goes.",
              )}
            </span>
          </div>
        </form>
        <StandingPanel lines={lines} checking={checking} />
      </div>
      <p className="cq-caption gq-t3 mt-4">
        {gateway.replyWithinDays
          ? t(
              `${fund} promises a reply within ${gateway.replyWithinDays} working days. Nothing is sent until you press Submit.`,
            )
          : t("Nothing is sent until you press Submit.")}
      </p>
    </div>
  );
}
