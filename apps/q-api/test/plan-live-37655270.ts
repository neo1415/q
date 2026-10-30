/**
 * Plan job 37655270 / plan d79a3147 ("Plan my raise over 8 weeks", live on
 * 841f413d8, 2026-10-30): the stored situation, plan steps and open points
 * exactly as kept (q_runtime.q_plan_versions, version 1). Demo data.
 */
import { QPlanStepSchema, QSituationDossierSchema } from "@capital-q/contracts";

export const LIVE_37655270_SITUATION = QSituationDossierSchema.parse({
  asOf: "2026-10-30T05:40:44.151Z",
  side: "FOUNDER",
  version: "situation/v1",
  sections: [
    {
      facts: [
        {
          ref: "F1",
          asOf: "2026-10-30T04:00:50.657Z",
          label: "personal_private",
          category: null,
          statement:
            "You created an evidence item (11 times; latest 2026-10-30)",
          provenance: {
            url: null,
            tool: "my_activity",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F2",
          asOf: "2026-10-30T04:00:50.461Z",
          label: "personal_private",
          category: null,
          statement: "You registered a source (9 times; latest 2026-10-30)",
          provenance: {
            url: null,
            tool: "my_activity",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
      ],
      reason: null,
      source: "ACTIVITY",
      status: "READ",
      truncated: false,
    },
    {
      facts: [
        {
          ref: "F3",
          asOf: "2026-10-28T17:27:19.798Z",
          label: "relationship_shared",
          category: null,
          statement:
            "Aster Africa Ventures: connected since 2026-10-28; next step: schedule meeting.",
          provenance: {
            url: null,
            tool: "list_my_relationships",
            record: {
              id: "94eb9286-666a-4145-92d5-9e6f3beef321",
              kind: "RELATIONSHIP",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
      ],
      reason: null,
      source: "RELATIONSHIPS",
      status: "READ",
      truncated: false,
    },
    {
      facts: [],
      reason: null,
      source: "MESSAGES",
      status: "READ",
      truncated: false,
    },
    {
      facts: [
        {
          ref: "F4",
          asOf: "2026-10-30T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Approve Q\'s proposed initial meeting with Aster Africa Ventures about LedgerBridge" due 2026-10-30T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "a07b3bec-979c-4789-ade3-36917b1d832b",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F5",
          asOf: "2026-10-30T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Approve a proposed initial meeting with Aster Africa Ventures, subject to agreeing a date after your evidence is ready" due 2026-10-30T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "3e150700-bb2e-433f-b4a2-5340e27ee774",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F6",
          asOf: "2026-10-30T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Approve the proposed initial meeting with Aster Africa Ventures by 30 October" due 2026-10-30T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "0bb1f15c-90f2-47d6-9fbe-3e696f3b1037",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F7",
          asOf: "2026-11-03T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Complete founder identity verification and restate LedgerBridge\'s current revenue, cash, burn and runway figures" due 2026-11-03T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "4a4ca8f2-dd91-48c4-aa9b-b717e3ee84b9",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F8",
          asOf: "2026-11-03T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Validate the evidence and status of LedgerBridge\'s September 2026 traction claims" due 2026-11-03T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "31dce702-0b9f-4623-9f4e-89993e3dfc3a",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F9",
          asOf: "2026-11-03T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Provide three months of LedgerBridge revenue evidence and reconcile the September traction claims for internal review" due 2026-11-03T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "8ed84358-7f07-42d5-8bad-8847527e8156",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F10",
          asOf: "2026-11-03T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Confirm LedgerBridge\'s current figures, runway and founder identities" due 2026-11-03T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "4ec2539f-f67f-475c-8679-8bb843c1396a",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F11",
          asOf: "2026-11-04T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Prepare LedgerBridge\'s regulatory, identity, governance and finance-control evidence for Aster" due 2026-11-04T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "c9af96c0-ab8a-4f4e-997a-44c47b009a0d",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F12",
          asOf: "2026-11-04T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Review LedgerBridge\'s private market note and customer risk note for internal preparation" due 2026-11-04T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "cbd3b063-2a70-4fe7-b5c6-1463c4c65d56",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F13",
          asOf: "2026-11-04T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Provide the revenue records and reconcile LedgerBridge\'s September traction claims" due 2026-11-04T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "4d50ba21-7ce6-47f2-b6a6-1051d0ff0e4c",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F14",
          asOf: "2026-11-06T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Prepare LedgerBridge\'s Nigerian regulatory, governance and finance-control position for Aster" due 2026-11-06T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "732f39dd-798a-452c-ac0e-9be7754edc7a",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F15",
          asOf: "2026-11-06T08:00:00.000Z",
          label: "personal_private",
          category: null,
          statement:
            'Reminder "Prepare LedgerBridge\'s regulatory, governance and finance-control evidence for Aster without sharing private documents" due 2026-11-06T08:00:00.000Z.',
          provenance: {
            url: null,
            tool: "list_schedule",
            record: {
              id: "a7d53ae1-0d7c-43ca-b3ac-35f873f086c9",
              kind: "REMINDER",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
      ],
      reason: null,
      source: "SCHEDULE",
      status: "READ",
      truncated: true,
    },
    {
      facts: [
        {
          ref: "F16",
          asOf: "2026-10-30",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Your part: Approve Q\'s proposed initial meeting with Aster Africa Ventures about LedgerBridge", due 2026-10-30.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "6cb9863f-3c78-47cf-ae86-8441dbeb764b",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F17",
          asOf: "2026-11-03",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Complete founder identity verification and restate LedgerBridge\'s current revenue, cash, burn and runway figures", due 2026-11-03.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "3886c2a5-8115-4905-9bb6-ef49eeacdcad",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F18",
          asOf: "2026-11-03",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Provide three months of LedgerBridge revenue evidence and reconcile the September traction claims for internal review", due 2026-11-03.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "38cbaf64-0202-4dad-a90a-a2466ed9c065",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F19",
          asOf: "2026-11-06",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Your part: Prepare LedgerBridge\'s regulatory, governance and finance-control evidence for Aster without sharing private documents", due 2026-11-06.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "2546387f-d939-4ca3-a264-ebe519902815",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F20",
          asOf: "2026-11-11",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Your part: Revise the LedgerBridge deck with confirmed economics, Nigerian market evidence, growth mechanics and the CFO plan", due 2026-11-11.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "9d7d3897-d2de-4c32-a6cc-74f48e95009d",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F21",
          asOf: "2026-11-13",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Your part: Approve sharing only the revised LedgerBridge seed deck with Aster Africa Ventures", due 2026-11-13.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "b19ec2ad-3998-424f-9d0a-ec1d5a5fb497",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F22",
          asOf: "2026-10-30",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Approve the proposed initial meeting with Aster Africa Ventures by 30 October", due 2026-10-30.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "9549ba3d-a4d0-4528-b603-33f37d660693",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F23",
          asOf: "2026-11-03",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Confirm LedgerBridge\'s current figures, runway and founder identities", due 2026-11-03.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "28d0882f-36c0-476a-838f-57d738703eb2",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F24",
          asOf: "2026-11-04",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Your part: Provide the revenue records and reconcile LedgerBridge\'s September traction claims", due 2026-11-04.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "d27cec0e-ae9f-44eb-b156-706bc15edc59",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F25",
          asOf: "2026-11-06",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Your part: Prepare LedgerBridge\'s Nigerian regulatory, governance and finance-control position for Aster", due 2026-11-06.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "ed3529e5-d4b5-4b8b-a0a6-2576c82572e6",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F26",
          asOf: "2026-11-11",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Your part: Research and revise the LedgerBridge seed deck for the Nigerian B2B payments market", due 2026-11-11.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "eef00b35-3a85-4a2b-94d3-2b7c5ed7da5d",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F27",
          asOf: "2026-11-03",
          label: "personal_private",
          category: null,
          statement:
            'On your board, not done yet (todo): task "Your part: Validate the evidence and status of LedgerBridge\'s September 2026 traction claims", due 2026-11-03.',
          provenance: {
            url: null,
            tool: "my_board",
            record: {
              id: "11a01b71-16a0-43e2-9e6c-5701fd84d3fc",
              kind: "BOARD_ITEM",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
      ],
      reason: null,
      source: "BOARD",
      status: "READ",
      truncated: true,
    },
    {
      facts: [
        {
          ref: "F28",
          asOf: "2026-10-30T04:05:06.158Z",
          label: "personal_private",
          category: null,
          statement:
            "Waiting for your approval, not approved yet (nothing is sent or changed until you approve, change or decline it on its card; asked 2026-10-30): Message Aster Africa Ventures",
          provenance: {
            url: null,
            tool: "list_pending_approvals",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F29",
          asOf: "2026-10-29T23:20:02.693Z",
          label: "personal_private",
          category: null,
          statement:
            "Waiting for your approval, not approved yet (nothing is sent or changed until you approve, change or decline it on its card; asked 2026-10-29): Message Aster Africa Ventures",
          provenance: {
            url: null,
            tool: "list_pending_approvals",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F30",
          asOf: "2026-10-29T22:06:30.603Z",
          label: "personal_private",
          category: null,
          statement:
            "Waiting for your approval, not approved yet (nothing is sent or changed until you approve, change or decline it on its card; asked 2026-10-29): Update your company profile",
          provenance: {
            url: null,
            tool: "list_pending_approvals",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
      ],
      reason: null,
      source: "Q_WORK",
      status: "READ",
      truncated: false,
    },
    {
      facts: [
        {
          ref: "F31",
          asOf: null,
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          statement:
            "Remembered: 2026-10-30 LedgerBridge 12-month financial model: Tunde asked to plan the raise over eight weeks. A draft investor update to Aster Africa Ventures was prepared, covering LedgerBridge’s September 2026 financial reconciliation and remaining founder and organisation verification steps. The message is ready for Tunde’s approval and has not been sent. The September financial report and supporting evidence remain unresolved.",
          provenance: {
            url: null,
            tool: "memory_recall",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F32",
          asOf: null,
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          statement:
            "Remembered: 2026-10-29 LedgerBridge runway: Tunde asked Q to open his pitch deck after Q presented a preliminary nine-step plan for an Aster Africa Ventures brief, including September metrics and unresolved evidence gaps. No deck content or decision has yet been established.",
          provenance: {
            url: null,
            tool: "memory_recall",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F33",
          asOf: null,
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          statement:
            "Remembered: 2026-10-29 Preparing for first investor meetings: Tunde asked for help preparing for his first investor meetings next month. Q outlined a preparation plan focused on substantiating LedgerBridge’s traction claims, addressing customer concentration and regulatory/payment risks, explaining the $1.2M SAFE and milestone case, and separating evidenced information from estimates. Open items include reconciling the revenue figures, assembling supporting records, and clarifying regulatory responsibilities and controls.",
          provenance: {
            url: null,
            tool: "memory_recall",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F34",
          asOf: null,
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          statement:
            "Remembered: 2026-10-29 Improving investment prospects: Tunde asked how to improve his chances of getting investment. Q indicated it would gather the current position and prepare a reviewed plan; no substantive advice or decision has yet been recorded.",
          provenance: {
            url: null,
            tool: "memory_recall",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F35",
          asOf: null,
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          statement:
            "Remembered: They said (2026-10-29): LedgerBridge is positioned between payment gateways and accounting tools on the supplier-payment workflow for mid-sized Nigerian distributors.",
          provenance: {
            url: null,
            tool: "memory_recall",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F36",
          asOf: null,
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          statement:
            "Remembered: They said (2026-10-28): The company has about three months of runway, according to Tunde's private estimate.",
          provenance: {
            url: null,
            tool: "memory_recall",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F37",
          asOf: null,
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          statement:
            "Remembered: 2026-10-29 LedgerBridge runway: Tunde asked for a short investor update email to Aster Africa Ventures. The drafted message described LedgerBridge's B2B payments platform, stated 140 paying customers, reported monthly revenue of USD 65,000, and a USD 1.2 million SAFE raise, while noting that September figures and cash, burn and runway were still being reconciled. No approval or sending decision was recorded.",
          provenance: {
            url: null,
            tool: "memory_recall",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F38",
          asOf: null,
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          statement:
            "Remembered: 2026-10-29 LedgerBridge runway: Tunde previously asked for a one-page investor teaser for LedgerBridge as a document. Q said a brief had been prepared and directed him to download the PDF. Tunde then asked what he should do today; no decision or further information was established.",
          provenance: {
            url: null,
            tool: "memory_recall",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F39",
          asOf: null,
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          statement:
            "Remembered: 2026-10-29 Runway assessment: Tunde asked about LedgerBridge's runway. Q cited an indicative calculation of 4.8 months based on $310,000 cash and $65,000 monthly net burn, while noting that the September financial report had not been reviewed and that Tunde's earlier private estimate was three months. The current runway remains unresolved pending reconciliation of cash and burn.",
          provenance: {
            url: null,
            tool: "memory_recall",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
      ],
      reason: null,
      source: "MEMORY",
      status: "READ",
      truncated: false,
    },
    {
      facts: [],
      reason: null,
      source: "Q_DAILY",
      status: "READ",
      truncated: false,
    },
    {
      facts: [],
      reason: "NOT_OFFERED",
      source: "PUBLIC",
      status: "UNAVAILABLE",
      truncated: false,
    },
    {
      facts: [
        {
          ref: "F40",
          asOf: "2026-10-28T17:21:38.785Z",
          label: "relationship_shared",
          category: null,
          statement:
            'Aster Africa Ventures (VC) expressed interest on 2026-10-28; you accepted. Their note: "I’m interested in learning more about LedgerBridge’s B2B payments and reconciliation platform for Nigerian merchants and distributors. The company’s seed-stage, Nigeria-based payments focus aligns with my mandate; I’d welcome an initial conversation to understand the operating metrics, regulatory setup and fundraising objective."',
          provenance: {
            url: null,
            tool: "list_incoming_interest",
            record: {
              id: "9d304cd2-bdc4-4658-b814-a0a500f06679",
              kind: "INVESTOR_ORGANISATION",
            },
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
      ],
      reason: null,
      source: "INTEREST",
      status: "READ",
      truncated: false,
    },
    {
      facts: [],
      reason: "NOT_PERMITTED",
      source: "PROSPECTS",
      status: "UNAVAILABLE",
      truncated: false,
    },
    {
      facts: [],
      reason: "NOT_OFFERED",
      source: "PROFILE",
      status: "UNAVAILABLE",
      truncated: false,
    },
    {
      facts: [
        {
          ref: "F59",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's problem: Nigerian distributors and merchants primarily settle supplier invoices through manual bank transfers. Finance teams reconcile payments manually against spreadsheets, while suppliers wait an average of 19 days for payment.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F60",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's solution: LedgerBridge is a B2B payments platform for Nigerian merchants and distributors. It issues invoices, collects payments by bank transfer and virtual account, automatically reconciles them, and settles supplier payouts from a shared ledger.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F61",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's value proposition: LedgerBridge is presented as reducing manual reconciliation and centralising collections and supplier settlement. The deck does not quantify the resulting customer outcome.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F62",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement: "Q's reading of your deck found no market section.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "Q_INFERENCE",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F63",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's go to market: The deck identifies merchant acquisition in Lagos and Abuja as a use of funds. It does not describe acquisition channels, sales motion, customer acquisition cost or expansion mechanics.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F64",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's business model: Merchants pay a monthly SaaS subscription of $180–$900 plus 0.4% of settled volume. Gross margin, unit economics and currency mix are not provided.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F65",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's traction: In September 2026, LedgerBridge reported $65,000 MRR, 140 active merchants and $4.1 million of processed payments. MRR increased from $31,000 in April to $65,000 in September, while active merchants increased from 62 to 140; net revenue retention was above 120% by company estimate.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F66",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement: "Q's reading of your deck found no competition section.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "Q_INFERENCE",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F67",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's financials: The deck reports September 2026 MRR and processed payment volume and shows monthly MRR from April through September 2026. It does not provide historical financial statements, a financial plan, or operating spend beyond the proposed use of funds.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F68",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's the ask: LedgerBridge is raising $1.2 million in a seed round on a SAFE. The proposed allocation is 50% engineering and compliance, 30% merchant acquisition in Lagos and Abuja, and 20% working capital, with a target of 400 merchants and $150,000 MRR within 18 months.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F69",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's founders: LedgerBridge has two co-founders based in Lagos: Tunde Bello, CEO and former payments operations professional, and Ada Okafor, CTO and former core banking engineer.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          ref: "F70",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            "Your deck's team: The company has 14 staff, including two co-founders. The deck does not identify key non-founder roles, hiring plans or advisors.",
          provenance: {
            url: null,
            tool: "read_company_deck",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
      ],
      reason: null,
      source: "DECK",
      status: "READ",
      truncated: false,
    },
    {
      facts: [
        {
          ref: "F41",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement: "Data room: 4 documents; 0 open requests from investors.",
          provenance: {
            url: null,
            tool: "read_company_data_room",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F42",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            'Data room document "LedgerBridge seed deck" in Fundraising summary: private; opened by 1.',
          provenance: {
            url: null,
            tool: "read_company_data_room",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F43",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            'Data room document "LedgerBridge financial report Sept 2026" in Other documents: private; opened by 0.',
          provenance: {
            url: null,
            tool: "read_company_data_room",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F44",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            'Data room document "LedgerBridge market note" in Other documents: private; opened by 0.',
          provenance: {
            url: null,
            tool: "read_company_data_room",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F45",
          asOf: null,
          label: "organisation_private",
          category: null,
          statement:
            'Data room document "LedgerBridge internal customer risk note" in Other documents: private; opened by 0.',
          provenance: {
            url: null,
            tool: "read_company_data_room",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
      ],
      reason: null,
      source: "DATA_ROOM",
      status: "READ",
      truncated: false,
    },
    {
      facts: [],
      reason: null,
      source: "PITCH_VIDEO",
      status: "READ",
      truncated: false,
    },
    {
      facts: [
        {
          ref: "F46",
          asOf: null,
          label: "founder_private",
          category: null,
          statement:
            "Readiness: Could stop the raise: No revenue evidence yet — missing (rank: 1; why: Investors at this stage ask for revenue evidence before a first call. Three months of statements or invoices close it.; plan step: revenue-evidence).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F47",
          asOf: "2026-10-30T05:40:44.117Z",
          label: "founder_private",
          category: null,
          statement:
            "Readiness: Team — developing (On record: Founders named, Founders slide. Not yet: founder identity verified.; evidence on record: 2; would move it: Start identity verification.).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F48",
          asOf: "2026-10-30T05:40:44.117Z",
          label: "founder_private",
          category: null,
          statement:
            "Readiness: Market — developing (On record: Sector. Not yet: market size, market slide.; evidence on record: 1; would move it: Add a market size with a public source or report.).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F49",
          asOf: "2026-10-30T05:40:44.117Z",
          label: "founder_private",
          category: null,
          statement:
            "Readiness: Product — strong (On record: Product description, Problem slide, Solution slide.; evidence on record: 3).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F50",
          asOf: "2026-10-30T05:40:44.117Z",
          label: "founder_private",
          category: null,
          statement:
            "Readiness: Traction — gap (On record: Traction figures, Traction slide. Not yet: revenue evidence.; evidence on record: 2; would move it: Upload bank statements or invoices for the last three months.).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F51",
          asOf: "2026-10-30T05:40:44.117Z",
          label: "founder_private",
          category: null,
          statement:
            "Readiness: Financials — developing (On record: Business model slide. Not yet: burn, runway or margin, financial statements.; evidence on record: 1; would move it: Add monthly burn, runway in months, and gross margin if you have it.).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F52",
          asOf: "2026-10-30T05:40:44.117Z",
          label: "founder_private",
          category: null,
          statement:
            "Readiness: Execution — developing (On record: Team size, Go-to-market slide.; evidence on record: 2).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F53",
          asOf: "2026-10-30T05:40:44.117Z",
          label: "founder_private",
          category: null,
          statement:
            "Readiness: Governance & trust — not shared yet (No verification, cap table or company documents yet.; evidence on record: 0; would move it: Request company verification.).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F54",
          asOf: "2026-10-30T05:40:44.117Z",
          label: "founder_private",
          category: null,
          statement:
            "Readiness: Raise & documents — developing (On record: Pitch deck, Raise target, Use of funds. Not yet: fundraising documents.; evidence on record: 5; would move it: File a one-page summary in the data room.).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F55",
          asOf: null,
          label: "founder_private",
          category: null,
          statement:
            "Action plan step: Add 3 months of revenue evidence — to do (now) (why: Investors at this stage ask for it before a first call.; next: Upload bank statements or invoices for the last three months.; owner: You).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F56",
          asOf: null,
          label: "founder_private",
          category: null,
          statement:
            "Action plan step: Upload your pitch deck — done: Q sees the evidence (why: Almost every investor asks for the deck first.; next: Upload the deck you are sending investors.; owner: You).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          ref: "F57",
          asOf: null,
          label: "founder_private",
          category: null,
          statement:
            "Action plan step: Name your use of funds — done: Q sees the evidence (why: A target with no plan for the money reads as unfinished.; next: Say where the money goes: hiring, product, growth, runway.; owner: Q drafts, you approve; q can help: Draft my use of funds from my deck and plans, for me to approve.).",
          provenance: {
            url: null,
            tool: "read_my",
            record: null,
          },
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
      ],
      reason: null,
      source: "READINESS",
      status: "READ",
      truncated: true,
    },
    {
      facts: [],
      reason: "NOT_OFFERED",
      source: "CLAIMS",
      status: "UNAVAILABLE",
      truncated: false,
    },
    {
      facts: [
        {
          ref: "F58",
          asOf: "2026-10-28T15:39:54.710Z",
          label: "founder_private",
          category: "RAISE_TARGET",
          statement:
            "Current raise (raise, active): target USD 1200000, stage seed, instrument safe; started 2026-10-28.",
          provenance: {
            url: null,
            tool: "get_capital_objective",
            record: {
              id: "31633da0-87f9-4c5f-bd9a-a892a9251207",
              kind: "COMPANY",
            },
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F71",
          asOf: "2026-10-28",
          label: "founder_private",
          category: null,
          statement: "You told Q: monthly revenue is: growing month on month.",
          provenance: {
            url: null,
            tool: "read_my_record",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F72",
          asOf: "2026-10-28",
          label: "founder_private",
          category: null,
          statement: "You told Q: revenue last month was USD 65,000.",
          provenance: {
            url: null,
            tool: "read_my_record",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F73",
          asOf: "2026-10-28",
          label: "founder_private",
          category: null,
          statement: "You told Q: cash in the bank is USD 310,000.",
          provenance: {
            url: null,
            tool: "read_my_record",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F74",
          asOf: "2026-10-28",
          label: "founder_private",
          category: null,
          statement: "You told Q: monthly net burn is USD 65,000.",
          provenance: {
            url: null,
            tool: "read_my_record",
            record: null,
          },
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          ref: "F75",
          asOf: null,
          label: "founder_private",
          category: null,
          statement:
            'Your document "LedgerBridge financial report Sept 2026" is held back from Q by its classification (highly confidential): Q does not read it. You can state its key figures yourself (for example monthly revenue and its month), and Q will use them as yours.',
          provenance: {
            url: null,
            tool: "read_my_record",
            record: null,
          },
          truthClass: "UNKNOWN",
          evidenceStatus: "NO_EVIDENCE",
        },
      ],
      reason: null,
      source: "CAPITAL",
      status: "READ",
      truncated: false,
    },
    {
      facts: [],
      reason: null,
      source: "MANDATE",
      status: "NOT_APPLICABLE",
      truncated: false,
    },
    {
      facts: [],
      reason: null,
      source: "GATEQ",
      status: "NOT_APPLICABLE",
      truncated: false,
    },
    {
      facts: [],
      reason: null,
      source: "FEED_DECISIONS",
      status: "NOT_APPLICABLE",
      truncated: false,
    },
  ],
  unknowns: ["PUBLIC", "PROSPECTS", "PROFILE", "CLAIMS"],
  publicTopics: [
    "Business Customer NG",
    "Fintech NG",
    "Merchant Payments NG",
    "Payments NG",
    "LedgerBridge",
  ],
});

export const LIVE_37655270_STEPS = QPlanStepSchema.array().parse([
  {
    due: "2026-11-03",
    key: "s1",
    why: "The existing update covers LedgerBridge’s September reconciliation and remaining verification steps, but it has not been approved or sent. Q should revise it around the evidence that is available and mark the unresolved figures and checks clearly.",
    cites: ["F31", "F28", "F40", "F1", "F2"],
    jobId: null,
    owner: "Q",
    title:
      "Review the existing Aster Africa Ventures update and prepare it for your approval",
    action: {
      kind: "WORKFORCE",
      roles: ["DOCUMENTS"],
    },
    status: "TODO",
    waitsFor: [],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: false,
    evidenceNeeded: [
      "A revised draft of the existing Aster Africa Ventures update",
      "A clear separation between confirmed information, figures you supplied and unresolved evidence",
      "No private document or held-back figure quoted or shared",
    ],
  },
  {
    due: "2026-11-03",
    key: "s2",
    why: "You told Q that last-month revenue was USD 65,000, cash was USD 310,000 and monthly net burn was USD 65,000. Your private estimate says about three months of runway, while another indicative calculation showed 4.8 months, so you must confirm the current figures and assumptions rather than choosing between them.",
    cites: ["F36", "F39", "F72", "F73", "F74", "F75"],
    jobId: null,
    owner: "YOU",
    title:
      "Confirm LedgerBridge’s current revenue, cash, burn and runway before investor use",
    action: {
      kind: "TASK",
    },
    status: "TODO",
    waitsFor: [],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: false,
    evidenceNeeded: [
      "Your confirmed monthly revenue and the month it covers",
      "Your confirmed cash balance and monthly net burn",
      "Your confirmed runway calculation and assumptions",
      "Key figures from the held-back September 2026 financial report, stated by you",
    ],
  },
  {
    due: "2026-11-04",
    key: "s3",
    why: "Revenue evidence is the highest-ranked issue that could stop the raise, and the September traction figures are currently company-reported rather than supported by records. Provide the records and reconcile them to the reported USD 65,000 MRR, 140 active merchants and USD 4.1 million processed payments.",
    cites: ["F46", "F50", "F55", "F65", "F75", "F18", "F24"],
    jobId: null,
    owner: "YOU",
    title:
      "Provide three months of LedgerBridge revenue evidence and reconcile September traction",
    action: {
      kind: "TASK",
    },
    status: "TODO",
    waitsFor: [],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: false,
    evidenceNeeded: [
      "Three months of bank statements or invoices",
      "A reconciliation of September 2026 revenue to the reported USD 65,000 MRR",
      "Evidence or explanation for the 140 active merchants and USD 4.1 million processed payments",
      "Any difference between the records and the deck clearly explained",
    ],
  },
  {
    due: "2026-11-06",
    key: "s4",
    why: "Aster Africa Ventures wants to understand LedgerBridge’s regulatory setup, while founder identity and governance evidence are not yet on record. Prepare the position for an initial conversation without sharing the held-back financial report, market note or customer risk note.",
    cites: ["F40", "F47", "F53", "F69", "F15", "F19", "F25"],
    jobId: null,
    owner: "YOU",
    title:
      "Complete founder verification and prepare LedgerBridge’s Nigerian regulatory and control position",
    action: {
      kind: "TASK",
    },
    status: "TODO",
    waitsFor: [],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: false,
    evidenceNeeded: [
      "Completed identity verification for Tunde Bello and Ada Okafor",
      "Your written Nigerian regulatory position and responsibilities",
      "A governance and finance-control summary suitable for an initial investor conversation",
      "A list of private documents that remain unshared",
    ],
  },
  {
    due: "2026-11-07",
    key: "s5",
    why: "The deck has no market or competition section. Research should compare LedgerBridge with payment gateways, accounting tools and the manual bank-transfer process used by Nigerian distributors and merchants, focusing on the supplier-payment and reconciliation workflow.",
    cites: ["F48", "F62", "F66", "F35", "F59", "F60"],
    jobId: null,
    owner: "Q",
    title:
      "Research the Nigerian B2B payments market and LedgerBridge’s competitive alternatives",
    action: {
      kind: "WORKFORCE",
      roles: ["RESEARCH"],
    },
    status: "TODO",
    waitsFor: [],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: false,
    evidenceNeeded: [
      "Sourced Nigerian B2B payments market size and growth evidence",
      "Comparison with relevant payment gateways, accounting tools and manual bank transfers",
      "Implications for LedgerBridge’s supplier-payment and reconciliation positioning",
    ],
  },
  {
    due: "2026-11-11",
    key: "s6",
    why: "The deck does not quantify the customer outcome from reducing manual reconciliation, and it omits acquisition channels, sales motion, customer acquisition cost, expansion mechanics, gross margin, unit economics and currency mix. Add measured figures where you have them and label estimates clearly.",
    cites: ["F61", "F63", "F64", "F65"],
    jobId: null,
    owner: "YOU",
    title:
      "Revise the LedgerBridge deck with customer outcomes, acquisition mechanics and unit economics",
    action: {
      kind: "TASK",
    },
    status: "TODO",
    waitsFor: [],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: false,
    evidenceNeeded: [
      "A measured customer outcome from LedgerBridge’s records",
      "Acquisition channels and sales motion for Lagos and Abuja",
      "Customer acquisition cost and expansion assumptions",
      "Gross margin, unit economics and currency mix, or explicit estimates",
    ],
  },
  {
    due: "2026-11-11",
    key: "s7",
    why: "The deck lacks historical financial statements, a forward financial plan and operating spend, and it does not identify key non-founder roles, hiring plans or advisors. Use the recorded 50% engineering and compliance, 30% Lagos and Abuja merchant acquisition, and 20% working-capital allocation, asking only for changes or additional milestones.",
    cites: ["F54", "F58", "F67", "F68", "F70", "F51"],
    jobId: null,
    owner: "YOU",
    title:
      "Complete the LedgerBridge financial plan, raise case and team plan using the recorded allocation",
    action: {
      kind: "TASK",
    },
    status: "TODO",
    waitsFor: [],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: false,
    evidenceNeeded: [
      "Historical financial summary and forward financial plan",
      "Any changes to the recorded use-of-funds allocation",
      "Milestones linked to the USD 1.2 million SAFE and 18-month targets",
      "Key non-founder roles, hiring plan and advisors, if applicable",
    ],
  },
  {
    due: "2026-11-12",
    key: "s8",
    why: "A company-profile update is waiting for your approval and has not been changed. Decide whether the proposed profile accurately presents LedgerBridge for this raise before any investor-facing profile change is made.",
    cites: ["F30"],
    jobId: null,
    owner: "TOGETHER",
    title:
      "Review and approve or decline the pending LedgerBridge company-profile update",
    action: {
      kind: "APP_ACTION",
      name: "company.profile.update",
    },
    status: "TODO",
    waitsFor: [],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: true,
    evidenceNeeded: [
      "Your approval or decline recorded on the company-profile update",
      "The saved profile, if approved, matches your current LedgerBridge description",
    ],
  },
  {
    due: "2026-11-13",
    key: "s9",
    why: "The revised seed deck is the identified document for Aster Africa Ventures, while the September financial report, market note and internal customer risk note are private. Share only the exact revised deck after your approval; the other documents remain held back unless you separately approve a specific share.",
    cites: ["F21", "F42", "F43", "F44", "F45"],
    jobId: null,
    owner: "TOGETHER",
    title:
      "Approve sharing only the revised LedgerBridge seed deck with Aster Africa Ventures",
    action: {
      kind: "APP_ACTION",
      name: "document.access.share",
    },
    status: "TODO",
    waitsFor: [],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: true,
    evidenceNeeded: [
      "Your approval records the revised LedgerBridge seed deck as the only document to share",
      "The September financial report, market note and internal customer risk note remain unshared",
      "The approved access period and permissions are recorded",
    ],
  },
  {
    due: "2026-11-14",
    key: "s10",
    why: "Aster Africa Ventures is connected and has requested an initial conversation about LedgerBridge’s operating metrics, Nigerian regulatory setup and fundraising objective. Prepare the meeting proposal only after the evidence, revised deck and sharing decision are complete; if an existing proposal is declined or expires, prepare a replacement.",
    cites: ["F3", "F40", "F4", "F5", "F6", "F16", "F22"],
    jobId: null,
    owner: "Q",
    title:
      "Approve the Aster Africa Ventures meeting proposal after LedgerBridge’s evidence and deck are ready",
    action: {
      kind: "TOOL_PROPOSAL",
      tool: "propose_meeting",
    },
    status: "TODO",
    waitsFor: [
      {
        kind: "STEP_DONE",
        stepKey: "s4",
      },
    ],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: true,
    evidenceNeeded: [
      "A meeting proposal for your approval after the evidence and deck steps are complete",
      "Preparation notes covering operating metrics, Nigerian regulatory setup and the USD 1.2 million SAFE",
      "Confirmation that no meeting is booked without your approval",
    ],
  },
  {
    due: "2026-11-28",
    key: "s11",
    why: "Use a LedgerBridge-specific screen: Nigerian or Africa focus, B2B payments or fintech relevance, seed-stage fit, ability to participate in a USD 1.2 million SAFE and a realistic path to a first conversation. Each draft must address LedgerBridge’s Nigerian supplier-payment workflow, the confirmed traction evidence when available and any remaining evidence limitation.",
    cites: ["F40", "F58", "F35", "F65", "F75"],
    jobId: null,
    owner: "Q",
    title:
      "Research and draft targeted outreach to investors suited to LedgerBridge’s eight-week raise",
    action: {
      kind: "WORKFORCE",
      roles: ["RESEARCH", "OUTREACH"],
    },
    status: "TODO",
    waitsFor: [
      {
        kind: "STEP_DONE",
        stepKey: "s7",
      },
    ],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: true,
    evidenceNeeded: [
      "A sourced and prioritised list using the five LedgerBridge-specific screening criteria",
      "One tailored draft for each investor you select",
      "Reference to the Nigerian supplier-payment workflow and USD 1.2 million SAFE",
      "Confirmed traction evidence where available and any remaining limitation clearly stated",
      "Your approval recorded before any message is sent",
    ],
  },
  {
    due: "2026-12-25",
    key: "s12",
    why: "After the Aster Africa Ventures proposal and targeted outreach, the raise needs an active final phase rather than stopping at first messages. Prepare approved replies, meeting proposals, diligence materials and a round-status review as investors respond, without sharing private documents unless you approve each exact share.",
    cites: ["F3", "F40", "F41", "F42", "F43", "F44", "F45", "F58"],
    jobId: null,
    owner: "Q",
    title:
      "Manage weeks five to eight: investor replies, further meetings, diligence requests and round status",
    action: {
      kind: "WORKFORCE",
      roles: ["CONVERSATION", "SCHEDULER", "DOCUMENTS"],
    },
    status: "TODO",
    waitsFor: [
      {
        kind: "STEP_DONE",
        stepKey: "s7",
      },
    ],
    proposalId: null,
    reminderId: null,
    boardItemId: null,
    needsApproval: true,
    evidenceNeeded: [
      "Approved replies to investor responses",
      "Approved meeting proposals and recorded outcomes for any further conversations",
      "A list of diligence requests with an approved response or outstanding owner",
      "Only specifically approved documents shared with each investor",
      "A round-status review covering investor stage, next action, evidence gaps and progress against the USD 1.2 million target",
    ],
  },
]);

export const LIVE_37655270_OPEN_POINTS: readonly string[] = [
  "Make sure no step states or shares an investor's private notes or decisions, and that your own private or held-back documents are only named as held back, never quoted, and shared only through their own approval step.",
  "Step 1: Remove “You created an evidence item (11 times; latest…” and “You registered a source (9 times; latest 2026-10-30)” from step 1, or add a specific explanation of how those activities affect the update; retain “Remembered: 2026-10-30 LedgerBridge 12-month financial model: Tunde asked…”.",
  "Step 6: Name the specific outcomes to quantify, such as reduced manual reconciliation effort and reduced supplier payment waiting time, and tie them to LedgerBridge's records.",
  "Step 12: Name Aster Africa Ventures and any subsequently sourced investors, and define the stages and next actions for reply, first meeting, diligence, follow-up and round-status review.",
  "Step 1: State that the existing pending Aster message will be superseded or reviewed first, and specify the approval or withdrawal decision before preparing any replacement.",
  "Step 12: Add explicit branches for an unapproved or unanswered Aster proposal and for requests concerning revenue evidence, founder verification, regulatory setup, or the held-back documents.",
  "Step 12: Set a review cadence and response deadlines for each investor event, with a named next action and owner for an Aster reply, a new meeting request, each diligence request and the final round-status review.",
  "Step 11: Add a selection checkpoint after the sourced screen, specify how many investors can be prioritised within the period, then draft outreach only for the approved shortlist.",
  "Step 10: Ask Tunde to decide on the existing pending proposal first; prepare a new proposal only if it is declined, expires or is otherwise no longer usable.",
  "Step 8: Name the specific profile fields to verify, including LedgerBridge’s Nigerian B2B payments positioning, Tunde Bello and Ada Okafor, the USD 1.2 million SAFE raise and any current traction figures.",
  "Step 10: Add an initial step to review and approve, decline or replace the existing pending Aster proposals and messages in “Waiting for your approval, not approved yet (nothing…”-“Waiting for your approval, not approved yet (nothing…”; make the later meeting proposal conditional on that outcome.",
  "Step 1: Make this step explicitly draft-only and add a subsequent approval step, or change the action and approval status so Tunde must approve the revised Aster update before it is used or sent.",
];
