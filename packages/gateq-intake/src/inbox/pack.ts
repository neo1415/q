/**
 * F4: the "download pack" for one application. One zip:
 *
 *   00-summary.pdf          one page: company, round, the gate's rules and
 *                           how they stood, the founder's note, contact
 *   01-shared/<file>        only the documents the founder ticked and sent
 *   02-application.json     the founder's answers for a CRM (versioned)
 *
 * What is never in it: the organisation's team notes, labels, assignee,
 * stars or messages (organisation_private), anything the founder did not
 * share, and any Q opinion. Every page carries who downloaded it.
 *
 * Built in memory with no dependency: the zip is STORE-only (the files are
 * already compressed formats, and STORE keeps this small and auditable)
 * and the PDF is a single text page in a standard font.
 */

export const PACK_SCHEMA_VERSION = "gateq-pack.v1" as const;

export type PackFile = { readonly name: string; readonly bytes: Uint8Array };

export type PackInput = {
  readonly companyName: string;
  readonly reference: string;
  readonly submittedAt: string;
  readonly downloadedBy: string;
  readonly downloadedAt: string;
  readonly fund: string;
  readonly summaryLines: readonly string[];
  readonly answers: Readonly<Record<string, string | null>>;
  readonly rules: readonly {
    readonly label: string;
    readonly standing: string;
  }[];
  readonly shared: readonly PackFile[];
  /** Shared documents that could not be included, by title, with why. */
  readonly omitted: readonly string[];
};

const encoder = new TextEncoder();

/** Safe, short file names inside the zip; no paths from outside. */
export function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 80);
  return cleaned === "" ? "file" : cleaned;
}

export function packFileName(companyName: string, at: string): string {
  return `${safeName(companyName)}-${at.slice(0, 10)}.zip`;
}

export function buildPack(input: PackInput): Uint8Array {
  const files: PackFile[] = [
    { name: "00-summary.pdf", bytes: summaryPdf(input) },
    ...input.shared.map((file, index) => ({
      name: `01-shared/${String(index + 1).padStart(2, "0")}-${safeName(file.name)}`,
      bytes: file.bytes,
    })),
    {
      name: "02-application.json",
      bytes: encoder.encode(
        `${JSON.stringify(
          {
            schema: PACK_SCHEMA_VERSION,
            reference: input.reference,
            company: input.companyName,
            submittedAt: input.submittedAt,
            // The founder's own answers: applicant claims, not verified facts.
            answers: input.answers,
            rules: input.rules,
            downloadedBy: input.downloadedBy,
            downloadedAt: input.downloadedAt,
          },
          null,
          2,
        )}\n`,
      ),
    },
  ];
  return zip(files, new Date(input.downloadedAt));
}

// ---------------------------------------------------------------------------
// A one-page PDF in Helvetica
// ---------------------------------------------------------------------------

/** WinAnsi-safe text for the standard font; anything else becomes "?". */
function pdfText(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\()]/g, (c) => `\\${c}`);
}

function wrap(line: string, width: number): string[] {
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      if (current !== "") out.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current !== "") out.push(current);
  return out.length === 0 ? [""] : out;
}

export function summaryPdf(input: PackInput): Uint8Array {
  const lines: { text: string; size: number }[] = [
    { text: input.companyName, size: 18 },
    {
      text: `Applied to ${input.fund} through GateQ on ${input.submittedAt.slice(0, 10)} (ref ${input.reference})`,
      size: 9,
    },
    { text: "", size: 9 },
    ...input.summaryLines.flatMap((line) =>
      wrap(line, 92).map((text) => ({ text, size: 10 })),
    ),
    { text: "", size: 9 },
    { text: "Your gate's rules", size: 12 },
    ...(input.rules.length === 0
      ? [{ text: "No published rules yet, so nothing was checked.", size: 10 }]
      : input.rules.map((rule) => ({
          text: `${rule.standing}: ${rule.label}`,
          size: 10,
        }))),
    { text: "", size: 9 },
    ...(input.omitted.length === 0
      ? []
      : [
          { text: "Shared but not included", size: 12 },
          ...input.omitted.map((text) => ({ text, size: 10 })),
          { text: "", size: 9 },
        ]),
    {
      text: "The founder's answers are their own claims, not verified facts.",
      size: 8,
    },
    {
      text: `Downloaded by ${input.downloadedBy} on ${input.downloadedAt.slice(0, 16).replace("T", " ")} UTC. Confidential.`,
      size: 8,
    },
  ];
  let y = 800;
  const content: string[] = [];
  for (const line of lines.slice(0, 70)) {
    y -= line.size + 6;
    if (y < 40) break;
    content.push(
      `BT /F1 ${line.size} Tf 48 ${y} Td (${pdfText(line.text)}) Tj ET`,
    );
  }
  const stream = content.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is ASCII by construction, so length is byte length.
  return encoder.encode(body);
}

// ---------------------------------------------------------------------------
// A STORE-only zip
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(at: Date): { time: number; date: number } {
  return {
    time:
      (at.getUTCHours() << 11) |
      (at.getUTCMinutes() << 5) |
      Math.floor(at.getUTCSeconds() / 2),
    date:
      ((at.getUTCFullYear() - 1980) << 9) |
      ((at.getUTCMonth() + 1) << 5) |
      at.getUTCDate(),
  };
}

export function zip(files: readonly PackFile[], at: Date): Uint8Array {
  const { time, date } = dosTime(at);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // STORE
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, file.bytes.length, true);
    local.setUint32(22, file.bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, file.bytes);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.bytes.length, true);
    entry.setUint32(24, file.bytes.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.bytes.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at2 = 0;
  for (const part of parts) {
    out.set(part, at2);
    at2 += part.length;
  }
  return out;
}

/** The names inside a STORE zip, for tests and audit. */
export function zipEntries(
  bytes: Uint8Array,
): { readonly name: string; readonly bytes: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const out: { name: string; bytes: Uint8Array }[] = [];
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    out.push({ name, bytes: bytes.subarray(start, start + size) });
    at = start + size;
  }
  return out;
}
