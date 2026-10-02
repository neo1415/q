// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { YourCompanyPitchItemDto } from "@capital-q/contracts";

vi.mock("../src/features/discover/company-pitch", () => ({
  CompanyPitch: ({ company }: { company: { companyId: string } }) => (
    <div data-testid={`pitch-${company.companyId}`} />
  ),
}));

import {
  YourCompaniesList,
  YourCompaniesRow,
} from "../src/features/discover/your-companies";

/**
 * "Your companies" (founder decision 2026-10-02): Zino, connected with
 * Nixo, sees Nixo's pitch in a row beside the feed, labelled, never in it.
 */

afterEach(cleanup);

const NIXO = "d48c26d2-5aca-4788-9033-073b0f9d08ec";
const SAVED = "c2000000-0000-4000-8000-000000000002";
const item = (
  companyId: string,
  canonicalName: string,
  label: YourCompanyPitchItemDto["label"],
): YourCompanyPitchItemDto => ({
  companyId,
  canonicalName,
  shortDescription: null,
  headquartersCountry: "NG",
  currentStageCode: "seed",
  label,
  readyAt: "2026-10-02T08:04:06.000Z",
  pitch: {
    mediaAssetId: "38579af4-cfa2-4fd8-9381-d9f562768c03",
    aspectRatio: "9:16",
    durationSeconds: 60,
    captionState: "NOT_REQUESTED",
    title: null,
  },
});

describe("Your companies", () => {
  it("hides the row when there is nothing to show", () => {
    const { container } = render(<YourCompaniesRow items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("names each company with a quiet label in words, and loads no media in the row", () => {
    render(
      <YourCompaniesRow
        items={[
          item(NIXO, "Nixo", "CONNECTED"),
          item(SAVED, "Ajopot", "SAVED"),
        ]}
      />,
    );
    const row = screen.getByRole("navigation", { name: "Your companies" });
    expect(row.textContent).toContain("Nixo");
    expect(row.textContent).toContain("Connected");
    expect(row.textContent).toContain("Saved");
    expect(row.querySelector("video, img")).toBeNull();
    expect(
      screen.getByRole("link", { name: /Your companies/ }).getAttribute("href"),
    ).toBe("/discover/yours");
  });

  it("lists each pitch, newest first as served, with its label and player", () => {
    render(
      <YourCompaniesList
        items={[
          item(NIXO, "Nixo", "CONNECTED"),
          item(SAVED, "Ajopot", "SAVED"),
        ]}
      />,
    );
    expect(screen.getByTestId(`pitch-${NIXO}`)).toBeTruthy();
    const labels = [
      ...document.querySelectorAll("[data-your-company-label]"),
    ].map((node) => node.textContent);
    expect(labels).toEqual(["Connected", "Saved"]);
  });
});
