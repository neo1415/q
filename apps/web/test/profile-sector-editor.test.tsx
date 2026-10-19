// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Live 2026-10-19: a founder could set sectors in onboarding but had no
 * way to change them on their company profile. The Company section's
 * sector card edits the declared categories in place (F1.categories, the
 * same revise path setup uses), and keeps that editor even when the
 * session view lists no sector answer.
 */

const revise = vi.fn((_input: unknown) =>
  Promise.resolve({ ok: true as const }),
);
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../src/features/profile/answer-actions", () => ({
  reviseProfileAnswerAction: (input: unknown) => revise(input),
  taxonomyChoicesAction: () =>
    Promise.resolve([
      { id: "11111111-1111-4111-8111-111111111111", name: "Fintech" },
      { id: "22222222-2222-4222-8222-222222222222", name: "Insurtech" },
    ]),
}));

const { ProfileAnswers } =
  await import("../src/features/profile/profile-answers-view");

const FINTECH = "11111111-1111-4111-8111-111111111111";
const INSURTECH = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  cleanup();
  revise.mockClear();
});

async function addInsurtechAndSave() {
  fireEvent.click(screen.getByRole("button", { name: "Edit sector" }));
  const search = await screen.findByPlaceholderText("Type to find a category");
  fireEvent.focus(search);
  fireEvent.change(search, { target: { value: "insur" } });
  fireEvent.click(await screen.findByRole("button", { name: "Insurtech" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(revise).toHaveBeenCalledTimes(1));
}

describe("founder profile sector editor", () => {
  it("shows the sector editor and submits the chosen taxonomy nodes", async () => {
    render(
      <ProfileAnswers
        journey="founder"
        include={["sector"]}
        state={{
          status: "READ",
          completed: true,
          labels: { [FINTECH]: "Fintech" },
          responses: {
            "F1.categories": {
              type: "RESOURCE_REFERENCE",
              resourceType: "TAXONOMY_NODE",
              resourceIds: [FINTECH],
            },
          },
          groups: [
            {
              id: "sector",
              label: "Sector",
              lines: [
                {
                  stepKey: "F1.categories",
                  title: "Categories",
                  value: "Fintech",
                  items: ["Fintech"],
                },
              ],
            },
          ],
        }}
      />,
    );
    const card = screen.getByRole("region", { name: "Sector" });
    expect(within(card).getByText("Fintech")).toBeTruthy();
    await addInsurtechAndSave();
    expect(revise).toHaveBeenCalledWith({
      journey: "founder",
      stepKey: "F1.categories",
      value: {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: [FINTECH, INSURTECH],
      },
    });
  });

  it("keeps the editor for a finished setup whose view lists no sector answer", async () => {
    render(
      <ProfileAnswers
        journey="founder"
        include={["sector"]}
        emptyText="Your sector appears here once you tell Q about it."
        state={{
          status: "READ",
          completed: true,
          labels: {},
          responses: {},
          groups: [],
        }}
      />,
    );
    const card = screen.getByRole("region", { name: "Sector" });
    expect(within(card).getByText("Not added")).toBeTruthy();
    expect(screen.queryByText(/appears here once you tell Q/u)).toBeNull();
    await addInsurtechAndSave();
    expect(revise).toHaveBeenCalledWith({
      journey: "founder",
      stepKey: "F1.categories",
      value: {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: [INSURTECH],
      },
    });
  });

  it("does not invent an editor while setup is still open", () => {
    render(
      <ProfileAnswers
        journey="founder"
        include={["sector"]}
        state={{ status: "READ", completed: false, groups: [] }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit sector" })).toBeNull();
  });
});
