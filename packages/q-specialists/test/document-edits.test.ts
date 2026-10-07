import { describe, expect, it } from "vitest";

import type {
  QArtifactContent,
  QSlide,
  QSlideImage,
} from "@capital-q/contracts";

import {
  applyDocumentEdit,
  editInstruction,
  fillInstruction,
  fillPlaceholder,
} from "../src/index.js";

/**
 * Q room W5 (R8): edits by slide are code over the version on screen;
 * none adds a figure, every result is re-checked, and a dropped picture
 * fills its placeholder with its credit in the notes.
 */

function slide(overrides: Partial<QSlide>): QSlide {
  return {
    layout: "BULLETS",
    title: "Market",
    bullets: [],
    bulletsRight: [],
    section: 0,
    ...overrides,
  };
}

function deck(slides: QSlide[]) {
  const content: QArtifactContent = {
    sections: [
      {
        heading: "Summary",
        body: "Northstar moves freight between Lagos and Abuja for 320 shippers.",
        findings: [],
      },
    ],
    gaps: [],
    deck: { slides, direction: "MINIMAL_INSTITUTIONAL", markIsDraft: false },
  };
  return {
    title: "Northstar — investor deck",
    summary: "Freight.",
    content,
    type: "PITCH_DECK",
  };
}

const BASE = deck([
  slide({
    layout: "TITLE",
    title: "Northstar",
    subtitle: "Freight between Lagos and Abuja",
  }),
  slide({
    title: "Market",
    bullets: [
      "Shippers book freight by phone.",
      "Trucks run empty on return.",
      "320 shippers use it.",
    ],
  }),
  slide({
    title: "Team",
    bullets: ["Three founders."],
    placeholder: { kind: "IMAGE", label: "Team photo: drop yours here" },
  }),
]);

const OWN: QSlideImage = {
  url: "cq-image:a1000000-0000-4000-8000-0000000000aa",
  alt: "Team photo",
  credit: "Your upload",
  provenance: "OWN_UPLOAD",
};

describe("edits by slide", () => {
  it("shorter: one line fewer, re-checked, nothing else changed", async () => {
    const out = await applyDocumentEdit(BASE, { kind: "SHORTEN", slide: 2 });
    expect(out.status).toBe("EDITED");
    if (out.status !== "EDITED") return;
    expect(out.composed.content.deck?.slides[1]?.bullets).toEqual([
      "Shippers book freight by phone.",
      "Trucks run empty on return.",
    ]);
    expect(out.composed.content.deck?.slides[0]).toEqual(
      BASE.content.deck?.slides[0],
    );
    expect(out.composed.content.audit?.rubric?.rounds).toBe(0);
  });

  it("a new title is theirs, but never a figure the document does not carry", async () => {
    const ok = await applyDocumentEdit(BASE, {
      kind: "CHANGE_TITLE",
      slide: 1,
      title: "Northstar Freight",
    });
    expect(ok.status === "EDITED" && ok.composed.title).toBe(
      "Northstar Freight",
    );
    const known = await applyDocumentEdit(BASE, {
      kind: "CHANGE_TITLE",
      slide: 2,
      title: "320 shippers and counting",
    });
    expect(known.status).toBe("EDITED");
    const invented = await applyDocumentEdit(BASE, {
      kind: "CHANGE_TITLE",
      slide: 2,
      title: "$4M revenue market",
    });
    expect(invented).toEqual({
      status: "NOT_APPLICABLE",
      reason: "A title cannot state a figure the document does not carry.",
    });
  });

  it("swaps a picture for another Pexels photo, credited in the notes", async () => {
    const pictured = deck([
      ...(BASE.content.deck?.slides ?? []).slice(0, 1),
      slide({
        title: "Market",
        bullets: ["Shippers book freight by phone."],
        image: {
          url: "https://images.pexels.com/photos/1/a.jpeg",
          alt: "a",
          credit: "Photo by A on Pexels",
        },
      }),
    ]);
    const out = await applyDocumentEdit(
      pictured,
      { kind: "SWAP_IMAGE", slide: 2 },
      {
        photos: {
          search: () =>
            Promise.resolve([
              {
                url: "https://images.pexels.com/photos/1/a.jpeg",
                alt: "a",
                credit: "Photo by A on Pexels",
              },
              {
                url: "https://images.pexels.com/photos/2/b.jpeg",
                alt: "b",
                credit: "Photo by B on Pexels",
              },
            ]),
        },
      },
    );
    expect(out.status).toBe("EDITED");
    if (out.status !== "EDITED") return;
    const changed = out.composed.content.deck?.slides[1];
    expect(changed?.image?.url).toBe(
      "https://images.pexels.com/photos/2/b.jpeg",
    );
    expect(changed?.note).toContain("Picture: Photo by B on Pexels");
  });

  it("no other photo: the picture becomes their space to fill", async () => {
    const pictured = deck([
      ...(BASE.content.deck?.slides ?? []).slice(0, 1),
      slide({
        title: "Market",
        bullets: ["x"],
        image: {
          url: "https://images.pexels.com/photos/1/a.jpeg",
          alt: "a",
          credit: "Photo by A on Pexels",
        },
      }),
    ]);
    const out = await applyDocumentEdit(pictured, {
      kind: "SWAP_IMAGE",
      slide: 2,
    });
    expect(
      out.status === "EDITED" &&
        out.composed.content.deck?.slides[1]?.placeholder?.kind,
    ).toBe("IMAGE");
  });

  it("the cover stays first", async () => {
    expect(
      (await applyDocumentEdit(BASE, { kind: "REMOVE_SLIDE", slide: 1 }))
        .status,
    ).toBe("NOT_APPLICABLE");
    const moved = await applyDocumentEdit(BASE, {
      kind: "MOVE_SLIDE",
      slide: 3,
      to: 2,
    });
    expect(
      moved.status === "EDITED" &&
        moved.composed.content.deck?.slides.map((s) => s.title),
    ).toEqual(["Northstar", "Team", "Market"]);
  });
});

describe("their own picture on a placeholder", () => {
  it("fills the space, keeps the words, and credits it in the notes", () => {
    const out = fillPlaceholder(BASE, 3, OWN);
    expect(out.status).toBe("EDITED");
    if (out.status !== "EDITED") return;
    const team = out.composed.content.deck?.slides[2];
    expect(team?.image).toEqual(OWN);
    expect(team?.placeholder).toBeUndefined();
    expect(team?.bullets).toEqual(["Three founders."]);
    expect(team?.note).toContain("Picture: Your upload");
  });

  it("a slide with no space for a picture is refused", () => {
    expect(fillPlaceholder(BASE, 2, OWN).status).toBe("NOT_APPLICABLE");
  });

  it("Q's 'use my photo' and a drop are the same edit (they replay each other)", async () => {
    expect(
      editInstruction({
        kind: "USE_PICTURE",
        slide: 3,
        documentId: "a1000000-0000-4000-8000-000000000009",
      }),
    ).toBe(fillInstruction(3));
    const pending = await applyDocumentEdit(
      BASE,
      {
        kind: "USE_PICTURE",
        slide: 3,
        documentId: "a1000000-0000-4000-8000-000000000009",
      },
      { ownPicture: () => Promise.resolve("NOT_READY") },
    );
    expect(pending.status).toBe("NOT_APPLICABLE");
    const placed = await applyDocumentEdit(
      BASE,
      {
        kind: "USE_PICTURE",
        slide: 3,
        documentId: "a1000000-0000-4000-8000-000000000009",
      },
      { ownPicture: () => Promise.resolve(OWN) },
    );
    expect(
      placed.status === "EDITED" &&
        placed.composed.content.deck?.slides[2]?.image,
    ).toEqual(OWN);
  });
});
