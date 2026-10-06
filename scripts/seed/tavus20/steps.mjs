/* global console */
// One company, end to end, as its founder and team would do it in the
// browser. Every step records ids (never secrets) in seed-state.json and is
// skipped when already done, so a rerun never duplicates anything.
//
// API calls are used only where the web app has no control for the job;
// each one is listed in SEED-FINDINGS.md (F4, F5, F8, F9/F10, F11).
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as lib from "./lib.mjs";
import * as plan from "./plan.mjs";
import * as ui from "./ui.mjs";

const TAXONOMY = JSON.parse(
  readFileSync(join(lib.ROOT, "scripts/seed/tavus20/taxonomy-names.json"), "utf8"),
);
const STAGE_DIR =
  "/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad/stage";
const SIGNAL = {
  5: "Signed partnerships or distribution deals",
  11: "Signed letters of intent",
  19: "Signed partnerships or distribution deals",
};
const PERSONALITY = { WARM: "Warm", WITTY: "Witty", DIRECT: "Sharp", FORMAL: "Calm", AUTO: "Auto" };

const nn = (c) => String(c.n).padStart(2, "0");
const log = (c, ...a) => console.log(`[${nn(c)} ${c.company}]`, ...a);

export function stateOf(c) {
  const all = lib.loadState();
  all.companies[nn(c)] ??= { company: c.company };
  return { all, s: all.companies[nn(c)] };
}
function mark(c, patch) {
  const { all, s } = stateOf(c);
  Object.assign(s, patch);
  lib.saveState(all);
  return s;
}
function done(c, key) {
  const { all, s } = stateOf(c);
  s.done ??= {};
  s.done[key] = true;
  lib.saveState(all);
}
const isDone = (c, key) => stateOf(c).s.done?.[key] === true;

/** Sign in through the web's own magic-link callback (no email is sent). */
export async function login(page, email, next = "/home") {
  const hash = await lib.magicTokenHash(email);
  await page.goto(
    `${lib.WEB}/auth/callback?token_hash=${hash}&type=magiclink&next=${encodeURIComponent(next)}`,
    { waitUntil: "domcontentloaded", timeout: 60000 },
  );
  await page.waitForTimeout(5000);
}

const h1 = async (page) =>
  (await page.locator("main h1").first().innerText({ timeout: 20000 }).catch(() => "")).trim();

async function clickContinue(page) {
  const b = page.getByRole("button", { name: "Continue", exact: true });
  if (await b.isVisible().catch(() => false)) await b.click();
  await page.waitForTimeout(7000);
}

// ------------------------------------------------------------- onboarding

async function onboardingForm(page, c) {
  const deckDone = { v: false };
  for (let i = 0; i < 30; i += 1) {
    if (page.url().includes("/verification") || page.url().includes("/home")) return;
    const form = page.getByRole("button", { name: "Use the form" });
    if (await form.isVisible().catch(() => false)) {
      await form.click();
      await page.waitForTimeout(3000);
    }
    const head = await h1(page);
    log(c, "onboarding:", head || page.url());
    if (/^Your company$/.test(head)) {
      await page.getByRole("textbox", { name: "Company name" }).fill(c.company);
      await page.getByRole("textbox", { name: "Website" }).fill(c.websiteUrl);
      const country = plan.COUNTRY_LABEL[c.headquarters.country] ?? "Somewhere else";
      await page.getByRole("combobox", { name: /based/ }).selectOption({ label: country });
      await clickContinue(page);
    } else if (/What stage/.test(head)) {
      await page.getByRole("radio", { name: plan.STAGE_LABEL[c.currentStageCode], exact: true }).check();
      await clickContinue(page);
    } else if (/what does the company do/.test(head)) {
      await page.getByRole("textbox").first().fill(c.shortDescription);
      await clickContinue(page);
    } else if (/categorise/.test(head)) {
      const wanted = new Set(
        Object.values(c.tags).flat().map((code) => TAXONOMY[code]).filter(Boolean),
      );
      await page.waitForTimeout(2500);
      const chips = await page.getByRole("list", { name: "Suggested categories" }).getByRole("button").all();
      let picked = 0;
      for (const chip of chips) {
        const name = ((await chip.getAttribute("aria-label")) ?? (await chip.innerText())).split(",")[0].trim();
        if (wanted.has(name)) {
          await chip.click();
          picked += 1;
        }
      }
      log(c, `categories: picked ${picked} of ${chips.length} suggestions`);
      if (picked > 0) await clickContinue(page);
      else {
        await page.getByRole("button", { name: "Skip for now" }).click();
        await page.waitForTimeout(7000);
      }
    } else if (/What do you already have/.test(head)) {
      const deck = join(lib.assetDir(c), "deck.pdf");
      if (!deckDone.v && existsSync(deck)) {
        const staged = stageFile(c, deck, `${c.company} deck.pdf`);
        await page.getByRole("combobox", { name: "What is this?" }).selectOption({ label: "Pitch deck" });
        await page.locator("main input[type=file]").first().setInputFiles(staged);
        deckDone.v = true;
        await page.waitForTimeout(15000);
        mark(c, { deckViaOnboarding: true });
        const cont = page.getByRole("button", { name: "Continue", exact: true });
        if (await cont.isVisible().catch(() => false)) {
          await cont.click();
          await page.waitForTimeout(8000);
        }
      } else {
        await page.getByRole("button", { name: /Skip/ }).first().click();
        await page.waitForTimeout(7000);
      }
    } else if (/what I understood/.test(head)) {
      await page.getByRole("button", { name: "Looks right" }).click();
      await page.waitForTimeout(9000);
    } else if (/founding team/.test(head)) {
      const role = /CTO/.test(c.founderPerson.role) ? "CTO" : /COO/.test(c.founderPerson.role) ? "COO" : "CEO";
      await page.getByRole("radio", { name: role, exact: true }).check();
      const founders = plan.founderCount(c);
      await page.getByRole("textbox", { name: "How many founders?" }).fill(String(founders));
      await page.getByRole("radio", { name: "All founders are full-time" }).check();
      await page.getByRole("textbox", { name: /How many people/ }).fill(String(c.headcount));
      for (const n of plan.strengthsOf(c)) {
        await page.getByRole("checkbox", { name: n, exact: true }).check().catch(() => {});
      }
      mark(c, { founderCount: founders });
      await clickContinue(page);
    } else if (/Business and traction/.test(head)) {
      await page.getByRole("radio", { name: SIGNAL[c.n] ?? "Paying customers" }).check();
      await page.waitForTimeout(800);
      await clickContinue(page);
    } else if (/raising now/.test(head)) {
      await page.getByRole("radio", { name: "Yes, actively" }).check();
      await page.waitForTimeout(1200);
      const cur = c.capital.targetRaise.currency;
      await page.getByRole("combobox", { name: "Currency" }).selectOption({ label: cur }).catch(() => {});
      await page.getByRole("textbox", { name: "Target amount" }).fill(String(c.capital.targetRaise.amount));
      await page.getByRole("radio", { name: plan.instrumentOf(c.capital.instrument).onboarding, exact: true }).check();
      await page.getByRole("radio", { name: plan.closeWindow(c.capital.targetCloseDate) }).check();
      for (const n of plan.useOfFundsBoxes(c)) await page.getByRole("checkbox", { name: n }).check();
      await clickContinue(page);
    } else if (/few things I still need/.test(head)) {
      const box = page.getByRole("textbox", { name: "A few things I still need" });
      const names = Object.values(c.tags).flat().map((code) => TAXONOMY[code]).filter(Boolean);
      await box.fill(`Categories: ${names.join(", ")}.`);
      await clickContinue(page);
    } else if (/what we have so far/.test(head)) {
      await page.waitForTimeout(5000);
      const home = page.getByRole("button", { name: "Go to Home" });
      if (await home.isVisible().catch(() => false)) {
        await home.click();
        await page.waitForTimeout(8000);
      }
      return;
    } else {
      throw new Error(`onboarding: unknown step "${head}" at ${page.url()}`);
    }
  }
  throw new Error("onboarding did not finish in 30 steps");
}

function stageFile(c, src, name) {
  const dir = join(STAGE_DIR, nn(c));
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, name.replace(/[/\\]/g, "-"));
  copyFileSync(src, dest);
  return dest;
}

export async function stepOnboarding(page, c) {
  const email = lib.emailFor(c.founderPerson.name, c.company);
  const acct = await lib.ensureAccount({
    email,
    displayName: c.founderPerson.name,
    seedKey: `tavus20:${nn(c)}:founder`,
  });
  mark(c, { founderUserId: acct.id });
  if (isDone(c, "onboarding")) return;
  await login(page, email, "/home");
  if (page.url().includes("/welcome")) await ui.welcomeAsFounder(page);
  if (!page.url().includes("/onboarding")) {
    await page.goto(`${lib.WEB}/onboarding/founder`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
  }
  await onboardingForm(page, c);
  const token = await lib.accessToken(email);
  const sess = await lib.call(lib.API, token, "GET", "/v1/onboarding/sessions/current?journeyType=founder");
  const subject = sess.body?.session?.subject;
  if (sess.body?.session?.status !== "COMPLETED" || subject?.type !== "COMPANY")
    throw new Error(`onboarding not completed (${sess.body?.session?.status})`);
  const org = await lib.sql(`select organisation_id from core.companies where id='${subject.id}'`);
  mark(c, { companyId: subject.id, organisationId: org[0]?.organisation_id });
  done(c, "onboarding");
  log(c, "onboarding complete", subject.id);
}

// ---------------------------------------------------------------- profile

export async function stepProfile(page, c) {
  if (isDone(c, "profile")) return;
  const { s } = stateOf(c);
  const email = lib.emailFor(c.founderPerson.name, c.company);
  await login(page, email, "/profile");
  await page.goto(`${lib.WEB}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const out = [];
  out.push(await ui.setField(page, "About", "In one line", c.shortDescription));
  out.push(await ui.setField(page, "About", "Description", c.primaryDescription));
  await ui.closeRegion(page, "About");
  // F3: reload between sections (the stale-version bug, fixed on the branch).
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  out.push(await ui.setField(page, "Company", "City", c.headquarters.city));
  out.push(await ui.setField(page, "Company", "Legal name", c.legalName));
  {
    const r = await ui.openRegion(page, "Company");
    const opener = r.getByRole("button", { name: /^(Add|Edit) founded$/ });
    if (await opener.isVisible().catch(() => false)) {
      await opener.click();
      await page.waitForTimeout(600);
      await r.getByRole("textbox", { name: "Founded" }).fill(c.foundedDate);
      await r.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForTimeout(2500);
      out.push("founded");
    }
  }
  await ui.closeRegion(page, "Company");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  // Sector dialog (search works here, unlike onboarding).
  await ui.region(page, "Sector").getByRole("button", { name: "Edit sector" }).click();
  await page.waitForTimeout(1500);
  const names = Object.values(c.tags).flat().map((code) => TAXONOMY[code]).filter(Boolean);
  out.push((await ui.addSectorCategories(page, names)).join(", "));
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(4000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  out.push(await ui.setField(page, "You and your team", "Headline", c.founderPerson.headline));
  await ui.closeRegion(page, "You and your team");
  // Images (crop dialogs).
  const dir = lib.assetDir(c);
  out.push(await ui.uploadImage(page, "Change logo", join(dir, "logo.png")));
  out.push(await ui.uploadImage(page, "Change company cover", join(dir, "cover.png")));
  out.push(await ui.uploadImage(page, "Change cover photo", join(dir, "cover.png")));
  const face = join(dir, "people", `${lib.slugOf(c.founderPerson.name)}.jpg`);
  if (existsSync(face)) out.push(await ui.uploadImage(page, "Change profile photo", face));
  log(c, "profile:", out.join(" | "));
  // F4: no web form for these.
  const token = await lib.accessToken(email);
  const base = `/v1/companies/${s.companyId}`;
  const r1 = await lib.call(lib.API, token, "PUT", `${base}/team/me`, {
    relationshipType: "team_member",
    businessTitle: c.founderPerson.role,
    isFounder: true,
  });
  const fp = await lib.call(lib.API, token, "GET", `${base}/founder-profile/me`);
  const r2 = await lib.call(lib.API, token, "PATCH", `${base}/founder-profile/me`, {
    ...(fp.status === 200 ? { expectedVersion: fp.body.version } : {}),
    professionalSummary: c.founderPerson.professionalSummary.slice(0, 2000),
    backgroundSummary: c.founderPerson.backgroundSummary.slice(0, 2000),
  });
  const tf = await lib.call(lib.API, token, "GET", `${base}/team-facts`);
  const founders = plan.founderCount(c);
  const r3 = await lib.call(lib.API, token, "PATCH", `${base}/team-facts`, {
    ...(tf.status === 200 ? { expectedVersion: tf.body.version } : {}),
    founderCount: founders,
    fullTimeFounderCount: founders,
    teamSize: c.headcount,
  });
  log(c, `api team/me ${r1.status}, founder-profile ${r2.status}, team-facts ${r3.status}`);
  done(c, "profile");
}

// ---------------------------------------------------------------- capital

export async function stepCapital(page, c) {
  if (isDone(c, "capital")) return;
  const { s } = stateOf(c);
  const email = lib.emailFor(c.founderPerson.name, c.company);
  await login(page, email, "/capital");
  await page.goto(`${lib.WEB}/capital`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const open = page.getByRole("button", { name: "Open a round" }).first();
  const none = page.getByRole("heading", { name: "No round open" });
  if (await none.isVisible().catch(() => false)) {
    await open.click();
    await page.waitForTimeout(1500);
    const f = page.getByRole("form", { name: "Open a round" });
    await f.getByRole("textbox", { name: "Name" }).fill(plan.STAGE_LABEL[c.currentStageCode]);
    await f.getByRole("combobox", { name: "Currency" }).selectOption({ label: c.capital.targetRaise.currency }).catch(() => {});
    await f.getByRole("textbox", { name: "Target" }).fill(String(c.capital.targetRaise.amount));
    await f.getByRole("radio", { name: plan.instrumentOf(c.capital.instrument).round, exact: true }).check();
    await f.getByRole("button", { name: "Open now" }).click();
    await page.waitForTimeout(5000);
  }
  // F5: close date and use-of-funds detail have no editor.
  const token = await lib.accessToken(email);
  const cur = await lib.call(lib.API, token, "GET", `/v1/companies/${s.companyId}/capital-objectives/current`);
  if (cur.status === 200) {
    const fmt = (n) => Number(n).toLocaleString("en-US");
    const uof = c.capital.useOfFunds
      .map((u) => `${u.line}: ${u.percent}% (${u.currency} ${fmt(u.amount)})`)
      .join("; ");
    const r = await lib.call(lib.API, token, "PATCH", `/v1/companies/${s.companyId}/capital-objectives/${cur.body.id}`, {
      expectedVersion: cur.body.version,
      targetCloseDate: c.capital.targetCloseDate,
      useOfFundsSummary: uof.slice(0, 2000),
    });
    log(c, "capital objective", r.status);
  } else log(c, "no capital objective", cur.status);
  done(c, "capital");
}

// -------------------------------------------------------------- documents

export async function stepDocuments(page, c) {
  if (isDone(c, "documents")) return;
  const { s } = stateOf(c);
  const email = lib.emailFor(c.founderPerson.name, c.company);
  const token = await lib.accessToken(email);
  const dr0 = (await lib.call(lib.API, token, "GET", `/v1/companies/${s.companyId}/data-room`)).body;
  const have = new Set((dr0.documents ?? []).map((d) => d.title));
  await login(page, email, "/documents");
  await page.goto(`${lib.WEB}/documents`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  // Deck, when onboarding did not take it.
  const deckTitle = `${c.company} ${plan.STAGE_LABEL[c.currentStageCode].toLowerCase()} deck (Oct 2026)`;
  const deckDoc = (dr0.documents ?? []).find((d) => d.kind && /deck/i.test(d.title));
  if (!deckDoc && !have.has(deckTitle)) {
    const staged = stageFile(c, join(lib.assetDir(c), "deck.pdf"), `${deckTitle}.pdf`);
    const [fc] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      page.getByRole("button", { name: "Upload" }).first().click(),
    ]);
    await fc.setFiles(staged);
    await page.waitForTimeout(12000);
  }
  // Data room files, named as the founder would name them.
  const drDir = join(lib.assetDir(c), "dataroom");
  const files = readdirSync(drDir).filter((f) => f.endsWith(".pdf")).sort();
  const todo = [];
  c.dataRoom.forEach((d, i) => {
    const title = d.title.replace(/[/\\]/g, "-");
    if (!have.has(title) && files[i]) todo.push(stageFile(c, join(drDir, files[i]), `${title}.pdf`));
  });
  if (todo.length) {
    await page.goto(`${lib.WEB}/documents`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const [fc] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      page.getByRole("button", { name: "Upload" }).first().click(),
    ]);
    await fc.setFiles(todo);
    await page.waitForTimeout(8000 + todo.length * 2500);
  }
  log(c, `documents: uploaded ${todo.length} data-room files`);
  // Deck: rename (onboarding uploads keep the file name) and make it downloadable.
  await page.goto(`${lib.WEB}/documents`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const deckItem = page.getByRole("listitem").filter({ hasText: "Pitch deck" }).first();
  const deckName = (await deckItem.locator("p").first().innerText().catch(() => "")).trim();
  if (deckName && deckName !== deckTitle) {
    await page.getByRole("button", { name: `Actions for ${deckName}` }).click();
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    const d = page.getByRole("dialog").first();
    await d.getByRole("textbox").first().fill(deckTitle);
    await d.getByRole("button", { name: "Save name" }).click();
    await page.waitForTimeout(3000);
  }
  await page.getByRole("button", { name: `Actions for ${deckTitle}` }).click();
  await page.getByRole("menuitem", { name: "Share…" }).click();
  await page.waitForTimeout(1200);
  {
    const d = page.getByRole("dialog").first();
    await d.getByRole("combobox").selectOption({ label: "Investors who can find us" });
    const save = d.getByRole("button", { name: "Save" });
    if (await save.isEnabled().catch(() => false)) await save.click();
    else await d.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(3000);
  }
  // F9/F10: level radios fail on first filing in production; folders have no UI.
  const dr = (await lib.call(lib.API, token, "GET", `/v1/companies/${s.companyId}/data-room`)).body;
  const results = [];
  for (const d of c.dataRoom) {
    const doc = dr.documents.find((x) => x.title === d.title.replace(/[/\\]/g, "-"));
    if (!doc) {
      results.push(`MISSING ${d.title}`);
      continue;
    }
    const folderCode = plan.FOLDER[d.folder];
    const level = plan.LEVEL[d.visibility];
    if (doc.level === level && doc.folderCode === folderCode) continue;
    const r = await lib.call(lib.API, token, "POST", `/v1/data-room/documents/${doc.documentId}/level`, {
      level,
      folderCode,
      checklistItemCode: plan.checklistItem(folderCode, d.title),
    });
    results.push(`${r.status}`);
  }
  const deck = dr.documents.find((x) => x.title === deckTitle);
  if (deck && deck.level !== "PUBLIC") {
    const r = await lib.call(lib.API, token, "POST", `/v1/data-room/documents/${deck.documentId}/level`, { level: "PUBLIC" });
    results.push(`deck ${r.status}`);
  }
  log(c, "data room levels:", results.join(" "));
  if (results.some((r) => r.startsWith("MISSING"))) throw new Error("data room incomplete");
  done(c, "documents");
}

// ------------------------------------------------------------------ pitch

export async function stepPitch(page, c) {
  if (isDone(c, "pitch")) return;
  const { s } = stateOf(c);
  const video = lib.videoFile(c);
  if (!existsSync(video)) {
    log(c, "pitch: video not available yet");
    return;
  }
  const email = lib.emailFor(c.founderPerson.name, c.company);
  const token = await lib.accessToken(email);
  let pitch = (await lib.call(lib.API, token, "GET", `/v1/companies/${s.companyId}/pitch`)).body?.pitch ?? null;
  await login(page, email, "/pitch");
  if (pitch === null) {
    await page.goto(`${lib.WEB}/pitch/new`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    const [fc] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      page.getByRole("button", { name: "Choose a video" }).click(),
    ]);
    await fc.setFiles(video);
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(10000);
      pitch = (await lib.call(lib.API, token, "GET", `/v1/companies/${s.companyId}/pitch`)).body?.pitch ?? null;
      if (pitch?.status === "READY") break;
      if (pitch && /FAILED|EXPIRED|DELETED/.test(pitch.status)) throw new Error(`pitch ${pitch.status}`);
    }
    if (pitch?.status !== "READY") throw new Error("pitch not ready in time");
  }
  mark(c, { pitchId: pitch.mediaAssetId });
  await page.goto(`${lib.WEB}/pitch/${pitch.mediaAssetId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const R = page.getByRole("region", { name: "Who sees it" });
  const title = `${c.company}: ${plan.STAGE_LABEL[c.currentStageCode].toLowerCase()} pitch with ${c.founderPerson.name}`;
  if (pitch.title !== title || pitch.audience !== "INVESTORS") {
    await R.getByRole("textbox", { name: "Title" }).fill(title);
    await R.getByRole("combobox", { name: "Who can watch it" }).selectOption({ label: "Investors who can find us" });
    await R.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(5000);
  }
  const sw = R.getByRole("switch", { name: "Let investors download my pitch" });
  if ((await sw.getAttribute("aria-checked")) !== "true") {
    await sw.click();
    await page.waitForTimeout(4000);
  }
  const after = (await lib.call(lib.API, token, "GET", `/v1/companies/${s.companyId}/pitch`)).body.pitch;
  log(c, `pitch ${after.status} ${after.playbackPolicy} ${after.audience} downloadable=${after.downloadable}`);
  if (after.audience !== "INVESTORS" || after.downloadable !== true) throw new Error("pitch details not saved");
  done(c, "pitch");
}

// -------------------------------------------------------------- Q settings

export async function stepQ(page, c) {
  if (isDone(c, "q")) return;
  const email = lib.emailFor(c.founderPerson.name, c.company);
  await login(page, email, "/settings");
  await page.goto(`${lib.WEB}/settings#q`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await page
    .getByRole("group", { name: /personality/ })
    .getByRole("button", { name: PERSONALITY[c.qPersonality] ?? "Auto" })
    .click();
  await page.waitForTimeout(2500);
  await quietEmails(page);
  const R = page.getByRole("region", { name: "How Q speaks for you" });
  const write = R.getByRole("button", { name: "Write your guide" });
  if (await write.isVisible().catch(() => false)) {
    await write.click();
    await page.waitForTimeout(1500);
    await R.locator("input[type=file]").first().setInputFiles(join(lib.assetDir(c), "q-guide.md"));
    await page.waitForTimeout(2500);
    await R.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(4000);
  }
  log(c, "Q:", (await R.getByRole("status").allInnerTexts()).filter(Boolean).join(" "));
  done(c, "q");
}

/** Fictional accounts: no digest or reminder emails to the founder's inbox. */
async function quietEmails(page) {
  for (const n of ["Email me each edition", "Email me what needs me if I haven’t seen it in 10 minutes"]) {
    const cb = page.getByRole("checkbox", { name: n });
    if (await cb.isChecked().catch(() => false)) {
      await cb.click();
      await page.waitForTimeout(2000);
    }
  }
}

// ------------------------------------------------------------------- team

export async function stepTeam(page, c) {
  if (isDone(c, "team")) return;
  const { s } = stateOf(c);
  const members = [];
  for (const [i, p] of c.team.entries()) {
    const email = lib.emailFor(p.name, c.company);
    const acct = await lib.ensureAccount({ email, displayName: p.name, seedKey: `tavus20:${nn(c)}:team:${i}` });
    members.push({ ...p, email, userId: acct.id });
  }
  mark(c, { team: members.map((m) => ({ name: m.name, userId: m.userId, role: m.appRole })) });
  const inOrg = new Set(
    (await lib.sql(
      `select u.email from identity.organisation_memberships m join identity.user_profiles p on p.id=m.user_id join auth.users u on u.id=p.auth_user_id where m.organisation_id='${s.organisationId}'`,
    )).map((r) => r.email.toLowerCase()),
  );
  // F8: each member signs in on the web, then asks to join (API).
  for (const m of members) {
    if (inOrg.has(m.email.toLowerCase())) continue;
    await login(page, m.email, "/profile");
    const t = await lib.accessToken(m.email);
    const r = await lib.call(lib.API, t, "POST", "/v1/join-requests", {
      organisationId: s.organisationId,
      message: `${m.name}, ${m.title}.`,
    });
    log(c, `join request ${m.name}: ${r.status}`);
  }
  // The owner lets them in and sets roles on the Team page.
  await login(page, lib.emailFor(c.founderPerson.name, c.company), "/settings/team");
  await page.goto(`${lib.WEB}/settings/team`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  for (let i = 0; i < members.length; i += 1) {
    const b = page.getByRole("button", { name: "Let in" }).first();
    if (!(await b.isVisible().catch(() => false))) break;
    await b.click();
    await page.waitForTimeout(4000);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  for (const m of members.filter((x) => x.appRole === "ADMIN")) {
    const btn = page.getByRole("button", { name: new RegExp(`^Role for .*: Member\\. Change$`) });
    const mine = page.getByRole("listitem").filter({ hasText: m.email }).getByRole("button", { name: /^Role for/ });
    const target = (await mine.count()) ? mine.first() : btn.first();
    if (!/Member/.test((await target.getAttribute("aria-label")) ?? (await target.innerText()))) continue;
    await target.click();
    await page.waitForTimeout(1200);
    const d = page.getByRole("dialog");
    await d.getByRole("radio", { name: /^Admin/ }).check();
    await d.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(4000);
  }
  // Each member: activate the company (F11, API), then name, headline, photo (UI), title (API).
  for (const m of members) {
    const t = await lib.accessToken(m.email);
    await lib.call(lib.API, t, "POST", `/v1/organisations/${s.organisationId}/activate`, {});
    await login(page, m.email, "/profile");
    await page.goto(`${lib.WEB}/profile`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    const out = [];
    out.push(await ui.setField(page, "You and your team", "Name", m.name));
    out.push(await ui.setField(page, "You and your team", "Headline", `${m.title}, ${c.company}`));
    await ui.closeRegion(page, "You and your team");
    const face = join(lib.assetDir(c), "people", `${lib.slugOf(m.name)}.jpg`);
    if (existsSync(face)) out.push(await ui.uploadImage(page, "Change profile photo", face));
    await page.goto(`${lib.WEB}/settings`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await quietEmails(page);
    const r = await lib.call(lib.API, t, "PUT", `/v1/companies/${s.companyId}/team/me`, {
      relationshipType: "team_member",
      businessTitle: m.title,
      isFounder: /co-?founder/i.test(m.title),
    });
    log(c, `member ${m.name}: ${out.join(" | ")} | team/me ${r.status}`);
  }
  done(c, "team");
}

// ------------------------------------------------------------- visibility

export async function stepVisibility(page, c) {
  if (isDone(c, "visible")) return;
  const { s } = stateOf(c);
  const email = lib.emailFor(c.founderPerson.name, c.company);
  await login(page, email, "/company/visibility");
  await page.goto(`${lib.WEB}/company/visibility`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const make = page.getByRole("button", { name: "Make visible to investors" });
  if (await make.isVisible().catch(() => false)) {
    await make.click();
    await page.waitForTimeout(2000);
    const d = page.getByRole("dialog").first();
    if (await d.isVisible().catch(() => false)) {
      await d.getByRole("button", { name: /Make visible|Confirm|Yes/ }).first().click();
    }
    await page.waitForTimeout(6000);
  }
  const check = page.getByRole("button", { name: "Check readiness" });
  if (await check.isVisible().catch(() => false)) {
    await check.click();
    await page.waitForTimeout(8000);
  }
  const row = (await lib.sql(
    `select marketplace_visibility v, marketplace_readiness_state r from core.companies where id='${s.companyId}'`,
  ))[0];
  log(c, "visibility", row.v, row.r);
  mark(c, { visibility: row.v, readiness: row.r });
  if (row.v === "network_visible" && row.r === "marketplace_ready") done(c, "visible");
}

export const STEPS = [stepOnboarding, stepProfile, stepCapital, stepDocuments, stepQ, stepTeam, stepPitch, stepVisibility];
