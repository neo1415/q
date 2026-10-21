"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  ApplicationContactDtoSchema,
  type ApplicationContactDto,
  type ApplicationCoverageDto,
  type ApplicationSummaryDto,
  type PublicGatewayDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
  RotateCw,
} from "@capital-q/ui/icons";

import {
  interviewProgressAction,
  saveAnswersAction,
  startFormAction,
  submitApplicationAction,
} from "../apply-actions";
import { FitGlyph, type GlyphKind } from "../fit-glyph";
import "../gateq.css";
import "../gateq-v2.css";
import { shareMaterialsAction } from "../materials-actions";
import { readRecovery, saveRecovery, amendRecovery } from "./session-recovery";
import { AnswersPage } from "./answers-page";
import { ContactStep } from "./contact-step";
import {
  answersFromProfile,
  contactFromProfile,
  dimensionWord,
  ownLabel,
  FLOW_PROGRESS,
  maySend,
  onQuestionsPage,
  pageRequest,
  progressFor,
  reachWords,
  ruleLines,
  validatePage,
  verdictFor,
  type FormAnswers,
  type FormPrefill,
  type FormStep,
  type InterviewLine,
  type Material,
  type RuleLine,
  type RuleStanding,
  type StepErrors,
} from "./form-model";
import { InterviewStep } from "./interview-step";
import { ReviewStep } from "./review-step";
import { useT } from "@/features/i18n/language";

/**
 * The GateQ form (F1, 2026-10-06; design gatepub-1 2026-10-21, "Form with
 * live rule standing").
 *
 * A founder answers every question on one page, with tappable answers and
 * "Preferred not to say" everywhere, and sees beside it how they stand
 * against the investor's published rules: each answer is saved and the
 * API's deterministic engine answers rule by rule (no model). Then the
 * contact is confirmed (by account or by an emailed code), then the
 * interview with Q whose turns the server keeps, then a review of the API's
 * coverage check. Submit exists only on the review: until the founder
 * presses "Submit to <fund>", the investor receives nothing (the API's
 * submission is the disclosure boundary). In the embed the credential
 * lives only in this component's memory: a third-party frame has no cookie
 * to lean on.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

const GLYPH: Readonly<Record<RuleStanding, GlyphKind>> = {
  MEETS: "fit",
  DOES_NOT_MEET: "no",
  NOT_ANSWERED: "unk",
};

const STANDING_WORDS: Readonly<Record<RuleStanding, string>> = {
  MEETS: "Meets",
  DOES_NOT_MEET: "Doesn't meet",
  NOT_ANSWERED: "Not answered",
};

/** For the development gallery and the screenshot checks only. */
export type GateQFormPreview = {
  readonly step: FormStep;
  readonly answers?: FormAnswers;
  readonly application?: ApplicationSummaryDto | null;
  readonly problem?: string | null;
  readonly loading?: boolean;
  /** Slice 1: the confirmed contact, the interview so far, the review. */
  readonly contact?: ApplicationContactDto | null;
  readonly transcript?: readonly InterviewLine[];
  readonly coverage?: ApplicationCoverageDto;
};

export type GateQFormProps = {
  readonly gateway: PublicGatewayDto;
  /** Inside an investor's website: narrower, no app chrome. */
  readonly compact?: boolean;
  /** Inside the signed-in app: the sticky bar clears the tab bar. */
  readonly inApp?: boolean;
  /** The founder's Capital Q profile, when signed in. */
  readonly prefill?: FormPrefill | null;
  /** Signed in with no company yet: find or add it first. */
  readonly needsCompany?: boolean;
  /** Documents the signed-in founder may choose to share. */
  readonly materials?: readonly Material[];
  readonly preview?: GateQFormPreview;
};

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function formRequest<T>(
  operation: () => Promise<T>,
): Promise<T | { readonly ok: false; readonly message: string }> {
  try {
    return await operation();
  } catch {
    return {
      ok: false,
      message:
        "The connection was interrupted. Your saved application is still here; please try again.",
    };
  }
}

export function GateQForm({
  gateway,
  compact = false,
  inApp = false,
  prefill = null,
  needsCompany = false,
  materials = [],
  preview,
}: GateQFormProps) {
  const t = useT();

  const fund = gateway.organisationDisplayName;
  const anonymous = prefill === null;
  const initial = answersFromProfile(prefill);
  const [answers, setAnswers] = useState<FormAnswers>(() => {
    const base = preview?.answers ?? initial.answers;
    // The deck goes by default; everything else only if ticked.
    const deck = materials.find((m) => /deck/i.test(m.name));
    return preview?.answers !== undefined || deck === undefined
      ? base
      : { ...base, materials: [deck.id] };
  });
  const fromProfile = initial.fromProfile;
  // Design gatepub-1: the questions come first, with the standing beside
  // them; the contact is confirmed once they choose to go on.
  const [step, setStep] = useState<FormStep>(preview?.step ?? "company");
  // Slice 1: the contact as the API holds it, and why we came back to it.
  const [contact, setContact] = useState<ApplicationContactDto | null>(
    preview?.contact ?? null,
  );
  const [contactNotice, setContactNotice] = useState<string | null>(null);
  // The credential, for the steps that render from it. The ref is the
  // synchronous copy the handlers use.
  const [credential, setCredential] = useState<string | null>(null);
  const [errors, setErrors] = useState<StepErrors>({});
  const [application, setApplication] = useState<ApplicationSummaryDto | null>(
    preview?.application ?? null,
  );
  const [problem, setProblem] = useState<string | null>(
    preview?.problem ?? null,
  );
  const [pending, startTransition] = useTransition();
  const token = useRef<string | null>(null);
  const submitKey = useRef<string>("");
  const [recovering, setRecovering] = useState(preview === undefined);
  const [touched, setTouched] = useState(false);
  const [submissionStarted, setSubmissionStarted] = useState(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (preview !== undefined) return;
    startTransition(async () => {
      await Promise.resolve();
      const restored = readRecovery(gateway.publicId);
      if (restored === null) {
        setRecovering(false);
        return;
      }
      token.current = restored.token;
      setCredential(restored.token);
      setAnswers(restored.answers);
      submitKey.current = restored.submitKey;
      setSubmissionStarted(restored.submitKey !== "");
      const progress = await formRequest(() =>
        interviewProgressAction(restored.token),
      );
      if (!progress.ok) {
        setProblem(progress.message);
        setStep("company");
        setRecovering(false);
        return;
      }
      setApplication(progress.application);
      const details = ApplicationContactDtoSchema.safeParse(
        Reflect.get(progress.coverage.contact, "details"),
      );
      const canonical = details.success
        ? details.data
        : (restored.contact ?? null);
      setContact(
        canonical === null
          ? null
          : {
              ...canonical,
              emailConfirmed: progress.coverage.contact.confirmed,
              confirmedVia: progress.coverage.contact.confirmed
                ? canonical.confirmedVia
                : null,
            },
      );
      const pastQuestions =
        restored.interview ||
        restored.step === "interview" ||
        restored.step === "review" ||
        restored.step === "contact";
      setStep(
        progress.application.submittedAt !== null
          ? "sent"
          : !pastQuestions
            ? "company"
            : !progress.coverage.contact.confirmed
              ? "contact"
              : restored.step === "review"
                ? "review"
                : "interview",
      );
      setRecovering(false);
    });
  }, [gateway.publicId, preview]);
  useEffect(() => {
    if (preview !== undefined || recovering || token.current === null) return;
    const old = readRecovery(gateway.publicId);
    saveRecovery(gateway.publicId, {
      token: token.current,
      answers,
      step,
      contact,
      interview: step === "interview" || step === "review",
      pendingTurn: old?.pendingTurn ?? null,
      submitKey: submitKey.current,
    });
  }, [answers, step, contact, recovering, gateway.publicId, preview]);

  const lines = ruleLines(gateway, application);
  const verdict = verdictFor(application);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const set = <K extends keyof FormAnswers>(
    field: K,
    value: FormAnswers[K],
  ) => {
    if (submissionStarted && field === "materials") return;
    setAnswers((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setTouched(true);
  };

  const ensureToken = async (): Promise<string | null> => {
    if (token.current !== null) return token.current;
    const started = await formRequest(() => startFormAction(gateway.publicId));
    if (!started.ok) {
      setProblem(started.message);
      return null;
    }
    token.current = started.sessionToken;
    setCredential(started.sessionToken);
    setApplication(started.application);
    saveRecovery(gateway.publicId, {
      token: started.sessionToken,
      answers,
      step,
      interview: false,
      contact,
      pendingTurn: null,
      submitKey: "",
    });
    return started.sessionToken;
  };

  const onContactConfirmed = (confirmed: ApplicationContactDto) => {
    setContact(confirmed);
    setContactNotice(null);
    // The form's reply-to answer follows the confirmed contact, so the
    // investor never gets an address nobody confirmed.
    setAnswers((current) => ({
      ...current,
      contactName: confirmed.name,
      contactEmail: confirmed.email,
      companyName:
        current.companyName.trim() === ""
          ? confirmed.companyName
          : current.companyName,
    }));
    // The questions were answered and admitted before the contact step.
    setStep("interview");
  };

  // Design gatepub-1: the standing follows the answers. Each change (after
  // a short pause) is saved and the API's deterministic engine answers;
  // only the latest answer is shown, never a stale one over a newer.
  const liveSeq = useRef(0);
  const [checking, setChecking] = useState(false);
  const liveKey = JSON.stringify(pageRequest(answers));
  const liveCheck = async (seq: number) => {
    // A newer answer, or "Continue", already superseded this one.
    if (seq !== liveSeq.current) return;
    const credential = await ensureToken();
    if (credential === null || seq !== liveSeq.current) return;
    setChecking(true);
    const saved = await formRequest(() =>
      saveAnswersAction(credential, pageRequest(answers)),
    );
    if (seq !== liveSeq.current) return;
    setChecking(false);
    if (saved.ok) setApplication(saved.application);
  };
  const liveRef = useRef(liveCheck);
  useEffect(() => {
    liveRef.current = liveCheck;
  });
  const questionsPage = onQuestionsPage(step);
  // A signed-in founder's profile already answers some questions: check
  // those at once, so the panel never says "not answered" for them.
  const live = touched || (prefill !== null && fromProfile.size > 1);
  useEffect(() => {
    if (
      preview !== undefined ||
      recovering ||
      !questionsPage ||
      !live ||
      needsCompany ||
      !gateway.acceptingApplications
    )
      return;
    const seq = liveSeq.current + 1;
    liveSeq.current = seq;
    const timer = window.setTimeout(() => void liveRef.current(seq), 500);
    return () => window.clearTimeout(timer);
  }, [
    liveKey,
    live,
    preview,
    recovering,
    questionsPage,
    needsCompany,
    gateway.acceptingApplications,
  ]);

  // "Continue to interview": the whole page is saved, the engine answers,
  // and only an admitted application goes on (the API refuses the rest).
  const onContinue = () => {
    if (preview !== undefined) return;
    const found = validatePage(answers);
    if (Object.values(found).some((value) => value !== undefined)) {
      setErrors(found);
      return;
    }
    setProblem(null);
    liveSeq.current += 1;
    startTransition(async () => {
      const credential = await ensureToken();
      if (credential === null) return;
      const saved = await formRequest(() =>
        saveAnswersAction(credential, pageRequest(answers)),
      );
      setChecking(false);
      if (!saved.ok) {
        setProblem(saved.message);
        return;
      }
      setApplication(saved.application);
      if (!maySend(verdictFor(saved.application))) return;
      setStep(contact?.emailConfirmed === true ? "interview" : "contact");
    });
  };

  // The only submission path: the review's Submit button.
  const onSubmit = () => {
    if (preview !== undefined || step !== "review") return;
    setProblem(null);
    if (submitKey.current === "") submitKey.current = key("send");
    setSubmissionStarted(true);
    amendRecovery(gateway.publicId, { submitKey: submitKey.current });
    startTransition(async () => {
      const credential = token.current;
      if (credential === null) return;
      const resumed = await formRequest(() =>
        interviewProgressAction(credential),
      );
      if (!resumed.ok) {
        setProblem(resumed.message);
        return;
      }
      if (resumed.application.submittedAt !== null) {
        setApplication(resumed.application);
        setStep("sent");
        return;
      }
      if (readRecovery(gateway.publicId)?.pendingTurn != null) {
        setProblem("Recover your last interview answer before submitting.");
        setStep("interview");
        return;
      }
      if (!anonymous) {
        // Only what the founder ticked (maybe nothing); the API checks each
        // is theirs and links the application to them for their GateQ page.
        const shared = await formRequest(() =>
          shareMaterialsAction(credential, answers.materials),
        );
        if (!shared.ok) {
          setProblem(shared.message);
          return;
        }
      }
      const sent = await formRequest(() =>
        submitApplicationAction(credential, submitKey.current),
      );
      if (!sent.ok) {
        if (
          "contactNotConfirmed" in sent &&
          sent.contactNotConfirmed === true
        ) {
          // 409: back to the contact step; everything else is kept. The
          // refused request recorded nothing, so the next Submit is new.
          submitKey.current = "";
          setContact((current) =>
            current === null
              ? null
              : { ...current, emailConfirmed: false, confirmedVia: null },
          );
          setContactNotice(
            "Confirm your contact email before submitting. Your answers and interview are saved.",
          );
          setStep("contact");
          return;
        }
        setProblem(sent.message);
        return;
      }
      setApplication(sent.application);
      setStep("sent");
    });
  };

  const n = progressFor(step);
  const pastCheck =
    step === "contact" ||
    step === "interview" ||
    step === "review" ||
    step === "sent";
  const showResults = pastCheck || application !== null;
  const shell = `gq-form${compact ? " gq-compact" : ""}${inApp ? " gq-in-app" : ""}`;

  if (preview?.loading === true || recovering) {
    return (
      <div className={shell} aria-busy="true">
        <div className="gq-sk" style={{ width: "100%", height: 300 }} />
        <div className="flex flex-col gap-3.5">
          <div className="gq-sk" style={{ width: "40%", height: 24 }} />
          <div className="gq-sk" style={{ width: "100%", height: 44 }} />
          <div className="gq-sk" style={{ width: "100%", height: 44 }} />
          <div className="gq-sk" style={{ width: "70%", height: 44 }} />
        </div>
      </div>
    );
  }

  const card = (
    <GateCard
      gateway={gateway}
      lines={lines}
      showResults={showResults && (pastCheck || verdict === "NOT_A_FIT")}
      openByDefault={!compact}
    />
  );

  if (needsCompany) {
    return (
      <div className={shell}>
        {card}
        <div className="gq-state">
          <span className="gq-state-ic">
            <Building2 {...icon} size={ICON_SIZE.prominent} />
          </span>
          <h2 className="cq-title-sm">{t("First, find your company")}</h2>
          <p className="cq-body-sm gq-t2">
            {t(
              `${fund} needs to know which company is applying. Find it on Capital Q or add it in a minute: upload your deck and Q fills in the rest.`,
            )}
          </p>
          <a href="/gateq?tab=claim" className={buttonClassName("primary")}>
            {t("Find my startup")}
          </a>
        </div>
      </div>
    );
  }

  if (!gateway.acceptingApplications) {
    return (
      <div className={shell}>
        {card}
        <div className="gq-state">
          <span className="gq-state-ic">
            <CircleAlert {...icon} size={ICON_SIZE.prominent} />
          </span>
          <h2 className="cq-title-sm">
            {t(`${fund} isn't taking applications right now`)}
          </h2>
          <p className="cq-body-sm gq-t2">
            {t("Their gate is closed. You can still read what they look for.")}
          </p>
        </div>
      </div>
    );
  }

  // Design gatepub-1: the questions are one page with the standing beside
  // them. A required rule not met is said there, plainly, and the page
  // stays: the founder can change an answer and see it at once.
  if (questionsPage) {
    return (
      <AnswersPage
        headingRef={heading}
        gateway={gateway}
        answers={answers}
        errors={errors}
        fromProfile={fromProfile}
        materials={materials}
        lines={lines}
        verdict={verdict}
        checking={checking}
        pending={pending}
        problem={problem}
        compact={compact}
        set={set}
        onContinue={onContinue}
      />
    );
  }

  const stage =
    step === "contact"
      ? "Your details"
      : step === "interview"
        ? "Interview with Q"
        : "Review";
  const head = (
    <div className="flex flex-col gap-2.5">
      <p className="cq-caption gq-t2">
        {t("Apply to")} {fund} · {t(stage)}
      </p>
      <div className="gq-steps" aria-hidden="true">
        {FLOW_PROGRESS.map((segment, i) => (
          <i key={segment} className={i + 1 <= n ? "on" : ""} />
        ))}
      </div>
    </div>
  );

  return (
    <div className={shell}>
      {card}
      <div className="flex min-w-0 flex-col gap-4">
        {step === "sent" ? null : head}
        {problem === null ? null : (
          <div className="gq-banner gq-banner-err" role="alert">
            <CircleAlert {...icon} />
            <span>
              <b>{step === "review" ? t("Not sent.") : t("Not saved.")}</b>{" "}
              {t(problem)} {t("Your answers are still here.")}{" "}
              <Button
                size="compact"
                className="ms-1.5"
                onClick={step === "review" ? onSubmit : onContinue}
                disabled={pending}
              >
                <RotateCw {...icon} />
                {t("Try again")}
              </Button>
            </span>
          </div>
        )}
        {step === "contact" ? (
          <ContactStep
            headingRef={heading}
            fund={fund}
            signedIn={!anonymous}
            initial={{
              ...contactFromProfile(prefill),
              // The page's answers lead: the email they gave to be reached
              // at, and the company they named.
              ...(answers.contactEmail.trim() === ""
                ? {}
                : { email: answers.contactEmail.trim() }),
              ...(answers.companyName.trim() === ""
                ? {}
                : { companyName: answers.companyName.trim() }),
              ...(contact === null
                ? {}
                : {
                    name: contact.name,
                    email: contact.email,
                    role: contact.role,
                    companyName: contact.companyName,
                    phone: contact.phone ?? "",
                    preferredChannel: contact.preferredChannel ?? "",
                  }),
            }}
            saved={contact}
            ensureToken={ensureToken}
            onConfirmed={onContactConfirmed}
            notice={contactNotice}
          />
        ) : null}
        {step === "interview" ? (
          <InterviewStep
            headingRef={heading}
            fund={fund}
            companyName={answers.companyName}
            sessionToken={credential}
            gatewayPublicId={gateway.publicId}
            participantName={contact?.name ?? ""}
            onFinish={() => setStep("review")}
            onApplication={setApplication}
            preview={
              preview?.transcript === undefined
                ? undefined
                : { lines: preview.transcript }
            }
          />
        ) : null}
        {step === "review" ? (
          <ReviewStep
            headingRef={heading}
            fund={fund}
            sessionToken={credential}
            contact={contact}
            sharedDocuments={materials
              .filter((m) => answers.materials.includes(m.id))
              .map((m) => m.name)}
            hasNote={answers.note.trim() !== ""}
            pending={pending}
            submissionStarted={submissionStarted}
            onSubmit={onSubmit}
            onContact={() => setStep("contact")}
            onInterview={() => setStep("interview")}
            preview={preview?.coverage}
          />
        ) : null}
        {step === "sent" ? (
          <div className="gq-result" style={{ padding: "8px 0" }}>
            <span className="text-(--cq-positive)">
              <FitGlyph kind="fit" size={40} />
            </span>
            <h1 ref={heading} tabIndex={-1} className="cq-title-lg">
              {t(`Thank you. ${fund} has your application`)}
            </h1>
            <p className="cq-body gq-t2" style={{ maxWidth: "52ch" }}>
              {t(
                contact === null
                  ? "Their team will review it, and may contact you."
                  : `Their team will review it, and may contact you ${reachWords(contact)}.`,
              )}{" "}
              {gateway.replyWithinDays
                ? t(
                    `${fund} has committed to reply within ${gateway.replyWithinDays} working days. `,
                  )
                : ""}
              {inApp
                ? t(
                    "You'll see every step on your GateQ page, and Q will tell you if they reply.",
                  )
                : ""}
            </p>
            {inApp || !anonymous ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href="/gateq?tab=applications"
                  className={buttonClassName("primary")}
                >
                  {t("See your applications")}
                </a>
              </div>
            ) : null}
          </div>
        ) : step === "contact" ? (
          <div className="gq-formbar">
            <Button
              variant="quiet"
              onClick={() => setStep("company")}
              disabled={pending}
            >
              <ChevronLeft {...icon} />
              {t("Back to your answers")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function GateCard({
  gateway,
  lines,
  showResults,
  openByDefault,
}: {
  readonly gateway: PublicGatewayDto;
  readonly lines: readonly RuleLine[];
  readonly showResults: boolean;
  readonly openByDefault: boolean;
}) {
  const t = useT();

  const fund = gateway.organisationDisplayName;
  return (
    <aside
      className="gq-card gq-gatecard"
      aria-label={t(`What ${fund} looks for`)}
    >
      <div className="flex items-center gap-3">
        <span
          className="gq-logo"
          style={{ width: 44, height: 44, borderRadius: "50%" }}
        >
          {gateway.organisationPhotoUrl ? (
            // Signed URL from the API; the investor's own public card image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gateway.organisationPhotoUrl} alt="" />
          ) : (
            t(fund.slice(0, 1).toUpperCase())
          )}
        </span>
        <div className="min-w-0">
          <p className="cq-title-sm">{fund}</p>
          <p className="cq-caption gq-t2">
            {gateway.replyWithinDays
              ? t(`Replies within ${gateway.replyWithinDays} working days`)
              : t(gateway.title)}
          </p>
        </div>
      </div>
      <details open={openByDefault || showResults}>
        <summary>
          <span className="cq-label">{t("What they look for")}</span>
          <span className="gq-t3 flex items-center gap-1 text-[13px]">
            {lines.length} {t("rule")}
            {lines.length === 1 ? "" : "s"}
            <ChevronDown {...icon} />
          </span>
        </summary>
        <div className="flex flex-col gap-3">
          {gateway.description ? (
            <p className="cq-body-sm">{t(gateway.description)}</p>
          ) : null}
          {lines.length === 0 ? (
            <p className="cq-body-sm gq-t2">
              {t(
                "No published criteria yet: nothing is checked, and every founder can share with them.",
              )}
            </p>
          ) : (
            <ul className="gq-crit">
              {lines.map((line) => (
                <li key={line.label}>
                  {showResults && line.standing !== null ? (
                    <FitGlyph kind={GLYPH[line.standing]} />
                  ) : (
                    <span className="gq-t3">
                      <Check {...icon} />
                    </span>
                  )}
                  <span>
                    <b className="font-medium">
                      {t(dimensionWord(line.dimension))}
                    </b>
                    {line.required ? (
                      ""
                    ) : (
                      <span className="gq-t3"> {t("· preferred")}</span>
                    )}
                    {ownLabel(line) === null ? null : (
                      <>
                        <br />
                        <span className="gq-t2">{ownLabel(line)}</span>
                      </>
                    )}
                    {showResults && line.standing !== null ? (
                      <span className="sr-only">
                        : {t(STANDING_WORDS[line.standing])}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="cq-caption gq-t3">
            {t("Nothing is sent until you press Submit.")}
          </p>
        </div>
      </details>
    </aside>
  );
}
