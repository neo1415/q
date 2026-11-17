import type { QAnswerCardsBlock } from "@capital-q/contracts";

/**
 * Production replay fixture, owner live 17 Nov 2026 (investor Zino
 * Aviation, conversation 9995dcca, run ba549abe): the ranked card block
 * Q stored for "Find the strongest companies that are currently available
 * and fit my investment thesis", exactly as persisted (no count asked; a
 * four-way tie at 10). Data, never a live call.
 */
export const ZINO_ASKED =
  "Find the strongest companies that are currently available and fit my investment thesis";

export const ZINO_WHY_ASKED =
  "So, why are they the strongest fits? Don't just repeat the descriptions";

export const ZINO_RANKED_BLOCK: QAnswerCardsBlock = {
  kind: "ANSWER_CARDS",
  cards: [
    {
      fit: {
        of: 7,
        score: 10,
        measured: 5,
      },
      hue: 1,
      key: "nixo",
      line: "seed · United States",
      name: "Nixo",
      said: "Nixo is strong on stage, sector, geography and 2 more; thesis and round terms not known yet. Capital Q mandate fit 10 out of 10, 5 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "Helping AI companies achieve SaaS-level margins from custom deployments and services work.",
      raise: "$5 million",
      reasons: [
        "In one of your sectors.",
        "Raising seed; you invest at pre-seed to Series A.",
        "Thesis not known yet.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "d48c26d2-5aca-4788-9033-073b0f9d08ec",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "STRONG",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "STRONG",
          value: null,
        },
        {
          label: "Business model",
          level: "STRONG",
          value: null,
        },
        {
          label: "Thesis",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
    {
      fit: {
        of: 7,
        score: 10,
        measured: 5,
      },
      hue: 2,
      key: "halyardsecurity",
      line: "seed · United Kingdom",
      name: "Halyard Security",
      said: "Halyard Security is strong on stage, sector, geography and 2 more; thesis and round terms not known yet. Capital Q mandate fit 10 out of 10, 5 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "Halyard rolls out phishing-resistant passkeys across NHS trusts and councils, including shared workstations and lost devices.",
      raise: "£3 million (from their pitch)",
      reasons: [
        "In one of your sectors.",
        "Raising seed; you invest at pre-seed to Series A.",
        "Thesis not known yet.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "1ab2cc02-160f-4812-a6b1-8be7e43afd3e",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "STRONG",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "STRONG",
          value: null,
        },
        {
          label: "Business model",
          level: "STRONG",
          value: null,
        },
        {
          label: "Thesis",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
    {
      fit: {
        of: 7,
        score: 10,
        measured: 5,
      },
      hue: 3,
      key: "tensorgate",
      line: "seed · United States",
      name: "Tensorgate",
      said: "Tensorgate is strong on stage, sector, geography and 2 more; thesis and round terms not known yet. Capital Q mandate fit 10 out of 10, 5 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "A gateway that runs LLM inference inside hardware enclaves and attests every request, so regulated firms can use AI on sensitive data.",
      raise: "$4 million (from their pitch)",
      reasons: [
        "In one of your sectors.",
        "Raising seed; you invest at pre-seed to Series A.",
        "Thesis not known yet.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "bf55d6e1-567a-470b-954d-054ae05990e2",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "STRONG",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "STRONG",
          value: null,
        },
        {
          label: "Business model",
          level: "STRONG",
          value: null,
        },
        {
          label: "Thesis",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
    {
      fit: {
        of: 7,
        score: 10,
        measured: 5,
      },
      hue: 4,
      key: "shiftwell",
      line: "Series A · United States",
      name: "Shiftwell",
      said: "Shiftwell is strong on stage, sector, geography and 2 more; thesis and round terms not known yet. Capital Q mandate fit 10 out of 10, 5 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "Scheduling, EVV, payroll and billing for US home-care agencies in one system, built by a former agency owner.",
      raise: "$15 million (from their pitch)",
      reasons: [
        "In one of your sectors.",
        "Raising Series A; you invest at pre-seed to Series A.",
        "Thesis not known yet.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "bfa975be-5611-4282-93b9-e886295b1140",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "STRONG",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "STRONG",
          value: null,
        },
        {
          label: "Business model",
          level: "STRONG",
          value: null,
        },
        {
          label: "Thesis",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
    {
      fit: {
        of: 7,
        score: 9.5,
        measured: 6,
      },
      hue: 5,
      key: "clearwaterassurance",
      line: "Series A · United Kingdom",
      name: "Clearwater Assurance",
      said: "Clearwater Assurance is strong on stage, sector, geography and 2 more, partial on thesis; round terms not known yet. Capital Q mandate fit 9.5 out of 10, 6 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "Continuous, independent validation of UK banks' credit and AI models, with the evidence supervisors ask for.",
      raise: "£9 million (from their pitch)",
      reasons: [
        "In one of your sectors.",
        "Raising Series A; you invest at pre-seed to Series A.",
        "Round terms not known yet.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "6ed1da85-cddc-4015-b5c2-86a95a48cfc8",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "STRONG",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "STRONG",
          value: null,
        },
        {
          label: "Business model",
          level: "STRONG",
          value: null,
        },
        {
          label: "Thesis",
          level: "PARTIAL",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
    {
      fit: {
        of: 7,
        score: 9.4,
        measured: 5,
      },
      hue: 6,
      key: "tangible",
      line: "seed · United Kingdom",
      name: "Tangible",
      said: "Tangible is strong on stage, sector, geography and business model, partial on thesis; cheque compatibility and round terms not known yet. Capital Q mandate fit 9.4 out of 10, 5 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "Tangible helps hardtech companies such as robotics and climate firms arrange and manage debt financing.",
      raise: null,
      reasons: [
        "In one of your sectors.",
        "Raising seed; you invest at pre-seed to Series A.",
        "The company has not shared its round size with you.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "bff322f5-ea98-506d-b0ed-dd51033e19b3",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "STRONG",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Business model",
          level: "STRONG",
          value: null,
        },
        {
          label: "Thesis",
          level: "PARTIAL",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
    {
      fit: {
        of: 7,
        score: 9.4,
        measured: 5,
      },
      hue: 7,
      key: "f2",
      line: "seed · United States",
      name: "F2",
      said: "F2 is strong on stage, sector, geography and business model, partial on thesis; cheque compatibility and round terms not known yet. Capital Q mandate fit 9.4 out of 10, 5 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "F2 builds AI workflow software that automates deal screening, underwriting and monitoring for private credit funds and banks.",
      raise: null,
      reasons: [
        "In one of your sectors.",
        "Raising seed; you invest at pre-seed to Series A.",
        "The company has not shared its round size with you.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "c6305feb-0cf8-52ab-977a-87569c3b2916",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "STRONG",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Business model",
          level: "STRONG",
          value: null,
        },
        {
          label: "Thesis",
          level: "PARTIAL",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
    {
      fit: {
        of: 7,
        score: 8.8,
        measured: 3,
      },
      hue: 1,
      key: "ajopot",
      line: "seed · Nigeria",
      name: "Ajopot",
      said: "Ajopot is strong on stage and sector, partial on geography; 4 measures not known yet. Capital Q mandate fit 8.8 out of 10, 3 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "A consumer app that digitises ajo — rotating savings circles — for gig workers and young professionals, with funds held at a licensed partner bank.",
      raise: null,
      reasons: [
        "In one of your sectors.",
        "Raising seed; you invest at pre-seed to Series A.",
        "Raising NGN 1,200,000,000, in their deck; not shared as a round size, so not scored.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "91de2a77-fe47-4af0-8534-d9abf9c55949",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "PARTIAL",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Business model",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Thesis",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
    {
      fit: {
        of: 7,
        score: 8.6,
        measured: 6,
      },
      hue: 2,
      key: "spheros",
      line: "seed · United States",
      name: "Spheros",
      said: "Spheros is strong on stage, sector, geography and business model, partial on cheque compatibility and thesis; round terms not known yet. Capital Q mandate fit 8.6 out of 10, 6 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "Fintech and data infrastructure company doing B2B SaaS, identity verification, and related services.",
      raise: "$2 million (from their pitch)",
      reasons: [
        "In one of your sectors.",
        "Raising seed; you invest at pre-seed to Series A.",
        "Round terms not known yet.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "e1f07c6b-834b-4fbb-8cab-b5be170f91b6",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "STRONG",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "PARTIAL",
          value: null,
        },
        {
          label: "Business model",
          level: "STRONG",
          value: null,
        },
        {
          label: "Thesis",
          level: "PARTIAL",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
    {
      fit: {
        of: 7,
        score: 8.2,
        measured: 5,
      },
      hue: 3,
      key: "watchly",
      line: "seed · Ghana",
      name: "Watchly",
      said: "Watchly is strong on stage, sector and business model, partial on geography and cheque compatibility; thesis and round terms not known yet. Capital Q mandate fit 8.2 out of 10, 5 of 7 measures known; not a quality score. No source documents yet. (Capital Q scale: strong 10, partial 4, mismatch 0.)",
      view: null,
      about:
        "Transaction fraud detection for banks and payment processors in Ghana: Watchly scores transactions in real time with models trained on regional fraud patterns.",
      raise: "$1 million (from their pitch)",
      reasons: [
        "In one of your sectors.",
        "Raising seed; you invest at pre-seed to Series A.",
        "Thesis not known yet.",
      ],
      subject: {
        kind: "COMPANY",
        companyId: "526c2d72-9142-4e48-b106-ee4910f19318",
      },
      measures: [
        {
          label: "Stage",
          level: "STRONG",
          value: null,
        },
        {
          label: "Sector",
          level: "STRONG",
          value: null,
        },
        {
          label: "Geography",
          level: "PARTIAL",
          value: null,
        },
        {
          label: "Cheque compatibility",
          level: "PARTIAL",
          value: null,
        },
        {
          label: "Business model",
          level: "STRONG",
          value: null,
        },
        {
          label: "Thesis",
          level: "UNKNOWN",
          value: null,
        },
        {
          label: "Round terms",
          level: "UNKNOWN",
          value: null,
        },
      ],
      sourceCount: 0,
      reasonLevels: ["STRONG", "STRONG", "UNKNOWN"],
    },
  ],
  shape: "RANKED",
  title: "Companies: fit against your mandate",
  followUps: [],
};
