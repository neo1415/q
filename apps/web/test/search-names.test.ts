import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { context, discoverInvestors, ownRelationships } = vi.hoisted(() => ({
  context: vi.fn<() => Promise<unknown>>(),
  discoverInvestors: vi.fn<() => Promise<unknown>>(),
  ownRelationships: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/features/q/context", () => ({
  resolveOwnContext: context,
  apiSession: () => Promise.resolve({ token: "t" }),
}));
vi.mock("@capital-q/api-client", () => ({ discoverInvestors }));
vi.mock("@/features/relationships/relationship-data", () => ({
  ownRelationships,
}));

const { matchesName, nameMatches } =
  await import("@/features/search/name-matches");

const relationship = (id: string, name: string) => ({
  relationshipId: `r-${id}`,
  counterpart: { kind: "INVESTOR_ORGANISATION", id, name },
  state: "CONNECTED",
});

beforeEach(() => {
  context.mockReset();
  discoverInvestors.mockReset();
  ownRelationships.mockReset();
});

describe("search by name, among people already in view", () => {
  it("matches every word, in any case", () => {
    expect(matchesName("Savanna Seed Partners", "seed savanna")).toBe(true);
    expect(matchesName("Savanna Seed Partners", "lagoon")).toBe(false);
  });

  it("for a founder: their relationships first, then Discover's investors, once each", async () => {
    context.mockResolvedValue({ kind: "FOUNDER", companyId: "c1" });
    ownRelationships.mockResolvedValue([relationship("i1", "Savanna Seed")]);
    discoverInvestors.mockResolvedValue({
      items: [
        { investorOrganisationId: "i1", displayName: "Savanna Seed" },
        { investorOrganisationId: "i2", displayName: "Savanna Angels" },
      ],
    });
    const found = await nameMatches("savanna");
    expect(found.map((match) => match.detail)).toEqual([
      "Your relationship",
      "In your Discover",
    ]);
  });

  it("for an investor: their relationships only; the feed is not read", async () => {
    context.mockResolvedValue({
      kind: "INVESTOR",
      investorOrganisationId: "o1",
    });
    ownRelationships.mockResolvedValue([]);
    await nameMatches("ledgerfold");
    expect(discoverInvestors).not.toHaveBeenCalled();
  });

  it("finds nobody for someone with no side yet", async () => {
    context.mockResolvedValue({ kind: "NONE" });
    expect(await nameMatches("anyone")).toEqual([]);
  });
});
