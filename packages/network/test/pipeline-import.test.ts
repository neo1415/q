import { crc32, deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  classifyRow,
  dateOf,
  domainOf,
  emailDomainOf,
  fingerprintUuid,
  importFingerprint,
  isUsableMapping,
  mapHeadersBySynonyms,
  moneyOf,
  nameKey,
  noteBody,
  parseCsv,
  proposalHash,
  readRows,
  readSheet,
  readStage,
  SheetError,
  type ImportRow,
  type MatchCandidate,
} from "../src/index.js";

/**
 * CRM import (decision 106): the deterministic half -- reading CSV and
 * XLSX, mapping columns by header synonyms, reading cells exactly (unknown
 * stays unknown), matching rows (matched, ambiguous, new, invalid) and the
 * proposal hash the approval binds to.
 */

const csv = (text: string) =>
  readSheet({
    bytes: new TextEncoder().encode(text),
    mimeType: "text/csv",
    fileName: "pipeline.csv",
  });

/** A minimal XLSX: a zip of the parts the reader needs. */
function xlsx(parts: Record<string, string>, deflate = true): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const raw = Buffer.from(text, "utf8");
    const body = deflate ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

const WORKBOOK = {
  "xl/workbook.xml":
    '<workbook xmlns:r="r"><sheets><sheet name="Deals" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels":
    '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/deals.xml"/></Relationships>',
  "xl/sharedStrings.xml":
    "<sst><si><t>Organization</t></si><si><t>Status</t></si><si><t>Date Added</t></si><si><r><t>Acme </t></r><r><t>&amp; Co</t></r></si><si><t>Partner Meeting</t></si></sst>",
  "xl/worksheets/deals.xml":
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>46000</v></c></row>' +
    '<row r="3"><c r="A3" t="inlineStr"><is><t>Beta Labs</t></is></c><c r="C3"><v>46001</v></c></row></sheetData></worksheet>',
};

describe("reading a pipeline file", () => {
  it("reads RFC 4180 CSV: quotes, doubled quotes, embedded newlines, BOM, CRLF", () => {
    const sheet = csv(
      '﻿Company,Stage,Notes\r\n"Acme, Inc.",Term Sheet,"Said ""yes""\nthen paused"\r\nBeta Labs,Passed,\r\n\r\n',
    );
    expect(sheet.format).toBe("CSV");
    expect(sheet.headers).toEqual(["Company", "Stage", "Notes"]);
    expect(sheet.rows).toEqual([
      ["Acme, Inc.", "Term Sheet", 'Said "yes"\nthen paused'],
      ["Beta Labs", "Passed", ""],
    ]);
  });

  it("uses the delimiter the export used (semicolon, tab)", () => {
    expect(csv("Name;Status\nAcme;Lead\n").rows).toEqual([["Acme", "Lead"]]);
    expect(csv("Name\tStatus\nAcme\tLead\n").rows).toEqual([["Acme", "Lead"]]);
  });

  it("reads the first worksheet of an XLSX, shared, rich and inline strings", () => {
    for (const deflate of [true, false]) {
      const sheet = readSheet({
        bytes: xlsx(WORKBOOK, deflate),
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileName: "deals.xlsx",
      });
      expect(sheet.format).toBe("XLSX");
      expect(sheet.headers).toEqual(["Organization", "Status", "Date Added"]);
      expect(sheet.rows).toEqual([
        ["Acme & Co", "Partner Meeting", "46000"],
        ["Beta Labs", "", "46001"],
      ]);
    }
  });

  it("refuses with clear errors: wrong type, no rows, too many rows, broken files", () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof SheetError ? error.code : "OTHER";
      }
      return "NONE";
    };
    expect(
      code(() =>
        readSheet({
          bytes: new Uint8Array([1, 2]),
          mimeType: "application/pdf",
          fileName: "deck.pdf",
        }),
      ),
    ).toBe("UNSUPPORTED_TYPE");
    expect(code(() => csv("Company,Stage\n"))).toBe("EMPTY");
    expect(code(() => csv(""))).toBe("EMPTY");
    // A blank first line is not the header: the first line with a name is.
    expect(csv(",,\nCompany,Stage,\nAcme,Lead,\n").headers).toEqual([
      "Company",
      "Stage",
    ]);
    expect(code(() => csv(`Company\n${"Acme\n".repeat(5001)}`))).toBe(
      "TOO_MANY_ROWS",
    );
    expect(code(() => csv('Company\n"Acme\n'))).toBe("UNREADABLE");
    expect(
      code(() =>
        readSheet({
          bytes: new Uint8Array([0x50, 0x4b, 0, 0]),
          mimeType: "",
          fileName: "x.xlsx",
        }),
      ),
    ).toBe("UNREADABLE");
  });

  it("keeps a 5,000-row file", () => {
    expect(csv(`Company\n${"Acme\n".repeat(5000)}`).rows).toHaveLength(5000);
  });

  it("parseCsv keeps a final row without a newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("mapping columns without a model", () => {
  it("maps an Affinity-style export", () => {
    expect(
      mapHeadersBySynonyms([
        "Organization Name",
        "Organization Domain",
        "Status",
        "Owners",
        "Date Added",
        "Deal Source",
        "Referred By",
        "Notes",
      ]),
    ).toEqual({
      counterpartName: "Organization Name",
      website: "Organization Domain",
      stage: "Status",
      owner: "Owners",
      addedOn: "Date Added",
      source: "Deal Source",
      notes: "Notes",
    });
  });

  it("maps a HubSpot deal export and a founder's investor tracker", () => {
    expect(
      mapHeadersBySynonyms([
        "Record ID",
        "Deal Name",
        "Deal Stage",
        "Amount",
        "Close Date",
        "Deal owner",
        "Last Activity Date",
      ]),
    ).toMatchObject({
      counterpartName: "Deal Name",
      stage: "Deal Stage",
      amount: "Amount",
      owner: "Deal owner",
      lastContactOn: "Last Activity Date",
    });
    expect(
      mapHeadersBySynonyms([
        "Fund name",
        "Name of investor",
        "Ticket size",
        "Status",
        "Way in",
        "Next step",
        "Follow-up date",
      ]),
    ).toMatchObject({
      counterpartName: "Fund name",
      contactName: "Name of investor",
      amount: "Ticket size",
      stage: "Status",
      source: "Way in",
      nextStep: "Next step",
      nextStepDue: "Follow-up date",
    });
  });

  it("finds no mapping without a name column, and refuses an unusable proposal", () => {
    expect(mapHeadersBySynonyms(["Stage", "Amount"])).toBeNull();
    const headers = ["Company", "Stage"];
    expect(
      isUsableMapping({ counterpartName: "Company", stage: "Stage" }, headers),
    ).toBe(true);
    expect(isUsableMapping({ stage: "Stage" }, headers)).toBe(false);
    expect(isUsableMapping({ counterpartName: "Firm" }, headers)).toBe(false);
    expect(
      isUsableMapping(
        { counterpartName: "Company", notes: "Company" },
        headers,
      ),
    ).toBe(false);
    expect(
      isUsableMapping(
        { counterpartName: "Company", shoeSize: "Stage" },
        headers,
      ),
    ).toBe(false);
  });

  it("reads stage labels onto the pipeline vocabulary; unclear is UNKNOWN", () => {
    expect(readStage("Closed Lost")).toBe("PASSED");
    expect(readStage("Closed won")).toBe("CLOSED");
    expect(readStage("Soft Circled")).toBe("COMMITTED");
    expect(readStage("Partner Meeting")).toBe("MEETING");
    expect(readStage("Light Diligence")).toBe("DILIGENCE");
    expect(readStage("Keep in Touch")).toBe("PAUSED");
    expect(readStage("3. Term sheet")).toBe("TERM_SHEET");
    expect(readStage("Wired")).toBe("CLOSED");
    expect(readStage("Researching")).toBe("RESEARCH");
    expect(readStage("Blue")).toBe("UNKNOWN");
  });
});

describe("reading cells exactly", () => {
  it("dates: ISO, named months, unambiguous d/m; ambiguous stays unknown", () => {
    expect(dateOf("2026-03-12")).toBe("2026-03-12");
    expect(dateOf("2026-03-12T10:00:00Z")).toBe("2026-03-12");
    expect(dateOf("12 Mar 2026")).toBe("2026-03-12");
    expect(dateOf("March 12, 2026")).toBe("2026-03-12");
    expect(dateOf("25/12/2026")).toBe("2026-12-25");
    expect(dateOf("12/25/2026")).toBe("2026-12-25");
    expect(dateOf("03/04/2026")).toBeNull();
    expect(dateOf("2026-02-30")).toBeNull();
    expect(dateOf("soon")).toBeNull();
    expect(dateOf("46000")).toBeNull();
    expect(dateOf("46000", { excelSerial: true })).toBe("2025-12-09");
  });

  it("money: exact decimal strings and ISO currency, never floats", () => {
    expect(moneyOf("$1.5M")).toEqual({ amount: "1500000", currency: "USD" });
    expect(moneyOf("250k")).toEqual({ amount: "250000", currency: null });
    expect(moneyOf("USD 2,000,000")).toEqual({
      amount: "2000000",
      currency: "USD",
    });
    expect(moneyOf("€0.1m")).toEqual({ amount: "100000", currency: "EUR" });
    expect(moneyOf("£12.345k")).toEqual({ amount: "12345", currency: "GBP" });
    expect(moneyOf("1.2345k")).toEqual({ amount: "1234.5", currency: null });
    expect(moneyOf("1-2M")).toBeNull();
    expect(moneyOf("TBD")).toBeNull();
  });

  it("names and domains for matching", () => {
    expect(nameKey("Acme, Inc.")).toBe(nameKey("ACME inc"));
    expect(nameKey("Acme Ltd")).toBe("acme");
    expect(nameKey("Café Ventures (fictional)")).toBe("cafeventures");
    expect(nameKey("Smith & Partners")).toBe("smithandpartners");
    expect(domainOf("https://www.Acme.io/about?x=1")).toBe("acme.io");
    expect(domainOf("acme")).toBeNull();
    expect(emailDomainOf("ada@acme.io")).toBe("acme.io");
    expect(emailDomainOf("ada@gmail.com")).toBeNull();
  });
});

describe("rows, matches and the proposal", () => {
  const sheet = csv(
    [
      "Company,Website,Stage,Stage date,Check size,Currency,Contact email,Next step,Follow-up date,Notes",
      "Acme Inc,https://acme.io,Partner meeting,2026-03-12,$500k,,ceo@acme.io,Send deck,2026-12-01,Strong team",
      "Twin,,Lead,03/04/2026,lots,EUR,,,,",
      ",,Lead,,,,,,,",
    ].join("\n"),
  );
  const mapping = mapHeadersBySynonyms(sheet.headers);
  if (mapping === null) throw new Error("no mapping");
  const rows = readRows(sheet, mapping);

  it("reads every mapped field; unreadable cells are kept as written", () => {
    expect(rows[0]).toMatchObject({
      rowNumber: 1,
      name: "Acme Inc",
      nameKey: "acme",
      domain: "acme.io",
      fields: {
        stage: "MEETING",
        stageLabel: "Partner meeting",
        stageDate: "2026-03-12",
        amount: "500000",
        currency: "USD",
        contactEmail: "ceo@acme.io",
        nextStep: "Send deck",
        nextStepDue: "2026-12-01",
        notes: "Strong team",
      },
    });
    expect(rows[1]?.fields).toEqual({
      stage: "RESEARCH",
      stageLabel: "Lead",
      currency: "EUR",
      unread: { stageDate: "03/04/2026", amount: "lots" },
    });
    expect(rows[2]?.name).toBeNull();
  });

  const candidate = (
    id: string,
    name: string,
    domain: string | null = null,
  ): MatchCandidate => ({ id, name, nameKey: nameKey(name), domain });

  it("matches by domain first, then name; several is ambiguous; none is new; no name is invalid", () => {
    const [acme, twin, blank] = rows as [ImportRow, ImportRow, ImportRow];
    const a1 = "00000000-0000-4000-8000-000000000001";
    const a2 = "00000000-0000-4000-8000-000000000002";
    const t1 = "00000000-0000-4000-8000-000000000003";
    const t2 = "00000000-0000-4000-8000-000000000004";
    // Two "Acme"s by name; the website decides.
    expect(
      classifyRow(acme, [
        candidate(a1, "Acme", "acme.io"),
        candidate(a2, "ACME Ltd"),
      ]),
    ).toMatchObject({ status: "MATCHED", matchedId: a1 });
    // Two "Twin"s and no website: the importer chooses.
    const twins = classifyRow(twin, [
      candidate(t2, "Twin Ltd"),
      candidate(t1, "Twin"),
    ]);
    expect(twins.status).toBe("AMBIGUOUS");
    expect(twins.matchedId).toBeNull();
    expect(twins.candidates.map((c) => c.id).sort()).toEqual([t1, t2]);
    expect(classifyRow(twin, [candidate(a1, "Acme")])).toMatchObject({
      status: "NEW",
    });
    expect(classifyRow(blank, [candidate(a1, "Acme")])).toMatchObject({
      status: "INVALID",
    });
  });

  it("binds the approval to every prepared byte", () => {
    const base = {
      party: "INVESTOR" as const,
      partyId: "00000000-0000-4000-8000-0000000000aa",
      documentVersionId: "00000000-0000-4000-8000-0000000000bb",
      mapping,
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        name: row.name,
        domain: row.domain,
        fields: row.fields,
        status: "NEW" as const,
        matchedId: null,
        candidateIds: [],
      })),
    };
    const hash = proposalHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(proposalHash({ ...base })).toBe(hash);
    expect(
      proposalHash({
        ...base,
        partyId: "00000000-0000-4000-8000-0000000000cc",
      }),
    ).not.toBe(hash);
    expect(
      proposalHash({
        ...base,
        rows: base.rows.map((row, index) =>
          index === 0
            ? { ...row, status: "MATCHED" as const, matchedId: base.partyId }
            : row,
        ),
      }),
    ).not.toBe(hash);
  });

  it("derives stable UUIDs for what a re-import must find again", () => {
    const one = fingerprintUuid(
      importFingerprint(["task", "u", "Acme", "Send deck"]),
    );
    expect(one).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      fingerprintUuid(importFingerprint(["task", "u", "Acme", "Send deck"])),
    ).toBe(one);
    expect(
      fingerprintUuid(importFingerprint(["task", "u", "Acme", "Call"])),
    ).not.toBe(one);
  });

  it("keeps the row's details as the side's private note", () => {
    const body = noteBody("deals.csv", rows[0] as ImportRow);
    expect(body).toContain("Imported from deals.csv, row 1.");
    expect(body).toContain("Amount: USD 500000");
    expect(body).toContain("Strong team");
    expect(noteBody("deals.csv", { rowNumber: 9, fields: {} })).toBeNull();
  });
});
