import { deflateRawSync } from "node:zlib";

/**
 * A minimal ZIP writer for tests.
 *
 * Hand-written so a test can build packages a real writer would refuse to
 * produce: a declared size that lies, a path that climbs out of the archive,
 * an unsupported compression method. Those are exactly the packages the
 * reader has to refuse, so they have to be constructible here.
 */

export type ZipEntry = {
  readonly name: string;
  readonly content: Buffer | string;
  /** 0 stored, 8 deflate, anything else to test refusal. */
  readonly method?: number;
  /** Overrides the declared uncompressed size, to fake a bomb cheaply. */
  readonly declaredSize?: number;
};

export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf8");
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(entry.name, "utf8");
    const declaredSize = entry.declaredSize ?? raw.length;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, eocd]);
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const OOXML_MIME_TYPES = { docx: DOCX_MIME, pptx: PPTX_MIME } as const;

export function buildDocx(
  documentXml: string,
  extra: readonly ZipEntry[] = [],
) {
  return buildZip([
    { name: "[Content_Types].xml", content: "<Types/>" },
    { name: "word/document.xml", content: documentXml },
    ...extra,
  ]);
}

export function buildPptx(slides: readonly { name: string; xml: string }[]) {
  return buildZip([
    { name: "[Content_Types].xml", content: "<Types/>" },
    ...slides.map((slide) => ({ name: slide.name, content: slide.xml })),
  ]);
}

/** A Word paragraph, with an optional style and numbering marker. */
export function paragraph(
  text: string,
  options: { readonly style?: string; readonly numbered?: boolean } = {},
): string {
  const properties =
    options.style === undefined && options.numbered !== true
      ? ""
      : `<w:pPr>${
          options.style === undefined
            ? ""
            : `<w:pStyle w:val="${options.style}"/>`
        }${options.numbered === true ? '<w:numPr><w:ilvl w:val="0"/></w:numPr>' : ""}</w:pPr>`;
  return `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

export function wordDocument(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

export function slideXml(lines: readonly string[]): string {
  const paragraphs = lines
    .map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="ppt" xmlns:a="draw"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}
