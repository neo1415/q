"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type {
  ClaimableCompanyDto,
  CompanyClaimMethod,
  FounderApplicationDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import {
  Building2,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock,
  DoorOpen,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  Lock,
  Mail,
  MessageSquare,
  Search,
  Upload,
  Users,
  X,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { askToJoinAction } from "@/features/team/team-actions";

import {
  claimAction,
  claimEvidenceCompleteAction,
  claimEvidenceUploadAction,
  confirmClaimCodeAction,
  searchClaimableAction,
} from "./gateq-actions";
import { ErrorBlock, Skeleton, StateBlock } from "./gateq-chrome";
import { monogram } from "./inbox-model";
import { GateqUnicornAssessment } from "./unicorn-assessment";
import { useT } from "@/features/i18n/language";

/**
 * A founder's GateQ (F2, F3; design a/gateq.html "Founder: GateQ page" and
 * "Founder: Find my startup"). Their applications and what each investor
 * sent back; and finding their company on Capital Q to claim, or to ask to
 * join when it already has members. A claim is a request: it becomes
 * membership only when it is verified or the members say yes.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

const REASON_WORDS: Readonly<Record<string, string>> = {
  OUTSIDE_STAGE: "outside their stage",
  OUTSIDE_SECTOR: "outside their sector",
  CHEQUE_DOES_NOT_FIT: "outside their cheque range",
  TIMING: "timing",
  OTHER: "they gave a reason in their message",
};

function sentWords(iso: string): string {
  return `Sent ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

export function FounderApplications({
  state,
  applications,
  limited = false,
}: {
  readonly state: "full" | "loading" | "empty" | "error" | "limited";
  readonly applications: readonly FounderApplicationDto[];
  readonly limited?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);

  if (state === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {[1, 2, 3].map((n) => (
          <Skeleton key={n} width="100%" height={74} />
        ))}
      </div>
    );
  }
  if (state === "error")
    return (
      <ErrorBlock
        t={t}
        what="Your applications"
        retryHref="/gateq?tab=applications"
      />
    );
  const findCard = (
    <section className="gq2-card mt-4" aria-labelledby="gqf-find">
      <h3 id="gqf-find">{t("Find investors who fit")}</h3>
      <p
        className="cq-body-sm text-(--cq-text-primary)"
        style={{ maxWidth: "68ch" }}
      >
        {t(
          "Many investors have a gate: a short form that tells you at once if you fit what they look for. Open one from an investor's profile or a link they shared.",
        )}
      </p>
      <Link
        href="/discover?tab=investors"
        className={buttonClassName(
          state === "empty" || applications.length === 0
            ? "primary"
            : "secondary",
          "compact",
          "self-start",
        )}
      >
        {t("Find investors")}
      </Link>
    </section>
  );
  if (state === "empty" || applications.length === 0) {
    return (
      <>
        <StateBlock
          icon={
            <DoorOpen
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
          }
          title={t("No applications yet")}
          body={t(
            "When you apply through an investor's gate, it shows here with how their rules stood and what they sent back.",
          )}
        />
        {findCard}
      </>
    );
  }
  const current =
    applications.find((application) => application.applicationId === open) ??
    null;
  return (
    <>
      {limited ? (
        <div className="gq-banner mb-3">
          <Lock {...icon} />
          <span>
            {t(
              "You're a member of your company. Admins send applications; you can see where each stands.",
            )}
          </span>
        </div>
      ) : null}
      <div role="list" aria-label={t("Your applications")}>
        {applications.map((application) => (
          <div role="listitem" key={application.applicationId}>
            <button
              type="button"
              className="gqf-row"
              onClick={() => setOpen(application.applicationId)}
            >
              <span className="gqf-mono" aria-hidden>
                {monogram(application.fund)}
              </span>
              <span className="min-w-0">
                <b>{t(application.fund)}</b>
                <span className="gqf-s line-clamp-2">
                  {t(founderDetailWords(application))}
                </span>
                <span className="gqf-when">
                  {t(sentWords(application.sentAt))}
                </span>
              </span>
              <StatusTag application={application} />
            </button>
          </div>
        ))}
      </div>
      {findCard}
      {Array.from(
        new Map(
          applications.flatMap((application) =>
            application.unicornPotential === undefined
              ? []
              : [
                  [
                    application.unicornPotential.companyId,
                    application.unicornPotential,
                  ] as const,
                ],
          ),
        ).values(),
      ).map((value) => (
        <GateqUnicornAssessment
          key={value.companyId}
          value={value}
          audience="FOUNDER"
        />
      ))}
      <SheetRoot
        open={current !== null}
        onOpenChange={(next) => (next ? undefined : setOpen(null))}
      >
        {current === null ? null : (
          <SheetContent
            title={t(current.fund)}
            description={t(
              `${sentWords(current.sentAt)}. Frozen at submission`,
            )}
            side="side"
          >
            <FounderApplicationDetail application={current} />
          </SheetContent>
        )}
      </SheetRoot>
    </>
  );
}

/** What happened, in words: the investor's own reply, never paraphrased. */
export function founderDetailWords(application: FounderApplicationDto): string {
  if (application.status === "PASSED") {
    return application.message === null
      ? `Passed with a reason: ${REASON_WORDS[application.reasonCode ?? "OTHER"] ?? "they gave a reason"}.`
      : `Passed with a reason. They got: “${application.message}”`;
  }
  if (application.status === "REPLIED") {
    return application.message === null
      ? "They replied."
      : `They wrote: “${application.message}”`;
  }
  return application.replyBy == null
    ? "Sent. They haven't made a reply promise."
    : `Reply promised by ${new Date(`${application.replyBy}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

function StatusTag({
  application,
  wide = false,
}: {
  readonly application: FounderApplicationDto;
  readonly wide?: boolean;
}) {
  const t = useT();
  const kind = application.status.toLowerCase();
  return (
    <span className={`gqf-st gqf-st-${kind}${wide ? " gqf-st-wide" : ""}`}>
      {application.status === "PASSED" ? (
        <X {...icon} size={12} />
      ) : application.status === "REPLIED" ? (
        <MessageSquare {...icon} size={12} />
      ) : (
        <Clock {...icon} size={12} />
      )}
      {application.status === "PASSED"
        ? t("Passed with a reason")
        : application.status === "REPLIED"
          ? t("They replied")
          : t("Waiting on them")}
    </span>
  );
}

const STOOD_WORDS = {
  MEETS: "Met",
  DOES_NOT_MEET_REQUIRED: "Not met, required",
  DOES_NOT_MEET_PREFERRED: "Not met, preferred",
  NOT_ANSWERED: "Not answered",
} as const;

/** How one published rule stood when it was sent, in words. */
export function stoodWords(rule: {
  readonly required: boolean;
  readonly standing: "MEETS" | "DOES_NOT_MEET" | "NOT_ANSWERED";
}): string {
  if (rule.standing === "MEETS") return STOOD_WORDS.MEETS;
  if (rule.standing === "NOT_ANSWERED") return STOOD_WORDS.NOT_ANSWERED;
  return rule.required
    ? STOOD_WORDS.DOES_NOT_MEET_REQUIRED
    : STOOD_WORDS.DOES_NOT_MEET_PREFERRED;
}

function FounderApplicationDetail({
  application,
}: {
  readonly application: FounderApplicationDto;
}) {
  const t = useT();
  const relationship =
    application.investorOrganisationId == null
      ? null
      : `/relationships/investor/${encodeURIComponent(application.investorOrganisationId)}`;
  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <StatusTag application={application} wide />
      <p className="cq-body text-(--cq-text-primary)">
        {t(founderDetailWords(application))}
      </p>
      <section className="gq2-card" aria-labelledby="gqf-stood">
        <h3 id="gqf-stood">{t("How their rules stood when you sent it")}</h3>
        {application.rules === undefined ? (
          <p className="cq-body-sm gq-t2">
            {t("Not recorded for this application.")}
          </p>
        ) : application.rules.length === 0 ? (
          <p className="cq-body-sm gq-t2">
            {t("They had no published rules then, so nothing was checked.")}
          </p>
        ) : (
          <div>
            {application.rules.map((rule) => (
              <div key={rule.label} className="gqf-stood">
                <span>{t(rule.label)}</span>
                <span className="gqf-word">
                  {rule.standing === "MEETS" ? (
                    <span className="gq-tick">
                      <Check {...icon} size={12} strokeWidth={2.4} />
                    </span>
                  ) : rule.standing === "NOT_ANSWERED" ? (
                    <span className="gq-unk-ic">
                      <CircleHelp {...icon} />
                    </span>
                  ) : (
                    <span className="gq-unk-ic">
                      <X {...icon} />
                    </span>
                  )}
                  {t(stoodWords(rule))}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="cq-caption gq-t3">
          {t("Their published bar, not their private thesis.")}
        </p>
      </section>
      {application.status === "REPLIED" && relationship !== null ? (
        <Link
          href={`${relationship}/messages`}
          className={buttonClassName("primary")}
        >
          {t("Answer in your messages")}
        </Link>
      ) : null}
      {relationship === null ? null : (
        <Link href={relationship} className={buttonClassName("quiet")}>
          {t("Open the relationship")}
        </Link>
      )}
    </div>
  );
}

export function ClaimView({
  state,
  initialQuery = "",
  initialResults = [],
  demoSheet = false,
}: {
  readonly state: "full" | "loading" | "empty" | "error" | "limited";
  readonly initialQuery?: string;
  readonly initialResults?: readonly ClaimableCompanyDto[];
  readonly demoSheet?: boolean;
}) {
  const t = useT();

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<readonly ClaimableCompanyDto[] | null>(
    initialQuery === "" ? null : initialResults,
  );
  const [failed, setFailed] = useState(false);
  const [claiming, setClaiming] = useState<ClaimableCompanyDto | null>(
    demoSheet ? (initialResults[0] ?? null) : null,
  );
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const search = (text: string) => {
    if (
      initialQuery !== "" &&
      results !== null &&
      text === initialQuery &&
      state !== "full"
    )
      return;
    startTransition(async () => {
      const found = await searchClaimableAction(text);
      setFailed(!found.ok);
      setResults(found.ok ? found.value : []);
    });
  };

  const showLoading = state === "loading" || pending;
  const showError = state === "error" || failed;
  const list = results ?? [];
  const head = (
    <div className="gq-card gq-findbox">
      <h2 className="cq-title-sm">{t("Find your company on Capital Q")}</h2>
      <p className="cq-body-sm gq-t2">
        {t(
          "It may already be here: from a deck, a colleague, or public records. Search by name or website.",
        )}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search(query);
        }}
      >
        <label className="gq-search">
          <span className="sr-only">{t("Company name or website")}</span>
          <Search {...icon} size={18} />
          <input
            className="gq-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Company name or website")}
          />
        </label>
      </form>
    </div>
  );

  return (
    <>
      {head}
      {notice === null ? null : (
        <div className="gq-banner" role="status">
          <Check {...icon} />
          <span>{t(notice)}</span>
        </div>
      )}
      {showLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton width="100%" height={64} />
          <Skeleton width="100%" height={64} />
        </div>
      ) : showError ? (
        <ErrorBlock t={t} what="Search" retryHref="/gateq?tab=claim" />
      ) : state === "empty" || (results !== null && list.length === 0) ? (
        <StateBlock
          icon={
            <Building2
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
          }
          title={t("Not on Capital Q yet")}
          body={t(
            "Add it now: upload your deck and Q fills in your profile. You check everything before anyone sees it.",
          )}
        >
          <Link href="/onboarding" className={buttonClassName("primary")}>
            <Upload {...icon} />
            {t("Upload your deck")}
          </Link>
          <Link
            href="/onboarding?manual=1"
            className={buttonClassName("secondary")}
          >
            {t("Add it by hand")}
          </Link>
        </StateBlock>
      ) : results === null ? null : (
        <>
          <section className="gq-sect">
            <h2 className="cq-label gq-t2">
              {t(
                list.length === 1
                  ? "1 company matches"
                  : `${String(list.length)} companies match`,
              )}
            </h2>
            <div>
              {list.map((company) => (
                <div key={company.companyId} className="gq-resrow">
                  <span className="gq-logo" style={{ width: 48, height: 48 }}>
                    {t(company.name.slice(0, 1).toUpperCase())}
                  </span>
                  <span className="min-w-0">
                    <b className="font-semibold">{company.name}</b>
                    <span className="cq-body-sm gq-t2 block">
                      {t(
                        [
                          company.website
                            ?.replace(/^https?:\/\/(www\.)?/, "")
                            .replace(/\/$/, ""),
                          company.city,
                        ]
                          .filter(
                            (part) =>
                              part !== null &&
                              part !== undefined &&
                              part !== "",
                          )
                          .join(" · "),
                      )}
                    </span>
                    <span className="cq-caption gq-t3">
                      {company.yours
                        ? t("You're a member")
                        : company.requested
                          ? t("Request sent")
                          : company.members > 0
                            ? t(
                                `Already has ${company.members} member${company.members === 1 ? "" : "s"}`,
                              )
                            : t("Not claimed yet")}
                    </span>
                  </span>
                  {company.yours || company.requested ? (
                    <span className="gq-t3">
                      <ChevronRight {...icon} size={18} />
                    </span>
                  ) : company.members > 0 ? (
                    <Button size="compact" onClick={() => setClaiming(company)}>
                      {t("Ask to join")}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="compact"
                      onClick={() => setClaiming(company)}
                    >
                      {t("This is mine")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
          {list.some((company) => company.members > 0 && !company.yours) ? (
            <div className="gq-banner">
              <Users {...icon} />
              <span>
                {t(
                  "A company that already has members on Capital Q lets you in when an admin says yes. If you think someone claimed yours wrongly, ask to join and say so: Capital Q reviews it.",
                )}
              </span>
            </div>
          ) : null}
          <p className="cq-body-sm gq-t2">
            {t("Not listed?")}{" "}
            <Link href="/onboarding" className="underline underline-offset-4">
              {t("Add your company")}
            </Link>
          </p>
        </>
      )}
      <ClaimSheet
        company={claiming}
        onClose={() => setClaiming(null)}
        onDone={(message) => {
          setClaiming(null);
          setNotice(message);
          if (results !== null) {
            setResults(
              results.map((company) =>
                company.companyId === claiming?.companyId
                  ? { ...company, requested: true }
                  : company,
              ),
            );
          }
        }}
      />
    </>
  );
}

function ClaimSheet({
  company,
  onClose,
  onDone,
}: {
  readonly company: ClaimableCompanyDto | null;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void;
}) {
  const t = useT();

  const hasMembers = (company?.members ?? 0) > 0;
  const domain =
    company?.website
      ?.replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/.*$/, "") ?? null;
  const [method, setMethod] = useState<CompanyClaimMethod>(
    hasMembers ? "ASK_MEMBERS" : "WORK_EMAIL",
  );
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  // 2026-10-08: the registry document, attached to the claim it backs.
  const [registryFile, setRegistryFile] = useState<File | null>(null);
  // P14: after a work-email claim, the code from that email.
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // F8: a company with members lets people in from its Team page; asking
  // is a team join request to its organisation, not a claim.
  const joinOrganisation =
    hasMembers && company !== null ? company.organisationId : null;
  const [pending, startTransition] = useTransition();
  const methods: readonly (readonly [
    CompanyClaimMethod,
    typeof Mail,
    string,
    string,
  ])[] = [
    ...(domain === null || hasMembers
      ? []
      : ([
          [
            "WORK_EMAIL",
            Mail,
            `Email at ${domain}`,
            "We check the address is at your company's own website.",
          ],
        ] as const)),
    ...(hasMembers
      ? []
      : ([
          [
            "REGISTRY_DOCUMENT",
            FileText,
            "A registry document",
            "Capital Q matches the company name and number.",
          ],
        ] as const)),
    [
      "ASK_MEMBERS",
      Users,
      hasMembers ? "Ask the members" : "Ask a colleague",
      "Someone already in the company says yes.",
    ],
  ];
  return (
    <SheetRoot
      open={company !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      {company === null ? null : (
        <SheetContent
          title={
            hasMembers ? t(`Ask to join ${company.name}`) : t("Show it's yours")
          }
          description={t("Pick one. It takes a minute.")}
          side="side"
        >
          <div className="flex flex-col gap-3.5">
            <ul
              className="gq-hair"
              role="radiogroup"
              aria-label={t("How to show it's yours")}
            >
              {methods.map(([value, Icon, title, body]) => (
                <li key={value}>
                  <label className="flex cursor-pointer items-start gap-3 py-3.5">
                    <input
                      type="radio"
                      name="claim-method"
                      className="mt-0.5 size-5"
                      style={{ accentColor: "var(--cq-accent)" }}
                      checked={method === value}
                      onChange={() => setMethod(value)}
                    />
                    <span className="flex-1">
                      <b className="flex items-center gap-2 font-medium">
                        <Icon {...icon} />
                        {t(title)}
                      </b>
                      <span className="cq-body-sm gq-t2">{body}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {method === "WORK_EMAIL" ? (
              <div className="gq-field">
                <label className="gq-label" htmlFor="gq-claim-email">
                  {t("Work email")}
                </label>
                <input
                  id="gq-claim-email"
                  className="gq-input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  placeholder={domain === null ? "" : t(`you@${domain}`)}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            ) : null}
            {method === "REGISTRY_DOCUMENT" ? (
              <div className="gq-field">
                <label className="gq-label" htmlFor="gq-claim-registry">
                  {t(
                    "Certificate of incorporation or registry extract (PDF, PNG or JPEG, up to 10 MB)",
                  )}
                </label>
                <input
                  id="gq-claim-registry"
                  className="gq-input"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => setRegistryFile(e.target.files?.[0] ?? null)}
                />
              </div>
            ) : null}
            {awaitingCode ? (
              <div className="gq-field" data-claim-code>
                <label className="gq-label" htmlFor="gq-claim-code">
                  {t("The six-digit code we emailed to")} {t(email.trim())}
                </label>
                <input
                  id="gq-claim-code"
                  className="gq-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={pending || code.trim().length < 6}
                  onClick={() => {
                    setProblem(null);
                    startTransition(async () => {
                      const out = await confirmClaimCodeAction(
                        company?.companyId ?? "",
                        code,
                      );
                      if (!out.ok) return setProblem(out.message);
                      if (out.value === "WRONG_CODE")
                        return setProblem("That code isn't right. Try again.");
                      if (out.value !== "CONFIRMED")
                        return setProblem(
                          "That code has expired. Close this and ask again for a new one.",
                        );
                      onDone(
                        "Email confirmed. Capital Q checks your claim and lets you know.",
                      );
                    });
                  }}
                >
                  {t("Confirm code")}
                </Button>
              </div>
            ) : null}
            {joinOrganisation !== null ? (
              <div className="gq-field">
                <label className="gq-label" htmlFor="gq-join-note">
                  {t("A note for the admins (optional)")}
                </label>
                <input
                  id="gq-join-note"
                  className="gq-input"
                  value={note}
                  maxLength={500}
                  placeholder={t("I lead product, joined in May")}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            ) : null}
            {problem === null ? null : (
              <div className="gq-banner gq-banner-err" role="alert">
                <CircleAlert {...icon} />
                <span>{t(problem)}</span>
              </div>
            )}
            <Button
              variant="primary"
              disabled={
                pending ||
                (method === "WORK_EMAIL" && email.trim() === "") ||
                (method === "REGISTRY_DOCUMENT" && registryFile === null)
              }
              onClick={() => {
                setProblem(null);
                startTransition(async () => {
                  if (joinOrganisation !== null) {
                    const asked = await askToJoinAction(joinOrganisation, note);
                    if (!asked.ok) return setProblem(asked.message);
                    return onDone(
                      `Asked. ${company.name}'s admins let you in from their Team page; you'll get an email when they decide.`,
                    );
                  }
                  const done = await claimAction(company.companyId, {
                    method,
                    ...(method === "WORK_EMAIL"
                      ? { workEmail: email.trim() }
                      : {}),
                    clientRequestId: `claim-${crypto.randomUUID()}`,
                  });
                  if (!done.ok) return setProblem(done.message);
                  if (done.value.status === "EMAIL_NOT_AT_COMPANY") {
                    return setProblem(
                      `Use an email at ${domain ?? "your company's website"}.`,
                    );
                  }
                  if (
                    method === "REGISTRY_DOCUMENT" &&
                    registryFile !== null &&
                    (done.value.status === "REQUESTED" ||
                      done.value.status === "ALREADY_REQUESTED")
                  ) {
                    const upload = await claimEvidenceUploadAction(
                      company.companyId,
                      {
                        fileName: registryFile.name.slice(0, 200),
                        contentType: registryFile.type,
                        sizeBytes: registryFile.size,
                      },
                    );
                    if (!upload.ok) return setProblem(upload.message);
                    const put = await fetch(upload.value.url, {
                      method: "PUT",
                      headers: upload.value.headers,
                      body: registryFile,
                    }).catch(() => null);
                    const attached =
                      put?.ok === true
                        ? await claimEvidenceCompleteAction(company.companyId)
                        : null;
                    if (attached?.ok !== true || !attached.value) {
                      return setProblem(
                        "Your request is in, but the document didn't upload. Try attaching it again.",
                      );
                    }
                  }
                  if (
                    method === "WORK_EMAIL" &&
                    done.value.status === "REQUESTED" &&
                    done.value.codeSent === true
                  ) {
                    setAwaitingCode(true);
                    return undefined;
                  }
                  onDone(
                    done.value.status === "ALREADY_YOURS"
                      ? `You're already a member of ${company.name}.`
                      : method === "ASK_MEMBERS"
                        ? `Asked. ${company.name}'s members decide, and you'll see it here.`
                        : "Request in. Capital Q checks it and lets you know.",
                  );
                });
              }}
            >
              {method === "ASK_MEMBERS" ? t("Send request") : t("Claim it")}
            </Button>
          </div>
        </SheetContent>
      )}
    </SheetRoot>
  );
}
