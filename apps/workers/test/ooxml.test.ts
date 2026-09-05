import { describe, expect, it } from "vitest";

import {
  decodeXmlText,
  findAll,
  openOoxmlPackage,
  OoxmlRefusedError,
  parseXml,
  textOf,
  type ZipLimits,
} from "../src/parser/ooxml.js";
import { buildZip } from "./support/zip.js";

/**
 * The OOXML reader's job is to refuse. These tests are the refusals: a
 * document that gets past them consumes unbounded memory or names a path
 * outside the package.
 */

const limits: ZipLimits = {
  maxEntries: 8,
  maxEntryBytes: 4_096,
  maxExpandedBytes: 16_384,
  maxExpansionRatio: 100,
};

function refusalCode(run: () => unknown): string {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof OoxmlRefusedError ? error.code : "NOT_REFUSED";
  }
  return "NO_ERROR";
}

describe("openOoxmlPackage", () => {
  it("reads a stored and a deflated entry", () => {
    const zip = buildZip([
      { name: "a.xml", content: "<a>stored</a>", method: 0 },
      { name: "b.xml", content: "<b>deflated</b>", method: 8 },
    ]);
    const pkg = openOoxmlPackage(zip, limits);
    expect(pkg.names).toEqual(["a.xml", "b.xml"]);
    expect(pkg.read("a.xml")).toBe("<a>stored</a>");
    expect(pkg.read("b.xml")).toBe("<b>deflated</b>");
    expect(pkg.read("missing.xml")).toBeNull();
  });

  it("refuses more entries than the limit allows", () => {
    const zip = buildZip(
      Array.from({ length: 9 }, (_value, index) => ({
        name: `e${String(index)}.xml`,
        content: "<x/>",
      })),
    );
    expect(refusalCode(() => openOoxmlPackage(zip, limits))).toBe(
      "ARCHIVE_ENTRY_LIMIT",
    );
  });

  it.each([
    ["../../etc/passwd", "traversal"],
    ["/absolute", "absolute"],
    ["C:/windows/system32", "drive letter"],
    ["a\\b.xml", "backslash"],
  ])("refuses the unsafe entry name %s (%s)", (name) => {
    const zip = buildZip([{ name, content: "<x/>" }]);
    expect(refusalCode(() => openOoxmlPackage(zip, limits))).toBe(
      "ARCHIVE_UNSAFE_ENTRY",
    );
  });

  it("refuses an entry that declares more than the per-entry bound", () => {
    const zip = buildZip([
      { name: "big.xml", content: "<x/>", declaredSize: 5_000 },
    ]);
    expect(refusalCode(() => openOoxmlPackage(zip, limits))).toBe(
      "ARCHIVE_ENTRY_TOO_LARGE",
    );
  });

  it("refuses a bomb before inflating anything", () => {
    // Declared sizes alone push past the expansion bound; no entry is read.
    const zip = buildZip([
      { name: "1.xml", content: "<x/>", declaredSize: 4_000 },
      { name: "2.xml", content: "<x/>", declaredSize: 4_000 },
      { name: "3.xml", content: "<x/>", declaredSize: 4_000 },
      { name: "4.xml", content: "<x/>", declaredSize: 4_000 },
      { name: "5.xml", content: "<x/>", declaredSize: 4_000 },
    ]);
    expect(refusalCode(() => openOoxmlPackage(zip, limits))).toBe(
      "ARCHIVE_EXPANSION_LIMIT",
    );
  });

  it("refuses an implausible compression ratio", () => {
    const zeros = Buffer.alloc(4_000);
    const zip = buildZip([{ name: "flat.bin", content: zeros }]);
    expect(
      refusalCode(() =>
        openOoxmlPackage(zip, { ...limits, maxExpansionRatio: 2 }),
      ),
    ).toBe("ARCHIVE_EXPANSION_LIMIT");
  });

  it("refuses a compression method it does not implement", () => {
    const zip = buildZip([{ name: "x.xml", content: "<x/>", method: 12 }]);
    expect(refusalCode(() => openOoxmlPackage(zip, limits))).toBe(
      "MALFORMED_PACKAGE",
    );
  });

  it("refuses anything that is not a package", () => {
    expect(
      refusalCode(() => openOoxmlPackage(Buffer.from("not a zip"), limits)),
    ).toBe("MALFORMED_PACKAGE");
  });
});

describe("parseXml", () => {
  const xmlLimits = { maxNodes: 50, maxDepth: 10 };

  it("recovers structure and text", () => {
    const tree = parseXml(
      "<root><a:p><a:t>one</a:t><a:t> two</a:t></a:p></root>",
      xmlLimits,
    );
    expect(findAll(tree, "t")).toHaveLength(2);
    expect(textOf(tree)).toBe("one two");
  });

  it("skips declarations, comments and doctypes instead of interpreting them", () => {
    const tree = parseXml(
      `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r><t>safe</t></r>`,
      xmlLimits,
    );
    expect(textOf(tree)).toContain("safe");
    expect(textOf(tree)).not.toContain("passwd");
  });

  it("refuses a document with too many elements", () => {
    const many = `<r>${"<x/>".repeat(60)}</r>`;
    expect(refusalCode(() => parseXml(many, xmlLimits))).toBe("XML_NODE_LIMIT");
  });

  it("refuses a document that nests too deeply", () => {
    const deep = `${"<x>".repeat(30)}${"</x>".repeat(30)}`;
    expect(refusalCode(() => parseXml(deep, xmlLimits))).toBe(
      "XML_DEPTH_LIMIT",
    );
  });
});

describe("decodeXmlText", () => {
  it("resolves only the five named entities and numeric references", () => {
    expect(
      decodeXmlText("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"),
    ).toBe(`a & b <c> "d" 'e'`);
    expect(decodeXmlText("&#65;&#x42;")).toBe("AB");
  });

  it("drops an unknown entity rather than resolving it", () => {
    // Resolution is the XXE surface; there is nothing to resolve here.
    expect(decodeXmlText("before &xxe; after")).toBe("before  after");
  });
});
