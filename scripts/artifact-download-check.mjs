#!/usr/bin/env node
/* global process, console, fetch, URL, Buffer */
/**
 * Deploy-time artifact download check (BIZ-001, R1 / R17).
 *
 * After a deploy, prove that what Q composed actually leaves the building:
 * fetch an investment brief as PDF and a deck as PDF and PowerPoint, and
 * check each file is what it says it is — HTTP 200, the right content
 * type, an attachment with the right extension, the right magic bytes
 * (`%PDF-`, `PK\x03\x04`), and at least one page or slide. Optionally,
 * that a character (₦ by default when asked) was drawn rather than
 * dropped.
 *
 * Read-only: GET requests under the session you give it. Nothing is
 * created, revised, shared or sent. Secrets are never printed.
 *
 * Through the web app (what a person's browser does):
 *
 *   node scripts/artifact-download-check.mjs \
 *     --web https://capital-qweb-production.up.railway.app \
 *     --cookie "$CQ_CHECK_COOKIE" \
 *     --brief <artifactId> --deck <artifactId> [--expect-char ₦]
 *
 *   The cookie is the whole `Cookie` request header of a signed-in tab
 *   (DevTools → Network → any request → Request Headers → cookie), or set
 *   CQ_CHECK_COOKIE instead of passing --cookie. The artifact ids are in
 *   the viewer's URL / the card's `data-q-artifact-open` attribute.
 *
 * Straight at the Q API (finds the latest READY brief and deck itself):
 *
 *   node scripts/artifact-download-check.mjs \
 *     --q-api https://<q-api-domain> --token "$CQ_CHECK_TOKEN" [--expect-char ₦]
 *
 *   The token is a Supabase access token for the founder (CQ_CHECK_TOKEN).
 *
 * A file on disk (to check the checker, or a file someone sent you):
 *
 *   node scripts/artifact-download-check.mjs --file deck.pptx --file brief.pdf
 *
 * Add --out <dir> to keep the downloaded files. Exit 0 when every check
 * passes, 1 otherwise.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const PPTX_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const TYPES = { pdf: "application/pdf", pptx: PPTX_TYPE };

function parseArgs(argv) {
  const args = { files: [], brief: [], deck: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    const take = () => {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} needs a value`);
      }
      i += 1;
      return value;
    };
    if (flag === "--web") args.web = take();
    else if (flag === "--q-api") args.qApi = take();
    else if (flag === "--cookie") args.cookie = take();
    else if (flag === "--token") args.token = take();
    else if (flag === "--brief") args.brief.push(take());
    else if (flag === "--deck") args.deck.push(take());
    else if (flag === "--file") args.files.push(take());
    else if (flag === "--out") args.out = take();
    else if (flag === "--expect-char") args.expectChar = take();
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  args.cookie ??= process.env.CQ_CHECK_COOKIE;
  args.token ??= process.env.CQ_CHECK_TOKEN;
  return args;
}

/** Every stream in the file, inflated where it is Flate-encoded. */
function pdfStreams(bytes) {
  const raw = Buffer.from(bytes).toString("latin1");
  const out = [raw];
  // `stream` that opens data, never the tail of `endstream`.
  const pattern = /(?<!end)stream\r?\n/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const chunk = Buffer.from(raw.slice(start, end), "latin1");
    try {
      out.push(inflateSync(chunk).toString("latin1"));
    } catch {
      // Not Flate (or not a stream at all): the raw text already has it.
    }
    pattern.lastIndex = end + "endstream".length;
  }
  return out.join("\n");
}

function pdfPageCount(text) {
  let fromTree = 0;
  const pages = /\/Type\s*\/Pages\b/g;
  let match;
  while ((match = pages.exec(text)) !== null) {
    const window = text.slice(
      Math.max(0, match.index - 400),
      match.index + 400,
    );
    for (const count of window.matchAll(/\/Count\s+(\d+)/g)) {
      fromTree = Math.max(fromTree, Number(count[1]));
    }
  }
  const pageObjects = [...text.matchAll(/\/Type\s*\/Page(?![s\w])/g)].length;
  return Math.max(fromTree, pageObjects);
}

/**
 * Whether the file's ToUnicode maps carry this character: a glyph was
 * drawn for it. Not a text extractor — enough to tell "₦ was drawn" from
 * "₦ was stripped", which is the failure this packet fixed.
 */
function pdfDrewCharacter(text, character) {
  const code = character.codePointAt(0);
  if (code === undefined || code > 0xffff) return false;
  const hex = code.toString(16).toUpperCase().padStart(4, "0");
  if (new RegExp(`<\\s*${hex}\\s*>`, "i").test(text)) return true;
  // bfrange: <lo> <hi> <dst>
  for (const range of text.matchAll(
    /<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>/g,
  )) {
    const lo = Number.parseInt(range[1], 16);
    const hi = Number.parseInt(range[2], 16);
    const dst = Number.parseInt(range[3], 16);
    if (code >= dst && code <= dst + (hi - lo)) return true;
  }
  return false;
}

/** Slide parts named in the zip's own directory (file names are not compressed). */
function pptxSlideCount(bytes) {
  const raw = Buffer.from(bytes).toString("latin1");
  const names = new Set(raw.match(/ppt\/slides\/slide\d+\.xml/g) ?? []);
  return names.size;
}

function checkBytes(label, format, bytes, expectChar) {
  const failures = [];
  const notes = [];
  if (format === "pdf") {
    if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") {
      failures.push("does not start with %PDF-");
    } else {
      const text = pdfStreams(bytes);
      const pages = pdfPageCount(text);
      notes.push(`${String(pages)} page(s)`);
      if (pages < 1) failures.push("no pages found");
      if (expectChar !== undefined) {
        if (pdfDrewCharacter(text, expectChar))
          notes.push(`drew ${expectChar}`);
        else failures.push(`no glyph mapped to ${expectChar}`);
      }
    }
  } else {
    if ([...bytes.subarray(0, 4)].join(",") !== "80,75,3,4") {
      failures.push("does not start with PK\\x03\\x04");
    } else {
      const slides = pptxSlideCount(bytes);
      notes.push(`${String(slides)} slide(s)`);
      if (slides < 1) failures.push("no slides found");
      if (
        !Buffer.from(bytes).toString("latin1").includes("ppt/presentation.xml")
      ) {
        failures.push("no ppt/presentation.xml");
      }
    }
  }
  notes.push(`${String(bytes.byteLength)} bytes`);
  return { label, format, failures, notes };
}

async function fetchFile({ label, url, headers, format, expectChar, out }) {
  let response;
  try {
    response = await fetch(url, { headers, redirect: "manual" });
  } catch (error) {
    return {
      label,
      format,
      failures: [`request failed: ${error.message}`],
      notes: [],
    };
  }
  if (response.status !== 200) {
    let said = "";
    try {
      const body = await response.json();
      said = body.message ?? body.detail ?? "";
    } catch {
      // Not JSON (a redirect to sign-in, an HTML error page).
    }
    const where =
      response.status >= 300 && response.status < 400
        ? ` (redirected to ${new URL(response.headers.get("location") ?? "/", url).pathname}: is the session valid?)`
        : "";
    return {
      label,
      format,
      failures: [
        `HTTP ${String(response.status)}${where}${said ? `: ${said}` : ""}`,
      ],
      notes: [],
    };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const result = checkBytes(
    label,
    format,
    bytes,
    format === "pdf" ? expectChar : undefined,
  );
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith(TYPES[format])) {
    result.failures.push(
      `content-type is "${type}", expected ${TYPES[format]}`,
    );
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  if (
    !/^attachment;/i.test(disposition) ||
    !disposition.includes(`.${format}"`)
  ) {
    result.failures.push(`content-disposition is "${disposition}"`);
  }
  if (out !== undefined) {
    mkdirSync(out, { recursive: true });
    const name =
      /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${label}.${format}`;
    writeFileSync(resolve(out, name), bytes);
    result.notes.push(`saved ${name}`);
  }
  return result;
}

async function discover(qApi, headers) {
  const response = await fetch(`${qApi}/v1/q/artifacts?limit=50`, { headers });
  if (response.status !== 200) {
    throw new Error(
      `listing artifacts returned HTTP ${String(response.status)}`,
    );
  }
  const body = await response.json();
  const ready = (body.items ?? []).filter((item) => item.status === "READY");
  const latest = (type) => ready.find((item) => item.type === type)?.artifactId;
  return { brief: latest("INVESTMENT_BRIEF"), deck: latest("PITCH_DECK") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (args.files.length === 0 && !args.web && !args.qApi)) {
    console.log(
      "usage: --web <origin> --cookie <header> --brief <id> --deck <id> | --q-api <origin> --token <jwt> | --file <path>  [--expect-char ₦] [--out dir]",
    );
    process.exit(args.help ? 0 : 1);
  }

  const results = [];
  for (const path of args.files) {
    const format = extname(path).toLowerCase() === ".pptx" ? "pptx" : "pdf";
    const bytes = new Uint8Array(readFileSync(path));
    results.push(
      checkBytes(
        basename(path),
        format,
        bytes,
        format === "pdf" ? args.expectChar : undefined,
      ),
    );
  }

  const jobs = [];
  if (args.web !== undefined) {
    if (!args.cookie)
      throw new Error("--web needs --cookie or CQ_CHECK_COOKIE");
    if (args.brief.length === 0 && args.deck.length === 0) {
      throw new Error("--web needs at least one --brief or --deck id");
    }
    const origin = args.web.replace(/\/$/, "");
    const headers = { cookie: args.cookie };
    const url = (id, format) =>
      `${origin}/api/q-artifact/${encodeURIComponent(id)}/${format}`;
    for (const id of args.brief)
      jobs.push({
        label: `brief ${id.slice(0, 8)}`,
        url: url(id, "pdf"),
        headers,
        format: "pdf",
      });
    for (const id of args.deck) {
      jobs.push({
        label: `deck ${id.slice(0, 8)}`,
        url: url(id, "pdf"),
        headers,
        format: "pdf",
      });
      jobs.push({
        label: `deck ${id.slice(0, 8)}`,
        url: url(id, "pptx"),
        headers,
        format: "pptx",
      });
    }
  }
  if (args.qApi !== undefined) {
    if (!args.token) throw new Error("--q-api needs --token or CQ_CHECK_TOKEN");
    const origin = args.qApi.replace(/\/$/, "");
    const headers = { authorization: `Bearer ${args.token}` };
    const found = await discover(origin, headers);
    const briefs =
      args.brief.length > 0 ? args.brief : found.brief ? [found.brief] : [];
    const decks =
      args.deck.length > 0 ? args.deck : found.deck ? [found.deck] : [];
    if (briefs.length === 0)
      results.push({
        label: "brief",
        format: "pdf",
        failures: ["no READY investment brief to check"],
        notes: [],
      });
    if (decks.length === 0)
      results.push({
        label: "deck",
        format: "pdf",
        failures: ["no READY deck to check"],
        notes: [],
      });
    const url = (id, format) =>
      `${origin}/v1/q/artifacts/${encodeURIComponent(id)}/export/${format}`;
    for (const id of briefs)
      jobs.push({
        label: `brief ${id.slice(0, 8)}`,
        url: url(id, "pdf"),
        headers,
        format: "pdf",
      });
    for (const id of decks) {
      jobs.push({
        label: `deck ${id.slice(0, 8)}`,
        url: url(id, "pdf"),
        headers,
        format: "pdf",
      });
      jobs.push({
        label: `deck ${id.slice(0, 8)}`,
        url: url(id, "pptx"),
        headers,
        format: "pptx",
      });
    }
  }
  for (const job of jobs) {
    results.push(
      await fetchFile({ ...job, expectChar: args.expectChar, out: args.out }),
    );
  }

  let failed = 0;
  for (const result of results) {
    const ok = result.failures.length === 0;
    if (!ok) failed += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${result.label.padEnd(16)} ${result.format.padEnd(4)}  ${[...result.notes, ...result.failures].join("; ")}`,
    );
  }
  console.log(
    failed === 0
      ? `artifact-download-check: ${String(results.length)} file(s) passed`
      : `artifact-download-check: ${String(failed)} of ${String(results.length)} failed`,
  );
  process.exit(failed === 0 && results.length > 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`artifact-download-check: ${error.message}`);
  process.exit(1);
});
