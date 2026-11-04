// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QCardDto } from "@capital-q/contracts";

/**
 * The owner's Q Card preview on the profile page (UX-07, owner 2026-11-04:
 * "didn't we mention a profile picture on it?"). The section must hand the
 * owner's own photo to the card, so a person with a photo sees it rather
 * than a monogram; without one, the initials stay.
 */

vi.mock("@/features/i18n/server", () => ({
  serverT: () => Promise.resolve((text: string) => text),
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { QCardSection } = await import("../src/features/q-card/q-card-section");

const PERSON = "f0000000-0000-4000-8000-000000000009";
const CARD: QCardDto = {
  subjectType: "PERSON",
  subjectId: PERSON,
  handle: "amara",
  publicCode: "abcdefgh23",
  fieldScopes: { displayName: "public_external" },
  indexable: false,
  scansLast30Days: 0,
  version: 1,
  updatedAt: "2026-11-04T10:00:00.000Z",
};

afterEach(cleanup);

async function renderSection(portraitUrl?: string | null) {
  const element = await QCardSection({
    subjectType: "PERSON",
    subjectId: PERSON,
    name: "Amara Diallo-Benson",
    tagline: null,
    portraitUrl,
    given: { card: CARD },
  });
  return render(element);
}

describe("the owner's Q Card preview", () => {
  it("shows the owner's real photo when one exists", async () => {
    const photo = "https://storage.example/sign/avatar.webp?token=t";
    const { container } = await renderSection(photo);
    const img = container.querySelector("[data-q-card] [data-card-photo]");
    expect(img?.getAttribute("src")).toBe(photo);
    // Decorative: the name beside it is the text.
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("falls back to initials, never a broken image, without one", async () => {
    const { container } = await renderSection(null);
    expect(container.querySelector("[data-card-photo]")).toBeNull();
    expect(container.querySelector("[data-card-portrait]")?.textContent).toBe(
      "AD",
    );
  });
});
