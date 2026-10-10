import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import {
  emitLive,
  installLiveFake,
  liveSent,
  livePeers,
  liveUserSays,
} from "../support/live-fake.js";
import { openQ } from "../support/q.js";
import { answer, useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";
import {
  READ_QUESTION,
  SKIM_OTHER,
  moves,
  pathOf,
  watchMoves,
} from "../journeys/journey-fixtures.js";
import {
  QATAR_FIVE,
  cards,
  escape,
  externalLinks,
  finding,
  recall,
  remember,
  fakeMark,
  fakeSince,
  identityCard,
  latestQText,
  logMark,
  measure,
  quiet,
  requireQatarStack,
  searchCallsSince,
  sendTimed,
  taskOf,
  toolNamesSince,
  BASELINE_READS,
  skimPerson,
  threadText,
  waitForLog,
  type FakeRequest,
} from "./kit.js";

/**
 * B. The Qatar Five, one by one, as the founder sees them. For EACH entity:
 *
 *   B1 ask by name on Home      -> identity card (kind, name, source links),
 *                                  reported facts in soft words, ZERO search
 *                                  calls, latency from send to card
 *   B2 a Nigerian-English rendering -> the SAME card (same external id), zero search
 *   B3 a follow-up              -> answered with no retrieval
 *   B4 open the researched card -> in focus, its sources
 *   B5 start its rehearsal      -> persona ready before the call, identity
 *                                  panel (logo or monogram, chip), this
 *                                  entity's own opening, no search/tool/model
 *                                  during the scripted call
 *   B6 away and back            -> context and persona continuity
 *
 * The model's reading of the ask (TURN_SKIM -> PERSON_SEARCH) is scripted;
 * the lookup, the card, the answer text, the hot cache, the rehearsal
 * persona and the live line are the product's. A prepared entity must never
 * reach the (scripted, logged) search index. All times are LOCAL+MOCK.
 */
const SOFT =
  /reportedly|according to|publicly (?:reported|documented)|not independently|search-indexed|prepared from public sources/iu;
const STATED_AS_FACT =
  /\b(?:is verified|has been verified|confirmed that|definitely)\b/iu;

/** Instructions each entity's persona line was created with (for the distinctness check). */
const personaLines = new Map<string, string>();
/** Cold persona-ready times by entity, then warm. */
const readyTimes = new Map<string, { cold?: number; warm?: number }>();

let context: BrowserContext;
let home: Page;

test.beforeAll(async ({ browser }) => {
  requireQatarStack();
  context = await contextAs(browser, CAST.founder);
  home = await context.newPage();
  await watchMoves(home);
  await home.goto("/home");
});

test.afterAll(async () => {
  await context?.close();
});

async function liveLinesSince(mark: number): Promise<FakeRequest[]> {
  return (await fakeSince(mark)).filter((r) => r.vendor === "openai-live");
}

for (const entity of QATAR_FIVE) {
  test.describe(`B ${entity.canonical}`, () => {
    let key = recall("keys")[entity.key] ?? "";
    let searchMark = 0;

    test(`B1 ${entity.canonical}: identity card by name, soft words, zero search, fast`, async () => {
      const words = `Who is ${entity.canonical}?`;
      await useScript([
        skimPerson(words, { name: entity.canonical, kind: entity.kind }),
        READ_QUESTION,
      ]);
      await home.goto("/home");
      await quiet(1_500);
      searchMark = await fakeMark();
      const log = logMark();
      const started = await sendTimed(home, words);
      const card = await identityCard(home, entity.nameRe, started);
      key = card.key;
      remember("keys", entity.key, key);
      measure(`B1 ${entity.canonical} send->card`, card.ms);
      expect
        .soft(card.ms, "send->card within the 5 s person-search target")
        .toBeLessThan(5_000);
      expect(key, "the card's key is the external person's id").toMatch(
        /^[0-9a-f-]{36}$/u,
      );

      // What it is: the block names the kind.
      await expect
        .soft(
          home.getByLabel(
            entity.kind === "PERSON" ? "Who I found" : "What I found",
          ),
          "the card set names what was found",
        )
        .toBeVisible();
      // Prepared, not searched: said on the card, and in q-api's own line.
      expect
        .soft(card.text, "card says it was prepared from public sources")
        .toMatch(/Prepared from public sources/u);
      const [line] = await waitForLog(
        log,
        "q answered a person search",
        1,
        30_000,
      );
      expect(line?.["outcome"], "MATCHED").toBe("MATCHED");
      expect(line?.["source"], "answered from the known-entity index").toBe(
        "KNOWN_ENTITY",
      );
      expect(line?.["modelCalls"], "no model wrote it").toBe(0);
      measure(
        `B1 ${entity.canonical} q-api personMs`,
        Number(line?.["personMs"]),
      );
      measure(
        `B1 ${entity.canonical} q-api totalMs`,
        Number(line?.["totalMs"]),
      );
      expect(
        await searchCallsSince(searchMark),
        "ZERO web search calls",
      ).toEqual([]);

      // Reported facts in soft words; never stated as verified fact.
      await expect
        .poll(async () => (await threadText(home)).match(SOFT) !== null, {
          timeout: 20_000,
        })
        .toBe(true);
      expect(await latestQText(home)).not.toMatch(STATED_AS_FACT);

      // Source links: the entity's own public sources.
      const links = await externalLinks(home);
      const own = links.filter((href) =>
        entity.hosts.some((h) =>
          new URL(href).hostname.replace(/^www\./u, "").endsWith(h),
        ),
      );
      if (own.length === 0)
        finding(
          `${entity.canonical}: the card shows a source count but renders no clickable source link (expected one of ${entity.hosts.join(", ")}; page had ${String(links.length)} external links)`,
        );
    });

    test(`B2 ${entity.canonical}: "${entity.rendering}" resolves to the same card, zero search`, async () => {
      test.skip(key === "", "B1 found no card");
      const words = `Who is ${entity.rendering}?`;
      await useScript([
        skimPerson(words, { name: entity.rendering, kind: entity.kind }),
        READ_QUESTION,
      ]);
      await home.goto("/home");
      await quiet(1_500);
      const mark = await fakeMark();
      const log = logMark();
      const started = await sendTimed(home, words);
      const card = await identityCard(home, entity.nameRe, started);
      measure(`B2 ${entity.rendering} send->card`, card.ms);
      expect(card.key, "the same prepared entity, not a new record").toBe(key);
      const [line] = await waitForLog(
        log,
        "q answered a person search",
        1,
        30_000,
      );
      expect(line?.["source"]).toBe("KNOWN_ENTITY");
      expect(line?.["outcome"]).toBe("MATCHED");
      expect(await searchCallsSince(mark)).toEqual([]);
    });

    test(`B3 ${entity.canonical}: a follow-up is answered with no retrieval`, async () => {
      test.skip(key === "", "B1 found no card");
      const words = `and ${entity.followUp}?`;
      const reply = `From what is already on the card: ${entity.canonical}, as publicly reported.`;
      await useScript([
        SKIM_OTHER,
        READ_QUESTION,
        {
          name: `b3-${entity.key}`,
          when: {
            task: "COMPANY_ANALYST",
            user: escape(words),
            afterTool: null,
          },
          reply: answer(reply),
        },
      ]);
      await quiet(1_500);
      const mark = await fakeMark();
      const log = logMark();
      const started = await sendTimed(home, words);
      await expect(home.getByText(reply.slice(0, 40)).first()).toBeVisible({
        timeout: 60_000,
      });
      measure(
        `B3 ${entity.canonical} follow-up send->answer`,
        Date.now() - started,
      );
      await waitForLog(log, "q answer produced", 1, 30_000);
      const names = toolNamesSince(log);
      console.log(
        `B3 ${entity.canonical} tools finished by code: ${names.join(", ")}`,
      );
      expect(
        names.filter((n) => !BASELINE_READS.includes(n)),
        "no retrieval tool beyond the baseline own-standing reads",
      ).toEqual([]);
      const rounds = (await fakeSince(mark)).filter(
        (r) => r.rule === `b3-${entity.key}`,
      );
      expect(rounds).toHaveLength(1);
      expect(rounds[0]?.answeredTools ?? []).toEqual([]);
      expect(
        rounds[0]?.input ?? "",
        "the earlier turn is in the model's context",
      ).toMatch(entity.nameRe);
      expect(await searchCallsSince(mark), "no retrieval").toEqual([]);
    });

    test(`B4 ${entity.canonical}: open the researched card`, async () => {
      test.skip(key === "", "B1 found no card");
      const words = `Who is ${entity.canonical}?`;
      await useScript([
        skimPerson(words, { name: entity.canonical, kind: entity.kind }),
        READ_QUESTION,
      ]);
      await home.goto("/home");
      await quiet(1_500);
      const mark = await fakeMark();
      const started = await sendTimed(home, words);
      const card = cards(home).filter({ hasText: entity.nameRe }).first();
      await identityCard(home, entity.nameRe, started);
      if ((await card.getAttribute("data-state")) !== "focus")
        await card.locator(".cq-ac-head-main").click();
      await expect(card, "the card is in focus").toHaveAttribute(
        "data-state",
        "focus",
      );
      await expect(card.getByText(/From \d+ sources?/u)).toBeVisible();
      await expect(
        card.getByText(/Prepared from public sources/u).first(),
      ).toBeVisible();
      // The reasons carry the soft attribution, not a verified claim.
      expect(await card.innerText()).toMatch(SOFT);
      expect(
        await searchCallsSince(mark),
        "opening the card is not a search",
      ).toEqual([]);
    });

    test(`B5 ${entity.canonical}: its rehearsal is prepared before the call, labelled, and uses no tools`, async () => {
      test.skip(key === "", "B1 found no card");
      const path = `/rehearsals/person/${key}`;

      // Through Q: "rehearse with <name>" -> VERIFIED navigation to the lobby.
      const say = `Rehearse with ${entity.canonical}`;
      await useScript([
        SKIM_OTHER,
        READ_QUESTION,
        {
          name: `b5-open-${entity.key}`,
          when: { task: "COMPANY_ANALYST", user: escape(say), afterTool: null },
          reply: {
            toolCalls: [
              {
                name: "open_page",
                arguments: { page: "EXTERNAL_REHEARSAL", id: key },
              },
            ],
          },
        },
        {
          name: `b5-after-${entity.key}`,
          when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
          reply: answer(`Opening your rehearsal with ${entity.canonical}…`),
        },
      ]);
      await home.goto("/home");
      await quiet(1_500);
      const first = await fakeMark();
      const started = await sendTimed(home, say);
      await expect(home).toHaveURL(new RegExp(`${escape(path)}$`, "u"), {
        timeout: 60_000,
      });
      await expect
        .poll(
          async () =>
            (await moves(home)).outcomes
              .filter((o) => pathOf(o.expected) === path)
              .map((o) => o.status),
          { timeout: 30_000 },
        )
        .toEqual(["DONE"]);
      const ready = home.getByRole("heading", {
        level: 1,
        name: /Ready to rehearse with/u,
      });
      await expect(ready).toBeVisible({ timeout: 60_000 });
      const cold = Date.now() - started;
      measure(
        `B5 ${entity.canonical} ask->persona ready (cold, through Q)`,
        cold,
      );
      readyTimes.set(entity.key, { cold });

      // A fresh load, the mic fake installed: the persona is warm now.
      await quiet(2_000);
      const mark = await fakeMark();
      const page = await context.newPage();
      await installLiveFake(page);
      await watchMoves(page);
      const t0 = Date.now();
      await page.goto(path);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: /Ready to rehearse with/u,
        }),
      ).toBeVisible({ timeout: 60_000 });
      const warm = Date.now() - t0;
      measure(`B5 ${entity.canonical} load->persona ready (warm)`, warm);
      readyTimes.set(entity.key, { cold, warm });
      void first;

      // The left-side identity panel.
      const panel = page.locator(".cq-stage").first();
      await expect(panel).toContainText(entity.nameRe);
      await expect(
        panel.getByText("Research-informed simulation").first(),
      ).toBeVisible();
      const logo = panel.locator("img");
      if (entity.kind === "PERSON") {
        // No permitted portrait yet: a monogram (initials), never a stock face.
        await expect(logo).toHaveCount(0);
        await expect(
          panel.locator("div[aria-hidden='true']").first(),
        ).toHaveText(/^[A-Z]{1,3}$/u);
      } else {
        const hasLogo = (await logo.count()) > 0;
        if (hasLogo) {
          const loaded = await logo
            .first()
            .evaluate(
              (img) =>
                (img as HTMLImageElement).complete &&
                (img as HTMLImageElement).naturalWidth > 0,
            );
          expect.soft(loaded, "the official logo loads").toBe(true);
        } else {
          // Acceptable: a monogram. Reported either way.
          console.log(`B5 ${entity.canonical}: no logo image, monogram shown`);
        }
      }
      await panel.getByText("Sources and details").click();
      await expect(
        panel.getByText(/not the real|simulation of/iu).first(),
      ).toBeVisible();
      const panelHrefs = await panel
        .locator("a[href^='http']")
        .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect
        .soft(panelHrefs.length, "the panel lists the entity's public sources")
        .toBeGreaterThan(0);

      // Preparing the persona asked no model and no search.
      const prep = await fakeSince(mark);
      expect(
        prep.filter((r) => r.vendor === "search"),
        "no search to prepare",
      ).toEqual([]);
      expect(
        prep.filter((r) => r.path === "/v1/responses" && r.rule === null),
        "no unscripted model round while preparing the persona",
      ).toEqual([]);

      // Join: the scripted call. GPT-Live is mocked at the peer.
      const joinMark = await fakeMark();
      await page.getByRole("button", { name: "Join now" }).click();
      await expect.poll(() => livePeers(page), { timeout: 45_000 }).toBe(1);
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (
                  window as Window & { __cqLiveOpen?: () => boolean }
                ).__cqLiveOpen?.() === true,
            ),
          { timeout: 30_000 },
        )
        .toBe(true);
      await emitLive(page, {
        type: "session.started",
        session: { id: `live_fake_${entity.key}`, model: "gpt-live-1" },
      });
      const afterJoin = await fakeSince(joinMark);
      const opening = afterJoin
        .filter((r) => r.path === "/v1/responses")
        .map(taskOf)
        .filter((t) => t !== "MEMORY_EXTRACTOR");
      if (opening.length > 0)
        finding(
          `${entity.canonical}: Join now ran model rounds before/at the call start: ${opening.join(", ")} (rehearsals.ts opening cue)`,
        );
      const callMark = await fakeMark();
      const lines = await expect
        .poll(async () => (await liveLinesSince(joinMark)).length, {
          timeout: 30_000,
        })
        .toBeGreaterThan(0)
        .then(() => liveLinesSince(joinMark));
      const persona = lines.at(-1)?.instructions ?? "";
      personaLines.set(entity.key, persona);
      remember("personas", entity.key, persona);
      expect(persona, "this entity's own opening theme").toContain(
        JSON.stringify(entity.opening),
      );
      expect(persona, "labelled as a simulation").toMatch(
        /simulation|rehearsal informed by public sources/iu,
      );

      // The founder talks; the model tries to delegate: nothing is fetched.
      await liveUserSays(page, "We build payments software for Gulf retailers");
      await emitLive(page, {
        type: "session.delegation.created",
        delegation: {
          id: `dlg_qa_${entity.key}`,
          type: "delegation",
          target: "client",
        },
      });
      await page.waitForTimeout(4_000);
      const sent = await liveSent(page);
      expect(
        sent.filter(
          (e) =>
            e.type === "session.commentary.append" &&
            (e.content ?? "").includes("Verified by Q's backend"),
        ),
        "the persona line is never given backend facts",
      ).toEqual([]);
      const during = await fakeSince(callMark);
      expect(
        during.filter((r) => r.vendor === "search"),
        "no search during the call",
      ).toEqual([]);
      // Background work of the earlier Q turn (memory extraction) may land
      // here; nothing that answers, reads or navigates may.
      expect(
        during
          .filter((r) => r.path === "/v1/responses")
          .map(taskOf)
          .filter((t) => t !== "MEMORY_EXTRACTOR"),
        "no analyst, reader or tool round during the scripted call",
      ).toEqual([]);
      await page.close();
    });

    test(`B6 ${entity.canonical}: away and back keeps the context and the same persona`, async () => {
      test.skip(key === "", "B1 found no card");
      // The Q thread survives leaving the page: the card is still there.
      await home.goto("/home");
      await openQ(home);
      await expect
        .poll(
          async () => (await threadText(home)).match(entity.nameRe) !== null,
          {
            timeout: 20_000,
          },
        )
        .toBe(true);
      // A pronoun follow-up after returning still carries the entity.
      const words = `remind me, what was that last one about?`;
      await useScript([
        SKIM_OTHER,
        READ_QUESTION,
        {
          name: `b6-${entity.key}`,
          when: {
            task: "COMPANY_ANALYST",
            user: escape(words),
            afterTool: null,
          },
          reply: answer("That was the profile I just showed you."),
        },
      ]);
      await quiet(1_500);
      const mark = await fakeMark();
      await sendTimed(home, words);
      await expect(
        home.getByText("That was the profile I just showed you.").first(),
      ).toBeVisible({
        timeout: 60_000,
      });
      const rounds = (await fakeSince(mark)).filter(
        (r) => r.rule === `b6-${entity.key}`,
      );
      expect(
        rounds[0]?.input ?? "",
        "the entity is still in Q's context",
      ).toMatch(entity.nameRe);
      expect(await searchCallsSince(mark)).toEqual([]);

      // Back to the rehearsal: ready again, and the persona line is the same.
      const callMark = await fakeMark();
      const page = await context.newPage();
      await installLiveFake(page);
      await page.goto("/home");
      await page.goto(`/rehearsals/person/${key}`);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: /Ready to rehearse with/u,
        }),
      ).toBeVisible({ timeout: 60_000 });
      await page.goBack();
      await page.goForward();
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: /Ready to rehearse with/u,
        }),
      ).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "Join now" }).click();
      await expect.poll(() => livePeers(page), { timeout: 45_000 }).toBe(1);
      await expect
        .poll(async () => (await liveLinesSince(callMark)).length, {
          timeout: 30_000,
        })
        .toBeGreaterThan(0);
      const again = (await liveLinesSince(callMark)).at(-1)?.instructions ?? "";
      expect(again, "the same opening after leaving and coming back").toContain(
        JSON.stringify(entity.opening),
      );
      expect(await livePeers(page), "one voice line, not two").toBe(1);
      await page.close();
    });
  });
}

test("B7 the five rehearsals are different conversations, not one template with a name", () => {
  const stored = recall("personas");
  const entries = Object.entries(stored);
  expect(entries.length, "all five personas were captured").toBe(
    QATAR_FIVE.length,
  );
  for (const entity of QATAR_FIVE) {
    const mine = stored[entity.key] ?? "";
    expect(mine, `${entity.canonical} opens on its own theme`).toContain(
      JSON.stringify(entity.opening),
    );
    for (const other of QATAR_FIVE.filter((o) => o.key !== entity.key)) {
      expect(
        mine,
        `${entity.canonical}'s call does not open on ${other.canonical}'s theme`,
      ).not.toContain(JSON.stringify(other.opening));
    }
  }
  const times = [...readyTimes.entries()].map(
    ([k, v]) => `${k}: cold=${String(v.cold)}ms warm=${String(v.warm)}ms`,
  );
  console.log(`B persona-ready[LOCAL+MOCK] ${times.join("; ")}`);
});
