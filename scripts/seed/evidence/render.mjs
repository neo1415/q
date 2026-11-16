// Text-native PDF rendering for the synthetic evidence documents.
//
// Uses pdf-lib, the library the memo/deck PDF export already uses
// (packages/deck-render). The scripts directory has no node_modules of its
// own (pnpm keeps dependencies per package), so pdf-lib is resolved from
// packages/deck-render rather than added as a new dependency.
//
// Deterministic: fixed document dates from the fixture, no metadata
// refresh, standard fonts only (no embedding), so the same fixture gives
// the same bytes.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildDocuments,
  dateLabel,
  monthLabel,
  renderCsv,
  SYNTHETIC_HEADER,
  WATERMARK_TEXT,
} from "./documents.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

export async function loadPdfLib() {
  const require = createRequire(
    join(REPO_ROOT, "packages", "deck-render", "package.json"),
  );
  return import(pathToFileURL(require.resolve("pdf-lib")).href);
}

// A4 portrait for documents; A4 landscape, one slide per page, for a deck.
const PORTRAIT = { width: 595.28, height: 841.89 };
const LANDSCAPE = { width: 841.89, height: 595.28 };
const MARGIN = 40;
const BODY_BOTTOM = 76;
const GREY = 0.35;

function periodText(doc) {
  const { from, to } = doc.period;
  return from === to
    ? monthLabel(from)
    : `${monthLabel(from)} to ${monthLabel(to)}`;
}

/** Splits text into lines no wider than `width` at `size`. */
function wrap(font, text, size, width) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= width || line === "") {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** Shortens a cell to fit, keeping it readable rather than overlapping. */
function fit(font, text, size, width) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width)
    out = out.slice(0, -1);
  return `${out}...`;
}

/**
 * Renders one document model to PDF bytes. Every page carries the synthetic
 * header line, a light diagonal watermark and a footer with the company,
 * title, version, period, issue date and page n/m.
 */
export async function renderPdf(doc, fx, pdfLib) {
  const { PDFDocument, StandardFonts, rgb, degrees } = pdfLib;
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const issued = new Date(`${doc.issuedOn}T00:00:00Z`);
  pdf.setTitle(doc.title, { showInWindowTitleBar: false });
  pdf.setAuthor(fx.company.legalName);
  pdf.setSubject(SYNTHETIC_HEADER);
  pdf.setKeywords(["synthetic", "demo", doc.id]);
  pdf.setProducer("Capital Q synthetic demo evidence generator");
  pdf.setCreator("scripts/seed/evidence");
  pdf.setCreationDate(issued);
  pdf.setModificationDate(issued);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);
  const PAGE = doc.layout === "slides" ? LANDSCAPE : PORTRAIT;
  // 772 is the portrait body top the existing packs were rendered with.
  const BODY_TOP = doc.layout === "slides" ? 525 : 772;
  const width = PAGE.width - 2 * MARGIN;

  const pages = [];
  let page;
  let y;
  const newPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    y = BODY_TOP;
    if (doc.pageBanner) {
      page.drawText(doc.pageBanner, {
        x: MARGIN,
        y,
        size: 9,
        font: bold,
        color: ink,
      });
      y -= 18;
    }
  };
  const need = (height) => {
    if (y - height < BODY_BOTTOM) newPage();
  };
  newPage();

  // Title block.
  for (const line of wrap(bold, doc.title, 15, width)) {
    need(20);
    page.drawText(line, { x: MARGIN, y, size: 15, font: bold, color: ink });
    y -= 20;
  }
  const meta = `${fx.company.legalName} | Period: ${periodText(doc)} | Version ${doc.version} | Issued ${dateLabel(doc.issuedOn)}`;
  page.drawText(meta, {
    x: MARGIN,
    y,
    size: 8.5,
    font: regular,
    color: rgb(GREY, GREY, GREY),
  });
  y -= 22;

  doc.blocks.forEach((block, index) => {
    if (block.kind === "pageBreak") {
      newPage();
    } else if (block.kind === "heading") {
      // A heading stays with the start of what follows it: a whole short
      // table, or the first few lines of anything else.
      const next = doc.blocks[index + 1];
      const follow =
        next?.kind === "table" && (next.rows.length + 1) * 11 <= 220
          ? (next.rows.length + 1) * 11
          : 36;
      need(24 + follow);
      y -= 6;
      for (const line of wrap(bold, block.text, 10.5, width)) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: 10.5,
          font: bold,
          color: ink,
        });
        y -= 14;
      }
      y -= 2;
    } else if (block.kind === "paragraph") {
      for (const line of wrap(regular, block.text, 8.5, width)) {
        need(12);
        page.drawText(line, {
          x: MARGIN,
          y,
          size: 8.5,
          font: regular,
          color: ink,
        });
        y -= 12;
      }
      y -= 4;
    } else if (block.kind === "table") {
      const size = 7.5;
      const rowH = 11;
      const cols = block.columns.length;
      // Column widths: explicit (scaled to the page) or a label column and
      // equal value columns.
      let widths;
      if (block.widths) {
        const total = block.widths.reduce((a, b) => a + b, 0);
        widths = block.widths.map((w) => (w * width) / total);
      } else {
        const labelW =
          cols === 1 ? width : Math.min(block.labelWidth, width * 0.6);
        const restW = (width - labelW) / Math.max(1, cols - 1);
        widths = [labelW, ...Array.from({ length: cols - 1 }, () => restW)];
      }
      const colX = widths.map(
        (_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0),
      );
      const numeric = (text) => /^-?[\d,.]+%?$/.test(text);
      // A column whose every filled cell is a number is right-aligned,
      // header included. Text cells wrap rather than being cut, so every
      // word stays in the text layer.
      const numericColumn = widths.map(
        (_, i) =>
          i > 0 &&
          block.rows.some((r) => (r[i] ?? "") !== "") &&
          block.rows.every((r) => (r[i] ?? "") === "" || numeric(r[i] ?? "")),
      );
      const layoutRow = (cells, font) =>
        cells.map((raw, i) =>
          numericColumn[i] && numeric(raw)
            ? [fit(font, raw, size, widths[i] - 6)]
            : raw === ""
              ? [""]
              : wrap(font, raw, size, widths[i] - 6),
        );
      const drawRow = (cells, font) => {
        const laid = layoutRow(cells, font);
        const lines = Math.max(1, ...laid.map((l) => l.length));
        need(rowH * lines);
        laid.forEach((cellLines, i) => {
          cellLines.forEach((text, n) => {
            if (text === "") return;
            const w = font.widthOfTextAtSize(text, size);
            const x = numericColumn[i] ? colX[i] + widths[i] - 6 - w : colX[i];
            page.drawText(text, { x, y: y - n * rowH, size, font, color: ink });
          });
        });
        y -= rowH * lines;
      };
      // Keep a table on one page when it fits on one; a longer one breaks.
      const tableHeight =
        [block.columns, ...block.rows].reduce(
          (s, r) =>
            s + Math.max(1, ...layoutRow(r, regular).map((l) => l.length)),
          0,
        ) * rowH;
      need(tableHeight <= BODY_TOP - BODY_BOTTOM - 40 ? tableHeight : rowH * 3);
      if (block.columns.some((c) => c !== "")) {
        drawRow(block.columns, bold);
        page.drawLine({
          start: { x: MARGIN, y: y + rowH - 3 },
          end: { x: MARGIN + width, y: y + rowH - 3 },
          thickness: 0.4,
          color: rgb(0.7, 0.7, 0.7),
        });
      }
      for (const cells of block.rows) {
        const isTotal = /^(Total|Net result|Closing cash|Gross profit)/.test(
          cells[0] ?? "",
        );
        drawRow(cells, isTotal ? bold : regular);
      }
      y -= 8;
    } else {
      throw new Error(`unknown block ${String(block.kind)}`);
    }
  });

  // Header, watermark and footer on every page, now that the count is known.
  const count = pages.length;
  pages.forEach((pg, index) => {
    pg.drawText(SYNTHETIC_HEADER, {
      x: MARGIN,
      y: PAGE.height - 28,
      size: 8,
      font: bold,
      color: rgb(0.55, 0.12, 0.12),
    });
    pg.drawLine({
      start: { x: MARGIN, y: PAGE.height - 36 },
      end: { x: PAGE.width - MARGIN, y: PAGE.height - 36 },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
    // The watermark's origin sits in the gap between the body and the
    // footer, so text extraction (which groups runs by baseline) reads it as
    // its own line and never splices it into a table row.
    pg.drawText(WATERMARK_TEXT, {
      x: 70,
      y: 58,
      size: 42,
      font: bold,
      color: rgb(0.8, 0.8, 0.8),
      opacity: 0.3,
      rotate: degrees(35),
    });
    pg.drawLine({
      start: { x: MARGIN, y: 46 },
      end: { x: PAGE.width - MARGIN, y: 46 },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
    pg.drawText(
      fit(regular, `${fx.company.legalName} | ${doc.title}`, 7, width),
      {
        x: MARGIN,
        y: 34,
        size: 7,
        font: regular,
        color: rgb(GREY, GREY, GREY),
      },
    );
    pg.drawText(
      `Version ${doc.version} | Period: ${periodText(doc)} | Issued ${dateLabel(doc.issuedOn)} | Page ${index + 1}/${count}`,
      {
        x: MARGIN,
        y: 24,
        size: 7,
        font: regular,
        color: rgb(GREY, GREY, GREY),
      },
    );
  });

  return pdf.save({ useObjectStreams: false });
}

/** Every file for one company: PDFs rendered, CSVs as UTF-8 text. */
export async function renderCompany(fx, pdfLib) {
  const docs = buildDocuments(fx);
  const files = [];
  for (const doc of docs) {
    const bytes =
      doc.format === "pdf"
        ? await renderPdf(doc, fx, pdfLib)
        : new TextEncoder().encode(renderCsv(doc));
    files.push({ doc, bytes });
  }
  return { docs, files };
}
