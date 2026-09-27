import { describe, expect, it } from "vitest";

import {
  NO_OWN_RECORDS,
  nameTokens,
  resolveOwnRecord,
  soundKey,
  type OwnRecordNames,
} from "../src/company/own-names.js";

/**
 * A said name resolved against the person's own records (founder live
 * 2026-09-27, failure 6). Properties over generated variants of recorded
 * names, not the transcript's strings: the check must hold for any
 * company a person owns.
 */

const RECORDED: readonly { canonical: string; legal: string }[] = [
  { canonical: "Zino Aviation", legal: "ZINO AVIATION LTD" },
  { canonical: "Kivu Freight", legal: "Kivu Freight Limited" },
  { canonical: "Marlow Robotics", legal: "Marlow Robotics Inc." },
  { canonical: "Tessa Health", legal: "TESSA HEALTH PLC" },
];

function ownCompany(name: {
  canonical: string;
  legal: string;
}): OwnRecordNames {
  return {
    ...NO_OWN_RECORDS,
    company: { companyId: "c1", names: [name.canonical, name.legal] },
  };
}

const VOWELS = ["a", "e", "i", "o", "u"];

/** The first word with one vowel sounded differently, as a recogniser might. */
function oneVowelMisheard(name: string): string {
  const [first = "", ...rest] = name.split(" ");
  const at = [...first].findIndex(
    (letter, index) => index > 0 && VOWELS.includes(letter.toLowerCase()),
  );
  const swapped = VOWELS.find((vowel) => vowel !== first[at]?.toLowerCase());
  return [
    `${first.slice(0, at)}${swapped ?? "a"}${first.slice(at + 1)}`,
    ...rest,
  ].join(" ");
}

describe("a said name against the person's own records", () => {
  it("resolves the recorded name however it is cased, registered or accented", () => {
    for (const name of RECORDED) {
      const records = ownCompany(name);
      for (const said of [
        name.canonical,
        name.canonical.toUpperCase(),
        name.legal,
        `the ${name.canonical.toLowerCase()} company`,
        name.canonical.replace(/o/g, "ö"),
      ]) {
        expect(resolveOwnRecord(said, records)).toEqual({
          kind: "OWN_COMPANY",
          recordedName: name.canonical,
          exact: true,
        });
      }
    }
  });

  it("resolves a first word misheard by one vowel to the recorded name", () => {
    for (const name of RECORDED) {
      const said = oneVowelMisheard(name.canonical);
      expect(said).not.toBe(name.canonical);
      expect(resolveOwnRecord(said, ownCompany(name))).toMatchObject({
        kind: "OWN_COMPANY",
        recordedName: name.canonical,
        exact: false,
      });
    }
  });

  it("resolves a first word that sounds alike beside a word that matches (Zener/Xeno for Zino)", () => {
    const records = ownCompany({
      canonical: "Zino Aviation",
      legal: "ZINO AVIATION LTD",
    });
    for (const said of ["Zener Aviation", "Xeno Aviation", "Zeno Aviation"]) {
      expect(resolveOwnRecord(said, records)?.recordedName).toBe(
        "Zino Aviation",
      );
    }
    expect(soundKey("Zener")).toBe(soundKey("Zino"));
  });

  it("keeps a different company different: another first word, a trailing word alone, a sound-alike with nothing else matching", () => {
    for (const name of RECORDED) {
      const records = ownCompany(name);
      const [first = "", second = ""] = nameTokens(name.canonical);
      for (const said of [
        `Delta ${second}`,
        `Northwind ${second}`,
        second,
        `${first} ${second} Partners`,
        "Acme Holdings",
      ]) {
        expect(resolveOwnRecord(said, records)).toBeNull();
      }
    }
    // One letter off at the start is another name, not a mishearing.
    expect(
      resolveOwnRecord(
        "Kino Aviation",
        ownCompany({ canonical: "Zino Aviation", legal: "Zino Aviation" }),
      ),
    ).toBeNull();
    // A sound-alike alone is not enough.
    expect(
      resolveOwnRecord(
        "Zener",
        ownCompany({ canonical: "Zino Aviation", legal: "Zino Aviation" }),
      ),
    ).toBeNull();
  });

  it("resolves the person's own name and firm, and returns nothing when two records are equally near", () => {
    const records: OwnRecordNames = {
      company: { companyId: "c1", names: ["Zino Aviation"] },
      firm: { names: ["Harbour Angels"] },
      person: { names: ["Adaeze Okafor"] },
    };
    expect(resolveOwnRecord("Adaeze Okafor", records)?.kind).toBe("OWN_PERSON");
    expect(resolveOwnRecord("Adeze Okafor", records)?.kind).toBe("OWN_PERSON");
    expect(resolveOwnRecord("Harbour Angels", records)?.kind).toBe("OWN_FIRM");
    expect(
      resolveOwnRecord("Zino", {
        ...records,
        firm: { names: ["Zino Capital"] },
      }),
    ).toBeNull();
  });

  it("resolves nothing when there are no records (unknown stays unknown)", () => {
    expect(resolveOwnRecord("Zino Aviation", NO_OWN_RECORDS)).toBeNull();
    expect(
      resolveOwnRecord(
        "",
        ownCompany({ canonical: "Zino Aviation", legal: "Zino Aviation" }),
      ),
    ).toBeNull();
  });
});
