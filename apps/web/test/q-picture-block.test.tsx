// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";

import type { QTurn } from "../src/features/q/conversation";

/**
 * L-13 (owner ask 2026-10-20): when Q talks about something visual, a
 * picture from an authorised source, credited where it is shown: in the
 * answer and on Q's stage.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { QResultBlocks } = await import("../src/features/q/q-result-blocks");
const { QPresenceStage } = await import("../src/features/q/q-presence-stage");
const { shownItems, stageOf } = await import("../src/features/q/shown");
const { clearResultShelf } = await import("../src/features/q/result-shelf");
const store = await import("../src/features/q/cards/card-visibility-store");

afterEach(() => {
  cleanup();
  clearResultShelf();
  store.resetCards();
  window.sessionStorage.clear();
});

const PICTURE: Extract<QResultBlock, { kind: "PICTURE" }> = {
  kind: "PICTURE",
  url: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg",
  alt: "A baobab tree at dusk",
  credit: { name: "Ada Obi", url: "https://www.pexels.com/@ada-obi" },
  source: "PEXELS",
  pageUrl: "https://www.pexels.com/photo/baobab-1/",
};

const MSG = "123e4567-e89b-12d3-a456-426614174000";

function turnsWith(
  block: Extract<QTurn, { kind: "Q" }>["blocks"][number],
): readonly QTurn[] {
  return [
    {
      kind: "PERSON",
      id: "p1",
      text: "What does a baobab look like?",
      unconfirmed: false,
    },
    {
      kind: "Q",
      id: MSG,
      runId: `run-${MSG}`,
      text: "A baobab is broad and short, with a thick trunk.",
      streaming: false,
      sourceCount: 0,
      publicSources: [],
      findings: [],
      uncertainties: [],
      blocks: [block],
    },
  ];
}

function expectCredited(container: HTMLElement) {
  const image = container.querySelector("[data-q-picture] img");
  expect(image?.getAttribute("src")).toBe(PICTURE.url);
  expect(image?.getAttribute("alt")).toBe(PICTURE.alt);
  expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
  const credit = screen.getByRole("link", { name: "Ada Obi" });
  expect(credit.getAttribute("href")).toBe(PICTURE.credit.url);
  const source = screen.getByRole("link", { name: "Pexels" });
  expect(source.getAttribute("href")).toBe(PICTURE.pageUrl);
  for (const link of [credit, source]) {
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  }
  expect(container.querySelector("figcaption")?.textContent).toBe(
    "Photo by Ada Obi on Pexels",
  );
}

describe("a picture in Q's answer", () => {
  it("shows the picture with its credit and the source's page", () => {
    const { container } = render(<QResultBlocks blocks={[PICTURE]} />);
    expect(screen.getByText("Picture")).toBeTruthy();
    expectCredited(container);
  });

  it("names the photographer without a link when the source gave none", () => {
    const { container } = render(
      <QResultBlocks
        blocks={[{ ...PICTURE, credit: { name: "Kofi", url: null } }]}
      />,
    );
    expect(screen.queryByRole("link", { name: "Kofi" })).toBeNull();
    expect(container.querySelector("figcaption")?.textContent).toBe(
      "Photo by Kofi on Pexels",
    );
  });
});

describe("a picture on Q's stage", () => {
  it("is shown on the stage, titled by what it shows, still credited", async () => {
    const turns = turnsWith(PICTURE);
    const shown = stageOf(shownItems(turns), turns).item;
    expect(shown?.id).toBe(MSG);
    expect(shown?.title).toBe(PICTURE.alt);

    const { container } = render(
      <QPresenceStage
        presence={(compact) => (
          <div data-testid="aperture" data-compact={String(compact)} />
        )}
        turns={turns}
        captions={false}
        caption={null}
      />,
    );
    // The stage loads its object code when first needed (W7).
    await waitFor(
      () => expect(container.querySelector("[data-q-picture]")).not.toBeNull(),
      { timeout: 20_000 },
    );
    expect(container.querySelector(`[data-q-shown="${MSG}"]`)).not.toBeNull();
    expectCredited(container);
    expect(screen.getByTestId("aperture").dataset.compact).toBe("true");
  }, 30_000);
});
