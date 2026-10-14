"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";

import {
  GATEQ_NOTE_MAX_CHARS,
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
  FileText,
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
import { shareMaterialsAction } from "../materials-actions";
import { readRecovery, saveRecovery, amendRecovery } from "./session-recovery";
import { ContactStep } from "./contact-step";
import {
  answersFromProfile,
  bandFor,
  contactFromProfile,
  COUNTRY_CHOICES,
  CURRENCIES,
  DECLINED,
  dimensionWord,
  draftNote,
  FLOW_PROGRESS,
  FORM_STEPS,
  formatMoney,
  INSTRUMENT_CHOICES,
  LEAD_CHOICES,
  maySend,
  MORE_COUNTRIES,
  normaliseAmount,
  progressFor,
  RAISE_BANDS,
  reachWords,
  requestFor,
  ruleLines,
  SECTOR_CHOICES,
  STAGE_CHOICES,
  stepForDimension,
  validateStep,
  verdictFor,
  verdictTitle,
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

/**
 * The GateQ form (F1, 2026-10-06; design a/gateq.html "Founder: GateQ form").
 *
 * A founder checks their fit with an investor in four short steps, with
 * tappable answers and "I'd rather not say" everywhere. The investor's rules
 * are on screen first; after each step the API's deterministic engine
 * answers rule by rule. Sending is a separate press at the end: until the
 * founder presses "Submit to <fund>", the investor receives nothing (the
 * API's submission is the disclosure boundary). In the embed the credential
 * lives only in this component's memory: a third-party frame has no cookie
 * to lean on.
 *
 * GateQ slice 1 (2026-10-13): contact first (confirmed by account or by an
 * emailed code), then the four steps and the rule check, then an interview
 * with Q whose turns the server keeps, then a review of the API's coverage
 * check. Submit exists only on the review.
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
  const [step, setStep] = useState<FormStep>(preview?.step ?? "contact");
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
        setStep("contact");
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
      setStep(
        progress.application.submittedAt !== null
          ? "sent"
          : !progress.coverage.contact.confirmed
            ? "contact"
            : restored.interview && restored.step === "check"
              ? "interview"
              : restored.step,
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
    setStep("company");
  };

  const next = (from: FormStep): FormStep => {
    const index = FORM_STEPS.indexOf(from as (typeof FORM_STEPS)[number]);
    return index === FORM_STEPS.length - 1
      ? "check"
      : (FORM_STEPS[index + 1] ?? "check");
  };

  const onContinue = () => {
    if (preview !== undefined) return;
    const found = validateStep(step, answers, { anonymous });
    if (Object.values(found).some((value) => value !== undefined)) {
      setErrors(found);
      return;
    }
    setProblem(null);
    startTransition(async () => {
      const credential = await ensureToken();
      if (credential === null) return;
      const saved = await formRequest(() =>
        saveAnswersAction(credential, requestFor(step, answers)),
      );
      if (!saved.ok) {
        setProblem(saved.message);
        return;
      }
      setApplication(saved.application);
      const upcoming = next(step);
      if (upcoming === "note" && answers.note === "") {
        set("note", draftNote(fund, answers));
      }
      setStep(upcoming);
    });
  };

  // Slice 1: the check admits; the interview comes before the review.
  const onToInterview = () => {
    if (!maySend(verdict)) return;
    setProblem(null);
    setStep("interview");
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

  const onBack = () => {
    setProblem(null);
    if (step === "company") return setStep("contact");
    if (step === "check") return setStep("note");
    if (step === "interview") return setStep("check");
    if (step === "review") return setStep("interview");
    const index = FORM_STEPS.indexOf(step as (typeof FORM_STEPS)[number]);
    if (index > 0) setStep(FORM_STEPS[index - 1] ?? "company");
  };

  const n = progressFor(step);
  const formStep = (FORM_STEPS as readonly FormStep[]).includes(step);
  const pastCheck =
    step === "check" ||
    step === "interview" ||
    step === "review" ||
    step === "sent";
  const showResults = pastCheck || application !== null;
  const shell = `gq-form${compact ? " gq-compact" : ""}${inApp ? " gq-in-app" : ""}`;

  if (preview?.loading === true || recovering) {
    return (
      <div className={shell} aria-busy="true">
        <div
          className="gq-sk"
          style={{ width: "100%", height: 300, borderRadius: 14 }}
        />
        <div className="flex flex-col gap-3.5">
          <div className="gq-sk" style={{ width: "40%", height: 24 }} />
          <div
            className="gq-sk"
            style={{ width: "100%", height: 44, borderRadius: 22 }}
          />
          <div
            className="gq-sk"
            style={{ width: "100%", height: 44, borderRadius: 22 }}
          />
          <div
            className="gq-sk"
            style={{ width: "70%", height: 44, borderRadius: 22 }}
          />
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
          <h2 className="cq-title-sm">First, find your company</h2>
          <p className="cq-body-sm gq-t2">
            {fund} needs to know which company is applying. Find it on Capital Q
            or add it in a minute: upload your deck and Q fills in the rest.
          </p>
          <a href="/gateq?tab=claim" className={buttonClassName("primary")}>
            Find my startup
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
            {fund} isn&apos;t taking applications right now
          </h2>
          <p className="cq-body-sm gq-t2">
            Their gate is closed. You can still read what they look for.
          </p>
        </div>
      </div>
    );
  }

  // A required rule established as unmet: say so plainly, offer the fix.
  // (The interview and review show the API's own access answer instead of
  // swapping the screen out from under the founder mid-conversation.)
  if (verdict === "NOT_A_FIT" && (formStep || step === "check")) {
    const miss = lines.find((line) => line.standing === "DOES_NOT_MEET");
    const met = lines.filter((line) => line.standing === "MEETS").length;
    return (
      <div className={shell}>
        {card}
        <div className="gq-card gq-result">
          <h2 ref={heading} tabIndex={-1} className="cq-title-md">
            {verdictTitle("NOT_A_FIT", fund, lines)}
          </h2>
          <p className="cq-body gq-t2">
            {answers.companyName || "Your company"} meets {met} of their{" "}
            {lines.length} rules, but this gate only accepts companies that meet
            all of the required ones. That&apos;s about fit, not quality.
          </p>
          <ResultLines lines={lines} />
          <p className="cq-body-sm gq-t2">
            Something wrong?{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() =>
                setStep(
                  miss === undefined
                    ? "company"
                    : stepForDimension(miss.dimension),
                )
              }
            >
              Change your answer
            </button>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            {compact ? null : (
              <a
                href="/discover?tab=investors"
                className={buttonClassName("primary")}
              >
                Find investors who fit
              </a>
            )}
            <Button variant="quiet" onClick={onBack}>
              Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const stage =
    step === "contact"
      ? "Your details"
      : formStep
        ? `Step ${FORM_STEPS.indexOf(step as (typeof FORM_STEPS)[number]) + 1} of 4`
        : step === "check"
          ? "Your fit"
          : step === "interview"
            ? "Interview with Q"
            : "Review";
  const head = (
    <div className="flex flex-col gap-2.5">
      <p className="cq-caption gq-t2">
        Apply to {fund} · {stage}
      </p>
      <div className="gq-steps" aria-hidden="true">
        {FLOW_PROGRESS.map((segment, i) => (
          <i key={segment} className={i + 1 <= n ? "on" : ""} />
        ))}
      </div>
    </div>
  );

  // The steps that carry their own buttons.
  const ownBar =
    step === "contact" || step === "interview" || step === "review";

  return (
    <div className={shell}>
      {card}
      <div className="flex min-w-0 flex-col gap-4">
        {step === "sent" ? null : head}
        {problem === null ? null : (
          <div className="gq-banner gq-banner-err" role="alert">
            <CircleAlert {...icon} />
            <span>
              <b>{step === "review" ? "Not sent." : "Not saved."}</b> {problem}{" "}
              Your answers are still here.{" "}
              <Button
                size="compact"
                className="ml-1.5"
                onClick={step === "review" ? onSubmit : onContinue}
                disabled={pending}
              >
                <RotateCw {...icon} />
                Try again
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
        {step === "company" ? (
          <CompanyStep
            headingRef={heading}
            answers={answers}
            errors={errors}
            fromProfile={fromProfile}
            set={set}
          />
        ) : null}
        {step === "round" ? (
          <RoundStep
            headingRef={heading}
            answers={answers}
            errors={errors}
            set={set}
          />
        ) : null}
        {step === "share" ? (
          <ShareStep
            headingRef={heading}
            fund={fund}
            answers={answers}
            errors={errors}
            materials={materials}
            anonymous={anonymous}
            confirmed={contact?.emailConfirmed === true ? contact : null}
            set={set}
          />
        ) : null}
        {step === "note" ? (
          <NoteStep
            headingRef={heading}
            fund={fund}
            answers={answers}
            errors={errors}
            fromProfile={!anonymous}
            set={set}
          />
        ) : null}
        {step === "check" ? (
          <CheckStep
            headingRef={heading}
            fund={fund}
            lines={lines}
            verdict={verdict}
            answers={answers}
            materials={materials}
            replyWithinDays={gateway.replyWithinDays ?? null}
            onAnswer={(dimension) => setStep(stepForDimension(dimension))}
          />
        ) : null}
        {step === "interview" ? (
          <InterviewStep
            headingRef={heading}
            fund={fund}
            companyName={answers.companyName}
            sessionToken={credential}
            gatewayPublicId={gateway.publicId}
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
              Thank you. {fund} has your application
            </h1>
            <p className="cq-body gq-t2" style={{ maxWidth: "52ch" }}>
              Their team will review it, and may contact you
              {contact === null ? "" : ` ${reachWords(contact)}`}.{" "}
              {gateway.replyWithinDays
                ? `${fund} has committed to reply within ${gateway.replyWithinDays} working days. `
                : ""}
              {inApp
                ? "You'll see every step on your GateQ page, and Q will tell you if they reply."
                : ""}
            </p>
            {inApp ? (
              <div className="flex flex-wrap gap-2">
                <a href="/gateq" className={buttonClassName("primary")}>
                  See your applications
                </a>
              </div>
            ) : null}
          </div>
        ) : ownBar ? null : (
          <div className="gq-formbar">
            <Button variant="quiet" onClick={onBack} disabled={pending}>
              <ChevronLeft {...icon} />
              Back
            </Button>
            {step === "check" ? (
              <Button
                variant="primary"
                style={{ minWidth: 160 }}
                onClick={onToInterview}
                disabled={pending || !maySend(verdict)}
              >
                Continue to interview
              </Button>
            ) : (
              <Button
                variant="primary"
                style={{ minWidth: 160 }}
                onClick={onContinue}
                disabled={pending}
              >
                {pending
                  ? "Checking…"
                  : step === "note"
                    ? "Check my fit"
                    : "Continue"}
              </Button>
            )}
          </div>
        )}
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
  const fund = gateway.organisationDisplayName;
  return (
    <aside
      className="gq-card gq-gatecard"
      aria-label={`What ${fund} looks for`}
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
            fund.slice(0, 1).toUpperCase()
          )}
        </span>
        <div className="min-w-0">
          <p className="cq-title-sm">{fund}</p>
          <p className="cq-caption gq-t2">
            {gateway.replyWithinDays
              ? `Replies within ${gateway.replyWithinDays} working days`
              : gateway.title}
          </p>
        </div>
      </div>
      <details open={openByDefault || showResults}>
        <summary>
          <span className="cq-label">What they look for</span>
          <span className="gq-t3 flex items-center gap-1 text-[13px]">
            {lines.length} rule{lines.length === 1 ? "" : "s"}
            <ChevronDown {...icon} />
          </span>
        </summary>
        <div className="flex flex-col gap-3">
          {gateway.description ? (
            <p className="cq-body-sm">{gateway.description}</p>
          ) : null}
          {lines.length === 0 ? (
            <p className="cq-body-sm gq-t2">
              No published criteria yet: nothing is checked, and every founder
              can share with them.
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
                      {dimensionWord(line.dimension)}
                    </b>
                    {line.required ? (
                      ""
                    ) : (
                      <span className="gq-t3"> · preferred</span>
                    )}
                    <br />
                    <span className="gq-t2">{line.label}</span>
                    {showResults && line.standing !== null ? (
                      <span className="sr-only">
                        : {STANDING_WORDS[line.standing]}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="cq-caption gq-t3">
            Nothing is sent until you press Submit.
          </p>
        </div>
      </details>
    </aside>
  );
}

function ResultLines({ lines }: { readonly lines: readonly RuleLine[] }) {
  return (
    <div>
      {lines.map((line) =>
        line.standing === null ? null : (
          <div key={line.label} className="gq-check">
            <FitGlyph kind={GLYPH[line.standing]} />
            <span>
              <b className="font-medium">{dimensionWord(line.dimension)}</b>
              <br />
              <span className="cq-body-sm gq-t2">{line.label}</span>
            </span>
            <span className="gq-status">{STANDING_WORDS[line.standing]}</span>
          </div>
        ),
      )}
    </div>
  );
}

type SetAnswer = <K extends keyof FormAnswers>(
  field: K,
  value: FormAnswers[K],
) => void;

function FromProfile() {
  return (
    <span className="gq-prefill">
      <Check {...icon} size={13} />
      From your profile
    </span>
  );
}

/** One question, single choice, with "I'd rather not say". */
function Options({
  label,
  options,
  value,
  onChange,
  error,
  badge,
}: {
  readonly label: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly badge?: boolean;
}) {
  const id = useId();
  return (
    <div className="gq-q">
      <p className="gq-label" id={id}>
        {label}
        {badge === true ? <FromProfile /> : null}
      </p>
      <div className="gq-opts" role="radiogroup" aria-labelledby={id}>
        {[...options, { value: DECLINED, label: "I'd rather not say" }].map(
          (option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={value === option.value}
              className={`gq-opt${option.value === DECLINED ? " gq-skip" : ""}`}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ),
        )}
      </div>
      {error === undefined ? null : <p className="gq-err">{error}</p>}
    </div>
  );
}

type StepProps = {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly answers: FormAnswers;
  readonly errors: StepErrors;
  readonly set: SetAnswer;
};

function CompanyStep({
  headingRef,
  answers,
  errors,
  fromProfile,
  set,
}: StepProps & { readonly fromProfile: ReadonlySet<keyof FormAnswers> }) {
  const [editing, setEditing] = useState(!fromProfile.has("companyName"));
  const sectors = answers.sectors === DECLINED ? [] : answers.sectors;
  const [other, setOther] = useState(answers.otherSector !== "");
  const inList = COUNTRY_CHOICES.some((c) => c.value === answers.country);
  const [elsewhere, setElsewhere] = useState(
    answers.country !== "" && answers.country !== DECLINED && !inList,
  );
  const sectorId = useId();
  const countryId = useId();
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
        Your company
      </h1>
      <p className="cq-body gq-t2">
        {fromProfile.size > 0
          ? "Filled in from your profile. Change anything that's out of date."
          : "Tap what fits. Rough is fine, and you can say you'd rather not."}
      </p>
      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="gq-field">
            <label className="gq-label" htmlFor="gq-name">
              Company name
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
              <p className="gq-err">{errors.companyName}</p>
            ) : null}
          </div>
          <div className="gq-field">
            <label className="gq-label" htmlFor="gq-line">
              What it does, in one line{" "}
              <span className="gq-t3">(optional)</span>
            </label>
            <input
              id="gq-line"
              className="gq-input"
              value={answers.oneLiner}
              maxLength={280}
              onChange={(e) => set("oneLiner", e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="gq-card gq-cocard">
          <span className="gq-logo" style={{ width: 48, height: 48 }}>
            {answers.companyName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <b className="cq-title-sm block">{answers.companyName}</b>
            {answers.oneLiner ? (
              <span className="cq-body-sm gq-t2 block">{answers.oneLiner}</span>
            ) : null}
          </span>
          <Button
            variant="quiet"
            size="compact"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        </div>
      )}
      <Options
        label="Stage"
        badge={fromProfile.has("stage") && answers.stage !== ""}
        options={STAGE_CHOICES}
        value={answers.stage}
        onChange={(value) => set("stage", value)}
        error={errors.stage}
      />
      <div className="gq-q">
        <p className="gq-label" id={sectorId}>
          Sector <span className="gq-t3 font-normal">(pick any)</span>
        </p>
        <div className="gq-opts" role="group" aria-labelledby={sectorId}>
          {SECTOR_CHOICES.map((choice) => {
            const on = sectors.includes(choice.value);
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={on}
                className="gq-opt"
                onClick={() =>
                  set(
                    "sectors",
                    on
                      ? sectors.filter((s) => s !== choice.value)
                      : [...sectors, choice.value].slice(0, 5),
                  )
                }
              >
                {choice.label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={other}
            className="gq-opt"
            onClick={() => {
              if (answers.sectors === DECLINED) set("sectors", []);
              setOther(!other);
              if (other) set("otherSector", "");
            }}
          >
            Something else
          </button>
          <button
            type="button"
            aria-pressed={answers.sectors === DECLINED}
            className="gq-opt gq-skip"
            onClick={() => {
              setOther(false);
              set("otherSector", "");
              set("sectors", answers.sectors === DECLINED ? [] : DECLINED);
            }}
          >
            I&apos;d rather not say
          </button>
        </div>
        {other ? (
          <input
            className="gq-input"
            aria-label="Your sector, in a few words"
            placeholder="In a few words, like insurance software"
            maxLength={120}
            value={answers.otherSector}
            onChange={(e) => set("otherSector", e.target.value)}
          />
        ) : null}
        {errors.sectors ? <p className="gq-err">{errors.sectors}</p> : null}
      </div>
      <div className="gq-q">
        <p className="gq-label" id={countryId}>
          Where is the company based?
          {fromProfile.has("country") && answers.country !== "" ? (
            <FromProfile />
          ) : null}
        </p>
        <div className="gq-opts" role="radiogroup" aria-labelledby={countryId}>
          {COUNTRY_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={answers.country === choice.value}
              className="gq-opt"
              onClick={() => {
                setElsewhere(false);
                set("country", choice.value);
              }}
            >
              {choice.label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={elsewhere}
            className="gq-opt"
            onClick={() => {
              setElsewhere(true);
              if (inList || answers.country === DECLINED) set("country", "");
            }}
          >
            Elsewhere
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={answers.country === DECLINED}
            className="gq-opt gq-skip"
            onClick={() => {
              setElsewhere(false);
              set("country", DECLINED);
            }}
          >
            I&apos;d rather not say
          </button>
        </div>
        {elsewhere ? (
          <select
            className="gq-input"
            aria-label="Country"
            value={
              inList || answers.country === DECLINED ? "" : answers.country
            }
            onChange={(e) => set("country", e.target.value)}
          >
            <option value="">Choose a country</option>
            {MORE_COUNTRIES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        ) : null}
        {errors.country ? <p className="gq-err">{errors.country}</p> : null}
      </div>
    </>
  );
}

function RoundStep({ headingRef, answers, errors, set }: StepProps) {
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
        Your round
      </h1>
      <p className="cq-body gq-t2">
        Rough numbers are fine. You can say you&apos;d rather not.
      </p>
      <div className="gq-q">
        <Options
          label="How much are you raising?"
          options={RAISE_BANDS}
          value={answers.band}
          onChange={(value) => {
            set("band", value);
            if (value === DECLINED) set("amount", "");
          }}
          error={errors.band}
        />
        {answers.band === DECLINED ? null : (
          <div className="flex max-w-[360px] gap-2">
            <select
              className="gq-input"
              style={{ width: 96 }}
              aria-label="Currency"
              value={answers.currency}
              onChange={(e) => set("currency", e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              className="gq-input"
              inputMode="decimal"
              aria-label="Exact amount"
              placeholder="Exact amount, like 1,200,000"
              value={answers.amount}
              aria-invalid={errors.amount !== undefined}
              onChange={(e) => {
                set("amount", e.target.value);
                const amount = normaliseAmount(e.target.value);
                if (amount !== null && answers.currency === "USD") {
                  const band = bandFor(amount);
                  if (band !== "") set("band", band);
                }
              }}
            />
          </div>
        )}
        {errors.amount ? <p className="gq-err">{errors.amount}</p> : null}
        {answers.band !== "" &&
        answers.band !== DECLINED &&
        answers.amount.trim() === "" ? (
          <p className="cq-caption gq-t3">
            Add the exact amount so the round-size rule can be checked. Without
            it, that rule stays unanswered.
          </p>
        ) : null}
      </div>
      <Options
        label="How are you raising?"
        options={INSTRUMENT_CHOICES}
        value={answers.instrument}
        onChange={(value) =>
          set("instrument", value as FormAnswers["instrument"])
        }
      />
      <Options
        label="Do you have a lead investor?"
        options={LEAD_CHOICES}
        value={answers.lead}
        onChange={(value) => set("lead", value as FormAnswers["lead"])}
      />
    </>
  );
}

function ShareStep({
  headingRef,
  fund,
  answers,
  errors,
  materials,
  anonymous,
  confirmed,
  set,
}: StepProps & {
  readonly fund: string;
  readonly materials: readonly Material[];
  readonly anonymous: boolean;
  /** Slice 1: the contact confirmed on the first step replaces the fields. */
  readonly confirmed: ApplicationContactDto | null;
}) {
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
        What to share
      </h1>
      <p className="cq-body gq-t2">
        {materials.length > 0
          ? `Pick what ${fund} should see. They only get what you tick.`
          : `${fund} gets your answers and your note. Nothing else.`}
      </p>
      {materials.length > 0 ? (
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
                        : answers.materials.filter((id) => id !== material.id),
                    )
                  }
                />
                <span className="flex-1">
                  <b className="block font-medium">{material.name}</b>
                  <span className="cq-caption gq-t2">{material.detail}</span>
                </span>
                <FileText {...icon} size={ICON_SIZE.regular} />
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {confirmed !== null ? (
        <p className="cq-body-sm gq-t2">
          {fund} may contact you at <b>{confirmed.email}</b>, the email you
          confirmed.
        </p>
      ) : anonymous ? (
        <div className="flex flex-col gap-3">
          <div className="gq-field">
            <label className="gq-label" htmlFor="gq-cname">
              Your name <span className="gq-t3">(optional)</span>
            </label>
            <input
              id="gq-cname"
              className="gq-input"
              autoComplete="name"
              maxLength={200}
              value={answers.contactName}
              onChange={(e) => set("contactName", e.target.value)}
            />
          </div>
          <div className="gq-field">
            <label className="gq-label" htmlFor="gq-cmail">
              Email for their reply
            </label>
            <input
              id="gq-cmail"
              className="gq-input"
              type="email"
              autoComplete="email"
              maxLength={254}
              value={answers.contactEmail}
              aria-invalid={errors.contactEmail !== undefined}
              onChange={(e) => set("contactEmail", e.target.value)}
            />
            {errors.contactEmail ? (
              <p className="gq-err">{errors.contactEmail}</p>
            ) : null}
          </div>
          <p className="cq-caption gq-t3">
            Have a Capital Q account? Sign in on the gate&apos;s page to share
            your deck too.
          </p>
        </div>
      ) : null}
    </>
  );
}

function NoteStep({
  headingRef,
  fund,
  answers,
  errors,
  fromProfile,
  set,
}: StepProps & { readonly fund: string; readonly fromProfile: boolean }) {
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="cq-title-lg">
        A short note
      </h1>
      <p className="cq-body gq-t2">
        Optional.{" "}
        {fromProfile
          ? "A first draft from your profile; it's yours to change."
          : "A line or two about why them."}
      </p>
      <div className="gq-field">
        <label className="gq-label" htmlFor="gq-msg">
          Note to {fund}
        </label>
        <textarea
          id="gq-msg"
          className="gq-input"
          rows={6}
          maxLength={GATEQ_NOTE_MAX_CHARS + 50}
          value={answers.note}
          aria-invalid={errors.note !== undefined}
          aria-describedby="gq-msg-count"
          onChange={(e) => set("note", e.target.value)}
        />
        <span id="gq-msg-count" className="cq-caption gq-t3 text-right">
          {answers.note.length} of {GATEQ_NOTE_MAX_CHARS}
        </span>
        {errors.note ? <p className="gq-err">{errors.note}</p> : null}
      </div>
    </>
  );
}

function CheckStep({
  headingRef,
  fund,
  lines,
  verdict,
  answers,
  materials,
  replyWithinDays,
  onAnswer,
}: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly fund: string;
  readonly lines: readonly RuleLine[];
  readonly verdict: ReturnType<typeof verdictFor>;
  readonly answers: FormAnswers;
  readonly materials: readonly Material[];
  readonly replyWithinDays: number | null;
  readonly onAnswer: (dimension: string) => void;
}) {
  const unanswered = lines.filter(
    (line) => line.standing === "NOT_ANSWERED" && line.required,
  );
  const shared = materials
    .filter((m) => answers.materials.includes(m.id))
    .map((m) => m.name.toLowerCase());
  const amount = normaliseAmount(answers.amount);
  return (
    <div className="gq-card gq-result">
      <div className="flex items-center gap-3">
        <FitGlyph
          kind={verdict === "FITS" && lines.length > 0 ? "fit" : "unk"}
          size={28}
        />
        <h1 ref={headingRef} tabIndex={-1} className="cq-title-md">
          {verdict === null ? "Checking…" : verdictTitle(verdict, fund, lines)}
        </h1>
      </div>
      <ResultLines lines={lines} />
      {verdict === "NEEDS_ANSWERS" && unanswered.length > 0 ? (
        <div className="gq-banner">
          <CircleAlert {...icon} />
          <span>
            Unanswered isn&apos;t a no, but this gate needs{" "}
            {unanswered
              .map((line) => dimensionWord(line.dimension).toLowerCase())
              .join(" and ")}{" "}
            to decide.{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => onAnswer(unanswered[0]?.dimension ?? "STAGE")}
            >
              Answer it
            </button>
          </span>
        </div>
      ) : null}
      <p className="cq-body-sm gq-t2">
        Next, a few questions from Q, then you review everything before it goes.
        When you submit, {fund} gets: {answers.companyName || "your company"},
        your answers
        {amount !== null
          ? ` (raising ${formatMoney(amount, answers.currency)})`
          : ""}
        {shared.length > 0 ? `, ${shared.join(", ")}` : ""}
        {answers.note.trim() !== "" ? " and your note" : ""}.
        {replyWithinDays
          ? ` ${fund} promises a reply within ${replyWithinDays} working days.`
          : ""}
      </p>
    </div>
  );
}
