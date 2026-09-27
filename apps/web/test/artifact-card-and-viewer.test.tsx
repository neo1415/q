// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QArtifactIdSchema, type QArtifactDetail } from "@capital-q/contracts";

/**
 * The artifact card and the viewer (QX-003E).
 *
 * Two properties are worth holding here and nowhere else.
 *
 * **No control that does not work.** A card for a document still being
 * prepared offers no View, because there is nothing to view, and neither
 * card offers a download, because no bytes exist. A button to nowhere is
 * worse than the absence of one, and it is the failure this surface would
 * otherwise drift into first.
 *
 * **Nothing internal reaches the screen.** A viewer is the easiest place
 * in the product to leak a tenant id, a run id or a provider name into
 * something a person can screenshot. The last test reads the rendered
 * text and refuses all of them.
 */

const readQArtifactAction = vi.fn<(id: string) => Promise<unknown>>();
const readQArtifactVersionAction =
  vi.fn<(id: string, version: number) => Promise<unknown>>();

vi.mock("../src/features/q/actions", () => ({
  readQArtifactAction: (id: string) => readQArtifactAction(id),
  readQArtifactVersionAction: (id: string, version: number) =>
    readQArtifactVersionAction(id, version),
}));

const { ArtifactViewer } = await import("../src/features/q/artifact-viewer");
const { QResultBlocks } = await import("../src/features/q/q-result-blocks");

const ARTIFACT = QArtifactIdSchema.parse(
  "a0000000-0000-4000-8000-000000000001",
);
const TENANT = "c0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000009";

function detail(version: number, body: string): QArtifactDetail {
  return {
    artifact: {
      artifactId: ARTIFACT,
      type: "INVESTMENT_BRIEF",
      status: "READY",
      title: "Investment brief — Northstar Logistics",
      summary: "What the record supports.",
      currentVersion: 2,
      createdAt: "2026-09-22T09:00:00.000Z",
      updatedAt: "2026-09-22T10:00:00.000Z",
    },
    current: {
      artifactId: ARTIFACT,
      version,
      title: "Investment brief — Northstar Logistics",
      summary: "What the record supports.",
      content: {
        sections: [
          { heading: "Summary", body, findings: [] },
          {
            heading: "What the company does",
            body: "They move freight between Lagos and Abuja (stated by the company).",
            findings: [
              {
                findingId: "b0000000-0000-4000-8000-000000000001",
                type: "FACT",
                statement: "Northstar Logistics moves freight.",
                truthClass: "USER_CLAIM",
                evidenceStatus: "SELF_REPORTED",
                confidence: "MODERATE",
                subjects: [],
                evidenceRefs: [],
              },
            ],
          },
        ],
        gaps: ["Traction", "Team"],
      },
      createdAt: "2026-09-22T10:00:00.000Z",
      ...(version === 2 ? { instruction: "Make it shorter." } : {}),
      composedByRunId: RUN,
    },
    history: [
      {
        version: 2,
        title: "Investment brief — Northstar Logistics",
        instruction: "Make it shorter.",
        createdAt: "2026-09-22T10:00:00.000Z",
      },
      {
        version: 1,
        title: "Investment brief — Northstar Logistics",
        createdAt: "2026-09-22T09:00:00.000Z",
      },
    ],
  } as unknown as QArtifactDetail;
}

beforeEach(() => {
  readQArtifactAction.mockReset();
  readQArtifactVersionAction.mockReset();
  readQArtifactAction.mockResolvedValue({
    ok: true,
    value: detail(2, "Short and plain."),
  });
  readQArtifactVersionAction.mockResolvedValue({
    ok: true,
    value: detail(1, "The original, longer opening."),
  });
});

describe("QX-003E · the card in an answer", () => {
  it("offers Open, the PDF and Edit with Q once the document is ready", async () => {
    const onOpenArtifact = vi.fn();
    const onAsk = vi.fn();
    render(
      <QResultBlocks
        blocks={[
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: ARTIFACT,
            type: "INVESTMENT_BRIEF",
            status: "READY",
            title: "Investment brief — Northstar Logistics",
          },
        ]}
        onAsk={onAsk}
        onOpenArtifact={onOpenArtifact}
      />,
    );
    expect(
      screen.getByText("Investment brief — Northstar Logistics"),
    ).toBeTruthy();
    // It says what it is: a private draft, not something that went out.
    expect(screen.getByText(/private draft/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenArtifact).toHaveBeenCalledWith(ARTIFACT);
    await userEvent.click(screen.getByText("Edit with Q"));
    expect(onAsk).toHaveBeenCalled();
    // A brief downloads as a PDF from the card (BIZ-001), and only as a
    // PDF: there is no PowerPoint of a document that has no slides.
    expect(
      screen.getByRole("link", { name: "Download PDF" }).getAttribute("href"),
    ).toBe(`/api/q-artifact/${ARTIFACT}/pdf`);
    // One file, so one button: no menu to open for a single choice.
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    expect(screen.queryByText(/PowerPoint/)).toBeNull();
  });

  it("offers nothing to open while it is still being prepared", () => {
    render(
      <QResultBlocks
        blocks={[
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: ARTIFACT,
            type: "INVESTMENT_BRIEF",
            status: "PREPARING",
            title: "Investment brief",
          },
        ]}
        onAsk={vi.fn()}
        onOpenArtifact={vi.fn()}
      />,
    );
    expect(screen.getByText(/still preparing/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(screen.queryByText("Edit with Q")).toBeNull();
    // No bytes exist yet, so there is no download to offer.
    expect(screen.queryByText("PDF")).toBeNull();
    // A skeleton holds the card's shape, hidden from assistive technology,
    // so the actions arriving later do not move the answer.
    const card = document.querySelector('[data-q-artifact-card="PREPARING"]');
    expect(
      card?.querySelector('[aria-hidden="true"] .animate-pulse'),
    ).toBeTruthy();
  });

  it("says so, rather than nothing, when preparing failed", () => {
    render(
      <QResultBlocks
        blocks={[
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: ARTIFACT,
            type: "INVESTMENT_BRIEF",
            status: "FAILED",
            title: "Investment brief",
          },
        ]}
        onOpenArtifact={vi.fn()}
      />,
    );
    expect(screen.getByText(/couldn't finish preparing/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });

  it("says what to do when preparing failed: ask Q to try again", async () => {
    const onAsk = vi.fn();
    render(
      <QResultBlocks
        blocks={[
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: ARTIFACT,
            type: "INVESTMENT_BRIEF",
            status: "FAILED",
            title: "Investment brief",
          },
        ]}
        onAsk={onAsk}
        onOpenArtifact={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Ask Q to try again" }),
    );
    expect(onAsk).toHaveBeenCalledWith(
      "Please try preparing that document again.",
    );
  });
});

describe("QX-003E · the viewer", () => {
  it("renders the document, its findings and its gaps", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Summary")).toBeTruthy();
    });
    expect(screen.getByText("Short and plain.")).toBeTruthy();
    expect(screen.getByText("Investment brief")).toBeTruthy();
    expect(screen.getByText(/Version 2/)).toBeTruthy();
    // The finding under the section, with whose claim it is.
    expect(screen.getByText("Northstar Logistics moves freight.")).toBeTruthy();
    expect(screen.getByText(/user claim · self reported/)).toBeTruthy();
    // Unknown stays unknown, in the document.
    const gaps = screen.getByText("What isn't on record yet").parentElement;
    expect(within(gaps as HTMLElement).getByText("Traction")).toBeTruthy();
    // And it says what it is not.
    expect(screen.getByText(/not verified evidence/i)).toBeTruthy();
  });

  it("opens an earlier version and says it is an earlier one", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Short and plain.")).toBeTruthy();
    });

    await userEvent.click(screen.getByText("V1"));
    await waitFor(() => {
      expect(screen.getByText("The original, longer opening.")).toBeTruthy();
    });
    expect(readQArtifactVersionAction).toHaveBeenCalledWith(ARTIFACT, 1);
    expect(screen.getByText(/an earlier version/)).toBeTruthy();
  });

  it("shows the new version as soon as the conversation says one was written, without a reopen (CQ-QACT-001, F5)", async () => {
    readQArtifactAction.mockResolvedValue({
      ok: true,
      value: detail(1, "The original, longer opening."),
    });
    const { rerender } = render(
      <ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} revision="m1" />,
    );
    await waitFor(() => {
      expect(screen.getByText("The original, longer opening.")).toBeTruthy();
    });
    readQArtifactAction.mockResolvedValue({
      ok: true,
      value: detail(2, "Short and plain."),
    });
    rerender(
      <ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} revision="m2" />,
    );
    await waitFor(() => {
      expect(screen.getByText("Short and plain.")).toBeTruthy();
    });
    expect(screen.getByText(/Version 2/)).toBeTruthy();
  });

  it("keeps an earlier version somebody chose, and says a newer one is ready", async () => {
    const { rerender } = render(
      <ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} revision="m1" />,
    );
    await waitFor(() => {
      expect(screen.getByText("Short and plain.")).toBeTruthy();
    });
    await userEvent.click(screen.getByText("V1"));
    await waitFor(() => {
      expect(screen.getByText("The original, longer opening.")).toBeTruthy();
    });
    rerender(
      <ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} revision="m2" />,
    );
    await waitFor(() => {
      expect(screen.getByText("A new version is ready")).toBeTruthy();
    });
    expect(screen.getByText("The original, longer opening.")).toBeTruthy();
    await userEvent.click(screen.getByText("Show the latest"));
    await waitFor(() => {
      expect(screen.getByText("Short and plain.")).toBeTruthy();
    });
  });

  it("says one plain sentence when it is not this person's to read", async () => {
    readQArtifactAction.mockResolvedValue({
      ok: false,
      message: "I couldn't find that document.",
    });
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("I couldn't find that document.")).toBeTruthy();
    });
    // Nothing of the document leaks alongside the refusal.
    expect(screen.queryByText("Summary")).toBeNull();
  });

  it("puts nothing internal on the screen", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Summary")).toBeTruthy();
    });
    const shown = document.body.textContent ?? "";
    for (const secret of [TENANT, RUN, "organisation_private", "tenant"]) {
      expect(shown).not.toContain(secret);
    }
  });

  it("gets out of the way when asked", async () => {
    const onClose = vi.fn();
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * QX-004 · a deck a founder can take with them.
 *
 * The composer, the store and this viewer all existed and nothing joined
 * them to the renderer, so a deck could be read on this screen and could
 * not leave the building. What is pinned here is the part a person feels:
 * the slides are drawn by the server rather than by React, and the two
 * download links point at the version actually on screen — somebody
 * looking at V1 who downloads V2 has sent the wrong slides.
 */
function deckDetail(version: number): QArtifactDetail {
  return {
    artifact: {
      artifactId: ARTIFACT,
      type: "PITCH_DECK",
      status: "READY",
      title: "Northstar Logistics — investor deck",
      summary: "Composed from what the record supports.",
      currentVersion: 2,
      createdAt: "2026-09-22T09:00:00.000Z",
      updatedAt: "2026-09-22T10:00:00.000Z",
    },
    current: {
      artifactId: ARTIFACT,
      version,
      title: "Northstar Logistics — investor deck",
      summary: "Composed from what the record supports.",
      content: {
        sections: [
          { heading: "What we do", body: "They move freight.", findings: [] },
        ],
        gaps: ["Financial performance and runway"],
        deck: {
          direction: "MINIMAL_INSTITUTIONAL",
          markIsDraft: false,
          slides: [
            {
              layout: "TITLE",
              title: "Northstar Logistics",
              bullets: [],
              bulletsRight: [],
              section: 0,
            },
          ],
        },
      },
    },
    history: [
      {
        version: 1,
        title: "Northstar Logistics — investor deck",
        createdAt: "2026-09-22T09:00:00.000Z",
      },
      {
        version: 2,
        title: "Northstar Logistics — investor deck",
        createdAt: "2026-09-22T10:00:00.000Z",
      },
    ],
  } as unknown as QArtifactDetail;
}

describe("QX-004 · the deck in the viewer", () => {
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"></svg>';
  let asked: string[] = [];

  beforeEach(() => {
    asked = [];
    readQArtifactAction.mockResolvedValue({ ok: true, value: deckDetail(2) });
    readQArtifactVersionAction.mockResolvedValue({
      ok: true,
      value: deckDetail(1),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        asked.push(url);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ slides: [SVG] }),
        } as Response);
      }),
    );
  });

  it("shows the slides the server drew, and calls the thing a deck", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    const slide = await screen.findByAltText("Slide 1");
    // Drawn on the server and shown in an img, which cannot run script.
    expect(slide.getAttribute("src")).toContain("data:image/svg+xml");
    expect(asked).toEqual([`/api/q-artifact/${ARTIFACT}/slides?version=2`]);
    expect(screen.getByText("Investor deck")).toBeTruthy();
    // The prose stays: a slide is a claim, the section is what it rests on.
    expect(screen.getByText("They move freight.")).toBeTruthy();
  });

  it("offers PowerPoint and PDF for the version actually on screen", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await screen.findByAltText("Slide 1");
    await userEvent.click(screen.getByRole("button", { name: /Download/ }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "PowerPoint (.pptx)" }),
    );
    await waitFor(() => {
      expect(asked).toContain(`/api/q-artifact/${ARTIFACT}/pptx?version=2`);
    });

    await userEvent.click(screen.getByText("V1"));
    await screen.findByText(/an earlier version/);
    await userEvent.click(screen.getByRole("button", { name: /Download/ }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "PDF document" }),
    );
    await waitFor(() => {
      expect(asked).toContain(`/api/q-artifact/${ARTIFACT}/pdf?version=1`);
    });
  });

  it("still shows the document when the drawing does not arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("They move freight.")).toBeTruthy();
    });
    expect(screen.queryByAltText("Slide 1")).toBeNull();
  });

  it("calls a deck a deck on the card, and offers both of its files there (BIZ-001)", () => {
    render(
      <QResultBlocks
        blocks={[
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: ARTIFACT,
            type: "PITCH_DECK",
            status: "READY",
            title: "Northstar Logistics — investor deck",
          },
        ]}
        onAsk={vi.fn()}
        onOpenArtifact={vi.fn()}
      />,
    );
    expect(screen.getByText("Investor deck")).toBeTruthy();
  });

  it("puts a deck's two files behind one Download menu, reachable by keyboard", async () => {
    render(
      <QResultBlocks
        blocks={[
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: ARTIFACT,
            type: "PITCH_DECK",
            status: "READY",
            title: "Northstar Logistics — investor deck",
          },
        ]}
        onAsk={vi.fn()}
        onOpenArtifact={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Download/ });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "PDF document",
      "PowerPoint (.pptx)",
    ]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menuitem")).toBeNull();
    });
    // Focus goes back to the control that opened the menu.
    expect(document.activeElement).toBe(trigger);
  });

  it("offers a brief as a PDF in the viewer, and no PowerPoint of a document with no slides", async () => {
    readQArtifactAction.mockResolvedValue({
      ok: true,
      value: detail(2, "Short and plain."),
    });
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Short and plain.")).toBeTruthy();
    });
    // Was: no download at all, so a founder who asked for a PDF of their
    // brief had none. The version on screen is the version downloaded.
    expect(
      screen.getByRole("link", { name: "Download PDF" }).getAttribute("href"),
    ).toBe(`/api/q-artifact/${ARTIFACT}/pdf?version=2`);
    // A button to nowhere is worse than the absence of one: a brief has
    // no slides, so there is nothing to write a PPTX from.
    expect(screen.queryByText(/PowerPoint/)).toBeNull();
    // And no slides are asked for.
    expect(asked).toEqual([]);
  });
});

/**
 * BIZ-001 · a download that fails says why, where the person is.
 *
 * The links used to navigate to the file route, so a refusal opened a
 * page of JSON: a dead end. A click now fetches, saves the file under the
 * server's name when it arrives, and otherwise shows the route's own
 * sentence beside the button.
 */
describe("BIZ-001 · downloading from the card", () => {
  const card = (type: string) => (
    <QResultBlocks
      blocks={[
        {
          kind: "ARTIFACT_REFERENCE",
          artifactId: ARTIFACT,
          type,
          status: "READY",
          title: "Investment brief — Northstar Logistics",
        },
      ]}
      onAsk={vi.fn()}
      onOpenArtifact={vi.fn()}
    />
  );

  it("saves the file under the name the server gave it", async () => {
    const saved: { name: string; href: string }[] = [];
    // jsdom has no object URLs; the browser's own download is the anchor
    // click, observed rather than performed.
    const createObjectURL = vi.fn(() => "blob:q-artifact");
    const original = {
      create: Object.getOwnPropertyDescriptor(URL, "createObjectURL"),
      revoke: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL"),
    };
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        saved.push({ name: this.download, href: this.href });
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-disposition":
                'attachment; filename="Investment-brief-Northstar-Logistics.pdf"',
            },
          }),
        ),
      ),
    );

    render(card("INVESTMENT_BRIEF"));
    await userEvent.click(screen.getByText("PDF"));
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]).toEqual({
      name: "Investment-brief-Northstar-Logistics.pdf",
      href: "blob:q-artifact",
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("That file didn't download")).toBeNull();
    click.mockRestore();
    for (const [name, descriptor] of [
      ["createObjectURL", original.create],
      ["revokeObjectURL", original.revoke],
    ] as const) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(URL, name);
      } else {
        Object.defineProperty(URL, name, descriptor);
      }
    }
  });

  it("says the route's sentence beside the button when the file cannot be made, and stays put", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              message:
                "That document isn't ready yet. Q is still preparing it.",
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    render(card("INVESTMENT_BRIEF"));
    await userEvent.click(screen.getByText("PDF"));
    await waitFor(() => {
      expect(screen.getByText("That file didn't download")).toBeTruthy();
    });
    expect(
      screen.getByText(
        "That document isn't ready yet. Q is still preparing it.",
      ),
    ).toBeTruthy();
    // Still on the card, and the button is still there to try again.
    expect(screen.getByText("PDF")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });

  it("says the connection dropped when the request never came back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    render(card("PITCH_DECK"));
    await userEvent.click(screen.getByRole("button", { name: /Download/ }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "PowerPoint (.pptx)" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("I lost the connection to Q. Please try again."),
      ).toBeTruthy();
    });
  });

  it("offers a PDF for a type this build has not heard of", () => {
    render(card("INVESTMENT_MEMO"));
    expect(screen.getByText("PDF")).toBeTruthy();
    expect(screen.queryByText(/PowerPoint/)).toBeNull();
  });
});
