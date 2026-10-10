import type { NameCandidate } from "./resolve.js";

/**
 * The five seeded Qatar entities with the spellings and recognition
 * renderings people and speech models are known to produce for them.
 * Aliases are Latin-script variants only: no Arabic script and no
 * pronunciation is written here, because neither may be invented. Those
 * come from a verified source or the person's own correction.
 *
 * `id` is a stable seed key; callers map it to their canonical record and
 * pass the aliases as `NameCandidate.aliases`. Phonetic variants (Muhanad,
 * Taslak, Al Rayyan) are caught by scoring; the aliases here cover names
 * no sound rule reaches ("queue invest", "IPA Qatar", "ARI Qatar").
 */

export type SeededEntity = NameCandidate & {
  readonly kind: "person" | "organisation";
};

export const QATAR_FIVE: readonly SeededEntity[] = [
  {
    kind: "person",
    id: "seed:shadi-qishta",
    name: "Shadi Qishta",
    aliases: ["Shady Kishta", "Shadi Kishta", "Shadi Qeshta", "Chadi Kishta"],
    city: "Doha",
    country: "Qatar",
  },
  {
    kind: "organisation",
    id: "seed:qinvest",
    name: "QInvest",
    aliases: [
      "QInvest LLC",
      "QINVEST",
      "Q Invest",
      "Q-Invest",
      "Queue Invest",
      "Kyoo Invest",
      "Q Invest LLC",
    ],
    city: "Doha",
    country: "Qatar",
  },
  {
    kind: "person",
    id: "seed:muhannad-taslaq",
    name: "Muhannad Taslaq",
    aliases: [
      "Muhanad Taslaq",
      "Mohannad Taslak",
      "Mohanad Taslak",
      "Muhannad Tasluq",
      "Mohannad Tasluq",
    ],
    city: "Doha",
    country: "Qatar",
  },
  {
    kind: "organisation",
    id: "seed:invest-qatar",
    name: "Invest Qatar",
    aliases: [
      "InvestQatar",
      "IPA Qatar",
      "Investment Promotion Agency Qatar",
      "Investment Promotion Agency",
      "Invest in Qatar",
    ],
    city: "Doha",
    country: "Qatar",
  },
  {
    kind: "organisation",
    id: "seed:alrayan-investment",
    name: "AlRayan Investment",
    aliases: [
      "Al Rayan Investment",
      "Al Rayan Investments",
      "Al-Rayan Investment",
      "Al Rayyan Investment",
      "ARI Qatar",
      "AlRayan",
    ],
    city: "Doha",
    country: "Qatar",
  },
];

export const seededByKind = (
  kind: SeededEntity["kind"],
): readonly SeededEntity[] => QATAR_FIVE.filter((one) => one.kind === kind);
