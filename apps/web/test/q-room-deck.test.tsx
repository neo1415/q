// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));

import type { QResultBlock } from "@capital-q/contracts";

import type { QTurn } from "../src/features/q/conversation";
import { resetManifest } from "../src/features/q/manifest";
import {
  QRoomDeck,
  type DeckLoaders,
} from "../src/features/q/room/q-room-deck";
import {
  deckDrawingOf,
  deckRevisionKey,
  isSlidePicture,
  uploadTarget,
  type DeckDrawing,
} from "../src/features/q/room/deck-room";
import { currentScreen } from "../src/features/q/screen";

/**
 * Q room W5 (R8): the deck surface. Slides and thumbnails from the Q
 * API's drawing; a marked space is a drop target; a dropped picture goes
 * up the ordinary upload path and onto the version on screen; Q's acts
 * page it; and Q's screen context says which slide and version are open.
 */

afterEach(() => {
  resetManifest();
});

const ARTIFACT = "a1000000-0000-4000-8000-000000000001";
const SVG = (n: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><text>Slide ${String(n)}</text></svg>`;

const DRAWING: DeckDrawing = {
  slides: [SVG(1), SVG(2), SVG(3)],
  pictures: [],
  placeholders: [
    {
      slide: 1,
      kind: "IMAGE",
      label: "Team photo: drop yours here",
      x: 576,
      y: 0,
      width: 384,
      height: 540,
    },
  ],
};

function q(n: number, blocks: readonly QResultBlock[]): QTurn {
  return {
    kind: "Q",
    id: `q${String(n)}`,
    text: "Done.",
    streaming: false,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks: [...blocks],
  } as unknown as QTurn;
}

function loaders(overrides: Partial<DeckLoaders> = {}) {
  const calls = {
    reads: 0,
    uploads: [] as string[],
    fills: [] as unknown[],
  };
  const value: DeckLoaders = {
    read: () => {
      calls.reads += 1;
      return Promise.resolve({
        ok: true,
        status: "READY",
        title: "Northstar — investor deck",
        type: "PITCH_DECK",
        version: 2,
        companyId: "c0000000-0000-4000-8000-000000000001",
        progress: null,
      });
    },
    slides: () => Promise.resolve(DRAWING),
    upload: (file) => {
      calls.uploads.push(file.name);
      return Promise.resolve("d0000000-0000-4000-8000-000000000009");
    },
    fill: (input) => {
      calls.fills.push(input);
      return Promise.resolve({ ok: true, version: 3 });
    },
    ...overrides,
  };
  return { value, calls };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe("the deck surface, in code", () => {
  it("keeps only https pictures and well-formed spaces", () => {
    const drawn = deckDrawingOf({
      slides: [SVG(1)],
      images: [
        {
          slide: 0,
          x: 1,
          y: 1,
          width: 1,
          height: 1,
          url: "http://x.test/a.png",
          alt: "a",
          credit: "c",
          fit: "cover",
        },
        {
          slide: 0,
          x: 1,
          y: 1,
          width: 1,
          height: 1,
          url: "https://images.pexels.com/a.jpeg",
          alt: "a",
          credit: "c",
          fit: "cover",
        },
      ],
      placeholders: [
        {
          slide: 0,
          kind: "IMAGE",
          label: "x",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
        { kind: "BOGUS" },
      ],
    });
    expect(drawn?.pictures).toHaveLength(1);
    expect(drawn?.placeholders).toHaveLength(1);
    expect(deckDrawingOf({ nope: true })).toBeNull();
  });

  it("Upload fills the space on screen, else the first one, else none", () => {
    expect(uploadTarget(DRAWING.placeholders, 1)).toBe(1);
    expect(uploadTarget(DRAWING.placeholders, 0)).toBe(1);
    expect(uploadTarget([], 0)).toBeNull();
    expect(isSlidePicture({ type: "image/png", size: 10 })).toBe(true);
    expect(isSlidePicture({ type: "application/pdf", size: 10 })).toBe(false);
  });

  it("counts the versions this conversation filed of it", () => {
    const ref: QResultBlock = {
      kind: "ARTIFACT_REFERENCE",
      artifactId: ARTIFACT,
      type: "PITCH_DECK",
      status: "READY",
      title: "Deck",
    } as QResultBlock;
    expect(
      deckRevisionKey([q(1, [ref]), q(2, []), q(3, [ref])], ARTIFACT),
    ).toBe(2);
  });
});

describe("the deck surface on screen", () => {
  it("shows the slide, thumbnails and what is left to fill; Q sees slide and version", async () => {
    const world = loaders();
    render(
      <QRoomDeck
        artifactId={ARTIFACT}
        title="Northstar deck"
        turns={[]}
        openedAt={0}
        loaders={world.value}
      />,
    );
    await settle();
    expect(screen.getByText(/Version 2 · 3 slides · 1 to fill/u)).toBeTruthy();
    expect(document.querySelectorAll("[data-q-deck-thumb]")).toHaveLength(3);
    expect(screen.getByLabelText("Slide 2, has a space to fill")).toBeTruthy();
    expect(currentScreen("/home")).toMatchObject({
      artifactId: ARTIFACT,
      artifactSlide: 1,
      artifactVersion: 2,
    });
    // The floating Upload names the slide it fills.
    expect(screen.getByText("Upload to slide 2")).toBeTruthy();
  });

  it("a picture dropped on the marked space goes up, then onto that slide of the version on screen", async () => {
    const world = loaders();
    render(
      <QRoomDeck
        artifactId={ARTIFACT}
        title="Northstar deck"
        turns={[]}
        openedAt={0}
        loaders={world.value}
      />,
    );
    await settle();
    fireEvent.click(screen.getByLabelText("Slide 2, has a space to fill"));
    await settle();
    const target = document.querySelector("[data-q-deck-placeholder='IMAGE']");
    expect(target).not.toBeNull();
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
      "team.png",
      { type: "image/png" },
    );
    await act(async () => {
      fireEvent.drop(target as Element, { dataTransfer: { files: [file] } });
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(world.calls.uploads).toEqual(["team.png"]);
    expect(world.calls.fills).toEqual([
      {
        artifactId: ARTIFACT,
        version: 2,
        slide: 2,
        documentId: "d0000000-0000-4000-8000-000000000009",
      },
    ]);
    expect(screen.getByText("Placed on slide 2.")).toBeTruthy();
    // It reads the document again for the new version.
    expect(world.calls.reads).toBeGreaterThan(1);
  });

  it("a file that is not a picture goes to the data room only", async () => {
    const world = loaders();
    render(
      <QRoomDeck
        artifactId={ARTIFACT}
        title="Northstar deck"
        turns={[]}
        openedAt={0}
        loaders={world.value}
      />,
    );
    await settle();
    const input = document.querySelector(
      "[data-q-deck-file]",
    ) as HTMLInputElement;
    const file = new File(["%PDF"], "financials.pdf", {
      type: "application/pdf",
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(world.calls.uploads).toEqual(["financials.pdf"]);
    expect(world.calls.fills).toEqual([]);
    expect(screen.getByText(/Added to your data room/u)).toBeTruthy();
  });

  it("follows Q's GO_TO_PAGE (an edit's slide)", async () => {
    const world = loaders();
    const go: QResultBlock = {
      kind: "UI_INTENT",
      intent: { kind: "DOCUMENT_ACT", act: "GO_TO_PAGE", page: 3 },
    } as QResultBlock;
    render(
      <QRoomDeck
        artifactId={ARTIFACT}
        title="Northstar deck"
        turns={[q(0, []), q(1, [go])]}
        openedAt={0}
        loaders={world.value}
      />,
    );
    await settle();
    expect(
      document
        .querySelector("[data-q-deck-slide]")
        ?.getAttribute("data-q-deck-slide"),
    ).toBe("3");
  });

  it("while Q is making it, says the stage", async () => {
    const world = loaders({
      read: () =>
        Promise.resolve({
          ok: true,
          status: "PREPARING",
          title: "Deck",
          type: "PITCH_DECK",
          version: null,
          companyId: null,
          progress: "Finding pictures and drawing charts from your numbers",
        }),
    });
    render(
      <QRoomDeck
        artifactId={ARTIFACT}
        title="Deck"
        turns={[]}
        openedAt={0}
        loaders={world.value}
      />,
    );
    await settle();
    expect(
      screen.getByText("Finding pictures and drawing charts from your numbers"),
    ).toBeTruthy();
  });
});
