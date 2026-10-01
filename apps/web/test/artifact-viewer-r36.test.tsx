// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QArtifactIdSchema, type QArtifactDetail } from "@capital-q/contracts";
import {
  DialogRoot,
  DialogViewerContent,
  shouldSwipeDismiss,
} from "@capital-q/ui/dialog";

/**
 * R36 · the viewer as a place to read.
 *
 * A deck is paged (one slide, its count, arrow keys, fit width or page),
 * the viewer is a real modal (focus inside, Escape closes, focus back on
 * the control that opened it), a phone can pull it down, and the way back
 * to Q is on it.
 */

const readQArtifactAction = vi.fn<(id: string) => Promise<unknown>>();
const readQArtifactVersionAction =
  vi.fn<(id: string, version: number) => Promise<unknown>>();

vi.mock("../src/features/q/actions", () => ({
  readQArtifactAction: (id: string) => readQArtifactAction(id),
  readQArtifactVersionAction: (id: string, version: number) =>
    readQArtifactVersionAction(id, version),
}));

const { ArtifactViewer, pageForKey } =
  await import("../src/features/q/artifact-viewer");

const ARTIFACT = QArtifactIdSchema.parse(
  "a0000000-0000-4000-8000-000000000002",
);

function deck(): QArtifactDetail {
  return {
    artifact: {
      artifactId: ARTIFACT,
      type: "PITCH_DECK",
      status: "READY",
      title: "Northstar Logistics — investor deck",
      summary: "Composed from what the record supports.",
      currentVersion: 1,
      createdAt: "2026-09-22T09:00:00.000Z",
      updatedAt: "2026-09-22T09:00:00.000Z",
    },
    current: {
      artifactId: ARTIFACT,
      version: 1,
      title: "Northstar Logistics — investor deck",
      summary: "Composed from what the record supports.",
      content: {
        sections: [
          { heading: "What we do", body: "They move freight.", findings: [] },
          {
            heading: "Market",
            body: "West African road freight.",
            findings: [],
          },
          { heading: "Team", body: "Two founders.", findings: [] },
        ],
        gaps: [],
        deck: {
          direction: "MINIMAL_INSTITUTIONAL",
          markIsDraft: false,
          slides: [0, 1, 2].map((section) => ({
            layout: "TITLE",
            title: `Slide ${String(section + 1)}`,
            bullets: [],
            bulletsRight: [],
            section,
          })),
        },
      },
    },
    history: [
      {
        version: 1,
        title: "Northstar Logistics — investor deck",
        createdAt: "2026-09-22T09:00:00.000Z",
      },
    ],
  } as unknown as QArtifactDetail;
}

const SVG = (n: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><title>${String(n)}</title></svg>`;

beforeEach(() => {
  readQArtifactAction.mockReset();
  readQArtifactVersionAction.mockReset();
  readQArtifactAction.mockResolvedValue({ ok: true, value: deck() });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ slides: [SVG(1), SVG(2), SVG(3)] }),
      } as Response),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("R36 · paging a deck", () => {
  it("shows one slide with its count and turns it with the arrow keys", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await screen.findByAltText("Slide 1");
    const count = document.querySelector("[data-q-artifact-page]");
    expect(count?.textContent).toBe("Slide 1 /  of 3");
    // Only the slide on screen, and the section it stands on.
    expect(screen.queryByAltText("Slide 2")).toBeNull();
    expect(screen.getByText("They move freight.")).toBeTruthy();
    expect(screen.queryByText("West African road freight.")).toBeNull();

    screen.getByRole("button", { name: "Next slide" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(await screen.findByAltText("Slide 2")).toBeTruthy();
    expect(screen.getByText("West African road freight.")).toBeTruthy();

    await userEvent.keyboard("{End}");
    expect(await screen.findByAltText("Slide 3")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Next slide" })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    await userEvent.keyboard("{Home}");
    expect(await screen.findByAltText("Slide 1")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Previous slide" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("pages with the buttons too", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await screen.findByAltText("Slide 1");
    await userEvent.click(screen.getByRole("button", { name: "Next slide" }));
    await userEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByAltText("Slide 3")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Previous slide" }),
    );
    expect(screen.getByAltText("Slide 2")).toBeTruthy();
  });

  it("fits the page by default and the width on request, saying which is on", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await screen.findByAltText("Slide 1");
    const slides = document.querySelector("[data-q-artifact-slides]");
    const page = screen.getByRole("button", { name: "Fit page" });
    const width = screen.getByRole("button", { name: "Fit width" });
    expect(slides?.getAttribute("data-fit")).toBe("page");
    expect(page.getAttribute("aria-pressed")).toBe("true");
    expect(width.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(width);
    expect(slides?.getAttribute("data-fit")).toBe("width");
    expect(width.getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves up, down and modified keys to scrolling and the browser", () => {
    expect(pageForKey("ArrowDown", 0, 3)).toBeNull();
    expect(pageForKey("PageDown", 0, 3)).toBeNull();
    expect(pageForKey("ArrowRight", 2, 3)).toBe(2);
    expect(pageForKey("ArrowLeft", 0, 3)).toBe(0);
    expect(pageForKey("ArrowRight", 0, 1)).toBeNull();
  });
});

describe("R36 · the viewer's way back to Q", () => {
  it("offers Edit with Q with the document's title, only where there is a conversation", async () => {
    const onEditWithQ = vi.fn();
    const { unmount } = render(
      <ArtifactViewer
        artifactId={ARTIFACT}
        onClose={vi.fn()}
        onEditWithQ={onEditWithQ}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit with Q" }),
    );
    expect(onEditWithQ).toHaveBeenCalledWith(
      "Northstar Logistics — investor deck",
    );
    unmount();

    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await screen.findByAltText("Slide 1");
    expect(screen.queryByRole("button", { name: "Edit with Q" })).toBeNull();
  });
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open the deck
      </button>
      <DialogRoot open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogViewerContent
            title="Document"
            onSwipeDismiss={() => setOpen(false)}
          >
            <ArtifactViewer
              artifactId={ARTIFACT}
              onClose={() => setOpen(false)}
            />
          </DialogViewerContent>
        ) : null}
      </DialogRoot>
    </>
  );
}

describe("R36 · the viewer is a modal", () => {
  it("moves focus inside, closes on Escape, and returns focus to what opened it", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open the deck" });
    await userEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await screen.findByAltText("Slide 1");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    // Tab stays inside: every stop settles in the dialog. The primitive's
    // focus guards hand focus back to the first or last control a frame
    // later, so each stop is awaited rather than read at once.
    for (let i = 0; i < 12; i += 1) {
      await userEvent.tab();
      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });
    }

    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it("closes from its own Close control and gives focus back", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open the deck" });
    await userEvent.click(opener);
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });
});

describe("R36 · pulling the phone sheet down", () => {
  it("closes on a long pull or a quick flick, never upward or on a nudge", () => {
    expect(shouldSwipeDismiss(160, 600)).toBe(true);
    expect(shouldSwipeDismiss(60, 80)).toBe(true);
    expect(shouldSwipeDismiss(60, 600)).toBe(false);
    expect(shouldSwipeDismiss(10, 5)).toBe(false);
    expect(shouldSwipeDismiss(-200, 100)).toBe(false);
  });
});

describe("DOCS · pictures on a slide", () => {
  it("draws a generated picture over its slide from its signed URL, labelled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              slides: [SVG(1), SVG(2), SVG(3)],
              images: [
                {
                  slide: 0,
                  x: 576,
                  y: 0,
                  width: 384,
                  height: 540,
                  url: "https://project.supabase.co/storage/v1/object/sign/cq-document-images/o/i.png?token=t",
                  alt: "Cover illustration (AI-generated)",
                  credit: "AI-generated image · Capital Q",
                  fit: "cover",
                },
                {
                  slide: 1,
                  x: 0,
                  y: 0,
                  width: 10,
                  height: 10,
                  url: "javascript:alert(1)",
                  alt: "bad",
                  credit: "",
                  fit: "cover",
                },
              ],
            }),
        } as Response),
      ),
    );
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    const picture = await screen.findByAltText(
      "Cover illustration (AI-generated)",
    );
    expect(picture.getAttribute("src")).toContain("/object/sign/");
    expect(screen.getByText("AI-generated image · Capital Q")).toBeTruthy();
    const figure = picture.closest("figure");
    expect(figure?.style.left).toBe("60%");
    // A picture that is not https is dropped; the rest are drawn.
    expect(screen.queryByAltText("bad")).toBeNull();
  });
});
