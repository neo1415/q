// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QCardDto } from "@capital-q/contracts";

/**
 * The owner's field picker on the profile page (owner 2026-11-19): an
 * investor card's wider declared fields are listed so the owner can turn
 * each on, each starts off ("Nobody"), and none is offered on a company's
 * card.
 */

vi.mock("@/features/i18n/server", () => ({
  serverT: () => Promise.resolve((text: string) => text),
}));
vi.mock("@/features/i18n/language", () => ({
  useT: () => (text: string) => text,
}));
vi.mock("@/features/q/context", () => ({
  apiSession: () => Promise.resolve(null),
}));
vi.mock("../src/features/q-card/public-card-data", () => ({
  appOrigin: () => "https://capitalq.example",
  displayUrlFor: (handle: string) => `capitalq.example/@${handle}`,
  loadPublicCard: () => Promise.resolve(null),
}));
vi.mock("../src/features/q-card/q-card-actions", () => ({
  claimHandleAction: vi.fn(),
  updateQCardAction: vi.fn(),
}));
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen: vi.fn(), askAbout: vi.fn() }),
}));
vi.mock("@/features/workspace/workspace-screen", () => ({
  useDirty: () => undefined,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { QCardSection } = await import("../src/features/q-card/q-card-section");

const NEW_FIELDS = [
  "mandateChequeRange",
  "mandateInvestmentRole",
  "inboundPreference",
  "portfolioHighlights",
];

function card(subjectType: QCardDto["subjectType"]): QCardDto {
  return {
    subjectType,
    subjectId: "f0000000-0000-4000-8000-000000000011",
    handle: "savanna",
    publicCode: "abcdefgh23",
    fieldScopes: { displayName: "public_external" },
    indexable: false,
    scansLast30Days: 0,
    version: 1,
    updatedAt: "2026-11-19T10:00:00.000Z",
  };
}

afterEach(cleanup);

describe("the Q Card field picker", () => {
  it("lists an investor's wider declared fields, each off until the owner picks an audience", async () => {
    const element = await QCardSection({
      subjectType: "INVESTOR_ORGANISATION",
      subjectId: "f0000000-0000-4000-8000-000000000011",
      name: "Savanna Capital",
      tagline: null,
      values: {},
      given: { card: card("INVESTOR_ORGANISATION") },
    });
    const { container } = render(element);
    for (const key of NEW_FIELDS) {
      const choice = container.querySelector(`[data-card-choice="${key}"]`);
      expect(choice, key).not.toBeNull();
      expect(choice?.getAttribute("data-state")).toBe("off");
      // Said as what it is, not as an empty value.
      expect(choice?.textContent).not.toContain("Not added yet");
      const select = choice?.querySelector("select");
      expect(
        Array.from(select?.options ?? []).map((option) => option.value),
      ).toEqual(["hidden", "network_visible", "public_external"]);
    }
  });

  it("never offers them on a company's card", async () => {
    const element = await QCardSection({
      subjectType: "COMPANY",
      subjectId: "f0000000-0000-4000-8000-000000000011",
      name: "Kivu Freight",
      tagline: null,
      given: { card: card("COMPANY") },
    });
    const { container } = render(element);
    for (const key of NEW_FIELDS) {
      expect(container.querySelector(`[data-card-choice="${key}"]`)).toBeNull();
    }
  });
});
