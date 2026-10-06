import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  CapitalRoundNotFoundError,
  type CapitalRoundService,
} from "@capital-q/capital";
import type { CapitalRoundDto } from "@capital-q/contracts";
import type { CommitmentService, LedgerCommitment } from "@capital-q/network";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { registerCommitmentRoutes } from "../src/http/commitments.js";

/**
 * P8 (2026-10-06): the Capital page's book says what a founder may not know
 * to ask (oversubscribed, overlapping rounds, money in another currency,
 * past the target close), and an investor sees the round their agreed
 * commitment counts toward -- its terms and an ownership estimate -- never
 * its target or totals. Synthetic ids only.
 */

const COMPANY = "f0000000-0000-4000-8000-00000000000a";
const SEED = "99999999-0000-4000-8000-000000000001";
const BRIDGE = "99999999-0000-4000-8000-000000000002";

const actor: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-00000000000a"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000a"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-00000000000a",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-00000000000a",
  ),
  actorType: "HUMAN",
};

const round = (
  id: string,
  name: string,
  overrides: Partial<CapitalRoundDto> = {},
): CapitalRoundDto => ({
  id,
  name,
  target: { amount: "1000000", currency: "USD" },
  instrument: "SAFE",
  status: "OPEN",
  isCurrent: false,
  openedOn: "2026-09-01",
  firstClosedOn: null,
  closedOn: null,
  cancelledOn: null,
  cancelledReason: null,
  terms: {
    targetCloseOn: null,
    valuation: null,
    valuationCap: null,
    discountPercent: null,
    hardCap: null,
    proRataRights: null,
    lead: null,
    extendsRoundId: null,
    reportedRaised: null,
  },
  closes: [],
  corrections: 0,
  revision: 1,
  createdAt: "2026-09-01T09:00:00.000Z",
  ...overrides,
});

const commitment = (
  id: string,
  overrides: Partial<LedgerCommitment>,
): LedgerCommitment => ({
  id,
  relationshipId: "88888888-0000-4000-8000-000000000001",
  counterpartId: COMPANY,
  counterpartName: "Fictional Co",
  amount: "200000",
  currencyCode: "USD",
  level: "FIRM",
  status: "RECEIVED",
  source: "PERSON",
  quote: null,
  roundId: SEED,
  statedByYourSide: true,
  transferReference: null,
  at: "2026-10-01T10:00:00.000Z",
  next: null,
  ...overrides,
});

function build(options: {
  readonly ledger: Awaited<ReturnType<CommitmentService["ledger"]>>;
  readonly rounds?: readonly CapitalRoundDto[];
}) {
  const app = Fastify();
  const investorRoundsAsked: string[][] = [];
  const capitalRounds: Pick<
    CapitalRoundService,
    "listRounds" | "roundHistory" | "roundsForInvestorCommitments"
  > = {
    listRounds: () => Promise.resolve(options.rounds ?? []),
    roundHistory: () => Promise.reject(new CapitalRoundNotFoundError()),
    roundsForInvestorCommitments: (ids) => {
      investorRoundsAsked.push([...ids]);
      return Promise.resolve(
        new Map([
          [
            SEED,
            {
              id: SEED,
              name: "Seed",
              instrument: "SAFE" as const,
              status: "FIRST_CLOSED" as const,
              valuation: null,
              valuationCap: "8000000",
              discountPercent: "20",
              proRataRights: "MAJOR_INVESTORS" as const,
              currency: "USD",
            },
          ],
        ]),
      );
    },
  };
  registerCommitmentRoutes(app, {
    authenticator: {
      authenticate: () =>
        Promise.resolve({
          authUserId: AuthUserIdSchema.parse(
            "a0000000-0000-4000-8000-00000000000a",
          ),
        }),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: actor }),
    },
    commitments: {
      ledger: () => Promise.resolve(options.ledger),
    } as unknown as CommitmentService,
    capitalRounds,
    today: () => "2026-10-06",
  });
  return { app, investorRoundsAsked };
}

describe("the founder's book (P8)", () => {
  it("words what the founder may not know to ask, and keeps other currencies out of the meter", async () => {
    const { app } = build({
      rounds: [
        round(SEED, "Seed", {
          isCurrent: true,
          status: "FIRST_CLOSED",
          terms: { ...round(SEED, "Seed").terms, targetCloseOn: "2026-10-01" },
        }),
        round(BRIDGE, "Seed bridge", { target: { amount: "250000", currency: "USD" } }),
      ],
      ledger: {
        side: "COMPANY",
        commitments: [],
        sums: [
          { roundId: SEED, currencyCode: "USD", received: "900000", confirmed: "200000", pledged: "0" },
          { roundId: SEED, currencyCode: "GBP", received: "50000", confirmed: "0", pledged: "0" },
        ],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/companies/${COMPANY}/capital-ledger`,
      headers: { authorization: "Bearer test" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      rounds: { id: string; sums: { raised: string }; otherCurrencies: { currencyCode: string; raised: string }[]; notices: string[] }[];
      totals: { currencyCode: string; raised: string }[];
    }>();
    const seed = body.rounds.find((item) => item.id === SEED);
    expect(seed?.sums.raised).toBe("900000");
    expect(seed?.otherCurrencies).toEqual([
      { currencyCode: "GBP", raised: "50000", confirmed: "0", pledged: "0" },
    ]);
    expect(seed?.notices).toEqual([
      "OVER_TARGET",
      "OVERLAPS_OPEN_ROUND",
      "OTHER_CURRENCY",
      "PAST_TARGET_CLOSE",
    ]);
    expect(body.totals.map((total) => total.currencyCode).sort()).toEqual(["GBP", "USD"]);
  });

  it("a round that is not theirs has no history (the same 404)", async () => {
    const { app } = build({ ledger: { side: "COMPANY", commitments: [], sums: [] } });
    const response = await app.inject({
      method: "GET",
      url: `/v1/companies/${COMPANY}/capital-rounds/${SEED}/history`,
      headers: { authorization: "Bearer test" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("the investor's commitments (P8)", () => {
  it("an agreed commitment carries its round's terms and an ownership estimate; a one-sided one carries nothing", async () => {
    const { app, investorRoundsAsked } = build({
      ledger: {
        side: "INVESTOR",
        commitments: [
          commitment("c0000000-0000-4000-8000-000000000001", {}),
          commitment("c0000000-0000-4000-8000-000000000002", {
            status: "STATED",
            next: null,
          }),
        ],
        sums: [{ roundId: SEED, currencyCode: "USD", received: "200000", confirmed: "0", pledged: "200000" }],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/network/commitments/mine",
      headers: { authorization: "Bearer test" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ commitments: { id: string; round?: Record<string, unknown> }[] }>();
    expect(investorRoundsAsked).toEqual([[SEED]]);
    expect(body.commitments[0]?.round).toEqual({
      id: SEED,
      name: "Seed",
      instrument: "SAFE",
      status: "FIRST_CLOSED",
      valuation: null,
      valuationCap: "8000000",
      discountPercent: "20",
      proRataRights: "MAJOR_INVESTORS",
      ownershipEstimate: { basisPoints: 250, from: "CAP" },
    });
    expect(body.commitments[1]?.round).toBeUndefined();
    // Never the round's target or what it raised overall.
    expect(JSON.stringify(body.commitments[0]?.round)).not.toContain("target");
  });
});
