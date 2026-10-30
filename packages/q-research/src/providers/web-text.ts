/**
 * Web text as Capital Q keeps it: a search index's titles and snippets
 * arrive with HTML character references still in them (live 2026-10-30:
 * report sources read "CBN&#39;s", "Nigeria&#8217;s", "Banks &amp;
 * Fintechs"). Each provider decodes them here, once, where the text
 * enters, so every consumer (the fact reader, the report's Sources, a
 * card) gets the characters themselves.
 *
 * One pass, so "&amp;#39;" becomes "&#39;" and is never decoded twice. A
 * reference that is not a known name, or names no valid character (NUL,
 * a surrogate, past U+10FFFF, a control character), is left as written.
 */

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  times: "×",
  divide: "÷",
  plusmn: "±",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  shy: "­",
  aacute: "á",
  agrave: "à",
  acirc: "â",
  auml: "ä",
  atilde: "ã",
  aring: "å",
  ccedil: "ç",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  iacute: "í",
  igrave: "ì",
  icirc: "î",
  iuml: "ï",
  ntilde: "ñ",
  oacute: "ó",
  ograve: "ò",
  ocirc: "ô",
  ouml: "ö",
  otilde: "õ",
  oslash: "ø",
  uacute: "ú",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  szlig: "ß",
  Eacute: "É",
  Agrave: "À",
  Ccedil: "Ç",
  Ouml: "Ö",
  Uuml: "Ü",
  Auml: "Ä",
};

const REFERENCE =
  /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/gu;

function character(body: string): string | null {
  if (!body.startsWith("#")) return NAMED[body] ?? null;
  const code =
    body[1] === "x" || body[1] === "X"
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
  if (!Number.isInteger(code) || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
    return null;
  }
  if (code >= 0x7f && code <= 0x9f) return null;
  return String.fromCodePoint(code);
}

/** The text with its HTML character references decoded, once. */
export function webText(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    REFERENCE,
    (whole, body: string) => character(body) ?? whole,
  );
}
