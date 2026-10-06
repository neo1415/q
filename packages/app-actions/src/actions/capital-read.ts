import { CompanyIdSchema } from "@capital-q/companies";
import type { LedgerSum } from "@capital-q/network";
import type { ActorContext } from "@capital-q/security";

import type { AppActionPorts } from "../ports.js";
import type { OwnReadItem } from "../reads.js";
import { moneyText } from "./commitments.js";

/**
 * read_my("capital") (2026-10-04): what the Capital page shows, through the
 * page's own services and authorization. A founder reads their rounds
 * (target, raised, confirmed, pledged -- raised is RECEIVED money only),
 * the all-time total, and each commitment's step; an investor reads their
 * own commitments and what they have invested. Sums stay exact strings.
 */

const STATUS_WORDS = {
  DETECTED: "Q heard it in a call; the amount needs confirming",
  STATED: "confirmed by one side, waiting for the other",
  CONFIRMED: "confirmed by both sides, not sent yet",
  TRANSFER_SENT: "marked sent, waiting for receipt",
  RECEIVED: "received",
} as const;

const NEXT_WORDS = {
  CONFIRM_AMOUNT: "confirm the amount",
  MARK_SENT: "mark it sent",
  CONFIRM_RECEIVED: "confirm it was received",
} as const;

function totalsByCurrency(
  sums: readonly LedgerSum[],
): Map<string, { raised: bigint; confirmed: bigint; pledged: bigint }> {
  // Integer minor units (two decimals at most), so the sum stays exact.
  const minor = (value: string) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  };
  const out = new Map<
    string,
    { raised: bigint; confirmed: bigint; pledged: bigint }
  >();
  for (const sum of sums) {
    const at = out.get(sum.currencyCode) ?? {
      raised: 0n,
      confirmed: 0n,
      pledged: 0n,
    };
    at.raised += minor(sum.received);
    at.confirmed += minor(sum.confirmed);
    at.pledged += minor(sum.pledged);
    out.set(sum.currencyCode, at);
  }
  return out;
}

const fromMinor = (value: bigint) => {
  const whole = value / 100n;
  const cents = value % 100n;
  return cents === 0n
    ? whole.toString()
    : `${whole.toString()}.${cents.toString().padStart(2, "0")}`;
};

export async function capitalItems(
  ports: AppActionPorts,
  actor: ActorContext,
): Promise<readonly OwnReadItem[] | null> {
  if (ports.commitments === undefined || ports.ownCompanyId === undefined) {
    return null;
  }
  const own = await ports.ownCompanyId(actor).catch(() => null);
  const companyId = own === null ? null : CompanyIdSchema.parse(own);
  const ledger =
    companyId === null
      ? await ports.commitments.ledger({ actor, side: "INVESTOR" })
      : await ports.commitments.ledger({ actor, side: "COMPANY", companyId });
  const rounds =
    companyId === null || ports.capitalRounds === undefined
      ? []
      : await ports.capitalRounds
          .listRounds({ actor, companyId })
          .catch(() => []);
  const items: OwnReadItem[] = [];
  for (const round of rounds) {
    const sum = ledger.sums.find(
      (item) =>
        item.roundId === round.id &&
        item.currencyCode === round.target.currency,
    );
    items.push({
      id: round.id,
      title: `${round.name} round`,
      status: `${round.isCurrent ? "current, " : ""}${round.status.toLowerCase()}`,
      at: round.openedOn,
      facts: {
        target: moneyText(round.target.amount, round.target.currency),
        raised: moneyText(sum?.received ?? "0", round.target.currency),
        confirmed: moneyText(sum?.confirmed ?? "0", round.target.currency),
        pledged: moneyText(sum?.pledged ?? "0", round.target.currency),
        instrument: round.instrument,
        // P8: terms and closes; null is "not said", never zero.
        firstClosedOn: round.firstClosedOn,
        closedOn: round.closedOn,
        cancelledOn: round.cancelledOn,
        targetCloseOn: round.terms.targetCloseOn,
        valuation:
          round.terms.valuation === null
            ? null
            : `${moneyText(round.terms.valuation.amount, round.target.currency)} ${round.terms.valuation.basis === "POST_MONEY" ? "post-money" : "pre-money"}`,
        valuationCap:
          round.terms.valuationCap === null
            ? null
            : moneyText(round.terms.valuationCap, round.target.currency),
        discountPercent: round.terms.discountPercent,
        hardCap:
          round.terms.hardCap === null
            ? null
            : moneyText(round.terms.hardCap, round.target.currency),
        proRataRights: round.terms.proRataRights,
        lead:
          round.terms.lead === null
            ? null
            : round.terms.lead.kind === "NAMED"
              ? round.terms.lead.name
              : "one of your investor relationships",
        extends:
          rounds.find((other) => other.id === round.terms.extendsRoundId)
            ?.name ?? null,
        reportedRaisedOutsideCapitalQ:
          round.terms.reportedRaised === null
            ? null
            : `${moneyText(round.terms.reportedRaised, round.target.currency)} (founder-reported)`,
        closesRecorded: round.closes.length,
        corrections: round.corrections,
      },
    });
  }
  for (const [currency, total] of totalsByCurrency(ledger.sums)) {
    items.push({
      id: `total-${currency}`,
      title:
        companyId === null
          ? `Invested in ${currency}`
          : `Total raised in ${currency}, all rounds`,
      status: "received money only",
      at: null,
      facts: {
        [companyId === null ? "invested" : "raised"]: moneyText(
          fromMinor(total.raised),
          currency,
        ),
        confirmed: moneyText(fromMinor(total.confirmed), currency),
        pledged: moneyText(fromMinor(total.pledged), currency),
      },
    });
  }
  for (const item of ledger.commitments) {
    items.push({
      id: item.id,
      title: `${item.counterpartName}: ${moneyText(item.amount, item.currencyCode)}`,
      status: STATUS_WORDS[item.status],
      at: item.at,
      facts: {
        yourNextStep: item.next === null ? null : NEXT_WORDS[item.next],
        round: rounds.find((round) => round.id === item.roundId)?.name ?? null,
        heardInCall: item.source === "Q_MEETING",
      },
    });
  }
  return items;
}
