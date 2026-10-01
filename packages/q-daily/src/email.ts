import type {
  QDailyEdition,
  QDailyImage,
  QDailyStory,
} from "@capital-q/contracts";

/**
 * The Q Daily as an email (DAILY spec §2, §3): a newspaper front page that
 * renders in Gmail and Outlook — tables, inline styles, system serif and
 * sans faces, no scripts, no background images, 600 px wide — carrying the
 * lead, each section's headlines and a link to the full edition. Kept well
 * under Gmail's ~102 KB clip (a test holds it under 60 KB).
 *
 * Email clients cannot read Capital Q's design tokens, so this file holds
 * the only literal colours in The Q Daily, chosen to match the light theme.
 */

const INK = "#14171a";
const MUTED = "#5b636b";
const RULE = "#d9dde1";
const PAPER = "#ffffff";
const PAGE = "#f3f2ee";
const ACCENT = "#1d4ed8";
const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Long date in English, from the edition's own YYYY-MM-DD. */
export function longDate(editionDate: string): string {
  const [year, month, day] = editionDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function dateline(edition: QDailyEdition): string {
  const kind = edition.frequency === "DAILY" ? "Daily" : "Weekly";
  return [
    longDate(edition.editionDate),
    `${kind} edition`,
    `No. ${edition.number}`,
    ...(edition.readerName === null ? [] : [`For ${edition.readerName}`]),
  ].join(" · ");
}

function link(url: string, text: string, style: string): string {
  return `<a href="${escapeHtml(url)}" style="${style}">${escapeHtml(text)}</a>`;
}

function credit(image: QDailyImage): string {
  const style = `color:${MUTED};text-decoration:underline`;
  return image.creditUrl === null
    ? escapeHtml(image.credit)
    : link(image.creditUrl, image.credit, style);
}

function picture(image: QDailyImage, width: number): string {
  const img = `<img src="${escapeHtml(image.url)}" width="${width}" alt="${escapeHtml(image.alt)}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0">`;
  const framed =
    image.linkUrl === null
      ? img
      : `<a href="${escapeHtml(image.linkUrl)}">${img}</a>`;
  return `${framed}<div style="font:12px/1.4 ${SANS};color:${MUTED};padding:6px 0 0">${credit(image)}</div>`;
}

function sourceLine(story: QDailyStory): string {
  const style = `color:${MUTED};text-decoration:underline`;
  return `<div style="font:12px/1.5 ${SANS};color:${MUTED};padding-top:6px">Source: ${story.sources
    .map((source) => link(source.url, source.publisher, style))
    .join(", ")}</div>`;
}

function leadBlock(story: QDailyStory): string {
  const quote = story.quotes[0];
  return [
    story.image === null
      ? ""
      : `<tr><td style="padding:0 0 14px">${picture(story.image, 552)}</td></tr>`,
    `<tr><td style="font:bold 28px/1.2 ${SERIF};color:${INK};padding:0 0 10px">${escapeHtml(story.headline)}</td></tr>`,
    story.standfirst.length === 0
      ? ""
      : `<tr><td style="font:17px/1.5 ${SERIF};color:${INK};padding:0 0 10px">${escapeHtml(story.standfirst)}</td></tr>`,
    ...story.paragraphs
      .slice(0, 2)
      .map(
        (paragraph) =>
          `<tr><td style="font:15px/1.6 ${SERIF};color:${INK};padding:0 0 10px">${escapeHtml(paragraph)}</td></tr>`,
      ),
    quote === undefined
      ? ""
      : `<tr><td style="font:italic 16px/1.5 ${SERIF};color:${INK};padding:4px 0 10px 14px;border-left:3px solid ${INK}">&ldquo;${escapeHtml(quote.text)}&rdquo;${quote.speaker === null ? "" : `<div style="font:12px/1.4 ${SANS};color:${MUTED};padding-top:4px">${escapeHtml(quote.speaker)}</div>`}</td></tr>`,
    `<tr><td style="padding:0 0 4px">${sourceLine(story)}</td></tr>`,
  ].join("");
}

function storyBlock(story: QDailyStory): string {
  const url = story.sources[0]?.url;
  const headline =
    url === undefined
      ? escapeHtml(story.headline)
      : link(url, story.headline, `color:${INK};text-decoration:none`);
  return `<tr><td style="padding:12px 0;border-top:1px solid ${RULE}"><div style="font:bold 18px/1.3 ${SERIF};color:${INK}">${headline}</div>${
    story.standfirst.length === 0
      ? ""
      : `<div style="font:15px/1.5 ${SERIF};color:${INK};padding-top:6px">${escapeHtml(story.standfirst)}</div>`
  }${sourceLine(story)}</td></tr>`;
}

function kicker(title: string): string {
  return `<tr><td style="font:bold 13px/1.4 ${SANS};color:${INK};padding:24px 0 4px;border-bottom:2px solid ${INK}">${escapeHtml(title)}</td></tr>`;
}

function chartBlock(edition: QDailyEdition): string {
  const chart = edition.chart;
  if (chart === null) return "";
  const top = Math.max(...chart.bars.map((bar) => bar.value));
  const rows = chart.bars
    .map((bar) => {
      const percent = Math.max(2, Math.round((bar.value / top) * 100));
      return `<tr><td width="150" style="font:13px/1.4 ${SANS};color:${INK};padding:4px 8px 4px 0">${escapeHtml(bar.label)}</td><td style="padding:4px 0"><table role="presentation" width="${percent}%" cellpadding="0" cellspacing="0"><tr><td bgcolor="${ACCENT}" height="14" style="background:${ACCENT};font-size:0;line-height:0">&nbsp;</td></tr></table></td><td width="70" align="right" style="font:bold 13px/1.4 ${SANS};color:${INK};padding:4px 0 4px 8px">${escapeHtml(bar.formatted)}</td></tr>`;
    })
    .join("");
  return `<tr><td style="padding:12px 0"><div style="font:bold 14px/1.4 ${SANS};color:${INK};padding-bottom:6px">${escapeHtml(chart.title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table><div style="font:12px/1.4 ${SANS};color:${MUTED};padding-top:6px">${escapeHtml(chart.source)}</div></td></tr>`;
}

function takeBlock(edition: QDailyEdition): string {
  const take = edition.qTake;
  if (take === null) return "";
  return `<tr><td style="padding:24px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${INK}"><tr><td style="padding:16px 18px"><div style="font:bold 13px/1.4 ${SANS};color:${INK}">Q's take</div><div style="font:12px/1.4 ${SANS};color:${MUTED};padding:2px 0 10px">Q's inference from the stories above, not reported fact.</div>${take.paragraphs
    .map(
      (paragraph) =>
        `<div style="font:15px/1.6 ${SERIF};color:${INK};padding-bottom:8px">${escapeHtml(paragraph)}</div>`,
    )
    .join("")}</td></tr></table></td></tr>`;
}

function briefsBlock(edition: QDailyEdition): string {
  if (edition.briefs.length === 0) return "";
  const items = edition.briefs
    .map((story) => {
      const url = story.sources[0]?.url;
      const title =
        url === undefined
          ? escapeHtml(story.headline)
          : link(url, story.headline, `color:${INK};text-decoration:underline`);
      return `<tr><td style="font:14px/1.5 ${SERIF};color:${INK};padding:6px 0;border-top:1px solid ${RULE}">${title} <span style="font:12px ${SANS};color:${MUTED}">${escapeHtml(story.sources[0]?.publisher ?? "")}</span></td></tr>`;
    })
    .join("");
  return `${kicker("In brief")}${items}`;
}

function usesStock(edition: QDailyEdition): boolean {
  const stories = [
    ...(edition.lead === null ? [] : [edition.lead]),
    ...edition.sections.flatMap((section) => section.stories),
  ];
  return stories.some((story) => story.image?.kind === "STOCK");
}

export type EditionEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

/**
 * The email for one edition. `links` are absolute addresses in the web app
 * (the full edition and Settings); without them the email says where to
 * find it instead.
 */
export function editionEmail(
  edition: QDailyEdition,
  links: { readonly edition: string; readonly settings: string } | null,
): EditionEmail {
  const headline = edition.lead?.headline ?? "Your markets this week";
  const subject = `The Q Daily · ${longDate(edition.editionDate)}: ${headline}`
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);
  const sectionRows = edition.sections
    .map(
      (section) =>
        `${kicker(section.title)}${section.stories.map(storyBlock).join("")}${
          section.code === "DEALS" ? chartBlock(edition) : ""
        }`,
    )
    .join("");
  const dealsWithoutSection =
    edition.chart !== null &&
    !edition.sections.some((section) => section.code === "DEALS")
      ? `${kicker("Deals and rounds")}${chartBlock(edition)}`
      : "";
  const footerLinks =
    links === null
      ? `<div>Open Capital Q and choose The Q Daily to read the full edition.</div>`
      : `<div>${link(links.edition, "Read the full edition", `color:${ACCENT};font-weight:bold`)} &nbsp;·&nbsp; ${link(links.settings, "Change how often it comes", `color:${MUTED}`)}</div>`;
  const pexels = usesStock(edition)
    ? `<div style="padding-top:6px">${link("https://www.pexels.com", "Photos provided by Pexels", `color:${MUTED}`)}</div>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:${PAGE}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE}"><tr><td align="center" style="padding:20px 8px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${PAPER}"><tr><td style="padding:24px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="font:bold 40px/1.1 ${SERIF};color:${INK};padding-bottom:6px">The Q Daily</td></tr><tr><td align="center" style="font:12px/1.5 ${SANS};color:${MUTED};padding:8px 0;border-top:3px double ${INK};border-bottom:1px solid ${INK}">${escapeHtml(dateline(edition))}</td></tr>${
    edition.topics.length === 0
      ? ""
      : `<tr><td align="center" style="font:12px/1.5 ${SANS};color:${MUTED};padding:6px 0 18px">Following ${escapeHtml(edition.topics.join(", "))}</td></tr>`
  }${edition.lead === null ? `<tr><td style="font:17px/1.5 ${SERIF};color:${INK};padding:12px 0">A quiet ${edition.frequency === "DAILY" ? "day" : "week"} in your markets: nothing new we could cite.</td></tr>` : leadBlock(edition.lead)}${sectionRows}${dealsWithoutSection}${briefsBlock(edition)}${takeBlock(edition)}</table></td></tr><tr><td style="padding:24px;font:13px/1.6 ${SANS};color:${MUTED}">${footerLinks}<div style="padding-top:8px">Every story names its source. Q's take is Q's inference.</div>${pexels}<div style="padding-top:8px">Capital Q · investment intelligence for founders and investors.</div></td></tr></table></td></tr></table></body></html>`;
  return { subject, text: editionText(edition, links), html };
}

/** The plain-text part, always sent beside the HTML. */
export function editionText(
  edition: QDailyEdition,
  links: { readonly edition: string; readonly settings: string } | null,
): string {
  const lines: string[] = ["THE Q DAILY", dateline(edition), ""];
  const story = (item: QDailyStory): void => {
    lines.push(item.headline);
    if (item.standfirst.length > 0) lines.push(item.standfirst);
    lines.push(
      `Source: ${item.sources.map((source) => `${source.publisher} ${source.url}`).join("; ")}`,
      "",
    );
  };
  if (edition.lead === null) {
    lines.push(
      "A quiet period in your markets: nothing new we could cite.",
      "",
    );
  } else {
    story(edition.lead);
  }
  for (const section of edition.sections) {
    lines.push(section.title.toUpperCase(), "");
    section.stories.forEach(story);
  }
  if (edition.briefs.length > 0) {
    lines.push("IN BRIEF", "");
    edition.briefs.forEach(story);
  }
  if (edition.qTake !== null) {
    lines.push("Q'S TAKE (Q's inference, not reported fact)", "");
    lines.push(...edition.qTake.paragraphs, "");
  }
  lines.push(
    links === null
      ? "Open Capital Q and choose The Q Daily to read the full edition."
      : `Read the full edition: ${links.edition}\nChange how often it comes: ${links.settings}`,
  );
  return lines.join("\n");
}
