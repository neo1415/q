#!/usr/bin/env node
/**
 * Enrich the original fictional-world companies (apps/q-api/src/dev/
 * fictional-world) to the bulk standard, through the same product writers
 * as the bulk seeder (seed.mjs), under each fictional person's own session:
 *
 * - a team of at least two: the co-founders their own story names (a
 *   generic operations lead only when it names nobody), each a fictional
 *   account that asks to join and is let in by the founder;
 * - three data room documents written from the company's seeded story and
 *   claims (overview, financial summary marked as the founder's claim, and
 *   product brief), filed in the data room;
 * - the pitch deck through the product's deck composer and renderer (no
 *   model), uploaded as the company's pitch deck and filed publicly;
 * - Q preferences (Daily off for invented people).
 *
 * Only companies whose legal name is marked "(fictional)" are touched. Real
 * companies seeded from public research are never given invented material.
 *
 *   /root/sb node scripts/seed/fictional-bulk/enrich.mjs --hosted [--only ledgerfold,tarmacly]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as lib from "../tavus20/lib.mjs";
import { renderDeck } from "./deck.mjs";
import {
  api,
  assertSyntheticTarget,
  ensureAccount,
  ensureProfile,
  fileInDataRoom,
  idem,
  qapi,
  uploadBytes,
} from "./seed.mjs";

const args = process.argv.slice(2);
const only = args.includes("--only")
  ? args[args.indexOf("--only") + 1].split(",")
  : null;
const MARKER = "fictional-world-enrich.v1";
const STATE_FILE = join(lib.ROOT, "docs/seed/fictional-bulk/enrich-state.json");
const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : { marker: MARKER, companies: {} };
const save = () =>
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

const { FICTIONAL_COMPANIES } = await import(
  join(lib.ROOT, "apps/q-api/dist/dev/fictional-world/companies.js")
);
const slug = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const bare = (name) => name.replace(/^(Dr|Prof)\.?\s+/u, "");
const fmt = (n) => Number(n).toLocaleString("en-US");

/** Co-founders and leads the company's own story names, beside the founder. */
export function teamFromStory(c) {
  const re = /([A-Z][\p{L}’'-]+(?: [A-Z][\p{L}’'-]+)+) \(([^,)]+)/gu;
  const people = [...c.story.team.matchAll(re)]
    .map((m) => ({ name: m[1], role: m[2].trim() }))
    .filter((p) => bare(p.name) !== bare(c.founder.displayName));
  if (people.length > 0) {
    return people.slice(0, 2).map((p) => ({
      displayName: p.name,
      businessTitle: /^(CEO|CTO|COO|CFO|CPO)$/u.test(p.role)
        ? `Co-founder and ${p.role}`
        : p.role,
      isFounder: /^(CEO|CTO|COO|CFO|CPO)$/u.test(p.role),
      appRole: "ADMIN",
    }));
  }
  // The story names nobody else: an operations lead, plainly a demo role.
  const h = createHash("sha256").update(c.key).digest();
  const first = ["Amara", "Kofi", "Zainab", "Tendai", "Nadia", "Femi"][
    h[0] % 6
  ];
  const last = ["Okoro", "Mensah", "Banda", "Haddad", "Mwangi", "Adeyemi"][
    h[1] % 6
  ];
  return [
    {
      displayName: `${first} ${last}`,
      businessTitle: "Head of Operations",
      isFounder: false,
      appRole: "MEMBER",
    },
  ];
}

const head = (c) => [
  `FICTIONAL DEMO DOCUMENT. ${c.name} and every person and figure below are invented for Capital Q demonstrations.`,
  `Prepared by: ${bare(c.founder.displayName)}, ${c.founder.businessTitle} (fictional). Source: the company's own records, self-reported and not audited. Prepared 2026-10-15.`,
  "",
];

/** The three documents, written only from what the seed file already says. */
export function documentsFor(c) {
  const s = c.story;
  const financial = c.claims.filter((x) =>
    ["financial", "traction", "customers", "market"].includes(x.claimType),
  );
  return [
    {
      kind: "COMPANY_PROFILE",
      title: `${c.name} company overview (fictional)`,
      filename: `${c.key}-overview.txt`,
      mime: "text/plain",
      text: [
        ...head(c),
        `${c.name} — company overview`,
        `Founded ${c.foundedDate} in ${c.city}.`,
        `Problem: ${s.problem}`,
        `Solution: ${s.solution}`,
        `Traction: ${s.traction}`,
        `Team: ${s.team}`,
        `Market: ${s.market}`,
        `Competition: ${s.competition}`,
        `Risks: ${s.risks}`,
        `The raise: ${s.raise}`,
        `Not yet known: ${s.unknowns.join("; ")}.`,
      ].join("\n"),
    },
    {
      kind: "FINANCIAL",
      title: `${c.name} financial summary, founder claim (fictional)`,
      filename: `${c.key}-financial-summary.txt`,
      mime: "text/plain",
      text: [
        ...head(c),
        `${c.name} — financial summary (the founder's own claims; not audited)`,
        `Raise: ${c.raise.target.currency} ${fmt(c.raise.target.amount)} (${c.raise.instrument}, ${c.raise.timeframe}).`,
        ...financial.map(
          (x) =>
            `- ${x.statement} [truth_class ${x.truthClass}; evidence ${x.evidenceStatus}${x.lifecycleStatus === "CONTRADICTORY" ? "; CONTRADICTORY with another figure, not reconciled" : ""}${x.documentTitle ? `; per ${x.documentTitle}` : ""}]`,
        ),
        `Not yet known: ${s.unknowns.join("; ")}.`,
        "Audited accounts: not available (unknown).",
      ].join("\n"),
    },
    {
      kind: "PRODUCT",
      title: `${c.name} product brief (fictional)`,
      filename: `${c.key}-product-brief.txt`,
      mime: "text/plain",
      text: [
        ...head(c),
        `${c.name} — product brief`,
        c.shortDescription,
        `How it works: ${s.solution}`,
        ...c.deck
          .filter((l) =>
            ["PRODUCT", "BUSINESS_MODEL", "CUSTOMERS"].includes(l.dimension),
          )
          .map((l) => `- ${l.statement}`),
        `Competition: ${s.competition}`,
      ].join("\n"),
    },
  ];
}

async function enrich(c) {
  const s = (state.companies[c.key] ??= { name: c.name, steps: {} });
  const done = (step, extra = {}) => {
    Object.assign(s, extra);
    s.steps[step] = true;
    save();
  };
  const f = `founder.${c.key}@${"fictional.capitalq.local"}`;
  const rows = await lib.sql(
    `select c.id, c.organisation_id, c.legal_name from core.companies c join identity.organisation_memberships m on m.organisation_id = c.organisation_id join identity.user_profiles p on p.id = m.user_id join auth.users u on u.id = p.auth_user_id where lower(u.email) = lower('${f}') and u.raw_app_meta_data->>'fictional_demo' = 'true'`,
  );
  const row = rows[0];
  if (!row || !String(row.legal_name ?? "").endsWith("(fictional)"))
    throw new Error(`${c.name}: not a marked fictional company; refusing`);
  const companyId = row.id;
  const base = `/v1/companies/${companyId}`;

  if (!s.steps.team) {
    const team = await api(f, "GET", "/v1/team");
    const orgId = team.organisation.organisationId;
    const members = teamFromStory(c).map((m) => ({
      ...m,
      email: `member.${c.key}.${slug(bare(m.displayName))}@fictional.capitalq.local`,
      headline: `${m.businessTitle}, ${c.name} (fictional demo team member)`,
    }));
    for (const m of members) {
      const id = await lib.sql(
        `select id, raw_app_meta_data->>'fictional_demo' fd from auth.users where lower(email) = lower('${m.email}')`,
      );
      if (id[0] && id[0].fd !== "true")
        throw new Error(`${m.email} exists and is not fictional`);
      if (!id[0])
        await ensureAccount(
          { ...m, email: m.email },
          `${MARKER}:${c.key}`,
          MARKER,
        );
      if (
        team.members.some(
          (x) => x.email?.toLowerCase() === m.email.toLowerCase(),
        )
      )
        continue;
      await ensureProfile(m.email, m);
      if (
        !team.joinRequests.some(
          (j) => j.email?.toLowerCase() === m.email.toLowerCase(),
        )
      ) {
        await api(
          m.email,
          "POST",
          "/v1/join-requests",
          {
            organisationId: orgId,
            message: `${m.displayName}, ${m.businessTitle}.`,
          },
          idem(MARKER, c.key, "join", m.email),
        );
      }
    }
    for (const j of (await api(f, "GET", "/v1/team")).joinRequests) {
      if (members.some((m) => m.email.toLowerCase() === j.email?.toLowerCase()))
        await api(f, "POST", `/v1/team/join-requests/${j.requestId}/decision`, {
          approve: true,
        });
    }
    const final = await api(f, "GET", "/v1/team");
    for (const m of members) {
      const r = final.members.find(
        (x) => x.email?.toLowerCase() === m.email.toLowerCase(),
      );
      if (!r) throw new Error(`${m.email} is not on the team after approval`);
      if (m.appRole === "ADMIN" && r.role !== "ADMIN")
        await api(f, "PUT", `/v1/team/members/${r.membershipId}/role`, {
          role: "ADMIN",
        });
      await api(m.email, "POST", `/v1/organisations/${orgId}/activate`, {});
      await api(m.email, "PUT", `${base}/team/me`, {
        relationshipType: "team_member",
        businessTitle: m.businessTitle,
        isFounder: m.isFounder,
      });
      await qapi(m.email, "PUT", "/v1/q/daily/preferences", {
        frequency: "OFF",
        email: false,
      });
    }
    done("team");
  }
  if (!s.steps.documents) {
    s.documentIds ??= {};
    for (const d of documentsFor(c)) {
      if (!s.documentIds[d.filename])
        s.documentIds[d.filename] = await uploadBytes(
          f,
          companyId,
          `${MARKER}:${c.key}`,
          d,
          Buffer.from(d.text, "utf8"),
        );
      await fileInDataRoom(f, s.documentIds[d.filename], d.kind);
    }
    done("documents");
  }
  if (!s.steps.deck) {
    if (!s.documentIds.deck) {
      const deck = await renderDeck({
        key: `fw-${c.key}`,
        companyId,
        name: c.name,
        shortDescription: c.shortDescription,
        lines: c.deck,
      });
      if (deck === null)
        throw new Error("the deck composer had too little to compose");
      s.documentIds.deck = await uploadBytes(
        f,
        companyId,
        `${MARKER}:${c.key}`,
        {
          kind: "PITCH_DECK",
          title: `${c.name} investor deck (fictional)`,
          filename: `${c.key}-deck.pdf`,
          mime: "application/pdf",
        },
        Buffer.from(deck.pdf),
      );
    }
    await fileInDataRoom(f, s.documentIds.deck, "PITCH_DECK");
    done("deck");
  }
  if (!s.steps.q) {
    await qapi(f, "PUT", "/v1/q/daily/preferences", {
      frequency: "OFF",
      email: false,
    });
    const g = await api(f, "GET", "/v1/me/etiquette-guide");
    if (g.guide == null)
      await api(f, "PUT", "/v1/me/etiquette-guide", {
        sourceKind: "PASTE",
        text: `How Q writes and speaks for ${bare(c.founder.displayName)} of ${c.name} (fictional demo account).\nTone: plain and brief.\nAlways: state the figure and its source; say what is not known yet.\nNever: send anything to an investor without my approval.`,
      });
    done("q");
  }
}

if (process.argv[1]?.endsWith("enrich.mjs")) {
  await assertSyntheticTarget();
  const list = FICTIONAL_COMPANIES.filter(
    (c) => only === null || only.includes(c.key),
  );
  for (const c of list) {
    try {
      await enrich(c);
      console.log(`enriched ${c.key}`);
    } catch (error) {
      console.log(
        `${c.key}: FAILED ${String(error?.message ?? error)
          .split("\n")[0]
          .slice(0, 300)}`,
      );
    }
  }
}
