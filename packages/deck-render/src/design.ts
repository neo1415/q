import type { QFontPairing, QVisualDirection } from "@capital-q/contracts";

/**
 * Design reference data (DOCS spec §4.3).
 *
 * Type pairings and the direction a sector's decks start from. Both are
 * reference data rather than anything a model decides: a model choosing
 * fonts and colours per deck is how a deck comes out as a generic AI
 * slide, and a short, curated list is what a person can actually choose
 * between.
 *
 * Every family here is SIL Open Font License, free for commercial use and
 * embeddable. A PPTX names them (PowerPoint substitutes when one is not
 * installed); the SVG names them with a generic fallback; the PDF embeds
 * the bundled faces themselves (`faces.ts`, `fonts/`).
 */

export type FontPairing = {
  readonly code: QFontPairing;
  /** What a person is shown when choosing. */
  readonly label: string;
  readonly headingFont: string;
  readonly bodyFont: string;
};

export const FONT_PAIRINGS: Readonly<Record<QFontPairing, FontPairing>> = {
  INTER_SOURCE_SERIF: {
    code: "INTER_SOURCE_SERIF",
    label: "Source Serif headings, Inter text",
    headingFont: "Source Serif 4",
    bodyFont: "Inter",
  },
  // Deck quality 2026-10-08: the text face of these two pairings is Inter.
  // Plex Sans and Source Sans 3 carry a Reserved Font Name, so a subset
  // cut of them may not be bundled, and the PDF now draws the faces the
  // pairing names. The codes stay: they are stored on existing decks.
  PLEX_SANS_PLEX_SERIF: {
    code: "PLEX_SANS_PLEX_SERIF",
    label: "IBM Plex Serif headings, Inter text",
    headingFont: "IBM Plex Serif",
    bodyFont: "Inter",
  },
  SOURCE_SANS_FRAUNCES: {
    code: "SOURCE_SANS_FRAUNCES",
    label: "Fraunces headings, Inter text",
    headingFont: "Fraunces",
    bodyFont: "Inter",
  },
  INTER_ONLY: {
    code: "INTER_ONLY",
    label: "Inter throughout",
    headingFont: "Inter",
    bodyFont: "Inter",
  },
};

/** A pairing by code, or undefined for one this build has not heard of. */
export function fontPairing(code: string | undefined): FontPairing | undefined {
  if (code === undefined) return undefined;
  return Object.values(FONT_PAIRINGS).find((pairing) => pairing.code === code);
}

export type DesignDirection = {
  readonly direction: QVisualDirection;
  readonly pairing: QFontPairing;
  /** Said to the person when Q chose it ("a calm, institutional look…"). */
  readonly why: string;
};

const INSTITUTIONAL: DesignDirection = {
  direction: "MINIMAL_INSTITUTIONAL",
  pairing: "PLEX_SANS_PLEX_SERIF",
  why: "a calm, institutional look that financial investors read as serious",
};
const TECHNICAL: DesignDirection = {
  direction: "DARK_TECHNICAL",
  pairing: "INTER_ONLY",
  why: "a dark, technical look common to software and deep-tech decks",
};
const WARM: DesignDirection = {
  direction: "WARM_GROWTH",
  pairing: "SOURCE_SANS_FRAUNCES",
  why: "a warm look suited to consumer, food, agriculture and health companies",
};

/**
 * Where a sector's decks start, keyed by taxonomy industry code
 * (`packages/taxonomy` reference ids, never words a person typed). A code not listed takes the
 * institutional direction.
 */
const BY_SECTOR: Readonly<Record<string, DesignDirection>> = {
  financial_services: INSTITUTIONAL,
  fintech: INSTITUTIONAL,
  payments: INSTITUTIONAL,
  digital_lending: INSTITUTIONAL,
  digital_banking: INSTITUTIONAL,
  wealthtech: INSTITUTIONAL,
  insurtech: INSTITUTIONAL,
  capital_markets: INSTITUTIONAL,
  real_estate: INSTITUTIONAL,
  energy: INSTITUTIONAL,
  clean_energy: INSTITUTIONAL,
  energy_access: INSTITUTIONAL,
  logistics: INSTITUTIONAL,
  supply_chain: INSTITUTIONAL,
  manufacturing: INSTITUTIONAL,
  telecommunications: INSTITUTIONAL,
  enterprise_software: TECHNICAL,
  developer_tools: TECHNICAL,
  data_infrastructure: TECHNICAL,
  hr_technology: TECHNICAL,
  cybersecurity: TECHNICAL,
  identity_security: TECHNICAL,
  artificial_intelligence: TECHNICAL,
  machine_learning: TECHNICAL,
  cloud_infrastructure: TECHNICAL,
  robotics: TECHNICAL,
  hardware: TECHNICAL,
  healthcare: WARM,
  digital_health: WARM,
  medical_devices: WARM,
  commerce: WARM,
  ecommerce: WARM,
  retail_technology: WARM,
  agriculture: WARM,
  agritech: WARM,
  education: WARM,
  edtech: WARM,
  media_entertainment: WARM,
  consumer: WARM,
};

/** The direction for the first sector code that has one, or institutional. */
export function designDirectionFor(
  sectorCodes: readonly string[],
): DesignDirection {
  for (const code of sectorCodes) {
    const found = BY_SECTOR[code.trim().toLowerCase()];
    if (found !== undefined) return found;
  }
  return INSTITUTIONAL;
}
