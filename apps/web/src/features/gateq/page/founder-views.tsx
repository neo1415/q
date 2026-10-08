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
  Clock,
  DoorOpen,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  Lock,
  Mail,
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
  if (state === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {[1, 2, 3].map((n) => (
          <Skeleton key={n} width="100%" height={64} radius={12} />
        ))}
      </div>
    );
  }
  if (state === "error")
    return (
      <ErrorBlock
        what="Your applications"
        retryHref="/gateq?tab=applications"
      />
    );
  if (state === "empty" || applications.length === 0) {
    return (
      <StateBlock
        icon={
          <DoorOpen
            size={ICON_SIZE.prominent}
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        }
        title="No applications yet"
        body="Many investors have a gate: a short form that tells you at once if you fit what they look for. Open one from an investor's profile or a link they shared."
      >
        <Link
          href="/discover?tab=investors"
          className={buttonClassName("primary")}
        >
          Find investors
        </Link>
      </StateBlock>
    );
  }
  return (
    <>
      {limited ? (
        <div className="gq-banner">
          <Lock {...icon} />
          <span>
            You&apos;re a member of your company. Admins send applications; you
            can see where each stands.
          </span>
        </div>
      ) : null}
      <section className="gq-sect">
        <h2 className="cq-title-sm">Your applications</h2>
        <ul className="gq-hair">
          {applications.map((application) => (
            <li
              key={application.applicationId}
              className="grid items-center gap-x-3 gap-y-0.5 py-3.5"
              style={{ gridTemplateColumns: "44px 1fr auto" }}
            >
              <span
                className="gq-logo"
                style={{ width: 44, height: 44, borderRadius: "50%" }}
              >
                {application.fund.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <b className="font-medium">{application.fund}</b>
                <span className="cq-caption gq-t2 block">
                  {sentWords(application.sentAt)}
                </span>
              </span>
              <span className="gq-status">
                {application.status === "PASSED" ? (
                  <>
                    <X {...icon} />
                    Passed: {REASON_WORDS[application.reasonCode ?? "OTHER"]}
                  </>
                ) : application.status === "REPLIED" ? (
                  <>
                    <Check {...icon} />
                    They replied
                  </>
                ) : (
                  <>
                    <Clock {...icon} />
                    Sent
                  </>
                )}
              </span>
              {application.message === null ? null : (
                <p
                  className="cq-body-sm gq-t2 col-start-2 col-end-4 mt-1.5"
                  style={{ maxWidth: "62ch" }}
                >
                  &ldquo;{application.message}&rdquo;
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
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
      <h2 className="cq-title-sm">Find your company on Capital Q</h2>
      <p className="cq-body-sm gq-t2">
        It may already be here: from a deck, a colleague, or public records.
        Search by name or website.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search(query);
        }}
      >
        <label className="gq-search">
          <span className="sr-only">Company name or website</span>
          <Search {...icon} size={18} />
          <input
            className="gq-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company name or website"
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
          <span>{notice}</span>
        </div>
      )}
      {showLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton width="100%" height={64} radius={12} />
          <Skeleton width="100%" height={64} radius={12} />
        </div>
      ) : showError ? (
        <ErrorBlock what="Search" retryHref="/gateq?tab=claim" />
      ) : state === "empty" || (results !== null && list.length === 0) ? (
        <StateBlock
          icon={
            <Building2
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
              aria-hidden
            />
          }
          title="Not on Capital Q yet"
          body="Add it now: upload your deck and Q fills in your profile. You check everything before anyone sees it."
        >
          <Link href="/onboarding" className={buttonClassName("primary")}>
            <Upload {...icon} />
            Upload your deck
          </Link>
          <Link
            href="/onboarding?manual=1"
            className={buttonClassName("secondary")}
          >
            Add it by hand
          </Link>
        </StateBlock>
      ) : results === null ? null : (
        <>
          <section className="gq-sect">
            <h2 className="cq-label gq-t2">
              {list.length} compan
              {list.length === 1 ? "y matches" : "ies match"}
            </h2>
            <div>
              {list.map((company) => (
                <div key={company.companyId} className="gq-resrow">
                  <span className="gq-logo" style={{ width: 48, height: 48 }}>
                    {company.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <b className="font-semibold">{company.name}</b>
                    <span className="cq-body-sm gq-t2 block">
                      {[
                        company.website
                          ?.replace(/^https?:\/\/(www\.)?/, "")
                          .replace(/\/$/, ""),
                        company.city,
                      ]
                        .filter(
                          (part) =>
                            part !== null && part !== undefined && part !== "",
                        )
                        .join(" · ")}
                    </span>
                    <span className="cq-caption gq-t3">
                      {company.yours
                        ? "You're a member"
                        : company.requested
                          ? "Request sent"
                          : company.members > 0
                            ? `Already has ${company.members} member${company.members === 1 ? "" : "s"}`
                            : "Not claimed yet"}
                    </span>
                  </span>
                  {company.yours || company.requested ? (
                    <span className="gq-t3">
                      <ChevronRight {...icon} size={18} />
                    </span>
                  ) : company.members > 0 ? (
                    <Button size="compact" onClick={() => setClaiming(company)}>
                      Ask to join
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="compact"
                      onClick={() => setClaiming(company)}
                    >
                      This is mine
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
                A company that already has members on Capital Q lets you in when
                an admin says yes. If you think someone claimed yours wrongly,
                ask to join and say so: Capital Q reviews it.
              </span>
            </div>
          ) : null}
          <p className="cq-body-sm gq-t2">
            Not listed?{" "}
            <Link href="/onboarding" className="underline underline-offset-4">
              Add your company
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
          title={hasMembers ? `Ask to join ${company.name}` : "Show it's yours"}
          description="Pick one. It takes a minute."
          side="side"
        >
          <div className="flex flex-col gap-3.5">
            <ul
              className="gq-hair"
              role="radiogroup"
              aria-label="How to show it's yours"
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
                        {title}
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
                  Work email
                </label>
                <input
                  id="gq-claim-email"
                  className="gq-input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  placeholder={domain === null ? "" : `you@${domain}`}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            ) : null}
            {method === "REGISTRY_DOCUMENT" ? (
              <div className="gq-field">
                <label className="gq-label" htmlFor="gq-claim-registry">
                  Certificate of incorporation or registry extract (PDF, PNG or
                  JPEG, up to 10 MB)
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
                  The six-digit code we emailed to {email.trim()}
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
                  Confirm code
                </Button>
              </div>
            ) : null}
            {joinOrganisation !== null ? (
              <div className="gq-field">
                <label className="gq-label" htmlFor="gq-join-note">
                  A note for the admins (optional)
                </label>
                <input
                  id="gq-join-note"
                  className="gq-input"
                  value={note}
                  maxLength={500}
                  placeholder="I lead product, joined in May"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            ) : null}
            {problem === null ? null : (
              <div className="gq-banner gq-banner-err" role="alert">
                <CircleAlert {...icon} />
                <span>{problem}</span>
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
              {method === "ASK_MEMBERS" ? "Send request" : "Claim it"}
            </Button>
          </div>
        </SheetContent>
      )}
    </SheetRoot>
  );
}
