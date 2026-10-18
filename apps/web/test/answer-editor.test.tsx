// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ADR 0024: a card edits its facts in place with the step's own options,
 * sends only what changed, and closes only on the server's answer.
 */

const revise = vi.fn((_input: unknown) =>
  Promise.resolve({ ok: true as const }),
);
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../src/features/profile/answer-actions", () => ({
  reviseProfileAnswerAction: (input: unknown) => revise(input),
  taxonomyChoicesAction: () => Promise.resolve([]),
}));

const { AnswerEditor } = await import("../src/features/profile/answer-editor");

afterEach(() => {
  cleanup();
  revise.mockClear();
});

describe("AnswerEditor", () => {
  it("saves only the changed fact, as the step's exact answer", async () => {
    render(
      <AnswerEditor
        journey="investor"
        title="Investment mandate"
        stepKeys={["I2.stages", "I2.investment_role"]}
        responses={{
          "I2.stages": { type: "MULTI_SELECT", optionKeys: ["seed"] },
        }}
        labels={{}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit investment mandate" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Series A" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(revise).toHaveBeenCalledTimes(1));
    expect(revise).toHaveBeenCalledWith({
      journey: "investor",
      stepKey: "I2.stages",
      value: { type: "MULTI_SELECT", optionKeys: ["seed", "series_a"] },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("closes without a call when nothing changed", async () => {
    render(
      <AnswerEditor
        journey="investor"
        title="Investment mandate"
        stepKeys={["I2.stages"]}
        responses={{
          "I2.stages": { type: "MULTI_SELECT", optionKeys: ["seed"] },
        }}
        labels={{}}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit investment mandate" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(revise).not.toHaveBeenCalled();
  });

  it("F18: at the category limit, says so instead of silently hiding search", async () => {
    const ids = Array.from(
      { length: 8 },
      (_, n) => `00000000-0000-4000-8000-00000000000${String(n)}`,
    );
    render(
      <AnswerEditor
        journey="founder"
        title="Sector"
        stepKeys={["F1.categories"]}
        responses={{
          "F1.categories": {
            type: "RESOURCE_REFERENCE",
            resourceType: "TAXONOMY_NODE",
            resourceIds: ids,
          },
        }}
        labels={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit sector" }));
    expect(await screen.findByText(/most you can keep \(8\)/u)).toBeTruthy();
  });
});
