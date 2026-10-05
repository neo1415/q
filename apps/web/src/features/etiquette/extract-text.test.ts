import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  docxDocumentXml,
  docxXmlToText,
  extractGuideText,
  guideTypeOf,
  tidyText,
} from "./extract-text";

/**
 * ADR 0050: a guide's text is read in the person's own browser. These hold
 * the reader to the file types it accepts, its limits and a Word file's
 * paragraphs; a PDF goes through pdf.js, exercised in the browser.
 */

/** A minimal .docx: one zip entry, word/document.xml, stored or deflated. */
function docx(xml: string, deflate = true): Uint8Array {
  const name = new TextEncoder().encode("word/document.xml");
  const raw = new TextEncoder().encode(xml);
  const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
  const local = new Uint8Array(30 + name.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, deflate ? 8 : 0, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, raw.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(data, 30 + name.length);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, deflate ? 8 : 0, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, raw.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, 0, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

const XML = `<?xml version="1.0"?><w:document><w:body>
<w:p><w:r><w:t>Be warm &amp; specific.</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Never chase </w:t></w:r><w:r><w:t>twice.</w:t></w:r></w:p>
</w:body></w:document>`;

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("reading a guide in the browser", () => {
  it("knows the four file types and nothing else", () => {
    expect(guideTypeOf({ name: "a.PDF", type: "" })).toBe("application/pdf");
    expect(guideTypeOf({ name: "a.docx", type: "" })).toBe(DOCX);
    expect(guideTypeOf({ name: "a.md", type: "" })).toBe("text/markdown");
    expect(guideTypeOf({ name: "a.txt", type: "" })).toBe("text/plain");
    expect(guideTypeOf({ name: "a.html", type: "text/html" })).toBeNull();
    expect(
      guideTypeOf({ name: "a.doc", type: "application/msword" }),
    ).toBeNull();
  });

  it("reads a Word file's paragraphs, deflated or stored", async () => {
    for (const deflate of [true, false]) {
      const xml = await docxDocumentXml(docx(XML, deflate));
      expect(tidyText(docxXmlToText(xml))).toBe(
        "Be warm & specific.\nNever chase twice.",
      );
    }
  });

  it("refuses what is not a Word file", async () => {
    await expect(
      docxDocumentXml(new TextEncoder().encode("not a zip at all")),
    ).rejects.toThrow("not a Word file");
  });

  it("tidies text: one newline style, no control characters", () => {
    expect(tidyText("a\r\nb\u0000c\n\n\n\nd  \n")).toBe("a\nbc\n\nd");
  });

  it("reads a text file within the limits, and a Word file", async () => {
    const text = new File(["Greet people warmly, by name, always."], "g.txt", {
      type: "text/plain",
    });
    expect(await extractGuideText(text, 20_000)).toEqual({
      ok: true,
      text: "Greet people warmly, by name, always.",
      fileName: "g.txt",
      mediaType: "text/plain",
    });
    const word = new File([docx(XML) as BlobPart], "house.docx", {
      type: DOCX,
    });
    const read = await extractGuideText(word, 20_000);
    expect(read).toMatchObject({ ok: true, mediaType: DOCX });
  });

  it("refuses an unsupported type, an empty file, and one over the text limit", async () => {
    expect(
      await extractGuideText(new File(["<p>x</p>"], "g.html"), 20_000),
    ).toMatchObject({ ok: false });
    expect(
      await extractGuideText(new File(["  "], "g.txt"), 20_000),
    ).toMatchObject({ ok: false });
    const long = await extractGuideText(
      new File(["word ".repeat(10_000)], "g.md"),
      20_000,
    );
    expect(long).toMatchObject({ ok: false });
    expect(long.ok ? "" : long.message).toContain("the limit is 20,000");
  });

  it("refuses a file over 10 MB before reading it", async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "g.txt");
    expect(await extractGuideText(big, 20_000)).toEqual({
      ok: false,
      message: "That file is over 10 MB. Choose a smaller one.",
    });
  });
});
