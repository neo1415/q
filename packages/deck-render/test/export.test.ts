import { readFile } from "node:fs/promises";

import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import type { QArtifactVersion, QDeck } from "@capital-q/contracts";

import {
  artifactKindName,
  documentFromArtifact,
  documentToPdf,
  exportFormatsForVersion,
  layOutDeck,
  renderArtifactFile,
  themeFor,
  DOCUMENT_PAGE,
} from "../src/index.js";

/**
 * Every artifact leaves as a real file (BIZ-001, founder requirement R1).
 *
 * "Q refused to give me a downloadable and viewable PDF or PPTX." Three
 * causes: only decks exported, a brief's export was refused outright, and
 * the PDF writer dropped every character outside WinAnsi — so "₦2,000,000"
 * shipped as "2,000,000", a different claim. These pin the file, per type
 * and per format, by what a reader of the file gets: the container it is
 * (magic bytes), how many pages it has, and the text read back out of it
 * with a real PDF text extractor rather than a byte search over streams
 * that are compressed and glyph-encoded anyway.
 */

/** The text of each page, as a PDF reader extracts it. */
async function pdfText(bytes: Uint8Array): Promise<readonly string[]> {
  const task = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const document = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= document.numPages; n += 1) {
    const page = await document.getPage(n);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  await task.destroy();
  return pages;
}

function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.slice(0, 5)).toString("latin1") === "%PDF-";
}

function isZip(bytes: Uint8Array): boolean {
  return (
    [...bytes.slice(0, 4)].join(",") === [0x50, 0x4b, 0x03, 0x04].join(",")
  );
}

const NAIRA = "₦2,000,000";
const EURO = "€1.2m";

function brief(
  overrides: Partial<QArtifactVersion["content"]> = {},
): QArtifactVersion {
  return {
    artifactId: "a0000000-0000-4000-8000-000000000001",
    version: 2,
    title: "Investment brief — Adébáyọ Foods",
    summary: `A pre-seed raise of ${NAIRA} for cold-chain distribution in Lagos.`,
    content: {
      sections: [
        {
          heading: "The raise",
          body: `Raising ${NAIRA} on a SAFE; a European angel has offered ${EURO}.\nUse of funds is not yet stated.`,
          findings: [
            {
              findingId: "b0000000-0000-4000-8000-000000000001",
              type: "FACT",
              statement: `The company is raising ${NAIRA}.`,
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              confidence: "MODERATE",
              subjects: [],
              evidenceRefs: [],
            },
          ],
        },
        {
          heading: "Team",
          body: "Founded by Ọlá Adébáyọ and Мария Иванова — “operators, not tourists”.",
          findings: [],
        },
      ],
      gaps: ["Revenue to date", "Unit economics"],
      ...overrides,
    },
    createdAt: "2026-09-25T10:00:00.000Z",
  } as QArtifactVersion;
}

const deck: QDeck = {
  slides: [
    {
      layout: "TITLE",
      title: "Adébáyọ Foods",
      subtitle: `Raising ${NAIRA} to keep food cold from farm to shelf`,
      bullets: [],
      bulletsRight: [],
      section: 0,
    },
    {
      layout: "BULLETS",
      title: "Traction",
      bullets: [
        `${EURO} committed by a European angel.`,
        "Live in Lagos and Ibadan.",
      ],
      bulletsRight: [],
      section: 0,
    },
    {
      layout: "CHART",
      title: "Monthly deliveries",
      bullets: [],
      bulletsRight: [],
      chart: {
        kind: "COLUMN",
        measure: "Deliveries",
        unit: "count",
        points: [
          { label: "July", value: "320" },
          { label: "August", value: "480" },
        ],
        grounding: "From what the founder told Capital Q.",
      },
      section: 0,
    },
  ],
  direction: "MINIMAL_INSTITUTIONAL",
  markIsDraft: false,
};

function deckVersion(): QArtifactVersion {
  const base = brief();
  return {
    ...base,
    title: "Adébáyọ Foods — investor deck",
    content: { ...base.content, deck },
  };
}

describe("BIZ-001 · a brief is a document you can download", () => {
  it("writes a PDF for INVESTMENT_BRIEF instead of refusing it", async () => {
    const file = await renderArtifactFile({
      type: "INVESTMENT_BRIEF",
      version: brief(),
      format: "pdf",
    });
    expect(file).not.toBeNull();
    expect(file?.contentType).toBe("application/pdf");
    expect(file?.extension).toBe("pdf");
    const bytes = file?.bytes ?? new Uint8Array();
    expect(isPdf(bytes)).toBe(true);

    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(reopened.getTitle()).toBe("Investment brief — Adébáyọ Foods");
    // A4 portrait, not a slide.
    expect(reopened.getPage(0).getWidth()).toBeCloseTo(DOCUMENT_PAGE.width, 1);
    expect(reopened.getPage(0).getHeight()).toBeCloseTo(
      DOCUMENT_PAGE.height,
      1,
    );
    // Two pre-subset faces, embedded whole (see fonts.ts): a brief stays
    // a few hundred kilobytes, not the 1.3 MB the full families would add.
    expect(bytes.byteLength).toBeLessThan(400_000);
  });

  it("keeps ₦, €, Yoruba and Cyrillic letters and smart quotes in the text a reader extracts", async () => {
    const file = await renderArtifactFile({
      type: "INVESTMENT_BRIEF",
      version: brief(),
      format: "pdf",
    });
    const text = (await pdfText(file?.bytes ?? new Uint8Array())).join(" ");
    expect(text).toContain(NAIRA);
    expect(text).toContain(EURO);
    expect(text).toContain("Adébáyọ");
    expect(text).toContain("Мария Иванова");
    expect(text).toContain("“operators, not tourists”");
    expect(text).toContain("—");
  });

  it("prints what the viewer shows: sections, findings with whose claim they are, gaps, and what it is not", async () => {
    const file = await renderArtifactFile({
      type: "INVESTMENT_BRIEF",
      version: brief(),
      format: "pdf",
    });
    const pages = await pdfText(file?.bytes ?? new Uint8Array());
    const text = pages.join(" ");
    expect(text).toContain("Investment brief");
    expect(text).toContain("The raise");
    expect(text).toContain("Use of funds is not yet stated.");
    expect(text).toContain(`The company is raising ${NAIRA}.`);
    // Truth class and evidence status, apart and visible.
    expect(text).toContain("user claim · self reported");
    // Unknown stays unknown, in the file too.
    expect(text).toContain("What isn't on record yet");
    expect(text).toContain("Unit economics");
    expect(text).toContain("Version 2 · 25 September 2026");
    // Every page says it is a private draft, because a page can travel alone.
    for (const page of pages) {
      expect(page).toContain("not verified evidence");
    }
  });

  it("paginates a long brief and numbers every page", async () => {
    const long =
      "Cold-chain logistics in Lagos loses a third of produce before it reaches a shelf. ".repeat(
        40,
      );
    const version = brief({
      sections: Array.from({ length: 5 }, (_, index) => ({
        heading: `Section ${String(index + 1)}`,
        body: long.trim(),
        findings: [],
      })),
    });
    const file = await renderArtifactFile({
      type: "INVESTMENT_BRIEF",
      version,
      format: "pdf",
    });
    const pages = await pdfText(file?.bytes ?? new Uint8Array());
    expect(pages.length).toBeGreaterThan(2);
    pages.forEach((page, index) => {
      expect(page).toContain(
        `Page ${String(index + 1)} of ${String(pages.length)}`,
      );
    });
    expect(pages.join(" ")).toContain("Section 5");
    // A multi-page render and a full text extraction: slow on a loaded
    // machine, not flaky.
  }, 30_000);

  it("embeds the bundled faces whole, not re-subset by pdf-lib", async () => {
    // pdf-lib's own subsetter produced Noto glyphs Chrome's viewer could
    // not draw — the text extracted, the page showed one letter in five —
    // so the faces ship pre-subset and are embedded byte for byte.
    const file = await renderArtifactFile({
      type: "INVESTMENT_BRIEF",
      version: brief(),
      format: "pdf",
    });
    const pdf = await PDFDocument.load(file?.bytes ?? new Uint8Array());
    const programs = pdf.context
      .enumerateIndirectObjects()
      .map(([, object]) => object)
      .filter(
        (object): object is PDFDict =>
          object instanceof PDFDict &&
          object.get(PDFName.of("Type")) === PDFName.of("FontDescriptor"),
      )
      .map((descriptor) => descriptor.get(PDFName.of("FontFile2")))
      .filter((ref) => ref !== undefined)
      .map((ref) => {
        // pdf-lib's typed lookup overloads omit PDFRawStream; check it here.
        const stream = pdf.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) {
          throw new Error("FontFile2 is not a raw stream");
        }
        return stream;
      })
      .map((stream) => decodePDFRawStream(stream).decode().byteLength);
    const bundled = await Promise.all(
      ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"].map(
        async (name) =>
          (await readFile(new URL(`../fonts/${name}`, import.meta.url)))
            .byteLength,
      ),
    );
    expect(programs.sort()).toEqual(bundled.sort());
  });

  it("offers no PowerPoint for a brief, rather than inventing slides", async () => {
    expect(exportFormatsForVersion(brief())).toEqual(["pdf"]);
    const file = await renderArtifactFile({
      type: "INVESTMENT_BRIEF",
      version: brief(),
      format: "pptx",
    });
    expect(file).toBeNull();
  });

  it("exports a type this build has never heard of, named from its code", async () => {
    expect(artifactKindName("INVESTMENT_MEMO")).toBe("Investment memo");
    expect(artifactKindName("INVESTMENT_BRIEF")).toBe("Investment brief");
    const file = await renderArtifactFile({
      type: "INVESTMENT_MEMO",
      version: brief(),
      format: "pdf",
    });
    const text = (await pdfText(file?.bytes ?? new Uint8Array())).join(" ");
    expect(text).toContain("Investment memo");
  });

  it("does not fail on a character no bundled font can draw", async () => {
    const document = documentFromArtifact({
      type: "INVESTMENT_BRIEF",
      version: brief({
        sections: [
          {
            heading: "Emoji and arrows",
            body: "Growth 🚀 → 3x in a year \u0007 with a bell character.",
            findings: [],
          },
        ],
      }),
    });
    const bytes = await documentToPdf(document, { title: "t" });
    const text = (await pdfText(bytes)).join(" ");
    expect(text).toContain("Growth");
    expect(text).toContain("-> 3x in a year");
  });
});

describe("BIZ-001 · a deck is slides, as PDF and as PowerPoint", () => {
  it("writes a PDF with one page per slide that keeps ₦ and €", async () => {
    const file = await renderArtifactFile({
      type: "PITCH_DECK",
      version: deckVersion(),
      format: "pdf",
    });
    const bytes = file?.bytes ?? new Uint8Array();
    expect(isPdf(bytes)).toBe(true);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(deck.slides.length);
    const pages = await pdfText(bytes);
    expect(pages[0]).toContain(NAIRA);
    expect(pages[0]).toContain("Adébáyọ Foods");
    expect(pages[1]).toContain(EURO);
    // The chart is drawn from its numbers, as text and shapes — not an image.
    expect(pages[2]).toContain("480");
    expect(pages[2]).toContain("August");
  });

  it("writes a PowerPoint for a deck", async () => {
    expect(exportFormatsForVersion(deckVersion())).toEqual(["pdf", "pptx"]);
    const file = await renderArtifactFile({
      type: "PITCH_DECK",
      version: deckVersion(),
      format: "pptx",
    });
    const bytes = file?.bytes ?? new Uint8Array();
    expect(file?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(isZip(bytes)).toBe(true);
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toContain("ppt/slides/slide3.xml");
    expect(raw).not.toContain("ppt/slides/slide4.xml");
  });

  it("takes a brand's accent and direction over the composed ones (the BIZ-005 seam)", async () => {
    const branded = layOutDeck(deck, {
      direction: "DARK_TECHNICAL",
      accent: "#aa3300",
    });
    expect(branded.theme.accent).toBe("#aa3300");
    expect(branded.theme.background).toBe(
      themeFor("DARK_TECHNICAL").background,
    );
    // Without a brand the composed direction stands.
    expect(layOutDeck(deck).theme.background).toBe(
      themeFor("MINIMAL_INSTITUTIONAL").background,
    );
    const file = await renderArtifactFile({
      type: "PITCH_DECK",
      version: deckVersion(),
      format: "pdf",
      brand: { direction: "DARK_TECHNICAL", accent: "#aa3300" },
    });
    expect(isPdf(file?.bytes ?? new Uint8Array())).toBe(true);
  });

  it("paints every slide the page background asked for, with readable text (founder live 2026-09-30)", () => {
    const laid = layOutDeck({ ...deck, background: "#3b2a1a" });
    expect(
      laid.slides.every((slide) => slide.background?.[0] === "#3b2a1a"),
    ).toBe(true);
    const light = layOutDeck({ ...deck, background: "#f3e6d4" });
    expect(light.slides[0]?.background).toEqual(["#f3e6d4"]);
  });
});
