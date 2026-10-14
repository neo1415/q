// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationSummaryDto } from "@capital-q/contracts";

const actions = vi.hoisted(() => ({
  resume: vi.fn(),
  turn: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("../src/features/gateq/interview-actions", () => ({
  resumeInterviewAction: actions.resume,
}));
vi.mock("../src/features/gateq/apply-actions", () => ({
  applicationTurnAction: actions.turn,
  submitApplicationAction: actions.submit,
}));
const { InterviewStep } = await import("../src/features/gateq/interview-step");
const application: ApplicationSummaryDto = {
  reference: "ga_test",
  status: "IN_PROGRESS",
  declaredName: "Sample",
  facts: [],
  documentCount: 0,
  submittedAt: null,
  access: "MAY_APPLY",
  unmet: [],
  stillNeeded: [],
};
const saved = {
  ok: true,
  value: {
    application,
    transcript: {
      turns: [
        {
          seq: 1,
          role: "PERSON",
          text: "We are pre-revenue",
          at: "2026-10-13T00:00:00Z",
        },
        {
          seq: 2,
          role: "Q",
          text: "What is your monthly revenue?",
          at: "2026-10-13T00:00:00Z",
        },
      ],
    },
    coverage: {
      contact: { required: true, confirmed: true },
      documentCount: 0,
      transcriptTurns: 1,
      coverage: {
        version: 1,
        access: "MAY_APPLY",
        unmet: [],
        stillNeeded: [],
        answered: [],
        unknown: [
          { dimension: "REVENUE", label: "Revenue", group: "FINANCIALS" },
        ],
        declined: [],
        missing: [],
        contradictions: ["Revenue statements differ"],
      },
    },
  },
};
const onApplication = vi.fn();
const onSubmitted = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  actions.resume.mockResolvedValue(saved);
});
afterEach(cleanup);
async function mount() {
  render(
    <InterviewStep
      token="gqs_application_token_long"
      fund="Sahel"
      onApplication={onApplication}
      onSubmitted={onSubmitted}
    />,
  );
  await screen.findByText("What is your monthly revenue?");
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "I don't know" })
        .disabled,
    ).toBe(false),
  );
}

describe("durable investment interview", () => {
  it("renders the recorded transcript and preserves an unknown answer without auto-submitting", async () => {
    actions.turn.mockResolvedValue({ ok: true, application, reply: "Thanks" });
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I don't know" }));
      await Promise.resolve();
    });
    expect(actions.turn).toHaveBeenCalledWith(
      "gqs_application_token_long",
      "I don't know the answer to this yet.",
      expect.any(String),
    );
    expect(actions.submit).not.toHaveBeenCalled();
  });
  it("retries the same failed turn ID and refuses to submit while a turn is unresolved", async () => {
    actions.turn
      .mockRejectedValueOnce(new Error("server action transport interrupted"))
      .mockResolvedValueOnce({ ok: true, application, reply: "Thanks" });
    await mount();
    fireEvent.change(screen.getByLabelText("Your answer"), {
      target: { value: "We have no revenue yet" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
      await Promise.resolve();
    });
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Review before submitting",
      }).disabled,
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });
    expect(actions.turn.mock.calls[0]?.[2]).toBe(
      actions.turn.mock.calls[1]?.[2],
    );
    expect(actions.resume).toHaveBeenCalledTimes(2);
  });
  it("shows unknowns and contradictions and requires exact human disclosure consent", async () => {
    actions.submit.mockResolvedValue({
      ok: true,
      application: { ...application, status: "SUBMITTED" },
    });
    await mount();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Review before submitting" }),
      );
      await Promise.resolve();
    });
    expect(screen.getByText("Revenue statements differ")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Submit to Sahel" })
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit to Sahel" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
  });
  it("keeps the same submit key after a transport failure", async () => {
    actions.submit
      .mockResolvedValueOnce({ ok: false, message: "Submit response lost" })
      .mockResolvedValueOnce({
        ok: true,
        application: { ...application, status: "SUBMITTED" },
      });
    await mount();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Review before submitting" }),
      );
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit to Sahel" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit to Sahel" }));
      await Promise.resolve();
    });
    expect(actions.submit.mock.calls[0]?.[1]).toBe(
      actions.submit.mock.calls[1]?.[1],
    );
  });
});
