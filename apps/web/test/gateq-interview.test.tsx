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
  ApplicationCoverageDto,
  ApplicationSummaryDto,
  PublicGatewayDto,
} from "@capital-q/contracts";

const calls = vi.hoisted(() => ({
  progress: vi.fn(),
  turn: vi.fn(),
  contact: vi.fn(),
  confirm: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("../src/features/gateq/apply-actions", () => ({
  interviewProgressAction: calls.progress,
  applicationTurnAction: calls.turn,
  contactAction: calls.contact,
  confirmContactAction: calls.confirm,
  submitApplicationAction: calls.submit,
  startApplicationAction: vi.fn(),
}));
vi.mock("../src/features/q-swarm/q-swarm", () => ({ QSwarm: () => null }));
const { ApplyExperience } =
  await import("../src/features/gateq/apply-experience");
const { EMPTY_ANSWERS } = await import("../src/features/gateq/form/form-model");
const { saveRecovery, readRecovery } =
  await import("../src/features/gateq/form/session-recovery");
const gateway: PublicGatewayDto = {
  publicId: "gq_interview",
  organisationDisplayName: "Sahel",
  title: "Apply",
  description: "",
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [],
  publishedAt: "2026-10-13T00:00:00Z",
  replyWithinDays: null,
};
const application: ApplicationSummaryDto = {
  reference: "ga_same",
  status: "IN_PROGRESS",
  declaredName: "Kora",
  facts: [],
  documentCount: 0,
  submittedAt: null,
  access: "MAY_APPLY",
  unmet: [],
  stillNeeded: [],
};
const coverage: ApplicationCoverageDto = {
  coverage: {
    version: 1,
    access: "MAY_APPLY",
    unmet: [],
    stillNeeded: [],
    answered: [
      {
        dimension: "PRODUCT",
        group: "PRODUCT",
        label: "Product",
        summary: "Clinic billing",
        provenance: "APPLICANT_PROVIDED",
      },
    ],
    missing: [
      {
        dimension: "REVENUE",
        group: "TRACTION",
        label: "Revenue",
        reason: "UNDERSTANDING",
      },
    ],
    unknown: [],
    declined: [],
    contradictions: ["Revenue figures differ"],
  },
  contact: { required: true, confirmed: true },
  documentCount: 0,
  transcriptTurns: 2,
};
const turns = [
  { seq: 1, role: "PERSON", text: "Clinic billing", at: "2026-10-13" },
  { seq: 2, role: "Q", text: "What revenue supports that?", at: "2026-10-13" },
];
const token = "gqs_scoped_12345678901234567890";
const initialSession = {
  token,
  application,
  contactName: "Amara",
  contactEmail: "amara@example.test",
  companyName: "Kora",
};
async function mount() {
  await act(async () => {
    render(
      <ApplyExperience gateway={gateway} initialSession={initialSession} />,
    );
    await Promise.resolve();
  });
}
async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
}
beforeEach(() => {
  sessionStorage.clear();
  for (const fn of Object.values(calls)) fn.mockReset();
  calls.progress.mockResolvedValue({
    ok: true,
    application,
    transcript: { turns },
    coverage,
  });
  saveRecovery(gateway.publicId, {
    token,
    answers: EMPTY_ANSWERS,
    step: "check",
    interview: true,
    pendingTurn: null,
    submitKey: "",
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
describe("founder interview and review", () => {
  it("restores ordered turns with the same credential and keeps submission separate", async () => {
    calls.progress.mockResolvedValue({
      ok: true,
      application,
      transcript: { turns },
      coverage: {
        ...coverage,
        contact: {
          ...coverage.contact,
          details: {
            name: "Amara Confirmed",
            email: "confirmed@example.test",
            role: "Founder",
            companyName: "Kora Confirmed",
            phone: null,
            preferredChannel: null,
            emailConfirmed: true,
            confirmedVia: "EMAIL_CODE",
          },
        },
      },
    });
    await mount();
    expect(calls.progress).toHaveBeenCalledWith(token);
    expect(screen.getByText("What revenue supports that?")).toBeTruthy();
    expect(calls.submit).not.toHaveBeenCalled();
    await press("Review my application");
    expect(screen.getByText(/Amara Confirmed/)).toBeTruthy();
    expect(screen.getByText(/confirmed@example.test/)).toBeTruthy();
    expect(screen.getByText("Revenue figures differ")).toBeTruthy();
    expect(screen.getByText("Revenue")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Submit to Sahel" }),
    ).toBeTruthy();
    expect(calls.submit).not.toHaveBeenCalled();
  });
  it("retries the same answer with its original turn ID and blocks a changed answer", async () => {
    calls.turn
      .mockResolvedValueOnce({ ok: false, message: "Connection interrupted." })
      .mockResolvedValueOnce({ ok: true, application, reply: "Thanks" });
    await mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
      target: { value: "Revenue is unknown" },
    });
    await press("Send");
    const first = calls.turn.mock.calls[0];
    expect(readRecovery(gateway.publicId)?.pendingTurn?.text).toBe(
      "Revenue is unknown",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
      target: { value: "Changed answer" },
    });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Send" }).disabled,
    ).toBe(true);
    await press("Try again");
    expect(calls.turn.mock.calls[1]).toEqual(first);
    expect(readRecovery(gateway.publicId)?.pendingTurn).toBeNull();
  });
  it("keeps a turn recoverable when the server action transport throws", async () => {
    calls.turn.mockRejectedValueOnce(new Error("Network interruption"));
    await mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
      target: { value: "Not yet known" },
    });
    await press("Send");
    expect(screen.getByText(/The connection was interrupted/)).toBeTruthy();
    expect(readRecovery(gateway.publicId)?.pendingTurn?.text).toBe(
      "Not yet known",
    );
  });

  it("recovers an interrupted turn across a reload without inventing another turn", async () => {
    saveRecovery(gateway.publicId, {
      token,
      answers: EMPTY_ANSWERS,
      step: "check",
      interview: true,
      pendingTurn: { id: "turn_original_123", text: "I do not know" },
      submitKey: "",
    });
    calls.turn.mockResolvedValue({ ok: true, application, reply: "Thank you" });
    await mount();
    await press("Try again");
    expect(calls.turn).toHaveBeenCalledWith(
      token,
      "I do not know",
      "turn_original_123",
    );
  });
  it("reuses the submission key after a lost confirmation", async () => {
    calls.submit
      .mockResolvedValueOnce({ ok: false, message: "Lost confirmation" })
      .mockResolvedValueOnce({
        ok: true,
        application: {
          ...application,
          status: "SUBMITTED",
          submittedAt: "2026-10-13",
        },
      });
    await mount();
    await press("Review my application");
    await press("Submit to Sahel");
    const first = calls.submit.mock.calls[0];
    await press("Submit to Sahel");
    expect(calls.submit.mock.calls[1]).toEqual(first);
    expect(screen.getByText("Sent to Sahel")).toBeTruthy();
  });
  it("recovers a successful submission's lost receipt before reattaching materials", async () => {
    const prepared = vi.fn().mockResolvedValue({ ok: true });
    calls.submit.mockResolvedValue({ ok: false, message: "Lost receipt" });
    await act(async () => {
      render(
        <ApplyExperience
          gateway={gateway}
          initialSession={initialSession}
          prepareSubmission={prepared}
        />,
      );
      await Promise.resolve();
    });
    await press("Review my application");
    await press("Submit to Sahel");
    calls.progress.mockResolvedValue({
      ok: true,
      application: {
        ...application,
        status: "SUBMITTED",
        submittedAt: "2026-10-13",
      },
      transcript: { turns },
      coverage,
    });
    await press("Submit to Sahel");
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(calls.submit).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sent to Sahel")).toBeTruthy();
  });

  it("does not allow submission when the server's mandatory coverage fails", async () => {
    calls.progress.mockResolvedValue({
      ok: true,
      application,
      transcript: { turns },
      coverage: {
        ...coverage,
        coverage: {
          ...coverage.coverage,
          access: "MAY_NOT_APPLY",
          unmet: ["Published stage"],
        },
      },
    });
    await mount();
    await press("Review my application");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Submit to Sahel" })
        .disabled,
    ).toBe(true);
    expect(calls.submit).not.toHaveBeenCalled();
  });
  it("requires contact confirmation and explains an incorrect code", async () => {
    calls.progress.mockResolvedValue({
      ok: true,
      application,
      transcript: { turns: [] },
      coverage: { ...coverage, contact: { required: true, confirmed: false } },
    });
    calls.contact.mockResolvedValue({
      ok: true,
      contact: { emailConfirmed: false },
      codeSent: true,
    });
    calls.confirm.mockResolvedValue({
      ok: true,
      status: "WRONG_CODE",
      contact: null,
    });
    await mount();
    expect(screen.queryByRole("textbox", { name: "Your answer" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Founder" },
    });
    await press("Send confirmation code");
    fireEvent.change(screen.getByLabelText("Email confirmation code"), {
      target: { value: "123456" },
    });
    await press("Confirm email");
    expect(
      screen.getByText("That code didn't match. Please try again."),
    ).toBeTruthy();
    expect(calls.turn).not.toHaveBeenCalled();
  });
});
