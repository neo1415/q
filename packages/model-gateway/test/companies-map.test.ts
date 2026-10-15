import { describe, expect, it } from "vitest";

import type { QToolCallOutcome, QToolPort } from "@capital-q/q-runtime";

import { companiesMapAskOf, runCompaniesMap } from "../src/q/companies-map.js";

/**
 * Lead 2026-10-16 (live: "show me on a map where my top companies are
 * based" came back as cards and no map; "show me a map of where Tensorgate
 * is" ran a web search for 22 s). A map of companies is drawn by code from
 * their declared locations, through the tool port, with no model and no
 * web search; an undeclared location stays unknown.
 */

const MAJI = "7c1d0e55-0000-4000-8000-000000000001";
const MAJI_HEALTH = "7c1d0e55-0000-4000-8000-000000000002";

type Profile = Record<string, string | null>;

const PROFILES: Readonly<Record<string, Profile>> = {
  [MAJI]: {
    companyId: MAJI,
    canonicalName: "Maji Loop",
    currentStageCode: "seed",
    headquartersCity: "Nairobi",
    headquartersCountry: "KE",
    foundedDate: "2022-03-01",
    shortDescription: "Solar-pumped, metered water kiosks in Nairobi.",
  },
  [MAJI_HEALTH]: {
    companyId: MAJI_HEALTH,
    canonicalName: "Maji Health",
    currentStageCode: null,
    headquartersCity: null,
    headquartersCountry: null,
    foundedDate: null,
    shortDescription: null,
  },
};

function outcome(
  callId: string,
  toolName: string,
  result: QToolCallOutcome["result"],
): QToolCallOutcome {
  return {
    callId,
    toolName,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: result.ok ? "SUCCEEDED" : "DENIED",
    failureCode: result.ok ? null : "NOT_AVAILABLE",
    sensitivity: "NETWORK_VISIBLE",
    result,
    latencyMs: 1,
  };
}

function port(options: { denied?: readonly string[] } = {}) {
  const asked: string[] = [];
  const tools: Pick<QToolPort, "execute"> = {
    execute: (proposal) => {
      asked.push(proposal.name);
      const args = proposal.arguments as Record<string, unknown>;
      if (proposal.name === "search_companies") {
        const query = String(args["query"]).toLowerCase();
        const items = Object.values(PROFILES)
          .filter((p) =>
            String(p["canonicalName"])
              .toLowerCase()
              .includes(query.split(" ")[0] ?? ""),
          )
          .map((p) => ({
            companyId: p["companyId"],
            canonicalName: p["canonicalName"],
            currentStageCode: p["currentStageCode"],
            headquartersCountry: p["headquartersCountry"],
            shortDescription: p["shortDescription"],
          }));
        return Promise.resolve(
          outcome(proposal.callId, "company.search", {
            ok: true,
            data: { items, nextCursor: null, truthClass: "USER_CLAIM" },
          }),
        );
      }
      if (proposal.name === "get_company") {
        const id = String(args["companyId"]);
        const profile = PROFILES[id];
        if (profile === undefined || options.denied?.includes(id)) {
          return Promise.resolve(
            outcome(proposal.callId, "company.get", {
              ok: false,
              error: { code: "NOT_AVAILABLE" },
            } as never),
          );
        }
        return Promise.resolve(
          outcome(proposal.callId, "company.get", {
            ok: true,
            data: { ...profile, truthClass: "USER_CLAIM" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected tool ${proposal.name}`));
    },
  };
  return { tools, asked };
}

const AVAILABLE = new Set(["search_companies", "get_company"]);
const CONTEXT = {} as Parameters<typeof runCompaniesMap>[0]["context"];

const NO_SWEEP = Promise.resolve(null);

describe("companiesMapAskOf", () => {
  it("reads a map of their own, named or shown companies", () => {
    expect(
      companiesMapAskOf(
        "show me on a map where my top companies are based",
        [],
      ),
    ).toEqual({ scope: "OWN", names: [] });
    expect(
      companiesMapAskOf("show me a map of where Maji Loop is in the world", []),
    ).toEqual({ scope: "NAMED", names: ["Maji Loop"] });
    expect(companiesMapAskOf("put them on a map", [MAJI])).toEqual({
      scope: "PREVIOUS",
      names: [],
    });
  });

  it("is not a map of companies otherwise", () => {
    expect(
      companiesMapAskOf("where are my top companies based?", []),
    ).toBeNull();
    expect(
      companiesMapAskOf("show me on a map where my investors are", []),
    ).toBeNull();
    expect(companiesMapAskOf("open the map", [])).toBeNull();
  });
});

describe("runCompaniesMap", () => {
  it("draws a named company from its declared country, with no search of the web", async () => {
    const p = port();
    const said = "show me a map of where Maji Loop is in the world";
    const ask = companiesMapAskOf(said, []);
    if (ask === null) throw new Error("not a map ask");
    const drawn = await runCompaniesMap({
      ask,
      asked: said,
      shownBefore: [],
      sweep: NO_SWEEP,
      tools: p.tools,
      context: CONTEXT,
      available: AVAILABLE,
    });
    expect(p.asked).toEqual(["search_companies", "get_company"]);
    expect(drawn?.blocks).toEqual([
      expect.objectContaining({
        kind: "MAP",
        places: [
          {
            label: "Maji Loop",
            countryCode: "KE",
            subject: { kind: "COMPANY", companyId: MAJI },
            note: null,
          },
        ],
      }),
    ]);
    expect(drawn?.text).toContain("Maji Loop (Nairobi, Kenya)");
    expect(drawn?.text).toContain("aren't verified");
  });

  it("places the shown companies, and leaves an undeclared one unplaced, never guessed", async () => {
    const p = port();
    const drawn = await runCompaniesMap({
      ask: { scope: "PREVIOUS", names: [] },
      asked: "put them on a map",
      shownBefore: [MAJI, MAJI_HEALTH],
      sweep: NO_SWEEP,
      tools: p.tools,
      context: CONTEXT,
      available: AVAILABLE,
    });
    const map = drawn?.blocks[0];
    expect(map?.kind).toBe("MAP");
    expect(
      map?.kind === "MAP" ? map.places.map((one) => one.countryCode) : [],
    ).toEqual(["KE", null]);
    expect(drawn?.text).toContain("Maji Health hasn't declared a location");
  });

  it("leaves a company the plan does not admit off the map", async () => {
    const p = port({ denied: [MAJI_HEALTH] });
    const drawn = await runCompaniesMap({
      ask: { scope: "PREVIOUS", names: [] },
      asked: "put them on a map",
      shownBefore: [MAJI, MAJI_HEALTH],
      sweep: NO_SWEEP,
      tools: p.tools,
      context: CONTEXT,
      available: AVAILABLE,
    });
    expect(drawn?.text).not.toContain("Maji Health");
  });

  it("hands back to the full path only when nothing is known and public information was asked for", async () => {
    const run = (asked: string) =>
      runCompaniesMap({
        ask: { scope: "PREVIOUS", names: [] },
        asked,
        shownBefore: [MAJI_HEALTH],
        sweep: NO_SWEEP,
        tools: port().tools,
        context: CONTEXT,
        available: AVAILABLE,
      });
    expect((await run("put it on a map"))?.text).toContain(
      "hasn't declared where it is based",
    );
    expect(await run("look it up online and put it on a map")).toBeNull();
  });
});
