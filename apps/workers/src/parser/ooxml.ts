import { inflateRawSync } from "node:zlib";

/**
 * A bounded reader for OOXML packages (doc 15 §26, doc 16 TM-FILE-03).
 *
 * Written here rather than taken from a library because the decompression
 * controls *are* the security property: entry count, per-entry expanded
 * size, total expanded size and the compression ratio are all checked
 * against the central directory before a single byte is inflated, and the
 * inflate itself is capped again. A library that expands first and asks
 * questions later cannot give that guarantee.
 *
 * It reads names and text. It never writes a file, never resolves a path,
 * never follows a relationship to an external target and never executes
 * anything.
 */

export type ZipLimits = {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxExpandedBytes: number;
  readonly maxExpansionRatio: number;
};

export class OoxmlRefusedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OoxmlRefusedError";
    this.code = code;
  }
}

type Entry = {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const from = Math.max(0, buffer.length - 65_557);
  for (let index = buffer.length - 22; index >= from; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) return index;
  }
  return -1;
}

/**
 * An entry name that climbs out of the package, names a drive or hides a
 * NUL is refused outright. We never write these names to disk, but a package
 * that contains them is malformed on purpose.
 */
function isUnsafeName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    name.length === 0 ||
    name.length > 512 ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.includes("\\") ||
    /^[a-z]:/.test(lower) ||
    name.split("/").includes("..")
  );
}

export type OoxmlPackage = {
  readonly names: readonly string[];
  /** Inflates one entry, bounded. `null` when the package has no such entry. */
  readonly read: (name: string) => string | null;
};

export function openOoxmlPackage(
  buffer: Buffer,
  limits: ZipLimits,
): OoxmlPackage {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) {
    throw new OoxmlRefusedError(
      "MALFORMED_PACKAGE",
      "no end of central directory",
    );
  }
  const entryCount = buffer.readUInt16LE(eocd + 8);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);

  if (
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    // ZIP64: a business document has no reason to need it, and reading it
    // safely is more surface than the format is worth here.
    throw new OoxmlRefusedError("MALFORMED_PACKAGE", "zip64 is not supported");
  }
  if (entryCount === 0 || entryCount > limits.maxEntries) {
    throw new OoxmlRefusedError(
      "ARCHIVE_ENTRY_LIMIT",
      "entry count out of bounds",
    );
  }
  if (directoryOffset + directorySize > buffer.length) {
    throw new OoxmlRefusedError(
      "MALFORMED_PACKAGE",
      "central directory out of range",
    );
  }

  const entries: Entry[] = [];
  let cursor = directoryOffset;
  let expandedTotal = 0;
  let compressedTotal = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length) {
      throw new OoxmlRefusedError(
        "MALFORMED_PACKAGE",
        "truncated central directory",
      );
    }
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new OoxmlRefusedError(
        "MALFORMED_PACKAGE",
        "bad central directory entry",
      );
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (isUnsafeName(name)) {
      throw new OoxmlRefusedError("ARCHIVE_UNSAFE_ENTRY", "unsafe entry name");
    }
    if (method !== 0 && method !== 8) {
      throw new OoxmlRefusedError(
        "MALFORMED_PACKAGE",
        "unsupported compression",
      );
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new OoxmlRefusedError(
        "ARCHIVE_ENTRY_TOO_LARGE",
        "entry exceeds its bound",
      );
    }
    expandedTotal += uncompressedSize;
    compressedTotal += compressedSize;
    if (expandedTotal > limits.maxExpandedBytes) {
      throw new OoxmlRefusedError(
        "ARCHIVE_EXPANSION_LIMIT",
        "package expands too far",
      );
    }
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
  }

  if (
    compressedTotal > 0 &&
    expandedTotal / compressedTotal > limits.maxExpansionRatio
  ) {
    throw new OoxmlRefusedError(
      "ARCHIVE_EXPANSION_LIMIT",
      "compression ratio out of bounds",
    );
  }

  return {
    names: entries.map((entry) => entry.name),
    read: (name) => {
      const entry = entries.find((candidate) => candidate.name === name);
      if (entry === undefined) return null;
      if (entry.localOffset + 30 > buffer.length) {
        throw new OoxmlRefusedError(
          "MALFORMED_PACKAGE",
          "truncated local header",
        );
      }
      if (buffer.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) {
        throw new OoxmlRefusedError("MALFORMED_PACKAGE", "bad local header");
      }
      const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
      const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
      const start = entry.localOffset + 30 + nameLength + extraLength;
      const slice = buffer.subarray(start, start + entry.compressedSize);
      const inflated =
        entry.method === 0
          ? slice
          : inflateRawSync(slice, { maxOutputLength: limits.maxEntryBytes });
      if (inflated.length > limits.maxEntryBytes) {
        throw new OoxmlRefusedError(
          "ARCHIVE_ENTRY_TOO_LARGE",
          "inflate exceeded its bound",
        );
      }
      return inflated.toString("utf8");
    },
  };
}

/**
 * Enough XML reading to recover text and structure, and no more.
 *
 * There is no entity resolution, no DTD handling, no external reference
 * following and no attribute evaluation: the scanner walks tags and text and
 * cannot be pointed at anything outside the string it was given.
 */
export type XmlNode = {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly XmlNode[];
  readonly text: string;
};

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXmlText(value: string): string {
  return value.replace(
    /&(#x?[0-9a-fA-F]+|[a-z]+);/g,
    (_match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : "";
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : "";
      }
      // An unknown named entity is dropped rather than resolved: resolution is
      // exactly the XXE surface this parser refuses to have.
      return ENTITIES[entity] ?? "";
    },
  );
}

const TAG = /<([!?/]?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTRIBUTE =
  /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"|([A-Za-z_][\w.:-]*)\s*=\s*'([^']*)'/g;

function parseAttributes(raw: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  ATTRIBUTE.lastIndex = 0;
  let match = ATTRIBUTE.exec(raw);
  while (match !== null) {
    const name = match[1] ?? match[3];
    const value = match[2] ?? match[4];
    if (name !== undefined && value !== undefined) {
      attributes.set(name, decodeXmlText(value));
    }
    match = ATTRIBUTE.exec(raw);
  }
  return attributes;
}

/** Parses one XML document into a tree, bounded by depth and node count. */
export function parseXml(
  source: string,
  limits: { readonly maxNodes: number; readonly maxDepth: number },
): XmlNode {
  const root: XmlNode & { children: XmlNode[]; text: string } = {
    name: "#root",
    attributes: new Map(),
    children: [],
    text: "",
  };
  const stack: (XmlNode & { children: XmlNode[]; text: string })[] = [root];
  let nodes = 0;
  let cursor = 0;

  TAG.lastIndex = 0;
  let match = TAG.exec(source);
  while (match !== null) {
    const [full, marker, name, rawAttributes, selfClosing] = match;
    const current = stack[stack.length - 1];
    if (current === undefined) break;
    const text = source.slice(cursor, match.index);
    if (text.length > 0) current.text += decodeXmlText(text);
    cursor = match.index + full.length;

    if (marker === "!" || marker === "?") {
      // Comments, declarations and DOCTYPEs are skipped, never interpreted.
      match = TAG.exec(source);
      continue;
    }
    if (marker === "/") {
      if (stack.length > 1) stack.pop();
      match = TAG.exec(source);
      continue;
    }

    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new OoxmlRefusedError(
        "XML_NODE_LIMIT",
        "document has too many elements",
      );
    }
    const node = {
      name: name ?? "",
      attributes: parseAttributes(rawAttributes ?? ""),
      children: [] as XmlNode[],
      text: "",
    };
    current.children.push(node);
    if (selfClosing !== "/") {
      if (stack.length >= limits.maxDepth) {
        throw new OoxmlRefusedError(
          "XML_DEPTH_LIMIT",
          "document nests too deeply",
        );
      }
      stack.push(node);
    }
    match = TAG.exec(source);
  }
  return root;
}

/** Depth-first text of one element and its descendants. */
export function textOf(node: XmlNode): string {
  return [node.text, ...node.children.map(textOf)].join("");
}

/** Every descendant whose local name (ignoring namespace) matches. */
export function findAll(node: XmlNode, localName: string): readonly XmlNode[] {
  const found: XmlNode[] = [];
  const walk = (current: XmlNode): void => {
    for (const child of current.children) {
      if (localName === child.name.replace(/^.*:/, "")) found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

export function localName(node: XmlNode): string {
  return node.name.replace(/^.*:/, "");
}
