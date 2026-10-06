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
};

vi.mock("../src/features/gateq/apply-actions", () => ({
  startFormAction: (...args: unknown[]) => calls.start(...args),
  saveAnswersAction: (...args: unknown[]) => calls.save(...args),
  submitApplicationAction: (...args: unknown[]) => calls.submit(...args),
}));
vi.mock("../src/features/gateq/materials-actions", () => ({
  shareMaterialsAction: (...args: unknown[]) => calls.share(...args),
}));

const model = await import("../src/features/gateq/form/form-model");
const { GateQForm } = await import("../src/features/gateq/form/gateq-form");

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

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
  calls.start.mockResolvedValue({
    ok: true,
    sessionToken: "gqs_token_aaaaaaaaaaaaaaaa",
    application: summary({}),
  });
});
afterEach(cleanup);

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
});

async function press(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
}

describe("the form, driven like a founder", () => {
  it("shows the investor's rules before asking anything", () => {
    render(<GateQForm gateway={GATEWAY} />);
    expect(screen.getByText("West Africa")).toBeTruthy();
    expect(
      screen.getByText(/Nothing is sent until you press Send/),
    ).toBeTruthy();
    expect(calls.start).not.toHaveBeenCalled();
  });

  it("checks the answers, then sends only when the founder presses Send", async () => {
    calls.save.mockResolvedValue({
      ok: true,
      sessionToken: "gqs_token_aaaaaaaaaaaaaaaa",
      application: summary({ access: "MAY_APPLY" }),
    });
    calls.submit.mockResolvedValue({
      ok: true,
      sessionToken: "gqs_token_aaaaaaaaaaaaaaaa",
      reply: null,
      application: summary({ access: "MAY_APPLY", status: "SUBMITTED" }),
    });
    render(<GateQForm gateway={GATEWAY} />);
    fireEvent.change(screen.getByLabelText("Company name"), {
      target: { value: "Kora Health" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Seed" }));
    fireEvent.click(screen.getByRole("button", { name: "Health" }));
    fireEvent.click(screen.getByRole("radio", { name: "Nigeria" }));
    await press("Continue");
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(calls.save.mock.calls[0]?.[1]).toMatchObject({
      companyName: "Kora Health",
      stage: "seed",
      sectors: ["Health"],
      country: "NG",
    });

    // Round: "I'd rather not say" for the amount.
    const groups = screen.getAllByRole("radiogroup");
    fireEvent.click(
      Array.from(groups[0]?.querySelectorAll("button") ?? []).find((b) =>
        /rather not/.test(b.textContent ?? ""),
      ) as HTMLButtonElement,
    );
    await press("Continue");
    expect(calls.save.mock.calls[1]?.[1]).toMatchObject({ raise: "DECLINED" });

    fireEvent.change(screen.getByLabelText("Email for their reply"), {
      target: { value: "amara@kora.ng" },
    });
    await press("Continue");
    await press("Check my fit");
    expect(
      screen.getByText("You meet all 3 of Sahel Capital's rules"),
    ).toBeTruthy();
    // Nothing has been sent yet: checking is not sharing.
    expect(calls.submit).not.toHaveBeenCalled();

    await press("Send to Sahel Capital");
    expect(calls.submit).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sent to Sahel Capital")).toBeTruthy();
  });

  it("never offers Send when a required rule is not met", () => {
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
    expect(screen.queryByRole("button", { name: /Send to/ })).toBeNull();
  });

  it("shares only the documents the founder ticked, and only on Send", async () => {
    calls.share.mockResolvedValue({ ok: true });
    calls.save.mockResolvedValue({
      ok: true,
      sessionToken: "gqs_token_aaaaaaaaaaaaaaaa",
      application: summary({ access: "MAY_APPLY" }),
    });
    calls.submit.mockResolvedValue({
      ok: true,
      sessionToken: "gqs_token_aaaaaaaaaaaaaaaa",
      reply: null,
      application: summary({ access: "MAY_APPLY", status: "SUBMITTED" }),
    });
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
          contactName: null,
          contactEmail: "amara@kora.ng",
        }}
        materials={[
          { id: deck, name: "Pitch deck v3", detail: "Pitch deck" },
          { id: accounts, name: "Management accounts", detail: "Financials" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Health" }));
    await press("Continue");
    fireEvent.click(screen.getByRole("radio", { name: "$1M–$3M" }));
    await press("Continue");
    // The deck is ticked by default; the accounts stay unticked.
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: /Pitch deck v3/,
      }).checked,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: /Management accounts/,
      }).checked,
    ).toBe(false);
    await press("Continue");
    await press("Check my fit");
    expect(calls.share).not.toHaveBeenCalled();
    await press("Send to Sahel Capital");
    expect(calls.share).toHaveBeenCalledWith("gqs_token_aaaaaaaaaaaaaaaa", [
      deck,
    ]);
  });
});
