import type {
  PipelineImportAppliedDto,
  PipelineImportMapping,
  PipelineImportPreview,
  PipelineProspect,
  RelationshipSideDetailsRead,
} from "@capital-q/contracts";

/**
 * Fictional data for the CRM import design review (`/dev/pipeline-import`)
 * and its browser checks. Every company, investor and person here is
 * invented; nothing is read from or written to any service.
 */

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const FIXTURE_DOCUMENT_ID = id(9001);

const Q_MAPPING: PipelineImportMapping = {
  counterpartName: "Organization",
  website: "Domain",
  stage: "Status",
  owner: "Owners",
  source: "Deal Source",
  amount: "Ticket",
  currency: "Currency",
  priority: "Priority",
  notes: "Notes",
};

const COLUMNS = [
  "Organization",
  "Domain",
  "Status",
  "Owners",
  "Deal Source",
  "Ticket",
  "Currency",
  "Priority",
  "Notes",
  "Fund",
];

export function fixturePreview(
  mapping?: PipelineImportMapping,
): PipelineImportPreview {
  const chosen = mapping ?? Q_MAPPING;
  return {
    importId: id(9100),
    proposalHash: (mapping === undefined ? "a" : "b").repeat(64),
    fileName: "affinity-deal-pipeline.csv",
    side: "INVESTOR",
    mapping: chosen,
    mappingSource: mapping === undefined ? "Q" : "PERSON",
    columns: COLUMNS,
    unmappedColumns: COLUMNS.filter(
      (column) => !Object.values(chosen).includes(column),
    ),
    counts: { rows: 9, matched: 4, ambiguous: 2, new: 2, invalid: 1 },
    status: "PREPARED",
    rows: [
      {
        rowNumber: 1,
        name: "Northwind Logistics (fictional)",
        stage: "DILIGENCE",
        stageLabel: "Deep dive",
        match: "MATCHED",
        matched: { id: id(1), name: "Northwind Logistics (fictional)" },
        candidates: [],
      },
      {
        rowNumber: 2,
        name: "Kestrel Health",
        stage: "MEETING",
        stageLabel: "First meeting",
        match: "MATCHED",
        matched: { id: id(2), name: "Kestrel Health Ltd (fictional)" },
        candidates: [],
      },
      {
        rowNumber: 3,
        name: "Baobab Pay (fictional)",
        stage: "TERM_SHEET",
        stageLabel: "IC approved",
        match: "MATCHED",
        matched: { id: id(3), name: "Baobab Pay (fictional)" },
        candidates: [],
      },
      {
        rowNumber: 4,
        name: "Sahel Solar (fictional)",
        stage: "UNKNOWN",
        stageLabel: "Tracking",
        match: "MATCHED",
        matched: { id: id(4), name: "Sahel Solar (fictional)" },
        candidates: [],
      },
      {
        rowNumber: 5,
        name: "Atlas Robotics",
        stage: "CONTACTED",
        stageLabel: "Outreach",
        match: "AMBIGUOUS",
        matched: null,
        candidates: [
          { id: id(5), name: "Atlas Robotics Inc (fictional)" },
          { id: id(6), name: "Atlas Robotics Africa (fictional)" },
        ],
      },
      {
        rowNumber: 6,
        name: "Lumen Labs",
        stage: "RESEARCH",
        stageLabel: "Sourced",
        match: "AMBIGUOUS",
        matched: null,
        candidates: [
          { id: id(7), name: "Lumen Labs (fictional)" },
          { id: id(8), name: "Lumen Labs Health (fictional)" },
        ],
      },
      {
        rowNumber: 7,
        name: "Harmattan Foods",
        stage: "RESEARCH",
        stageLabel: "Lead",
        match: "NEW",
        matched: null,
        candidates: [],
      },
      {
        rowNumber: 8,
        name: "Okavango Data",
        stage: "PASSED",
        stageLabel: "Closed lost",
        match: "NEW",
        matched: null,
        candidates: [],
      },
      {
        rowNumber: 9,
        name: null,
        stage: null,
        stageLabel: null,
        match: "INVALID",
        matched: null,
        candidates: [],
      },
    ],
  };
}

export function fixtureApplied(
  resolved: number,
  kept: number,
): PipelineImportAppliedDto {
  return {
    importId: id(9100),
    replayed: false,
    result: {
      linked: 4 + resolved,
      relationshipsCreated: 2 + resolved,
      keptPrivate: 2 + kept,
      skipped: 3 - resolved - kept,
      stageEvents: 4 + resolved,
      notes: 4 + resolved,
      tasks: 2,
      details: 4 + resolved,
    },
    relationships: [
      {
        relationshipId: id(201),
        counterpartId: id(1),
        name: "Northwind Logistics (fictional)",
      },
      {
        relationshipId: id(202),
        counterpartId: id(2),
        name: "Kestrel Health Ltd (fictional)",
      },
      {
        relationshipId: id(203),
        counterpartId: id(3),
        name: "Baobab Pay (fictional)",
      },
      {
        relationshipId: id(204),
        counterpartId: id(4),
        name: "Sahel Solar (fictional)",
      },
      ...(resolved > 0
        ? [
            {
              relationshipId: id(205),
              counterpartId: id(5),
              name: "Atlas Robotics Inc (fictional)",
            },
          ]
        : []),
    ],
  };
}

export const FIXTURE_PROSPECTS: readonly PipelineProspect[] = [
  {
    importId: id(9000),
    rowNumber: 7,
    name: "Harmattan Foods",
    website: "harmattanfoods.example",
    stage: "RESEARCH",
    stageLabel: "Lead",
    priority: "Tier 2",
    source: "Demo day",
    contactName: "Amara Okafor (fictional)",
    amount: "250000",
    currency: "USD",
    fileName: "affinity-deal-pipeline.csv",
    importedAt: "2026-11-18T10:00:00.000Z",
  },
  {
    importId: id(9000),
    rowNumber: 8,
    name: "Okavango Data",
    website: null,
    stage: "PASSED",
    stageLabel: "Closed lost",
    priority: null,
    source: null,
    contactName: null,
    amount: null,
    currency: null,
    fileName: "affinity-deal-pipeline.csv",
    importedAt: "2026-11-18T10:00:00.000Z",
  },
];

export const FIXTURE_SIDE_DETAILS: RelationshipSideDetailsRead = {
  details: {
    relationshipId: id(201),
    side: "INVESTOR",
    stage: "DILIGENCE",
    stageLabel: "Deep dive",
    owner: { membershipId: id(301), name: "Ada Obi (fictional)" },
    source: "Warm intro",
    introducerName: "Tunde Bello (fictional)",
    introducerEmail: null,
    expected: { amount: "500000", currency: "USD" },
    priority: "HIGH",
    revision: 3,
    updatedAt: "2026-11-18T10:00:00.000Z",
    visibility: "organisation_private",
  },
  members: [
    { membershipId: id(301), name: "Ada Obi (fictional)" },
    { membershipId: id(302), name: "Kwame Mensah (fictional)" },
  ],
};
