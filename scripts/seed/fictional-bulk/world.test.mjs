// node --test scripts/seed/fictional-bulk/world.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACCOUNT_DOMAIN,
  ARCHETYPES,
  buildWorld,
  COUNTRIES,
  countriesOf,
  documentText,
  SEED_MARKER,
  storyText,
} from "./world.mjs";

const HOSTED_CODES = new Set(
  "advertising,b2b_saas,b2c_subscription,freemium,hardware_sales,licensing,marketplace,services,transaction_fee,usage_based,business_customer,consumer,developer,enterprise,financial_institution,government,insurance_company,mid_market,nonprofit,small_business,agriculture,agritech,banking,capital_markets,clean_energy,commerce,cross_border_payments,cybersecurity,data_infrastructure,developer_tools,digital_banking,digital_health,digital_lending,ecommerce,edtech,education,embedded_payments,energy,energy_access,enterprise_software,financial_services,fintech,healthcare,hr_technology,identity_security,insurance,insurtech,logistics,manufacturing,media_entertainment,medical_devices,merchant_payments,mobility,payment_infrastructure,payments,proptech,real_estate,retail_technology,supply_chain,telecommunications,wealthtech,claims_automation,core_banking_platform,data_analytics_platform,developer_api,digital_wallet,embedded_finance,energy_management,fleet_management,fraud_detection,health_records,identity_verification,insurance_distribution,learning_platform,lending_platform,security_platform,telehealth,workflow_automation".split(
    ",",
  ),
);
const HOSTED_GEOS = new Set(
  "africa,asia,benin,botswana,brazil,cameroon,canada,central_africa,cote_divoire,dr_congo,east_africa,egypt,ethiopia,europe,france,germany,ghana,global,india,kenya,latin_america,middle_east,morocco,netherlands,nigeria,north_africa,north_america,rwanda,senegal,singapore,south_africa,southern_africa,tanzania,togo,tunisia,uganda,united_arab_emirates,united_kingdom,united_states,west_africa,zambia".split(
    ",",
  ),
);
const DECIMAL = /^(0|[1-9][0-9]*)$/;

test("deterministic: the same count builds the same world, and a prefix is stable", () => {
  const a = buildWorld({ count: 60 });
  const b = buildWorld({ count: 60 });
  assert.deepEqual(a, b);
  const bigger = buildWorld({ count: 120 });
  assert.deepEqual(bigger.companies.slice(0, 60), a.companies);
});

test("400 complete fictional companies with unique keys, names and accounts", () => {
  const { companies } = buildWorld({ count: 400 });
  assert.equal(companies.length, 400);
  const keys = new Set(companies.map((c) => c.key));
  const names = new Set(companies.map((c) => c.name.toLowerCase()));
  const emails = companies.flatMap((c) => [
    c.founder.email,
    ...c.members.map((m) => m.email),
  ]);
  assert.equal(keys.size, 400);
  assert.equal(names.size, 400);
  assert.equal(new Set(emails).size, emails.length);
  for (const c of companies) {
    assert.ok(c.seedKey.startsWith(SEED_MARKER));
    assert.ok(c.website.endsWith(".example"), c.website);
    assert.ok(c.legalName.endsWith("(fictional)"));
    for (const e of emails.slice(0, 3))
      assert.ok(e.endsWith(`@${ACCOUNT_DOMAIN}`));
    assert.ok(storyText(c).startsWith("Fictional demo company."));
    // Team: the founder plus at least one more person, each with a role.
    assert.ok(c.members.length >= 1);
    for (const m of c.members)
      assert.ok(
        m.businessTitle.length > 0 && ["ADMIN", "MEMBER"].includes(m.appRole),
      );
    assert.ok(c.team.teamSize >= c.team.founderCount);
    // Raise: decimal string plus ISO currency, never a float or zero.
    assert.match(c.raise.target.amount, DECIMAL);
    assert.ok(Number(c.raise.target.amount) > 0);
    assert.match(c.raise.target.currency, /^[A-Z]{3}$/);
    assert.ok(c.raise.useOfFunds.length >= 1);
    assert.ok(["active", "preparing"].includes(c.raise.raising));
    if (c.raise.minCheque !== undefined)
      assert.match(c.raise.minCheque, DECIMAL);
    // Documents with provenance stated in the document itself.
    assert.ok(c.documents.length >= 1);
    for (const d of c.documents) {
      const text = documentText(c, d);
      assert.match(text, /FICTIONAL DEMO DOCUMENT/);
      assert.match(text, /self-reported and not audited/);
    }
    // Founders carry no mandate of any kind.
    assert.equal(c.mandate, undefined);
    for (const code of c.categories) assert.ok(HOSTED_CODES.has(code), code);
    assert.ok(c.q.guide.includes("fictional demo account"));
  }
});

test("unknown stays unknown: absent figures are absent, never zero", () => {
  const { companies } = buildWorld({ count: 400 });
  for (const c of companies) {
    for (const [field, value] of Object.entries(c.fin)) {
      if (field === "currency" || field === "revenueTrend") continue;
      assert.match(String(value), /^-?[0-9]+$/);
      if (field !== "grossMargin")
        assert.ok(Number(value) > 0, `${c.key} ${field}=${value}`);
    }
    if (c.fin.cash === undefined)
      assert.ok(c.story.unknowns.includes("Cash position and runway"));
  }
  const thin = companies.filter((c) => c.evidence === "thin");
  assert.ok(
    thin.filter((c) => c.fin.monthlyBurn === undefined).length >
      thin.length / 2,
  );
});

test("varied: sectors, stages, countries, currencies, evidence and figures are spread", () => {
  const { companies } = buildWorld({ count: 400 });
  const distinct = (f) => new Set(companies.map(f)).size;
  assert.ok(distinct((c) => c.archetype) >= ARCHETYPES.length - 2);
  assert.ok(distinct((c) => c.stageOption) >= 5);
  assert.ok(
    distinct((c) => c.countryOption) >= Object.keys(COUNTRIES).length - 2,
  );
  assert.ok(distinct((c) => c.raise.target.currency) >= 6);
  assert.equal(
    distinct((c) => c.evidence),
    3,
  );
  // No suspiciously uniform figures: most raise amounts are distinct.
  assert.ok(distinct((c) => c.raise.target.amount) > 220);
  const share = (p) => companies.filter(p).length / companies.length;
  assert.ok(share((c) => c.countryOption === "ng") < 0.3);
  const hard = companies.filter(
    (c) =>
      ["USD", "EUR", "GBP"].includes(c.raise.target.currency) &&
      Number(c.raise.target.amount) >= 1_000_000,
  );
  assert.ok(
    hard.filter((c) => Number(c.raise.target.amount) % 1_000_000 === 0).length /
      hard.length <
      0.5,
  );
});

test("investors: coherent mandates, logins and GateQ derived from the mandate", () => {
  const { investors } = buildWorld({ count: 1 });
  assert.ok(investors.length >= 10 && investors.length <= 15);
  const order = ["pre_seed", "seed", "series_a", "series_b", "series_c_plus"];
  for (const inv of investors) {
    assert.ok(inv.name.endsWith("(fictional)"));
    assert.ok(inv.logins.length >= 2);
    const [min, typical, max] = inv.cheque.map(Number);
    assert.ok(min > 0 && min <= typical && typical <= max, inv.key);
    for (const s of inv.stages) assert.ok(order.includes(s));
    for (const g of inv.geographies) assert.ok(HOSTED_GEOS.has(g), g);
    for (const s of [
      ...inv.sectors,
      ...inv.sectorExclusions,
      ...inv.avoidSectors,
    ])
      assert.ok(HOSTED_CODES.has(s), s);
    // An excluded sector is never also a focus sector.
    for (const s of inv.sectorExclusions) assert.ok(!inv.sectors.includes(s));
    // Revenue appetite follows stage: a later-stage-only fund requires revenue.
    if (!inv.stages.includes("pre_seed") && !inv.stages.includes("seed"))
      assert.equal(inv.revenue, "revenue_required");
    const stage = inv.gateq.find((c) => c.config.type === "STAGE");
    assert.deepEqual(stage.config.allowedStageCodes, inv.stages);
    const geo = inv.gateq.find((c) => c.config.type === "GEOGRAPHY");
    assert.deepEqual(geo.config.allowedCountries, countriesOf(inv.geographies));
    const cheque = inv.gateq.find(
      (c) => c.config.type === "CHEQUE_COMPATIBILITY",
    );
    assert.equal(cheque.config.minCheque, inv.cheque[0]);
    assert.equal(cheque.config.maxCheque, inv.cheque[2]);
    assert.deepEqual(
      inv.gateq.map((c) => c.position),
      inv.gateq.map((_, i) => i + 1),
    );
  }
});
