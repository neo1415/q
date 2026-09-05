/**
 * Builds a small, valid, uncompressed PDF with a correct cross-reference
 * table, so the PDF tests exercise a real file rather than a stub. Text is
 * placed at descending vertical positions, which is what the extractor uses
 * to recover lines.
 */
export function buildPdf(pages: readonly (readonly string[])[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_page, index) => 3 + index * 2);
  const fontId = 3 + pages.length * 2;

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${String(id)} 0 R`)
    .join(" ")}] /Count ${String(pages.length)} >>`;

  pages.forEach((lines, index) => {
    const pageId = pageIds[index] ?? 0;
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents ${String(contentId)} 0 R /Resources << /Font << /F1 ${String(fontId)} 0 R >> >> >>`;
    const text = lines
      .map(
        (line, at) =>
          `BT /F1 14 Tf 72 ${String(700 - at * 24)} Td (${line}) Tj ET`,
      )
      .join("\n");
    objects[contentId] =
      `<< /Length ${String(text.length)} >>\nstream\n${text}\nendstream`;
  });
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id <= fontId; id += 1) {
    offsets[id] = body.length;
    body += `${String(id)} 0 obj\n${objects[id] ?? ""}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${String(fontId + 1)}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id += 1) {
    body += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${String(fontId + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
