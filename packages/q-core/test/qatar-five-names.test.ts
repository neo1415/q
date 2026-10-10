import { describe, expect, it } from "vitest";

import {
  decide,
  parseMention,
  QATAR_FIVE,
  rankCandidates,
  seededByKind,
  type NameCandidate,
} from "../src/names/public.js";

const people = seededByKind("person");
const orgs = seededByKind("organisation");

const topOrg = (said: string, extra: readonly NameCandidate[] = []) =>
  rankCandidates(parseMention(said), [...orgs, ...extra], {
    kind: "organisation",
  })[0];
const topPerson = (said: string) =>
  rankCandidates(parseMention(said), people, { kind: "person" })[0];

describe("Qatar Five: variants and ASR renderings resolve to the seed", () => {
  it.each([
    ["Shadi Qishta", "seed:shadi-qishta"],
    ["Shady Kishta", "seed:shadi-qishta"],
    ["Shadi Qeshta", "seed:shadi-qishta"],
    ["Chadi Kishta", "seed:shadi-qishta"],
    ["Muhannad Taslaq", "seed:muhannad-taslaq"],
    ["Muhanad Taslak", "seed:muhannad-taslaq"],
    ["Mohannad Taslak", "seed:muhannad-taslaq"],
    ["Mohanad Tasluq", "seed:muhannad-taslaq"],
  ])("person: %s", (said, id) => {
    const top = topPerson(said);
    expect(top?.id).toBe(id);
    expect(top?.nameScore).toBeGreaterThanOrEqual(0.8);
  });

  it.each([
    ["QInvest", "seed:qinvest"],
    ["QInvest LLC", "seed:qinvest"],
    ["QINVEST", "seed:qinvest"],
    ["Q Invest", "seed:qinvest"],
    ["queue invest", "seed:qinvest"],
    ["Q-Invest", "seed:qinvest"],
    ["Invest Qatar", "seed:invest-qatar"],
    ["InvestQatar", "seed:invest-qatar"],
    ["IPA Qatar", "seed:invest-qatar"],
    ["Investment Promotion Agency Qatar", "seed:invest-qatar"],
    ["AlRayan Investment", "seed:alrayan-investment"],
    ["Al Rayan", "seed:alrayan-investment"],
    ["Al-Rayan", "seed:alrayan-investment"],
    ["Al Rayyan", "seed:alrayan-investment"],
    ["ARI Qatar", "seed:alrayan-investment"],
    ["Al Rayan Investments", "seed:alrayan-investment"],
  ])("organisation: %s", (said, id) => {
    const top = topOrg(said);
    expect(top?.id).toBe(id);
    expect(top?.nameScore).toBeGreaterThanOrEqual(0.85);
  });

  it("QInvest and Invest Qatar are not confused with each other", () => {
    for (const said of ["QInvest", "Q Invest", "queue invest"]) {
      const ranked = rankCandidates(parseMention(said), orgs, {
        kind: "organisation",
      });
      const wrong = ranked.find((r) => r.id === "seed:invest-qatar");
      expect(wrong?.nameScore ?? 0, said).toBeLessThan(0.85);
    }
    const ranked = rankCandidates(parseMention("Invest Qatar"), orgs, {
      kind: "organisation",
    });
    expect(
      ranked.find((r) => r.id === "seed:qinvest")?.nameScore ?? 0,
    ).toBeLessThan(0.85);
  });
});

describe("Qatar Five: resolved with context clues", () => {
  it("'Shadi Qishta, Doha, from QInvest' is corroborated", () => {
    const shadi: NameCandidate = {
      id: "seed:shadi-qishta",
      name: "Shadi Qishta",
      aliases: ["Shady Kishta"],
      city: "Doha",
      employer: "QInvest LLC",
    };
    const ranked = rankCandidates(
      parseMention("Shady Kishta, Doha, from Q Invest"),
      [
        shadi,
        { ...shadi, id: "lagos-shady", city: "Lagos", employer: "Dangote" },
      ],
      { kind: "person" },
    );
    expect(ranked[0]?.id).toBe("seed:shadi-qishta");
    expect(ranked[0]?.corroborated).toBe(true);
    expect(decide(ranked).kind).toBe("ONE");
  });

  it("Mohannad Taslak at Invest Qatar in Doha is corroborated", () => {
    const ranked = rankCandidates(
      parseMention(
        "Mohannad Taslak from Investment Promotion Agency Qatar, Doha",
      ),
      [
        {
          id: "seed:muhannad-taslaq",
          name: "Muhannad Taslaq",
          city: "Doha",
          employer: "Invest Qatar",
          employerAliases:
            QATAR_FIVE.find((e) => e.id === "seed:invest-qatar")?.aliases ?? [],
        },
      ],
      { kind: "person" },
    );
    expect(ranked[0]?.corroborated).toBe(true);
  });
});

describe("Qatar Five: negatives", () => {
  it("'Al Rayan Bank' is a different entity from AlRayan Investment", () => {
    const bank: NameCandidate = { id: "al-rayan-bank", name: "Al Rayan Bank" };
    const ranked = rankCandidates(
      parseMention("Al Rayan Bank"),
      [...orgs, bank],
      {
        kind: "organisation",
      },
    );
    expect(ranked[0]?.id).toBe("al-rayan-bank");
    const investment = ranked.find((r) => r.id === "seed:alrayan-investment");
    expect(investment?.nameScore ?? 0).toBeLessThan(0.85);
    // And the other way round: saying Investment never lands on the bank.
    const back = rankCandidates(
      parseMention("Al Rayan Investments"),
      [...orgs, bank],
      {
        kind: "organisation",
      },
    );
    expect(back[0]?.id).toBe("seed:alrayan-investment");
    expect(
      back.find((r) => r.id === "al-rayan-bank")?.nameScore ?? 0,
    ).toBeLessThan(0.85);
  });

  it("a generic 'Shadi' with no clue is not Shadi Qishta", () => {
    const ranked = rankCandidates(parseMention("Shadi"), people, {
      kind: "person",
    });
    expect(ranked.every((r) => !r.corroborated)).toBe(true);
    expect(ranked.every((r) => r.score < 0.85)).toBe(true);
    expect(decide(ranked).kind).not.toBe("ONE");
    expect(decide(ranked, { withinOwnRecords: true }).kind).not.toBe("ONE");
  });

  it("other Shadis and Muhannads are other people", () => {
    const top = topPerson("Shadi Karam");
    expect(top?.nameScore ?? 0).toBeLessThan(0.6);
    expect(topPerson("Muhannad Khalil")?.nameScore ?? 0).toBeLessThan(0.6);
  });

  it("a name alone does not corroborate; a wrong city blocks it", () => {
    const ranked = rankCandidates(parseMention("Shadi Qishta"), people, {
      kind: "person",
    });
    expect(ranked[0]?.corroborated).toBe(false);
    const lagos = rankCandidates(parseMention("Shadi Qishta, Lagos"), people, {
      kind: "person",
    });
    expect(lagos[0]?.conflicts).toContain("CITY");
    expect(decide(lagos).kind).not.toBe("ONE");
  });

  it("the seeds carry no invented Arabic script", () => {
    for (const one of QATAR_FIVE) {
      for (const name of [one.name, ...(one.aliases ?? [])]) {
        expect(/[؀-ۿ]/u.test(name), name).toBe(false);
      }
    }
  });
});
