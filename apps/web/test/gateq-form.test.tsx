// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApplicationContactDto,
  ApplicationCoverageDto,
  ApplicationSummaryDto,
  PublicGatewayDto,
} from "@capital-q/contracts";

/**
 * F1: the GateQ form. Validation and the step requests are pure; the
 * component is driven like a founder would, and the server actions are
 * doubles so we can see exactly what leaves the browser and when.
 */

type Action = (...args: unknown[]) => Promise<unknown>;
const calls = {
  start: vi.fn<Action>(),
  save: vi.fn<Action>(),
  submit: vi.fn<Action>(),
  share: vi.fn<Action>(),
  contact: vi.fn<Action>(),
  confirm: vi.fn<Action>(),
  accountContact: vi.fn<Action>(),
  open: vi.fn<Action>(),
  turn: vi.fn<Action>(),
  coverage: vi.fn<Action>(),
  progress: vi.fn<Action>(),
  transcript: vi.fn<Action>(),
};
const video = {
  state: vi.fn<Action>(),
  start: vi.fn<Action>(),
  end: vi.fn<Action>(),
};
/** Every server call, in order, by name: the flow's order is the assertion. */
const order: string[] = [];
const tracked =
  (name: keyof typeof calls) =>
  (...args: unknown[]) => {
    order.push(name);
    return calls[name](...args);
  };

vi.mock("../src/features/gateq/apply-actions", () => ({
  interviewProgressAction: tracked("progress"),
  transcriptAction: tracked("transcript"),
  startFormAction: tracked("start"),
  saveAnswersAction: tracked("save"),
  submitApplicationAction: tracked("submit"),
  saveContactAction: tracked("contact"),
  confirmContactAction: tracked("confirm"),
  openInterviewAction: tracked("open"),
  applicationTurnAction: tracked("turn"),
  coverageAction: tracked("coverage"),
  startApplicationAction: vi.fn(),
  // Video is untracked: whether it is offered never changes the form's order.
  videoStateAction: (...args: unknown[]) => video.state(...args),
  startVideoAction: (...args: unknown[]) => video.start(...args),
  endVideoAction: (...args: unknown[]) => video.end(...args),
}));
vi.mock("../src/features/gateq/materials-actions", () => ({
  shareMaterialsAction: tracked("share"),
  saveAccountContactAction: tracked("accountContact"),
}));

const model = await import("../src/features/gateq/form/form-model");
const { GateQForm } = await import("../src/features/gateq/form/gateq-form");
const { InterviewStep } =
  await import("../src/features/gateq/form/interview-step");

const GATEWAY: PublicGatewayDto = {
  publicId: "gq_preview0000000000000000000",
  organisationDisplayName: "Sahel Capital",
  title: "Apply to Sahel Capital",
  description:
    "We back early companies making money move better in West Africa.",
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [
    { label: "Pre-seed or seed", requiredness: "REQUIRED", dimension: "STAGE" },
    { label: "West Africa", requiredness: "REQUIRED", dimension: "GEOGRAPHY" },
    {
      label: "$500k to $3M",
      requiredness: "REQUIRED",
      dimension: "RAISE_SIZE",
    },
  ],
  publishedAt: "2026-10-05T09:00:00.000Z",
  replyWithinDays: 10,
};

const summary = (
  over: Partial<ApplicationSummaryDto>,
): ApplicationSummaryDto => ({
  reference: "ga_x",
  status: "IN_PROGRESS",
  declaredName: "Kora Health",
  facts: [],
  documentCount: 0,
  submittedAt: null,
  access: "NEEDS_INFORMATION",
  unmet: [],
  stillNeeded: [],
  ...over,
});

const TOKEN = "gqs_token_aaaaaaaaaaaaaaaa";

const contactDto = (
  over: Partial<ApplicationContactDto> = {},
): ApplicationContactDto => ({
  name: "Amara Okafor",
  email: "amara@kora.ng",
  role: "Founder & CEO",
  companyName: "Kora Health",
  phone: null,
  preferredChannel: null,
  emailConfirmed: true,
  confirmedVia: "EMAIL_CODE",
  ...over,
});

const coverageDto = (
  over: Partial<ApplicationCoverageDto["coverage"]> = {},
  contact: ApplicationCoverageDto["contact"] = {
    required: true,
    confirmed: true,
  },
): ApplicationCoverageDto => ({
  coverage: {
    version: 1,
    access: "MAY_APPLY",
    unmet: [],
    stillNeeded: [],
    answered: [
      {
        dimension: "STAGE",
        label: "Stage",
        group: "COMPANY",
        summary: "Seed",
        provenance: "APPLICANT_PROVIDED",
      },
      {
        dimension: "REVENUE",
        label: "Revenue",
        group: "TRACTION",
        summary: "$40k MRR",
        provenance: "DOCUMENT_SUPPORTED",
      },
    ],
    unknown: [{ dimension: "BURN", label: "Monthly burn", group: "TRACTION" }],
    declined: [
      { dimension: "VALUATION", label: "Valuation", group: "FUNDRAISING" },
    ],
    missing: [
      {
        dimension: "TEAM_SIZE",
        label: "Team size",
        group: "TEAM",
        reason: "UNDERSTANDING",
      },
    ],
    contradictions: ["Revenue: $40k MRR in the deck, $25k MRR in the chat"],
    ...over,
  },
  contact,
  documentCount: 1,
  transcriptTurns: 4,
});

beforeEach(() => {
  sessionStorage.clear();
  order.length = 0;
  for (const fn of Object.values(calls)) fn.mockReset();
  for (const fn of Object.values(video)) fn.mockReset();
  // By default video is not offered, so the typed interview is the step.
  video.state.mockResolvedValue({
    ok: true,
    state: { available: false, session: null, allowance: null },
  });
  calls.start.mockResolvedValue({
    ok: true,
    sessionToken: TOKEN,
    application: summary({}),
  });
  calls.contact.mockResolvedValue({
    ok: true,
    contact: contactDto({ emailConfirmed: false, confirmedVia: null }),
    codeSent: true,
    codeExpiresInMinutes: 15,
  });
  calls.confirm.mockResolvedValue({
    ok: true,
    status: "CONFIRMED",
    contact: contactDto(),
  });
  calls.accountContact.mockResolvedValue({
    ok: true,
    contact: contactDto({ confirmedVia: "ACCOUNT" }),
    codeSent: false,
    codeExpiresInMinutes: null,
  });
  calls.open.mockResolvedValue({
    ok: true,
    turns: [
      {
        seq: 1,
        role: "Q",
        text: "Who pays you today, clinics or patients?",
        at: "2026-10-13T09:00:00.000Z",
      },
    ],
  });
  calls.turn.mockResolvedValue({
    ok: true,
    sessionToken: TOKEN,
    reply: "Thanks. What does a clinic pay per month?",
    application: summary({ access: "MAY_APPLY" }),
  });
  calls.coverage.mockResolvedValue({ ok: true, coverage: coverageDto() });
  calls.progress.mockResolvedValue({
    ok: true,
    application: summary({ access: "MAY_APPLY" }),
    transcript: { turns: [] },
    coverage: coverageDto(),
  });
  calls.transcript.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      turns: [
        {
          seq: 1,
          role: "Q",
          text: "Who pays you today, clinics or patients?",
          at: "2026-10-13",
        },
        {
          seq: 2,
          role: "PERSON",
          text:
            typeof calls.turn.mock.calls.at(-1)?.[1] === "string"
              ? calls.turn.mock.calls.at(-1)?.[1]
              : "",
          at: "2026-10-13",
        },
        {
          seq: 3,
          role: "Q",
          text: "Thanks. What does a clinic pay per month?",
          at: "2026-10-13",
        },
      ],
    }),
  );
  calls.save.mockResolvedValue({
    ok: true,
    sessionToken: TOKEN,
    application: summary({ access: "MAY_APPLY" }),
  });
  calls.submit.mockResolvedValue({
    ok: true,
    sessionToken: TOKEN,
    reply: null,
    application: summary({ access: "MAY_APPLY", status: "SUBMITTED" }),
  });
  calls.share.mockResolvedValue({ ok: true });
});
afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();

describe("the form's rules (pure)", () => {
  const anonymous = { anonymous: true };
  it('needs an answer to every question, and accepts "I\'d rather not say"', () => {
    const empty = model.validateStep("company", model.EMPTY_ANSWERS, anonymous);
    expect(Object.keys(empty).sort()).toEqual([
      "companyName",
      "country",
      "sectors",
      "stage",
    ]);
    const declined = model.validateStep(
      "company",
      {
        ...model.EMPTY_ANSWERS,
        companyName: "Kora",
        stage: model.DECLINED,
        sectors: model.DECLINED,
        country: model.DECLINED,
      },
      anonymous,
    );
    expect(declined).toEqual({});
  });

  it("refuses an amount that isn't a number, and never invents one from a band", () => {
    const answers = {
      ...model.EMPTY_ANSWERS,
      band: "1m_3m",
      amount: "1.2 million",
    };
    expect(
      model.validateStep("round", answers, anonymous).amount,
    ).toBeDefined();
    // A band without an exact figure sends no amount: the rule stays unknown.
    expect(model.requestFor("round", { ...answers, amount: "" })).toEqual({});
    expect(
      model.requestFor("round", { ...answers, amount: "1,200,000" }),
    ).toEqual({
      raise: { amount: "1200000", currency: "USD" },
    });
    expect(
      model.requestFor("round", { ...answers, band: model.DECLINED }),
    ).toEqual({
      raise: "DECLINED",
    });
  });

  it("asks a signed-out founder for an email to reply to", () => {
    expect(
      model.validateStep("share", model.EMPTY_ANSWERS, anonymous).contactEmail,
    ).toBeDefined();
    expect(
      model.validateStep(
        "share",
        { ...model.EMPTY_ANSWERS, contactEmail: "a@b" },
        anonymous,
      ).contactEmail,
    ).toBeDefined();
    expect(
      model.validateStep("share", model.EMPTY_ANSWERS, { anonymous: false }),
    ).toEqual({});
  });

  it("shows the investor's own label only when it says more than the topic (live check 2026-10-16)", () => {
    expect(model.ownLabel({ dimension: "STAGE", label: "Stage" })).toBeNull();
    expect(model.ownLabel({ dimension: "STAGE", label: " stage " })).toBeNull();
    expect(
      model.ownLabel({ dimension: "GEOGRAPHY", label: "Where you're based" }),
    ).toBe("Where you're based");
  });

  it("reads the engine's answer rule by rule, unknown never as a no", () => {
    const lines = model.ruleLines(
      GATEWAY,
      summary({ unmet: ["West Africa"], stillNeeded: ["$500k to $3M"] }),
    );
    expect(lines.map((l) => l.standing)).toEqual([
      "MEETS",
      "DOES_NOT_MEET",
      "NOT_ANSWERED",
    ]);
    expect(model.verdictFor(summary({ access: "MAY_NOT_APPLY" }))).toBe(
      "NOT_A_FIT",
    );
    expect(model.verdictFor(summary({ access: "NEEDS_INFORMATION" }))).toBe(
      "NEEDS_ANSWERS",
    );
    expect(
      model.maySend(model.verdictFor(summary({ access: "NEEDS_INFORMATION" }))),
    ).toBe(false);
    expect(
      model.maySend(model.verdictFor(summary({ access: "MAY_APPLY" }))),
    ).toBe(true);
  });

  it("prefills only what the profile actually says", () => {
    const { answers, fromProfile } = model.answersFromProfile({
      companyName: "Kora Health",
      oneLiner: null,
      stageCode: "seed",
      country: "Nigeria",
      contactName: null,
      contactEmail: "amara@kora.ng",
    });
    expect(answers.stage).toBe("seed");
    expect(answers.country).toBe("");
    expect(fromProfile.has("stage")).toBe(true);
    expect(fromProfile.has("country")).toBe(false);
  });

  it("slice 1: asks for name, email, role and company; phone only if chosen", () => {
    expect(
      Object.keys(model.validateContact(model.EMPTY_CONTACT)).sort(),
    ).toEqual(["companyName", "email", "name", "role"]);
    const filled = {
      name: "Amara Okafor",
      email: "Amara@Kora.ng ",
      role: "CEO",
      companyName: "Kora Health",
      phone: "",
      preferredChannel: "PHONE" as const,
    };
    expect(model.validateContact(filled).phone).toBeDefined();
    expect(model.validateContact({ ...filled, preferredChannel: "" })).toEqual(
      {},
    );
    expect(model.contactRequest({ ...filled, preferredChannel: "" })).toEqual({
      name: "Amara Okafor",
      email: "amara@kora.ng",
      role: "CEO",
      companyName: "Kora Health",
    });
    expect(model.normaliseCode("12 34-56")).toBe("123456");
  });

  it("slice 1: the flow runs contact, form, interview, review", () => {
    expect(model.FLOW_PROGRESS).toEqual([
      "contact",
      "company",
      "round",
      "share",
      "note",
      "interview",
      "review",
    ]);
    expect(model.progressFor("check")).toBe(model.progressFor("note"));
    expect(
      model.latestQuestion([
        { from: "Q", text: "First?" },
        { from: "YOU", text: "Yes" },
      ]),
    ).toBeNull();
    expect(
      model.latestQuestion([
        { from: "YOU", text: "Yes" },
        { from: "Q", text: "Next?" },
      ]),
    ).toBe("Next?");
    expect(
      model.maySubmit(coverageDto({}, { required: true, confirmed: false })),
    ).toBe(false);
    expect(model.maySubmit(coverageDto({ access: "NEEDS_INFORMATION" }))).toBe(
      false,
    );
    expect(model.maySubmit(coverageDto())).toBe(true);
  });
});

async function press(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** A guest through the contact step with an emailed code. */
async function guestContact() {
  await flush();
  type("Full name", "Amara Okafor");
  type(/^Email/, "amara@kora.ng");
  type("Your role", "Founder & CEO");
  type("Company", "Kora Health");
  await press("Email me a code");
  expect(
    screen.getByText(/We sent a 6-digit code to amara@kora.ng/),
  ).toBeTruthy();
  type("6-digit code", "123456");
  await press("Confirm");
}

/** The four form steps and the check, admitted. */
async function formSteps() {
  fireEvent.click(screen.getByRole("radio", { name: "Seed" }));
  fireEvent.click(screen.getByRole("button", { name: "Health" }));
  fireEvent.click(screen.getByRole("radio", { name: "Nigeria" }));
  await press("Continue");
  fireEvent.click(screen.getByRole("radio", { name: "$1M–$3M" }));
  await press("Continue");
  await press("Continue");
  await press("Check my fit");
}

async function toReview() {
  await guestContact();
  await formSteps();
  await press("Continue to interview");
  await flush();
  await press("Skip to review");
  await flush();
}

describe("the form, driven like a founder", () => {
  it("restores the same application and server-authorized contact in review after refresh", async () => {
    const { saveRecovery } =
      await import("../src/features/gateq/form/session-recovery");
    const canonical = contactDto({
      name: "Canonical contact",
      email: "canonical@example.test",
      role: "CEO",
    });
    const restoredCoverage = {
      ...coverageDto(),
      contact: { ...coverageDto().contact, details: canonical },
    };
    calls.progress.mockResolvedValue({
      ok: true,
      application: summary({ access: "MAY_APPLY" }),
      transcript: { turns: [] },
      coverage: restoredCoverage,
    });
    calls.coverage.mockResolvedValue({ ok: true, coverage: restoredCoverage });
    saveRecovery(GATEWAY.publicId, {
      token: TOKEN,
      answers: model.EMPTY_ANSWERS,
      step: "review",
      interview: true,
      contact: contactDto(),
      pendingTurn: null,
      submitKey: "",
    });
    render(<GateQForm gateway={GATEWAY} />);
    await flush();
    expect(calls.start).not.toHaveBeenCalled();
    expect(calls.progress).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText(/Canonical contact.*CEO/)).toBeTruthy();
    expect(screen.getByText(/canonical@example.test/)).toBeTruthy();
    expect(calls.open).not.toHaveBeenCalled();
  });

  it("shows the investor's rules first and starts with who is applying", async () => {
    render(<GateQForm gateway={GATEWAY} />);
    await flush();
    expect(screen.getByText("West Africa")).toBeTruthy();
    expect(
      screen.getByText(/Nothing is sent until you press Submit/),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your details" })).toBeTruthy();
    // Who receives it, and what they'll see, before anything is typed.
    expect(screen.getByText(/goes to Sahel Capital's team only/)).toBeTruthy();
    expect(calls.start).not.toHaveBeenCalled();
  });

  it("runs contact, then the form, then the interview, then the review, then submits", async () => {
    render(<GateQForm gateway={GATEWAY} />);
    await guestContact();
    expect(calls.contact.mock.calls[0]?.[1]).toEqual({
      name: "Amara Okafor",
      email: "amara@kora.ng",
      role: "Founder & CEO",
      companyName: "Kora Health",
    });
    expect(calls.confirm).toHaveBeenCalledWith(TOKEN, "123456");
    // The form, unchanged, with the company carried over from the contact.
    expect(screen.getByRole("heading", { name: "Your company" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Company name").value).toBe(
      "Kora Health",
    );

    fireEvent.click(screen.getByRole("radio", { name: "Seed" }));
    fireEvent.click(screen.getByRole("button", { name: "Health" }));
    fireEvent.click(screen.getByRole("radio", { name: "Nigeria" }));
    await press("Continue");
    fireEvent.click(screen.getByRole("radio", { name: "$1M–$3M" }));
    await press("Continue");
    // The confirmed contact replaces the old reply-to fields.
    expect(screen.queryByLabelText("Email for their reply")).toBeNull();
    expect(screen.getByText("amara@kora.ng")).toBeTruthy();
    await press("Continue");
    expect(calls.save.mock.calls[2]?.[1]).toEqual({
      contactName: "Amara Okafor",
      contactEmail: "amara@kora.ng",
    });
    await press("Check my fit");
    expect(
      screen.getByText("You meet all 3 of Sahel Capital's rules"),
    ).toBeTruthy();

    await press("Continue to interview");
    expect(
      await screen.findByText("Who pays you today, clinics or patients?", {
        selector: "li span",
      }),
    ).toBeTruthy();
    type("Your answer", "Clinics, monthly.");
    await press("Send");
    expect(
      await screen.findByText("Thanks. What does a clinic pay per month?", {
        selector: "li span",
      }),
    ).toBeTruthy();
    await press("Finish and review");
    expect(
      await screen.findByRole("heading", { name: "Review before you submit" }),
    ).toBeTruthy();
    expect(calls.submit).not.toHaveBeenCalled();

    await press("Submit to Sahel Capital");
    expect(calls.submit).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "start",
      "contact",
      "confirm",
      "save",
      "save",
      "save",
      "save",
      "open",
      "turn",
      "transcript",
      "coverage",
      "progress",
      "submit",
    ]);
    // Q closes: thanks, may contact through the confirmed channel.
    expect(
      screen.getByRole("heading", {
        name: "Thank you. Sahel Capital has your application",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/may contact you at amara@kora.ng/)).toBeTruthy();
  });

  it("offers no Submit anywhere before the review", async () => {
    render(<GateQForm gateway={GATEWAY} />);
    await guestContact();
    await formSteps();
    expect(screen.queryByRole("button", { name: /Submit|Send to/ })).toBeNull();
    await press("Continue to interview");
    await flush();
    expect(screen.queryByRole("button", { name: /Submit/ })).toBeNull();
    expect(calls.submit).not.toHaveBeenCalled();
    await press("Skip to review");
    await flush();
    expect(
      screen.getByRole("button", { name: "Submit to Sahel Capital" }),
    ).toBeTruthy();
    expect(calls.submit).not.toHaveBeenCalled();
  });

  it("shows the review's provenance, gaps, contradictions and disclosure", async () => {
    render(<GateQForm gateway={GATEWAY} />);
    await toReview();
    expect(screen.getByText("You said")).toBeTruthy();
    expect(screen.getByText("From your documents")).toBeTruthy();
    expect(screen.getByText(/\$40k MRR in the deck/)).toBeTruthy();
    expect(screen.getByText("You don't know yet")).toBeTruthy();
    expect(screen.getByText("You'd rather not say")).toBeTruthy();
    expect(
      screen.getByText(/Missing · Helps them understand you/),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Exactly what Sahel Capital receives",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/word for word \(4 turns\)/)).toBeTruthy();
  });

  it("blocks Submit until the contact is confirmed", async () => {
    calls.coverage.mockResolvedValue({
      ok: true,
      coverage: coverageDto({}, { required: true, confirmed: false }),
    });
    render(<GateQForm gateway={GATEWAY} />);
    await toReview();
    expect(
      screen
        .getByRole("button", { name: "Submit to Sahel Capital" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await press("Confirm my email");
    expect(screen.getByRole("heading", { name: "Your details" })).toBeTruthy();
  });

  it("goes back to the contact step on 409 CONTACT_NOT_CONFIRMED", async () => {
    calls.submit.mockResolvedValue({
      ok: false,
      contactNotConfirmed: true,
      message: "Confirm your contact email before submitting.",
    });
    render(<GateQForm gateway={GATEWAY} />);
    await toReview();
    await press("Submit to Sahel Capital");
    expect(
      screen.getByRole("heading", { name: "Check your email" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Your answers and interview are saved/),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Thank you/ })).toBeNull();
    // A new code, confirmed, returns to the form with everything kept.
    await press("Send a new code");
    expect(calls.contact).toHaveBeenCalledTimes(2);
  });

  it("never offers to continue when a required rule is not met", () => {
    render(
      <GateQForm
        gateway={GATEWAY}
        preview={{
          step: "check",
          application: summary({
            access: "MAY_NOT_APPLY",
            unmet: ["West Africa"],
          }),
        }}
      />,
    );
    expect(
      screen.getByText(/only takes companies that meet "West Africa"/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send to|Submit/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Continue to interview" }),
    ).toBeNull();
  });

  it("a signed-in founder confirms through the account, and shares only ticked documents on Submit", async () => {
    const deck = "00000000-0000-4000-8000-0000000000d1";
    const accounts = "00000000-0000-4000-8000-0000000000d2";
    render(
      <GateQForm
        gateway={GATEWAY}
        prefill={{
          companyName: "Kora Health",
          oneLiner: "Gets clinics paid",
          stageCode: "seed",
          country: "NG",
          contactName: "Amara Okafor",
          contactEmail: "amara@kora.ng",
        }}
        materials={[
          { id: deck, name: "Pitch deck v3", detail: "Pitch deck" },
          { id: accounts, name: "Management accounts", detail: "Financials" },
        ]}
      />,
    );
    await flush();
    expect(screen.getByLabelText<HTMLInputElement>(/^Email/).value).toBe(
      "amara@kora.ng",
    );
    type("Your role", "Founder & CEO");
    await press("Confirm and continue");
    expect(calls.accountContact).toHaveBeenCalledWith(TOKEN, {
      name: "Amara Okafor",
      email: "amara@kora.ng",
      role: "Founder & CEO",
      companyName: "Kora Health",
    });
    // No code for the account's own email.
    expect(calls.contact).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Health" }));
    await press("Continue");
    fireEvent.click(screen.getByRole("radio", { name: "$1M–$3M" }));
    await press("Continue");
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /Pitch deck v3/ })
        .checked,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: /Management accounts/,
      }).checked,
    ).toBe(false);
    await press("Continue");
    await press("Check my fit");
    await press("Continue to interview");
    await flush();
    await press("Skip to review");
    await flush();
    expect(
      screen.getByText(/Documents you ticked: Pitch deck v3/),
    ).toBeTruthy();
    expect(calls.share).not.toHaveBeenCalled();
    await press("Submit to Sahel Capital");
    expect(calls.share).toHaveBeenCalledWith(TOKEN, [deck]);
    expect(calls.submit).toHaveBeenCalledTimes(1);
  });
});

describe("the interview step", () => {
  const ref = { current: null };

  it("resumes from the server's transcript on mount", async () => {
    calls.open.mockResolvedValue({
      ok: true,
      turns: [
        {
          seq: 1,
          role: "Q",
          text: "Who pays you?",
          at: "2026-10-13T09:00:00Z",
        },
        {
          seq: 2,
          role: "PERSON",
          text: "Clinics.",
          at: "2026-10-13T09:01:00Z",
        },
        {
          seq: 3,
          role: "Q",
          text: "How many clinics pay today?",
          at: "2026-10-13T09:01:02Z",
          latencyMs: 1800,
        },
      ],
    });
    render(
      <InterviewStep
        headingRef={ref}
        fund="Sahel Capital"
        companyName="Kora Health"
        sessionToken={TOKEN}
        onFinish={() => undefined}
      />,
    );
    await flush();
    expect(calls.open).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText("Clinics.")).toBeTruthy();
    // Q's latest question, by the composer.
    expect(
      screen.getByText("How many clinics pay today?", { selector: "p" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Finish and review" }),
    ).toBeTruthy();

    // Pause, then resume: the transcript is read again from the server.
    await press("Pause, come back later");
    expect(
      screen.getByRole("heading", { name: "Interview paused" }),
    ).toBeTruthy();
    await press("Resume the interview");
    await flush();
    expect(calls.open).toHaveBeenCalledTimes(2);
  });

  it("retries a failed message with the same client turn id", async () => {
    calls.turn
      .mockResolvedValueOnce({
        ok: false,
        message: "Couldn't reach Capital Q.",
      })
      .mockResolvedValueOnce({
        ok: true,
        sessionToken: TOKEN,
        reply: "Thanks.",
        application: summary({}),
      });
    render(
      <InterviewStep
        headingRef={ref}
        fund="Sahel Capital"
        companyName="Kora Health"
        sessionToken={TOKEN}
        onFinish={() => undefined}
      />,
    );
    await flush();
    type("Your answer", "About forty clinics.");
    await press("Send");
    expect(screen.getByRole("alert").textContent).toMatch(/Not sent/);
    await press("Try again");
    expect(calls.turn).toHaveBeenCalledTimes(2);
    const first = calls.turn.mock.calls[0];
    const second = calls.turn.mock.calls[1];
    expect(first?.[1]).toBe("About forty clinics.");
    expect(second?.[1]).toBe("About forty clinics.");
    expect(typeof first?.[2]).toBe("string");
    expect(second?.[2]).toBe(first?.[2]);
    // A new message after the retry gets a new id.
    type("Your answer", "Mostly in Lagos.");
    await press("Send");
    expect(calls.turn.mock.calls[2]?.[2]).not.toBe(first?.[2]);
  });

  it('sends "I don\'t know" and "I\'d rather not say" as answers', async () => {
    render(
      <InterviewStep
        headingRef={ref}
        fund="Sahel Capital"
        companyName="Kora Health"
        sessionToken={TOKEN}
        onFinish={() => undefined}
      />,
    );
    await flush();
    await press("I don't know");
    expect(calls.turn.mock.calls[0]?.[1]).toBe(model.QUICK_REPLIES.UNKNOWN);
    await flush();
    await press("I'd rather not say");
    expect(calls.turn.mock.calls[1]?.[1]).toBe(model.QUICK_REPLIES.DECLINED);
  });
});

describe("the interview step, video first", () => {
  const ref = { current: null };
  const offered = {
    ok: true,
    state: {
      available: true,
      session: null,
      allowance: {
        weeklySessions: 5,
        remaining: 4,
        resetsAt: "2026-10-19T00:00:00.000Z",
      },
    },
  };
  const live = {
    id: "8b0c2a4e-1f6d-4c3b-9a8e-2d7f5e6a1b3c",
    status: "LIVE",
    joinUrl: "https://tavus.daily.co/c123",
    endsAt: new Date(Date.now() + 180_000).toISOString(),
    liveAt: new Date().toISOString(),
    maxSeconds: 180,
    endedReason: null,
    disclosure: "Q is an AI interviewer.",
  };
  const step = (onFinish: () => void = () => undefined) =>
    render(
      <InterviewStep
        headingRef={ref}
        fund="Sahel Capital"
        companyName="Kora Health"
        sessionToken={TOKEN}
        participantName="Ada Obi"
        onFinish={onFinish}
      />,
    );

  it("offers the video interview as the default, typing as the choice", async () => {
    video.state.mockResolvedValue(offered);
    step();
    await flush();
    expect(video.state).toHaveBeenCalledWith(TOKEN);
    expect(
      screen.getByRole("button", { name: "Start the video interview" }),
    ).toBeTruthy();
    expect(
      screen.getByText("4 of 5 video sessions left this week."),
    ).toBeTruthy();
    // No composer while video is the way in.
    expect(screen.queryByLabelText("Your answer")).toBeNull();
    await press("Type my answers instead");
    expect(screen.getByLabelText("Your answer")).toBeTruthy();
    // The person can change their mind.
    await press("Talk with Q on video instead");
    expect(
      screen.getByRole("button", { name: "Start the video interview" }),
    ).toBeTruthy();
  });

  it("makes the video interview the step's primary; pressing it before consent asks for the box (live check 2026-10-16)", async () => {
    video.state.mockResolvedValue(offered);
    step();
    await flush();
    const start = screen.getByRole("button", {
      name: "Start the video interview",
    });
    expect(start.hasAttribute("disabled")).toBe(false);
    expect(start.getAttribute("data-variant")).toBe("primary");
    expect(
      screen
        .getByRole("button", { name: "Skip to review" })
        .getAttribute("data-variant"),
    ).toBe("secondary");
    await press("Start the video interview");
    expect(video.start).not.toHaveBeenCalled();
    expect(
      screen.getByText("Tick the box above to start the video interview."),
    ).toBeTruthy();
    expect(document.activeElement?.getAttribute("type")).toBe("checkbox");
  });

  it("types when video is not offered, saying why when the cap is reached", async () => {
    video.state.mockResolvedValue({
      ok: true,
      state: {
        available: false,
        session: null,
        allowance: {
          weeklySessions: 5,
          remaining: 0,
          resetsAt: "2026-10-19T00:00:00.000Z",
        },
      },
    });
    step();
    await flush();
    expect(screen.getByLabelText("Your answer")).toBeTruthy();
    expect(screen.getByText(/used this week’s 5 video sessions/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Start the video interview" }),
    ).toBeNull();
  });

  it("says plainly when this application's video sessions are used", async () => {
    video.state.mockResolvedValue({
      ok: true,
      state: {
        available: false,
        session: null,
        allowance: {
          weeklySessions: 5,
          remaining: 3,
          resetsAt: "2026-10-19T00:00:00.000Z",
        },
        unavailableReason: "APPLICATION_SESSIONS_USED",
        perApplication: 2,
      },
    });
    step();
    await flush();
    expect(screen.getByLabelText("Your answer")).toBeTruthy();
    expect(
      screen.getByText(/used the 2 video sessions this application allows/),
    ).toBeTruthy();
  });

  it("re-offers video after the person chose to continue by typing", async () => {
    video.state.mockResolvedValue(offered);
    video.start.mockResolvedValue({
      ok: true,
      state: { available: false, session: live, allowance: null },
    });
    video.end.mockResolvedValue({
      ok: true,
      state: { available: false, session: null, allowance: null },
    });
    step();
    await flush();
    fireEvent.click(screen.getByRole("checkbox"));
    await press("Start the video interview");
    await flush();
    await press("Continue by typing instead");
    await flush();
    expect(video.end).toHaveBeenCalledWith(TOKEN, true);
    expect(screen.getByLabelText("Your answer")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Talk with Q on video instead" }),
    ).toBeTruthy();
  });

  it("falls back to typing when the start is refused", async () => {
    video.state.mockResolvedValue(offered);
    video.start.mockResolvedValue({
      ok: false,
      message: "Video isn't available right now. You can continue by typing.",
    });
    step();
    await flush();
    fireEvent.click(screen.getByRole("checkbox"));
    await press("Start the video interview");
    await flush();
    expect(screen.getByLabelText("Your answer")).toBeTruthy();
    expect(screen.getByText(/Video isn't available right now/)).toBeTruthy();
  });

  it("opens the shared room, then ends into the review with the spoken transcript", async () => {
    video.state.mockResolvedValue(offered);
    video.start.mockResolvedValue({
      ok: true,
      state: { available: false, session: live, allowance: null },
    });
    video.end.mockResolvedValue({
      ok: true,
      state: { available: false, session: null, allowance: null },
    });
    const onFinish = vi.fn();
    step(onFinish);
    await flush();
    fireEvent.click(screen.getByRole("checkbox"));
    await press("Start the video interview");
    await flush();
    // The room's own way out replaces the step's bar while it is open.
    expect(
      screen.queryByRole("button", {
        name: /Skip to review|Finish and review/,
      }),
    ).toBeNull();
    expect(calls.coverage).toHaveBeenCalledWith(TOKEN);
    const before = calls.transcript.mock.calls.length;
    await press("End and review my application");
    await flush();
    expect(video.end).toHaveBeenCalledWith(TOKEN, false);
    expect(calls.transcript.mock.calls.length).toBe(before + 1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("reopens a live session after a refresh instead of starting another", async () => {
    video.state.mockResolvedValue({
      ok: true,
      state: { available: false, session: live, allowance: null },
    });
    step();
    await flush();
    expect(video.start).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Continue by typing instead" }),
    ).toBeTruthy();
  });
});
