/**
 * Run 91bb8564 (conversation 2a26d43b, production a65386689, 16 Nov 2026
 * 21:33 UTC), as stored: the plan's retrieved passages
 * (q_knowledge.chunks of "Team and hiring plan", c0d522b1, every ACTIVE
 * chunk in order), the data room listing the run read
 * (company.data_room.read) and the two pages reads it made
 * (company.data_room.document.pages.read), from
 * q_runtime.conversation_tool_results. A synthetic demo company; read-only
 * copies, verbatim.
 */

export const PLAN_CHUNKS: readonly string[] = [
  "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD",
  "Team and hiring plan\n\nHalyard Security Ltd | Period: May 2025 to Dec 2027 | Version 1.0 | Issued 13 Nov 2026",
  "Founders\n\nCallum Reid, Co-founder & CEO. Former incident responder at the national cyber security centre who led the response to two ransomware attacks on public bodies. Both started with a phished password. Eilidh MacLeod, Co-founder & CTO. Identity engineer; previously built single sign-on for a UK public cloud supplier. Leads the enrolment and recovery platform.",
  "Key people\n\nJamie Fraser, Head of Public Sector Partnerships. Ten years selling into NHS boards and councils. Manages framework listings and procurement.",
  "Headcount at 31 Oct 2026\n\nFunction | People\n\nEngineering | 9\n\nDeployment | 9\n\nSales | 3\n\nOperations | 2\n\nTotal | 23",
  "Headcount by function: May 2025 to Oct 2025\n\nMay 2025 | Jun 2025 | Jul 2025 | Aug 2025 | Sep 2025 | Oct 2025\n\nEngineering | 5 | 5 | 5 | 6 | 6 | 6\n\nDeployment | 2 | 2 | 3 | 3 | 3 | 4\n\nSales | 1 | 1 | 1 | 2 | 2 | 2\n\nOperations | 1 | 1 | 1 | 1 | 1 | 1\n\nTotal | 9 | 9 | 10 | 12 | 12 | 13",
  "Headcount by function: Nov 2025 to Apr 2026\n\nNov 2025 | Dec 2025 | Jan 2026 | Feb 2026 | Mar 2026 | Apr 2026\n\nEngineering | 7 | 7 | 7 | 7 | 8 | 8\n\nDeployment | 4 | 4 | 5 | 5 | 5 | 6\n\nSales | 2 | 2 | 2 | 2 | 2 | 3\n\nOperations | 1 | 1 | 2 | 2 | 2 | 2\n\nTotal | 14 | 14 | 16 | 16 | 17 | 19",
  "Headcount by function: May 2026 to Oct 2026\n\nMay 2026 | Jun 2026 | Jul 2026 | Aug 2026 | Sep 2026 | Oct 2026\n\nEngineering | 8 | 9 | 9 | 9 | 9 | 9\n\nDeployment | 6 | 6 | 7 | 7 | 7 | 9\n\nSales | 3 | 3 | 3 | 3 | 3 | 3\n\nOperations | 2 | 2 | 2 | 2 | 2 | 2\n\nTotal | 19 | 20 | 21 | 21 | 21 | 23",
  "Hiring plan funded by the seed round\n\nRole | Function | People Start by | Use of funds line\n\nDeployment engineer | Deployment | 6 2027-Q2 | Deployment team for NHS trusts and councils\n\nProduct engineer (shared workstations, Engineering | 4 2027-Q2 | Product: shared workstation and lost-device flows\n\nlost devices)\n\nPublic-sector account manager | Sales | 3 2027-Q1 | Public-sector sales and framework listings\n\nInformation security and assurance | Operations | 1 2027-Q1 | Assurance (Cyber Essentials Plus, DSPT, ISO 27001) and\n\nmanager | G&A\n\nFinance and operations manager | Operations | 1 2027-Q3 | Assurance (Cyber Essentials Plus, DSPT, ISO 27001) and\n\nG&A",
  "SYNTHETIC DEMO DOCUMENT\n\nHalyard Security Ltd | Team and hiring plan Version 1.0 | Period: May 2025 to Dec 2027 | Issued 13 Nov 2026 | Page 1/1",
];

export const DATA_ROOM_READ = {
  viewer: "INVESTOR",
  documents: [
    {
      title: "Halyard Security seed deck (Oct 2026)",
      folder: "Fundraising summary",
      status: "open to you",
      documentId: "eb34fa88-5f78-4872-a887-bb5ff206bef2",
    },
    {
      title: "HMRC tax position and SEIS-EIS advance assurance",
      folder: "Tax and compliance",
      status: "on request",
      documentId: "dd0b4b57-a253-4e42-895b-ba21e4e698e7",
    },
    {
      title: "IP assignment deeds (founders and staff)",
      folder: "Legal and IP",
      status: "on request",
      documentId: "1da0c9c7-0fc7-427d-9e69-f9150e57c89a",
    },
    {
      title: "NHS Data Security and Protection Toolkit submission",
      folder: "Legal and IP",
      status: "on request",
      documentId: "ace3a73d-f6ab-467d-94c0-06492f7bb7a5",
    },
    {
      title: "Phishing outcome reporting method",
      folder: "Financials",
      status: "on request",
      documentId: "b0595ebf-36b7-4740-8de9-10c96185d47d",
    },
    {
      title: "Management accounts, May 2025 to Oct 2026",
      folder: "Financials",
      status: "shared with you",
      documentId: "7d1605cc-060f-491f-8ca1-b579045e2ccf",
    },
    {
      title:
        "Business account statement, Aug 2026 to Oct 2026, with monthly balances",
      folder: "Other documents",
      status: "shared with you",
      documentId: "38864c09-3e4b-4bde-ae55-31fc2a2ed89b",
    },
    {
      title: "Customer cohorts and retention",
      folder: "Financials",
      status: "shared with you",
      documentId: "fdb97f87-93f1-42fd-aec3-300260acd370",
    },
    {
      title: "Customer concentration",
      folder: "Customers and contracts",
      status: "shared with you",
      documentId: "65799eaa-cf25-480d-bda1-d86d757ecafa",
    },
    {
      title: "Capitalisation table and ownership",
      folder: "Other documents",
      status: "shared with you",
      documentId: "4aeb44c3-73d3-4da6-9357-b2ed5252cb5f",
    },
    {
      title: "Seed round terms and use of funds",
      folder: "Fundraising summary",
      status: "shared with you",
      documentId: "85629237-aa92-4e5f-831c-33d0f2a79e19",
    },
    {
      title: "Projections to December 2027, with assumptions",
      folder: "Financials",
      status: "shared with you",
      documentId: "b3d7f334-45ae-41ad-a2a5-feb5808a7d13",
    },
    {
      title: "KPI and product metrics pack",
      folder: "Fundraising summary",
      status: "shared with you",
      documentId: "ebdded05-8b00-4e9b-932a-32e87829ac50",
    },
    {
      title: "Team and hiring plan",
      folder: "Team",
      status: "shared with you",
      documentId: "c0d522b1-ca99-4e7d-ad83-cb99ba7326ef",
    },
  ],
  openRequests: 0,
};

export const MANAGEMENT_ACCOUNTS_READ = {
  pages: [
    {
      page: 1,
      text: "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD\nManagement accounts, May 2025 to Oct 2026\nHalyard Security Ltd | Period: May 2025 to Oct 2026 | Version 1.0 | Issued 13 Nov 2026\nBasis of preparation\nPrepared by the company's finance lead; unaudited management information. Accrual basis. Amounts in GBP, whole units. Revenue recognition: licences at 12 per user per year are recognised monthly (1.00 per licensed seat per month). Deployment fees are invoiced at contract signature and recognised at go-live. The deployment team's payroll is reported in cost of sales.\nSummary for October 2026\nOct 2026\nRevenue | 73,000\nGross profit | 16,660\nNet result for the month | -90,340\nCash at month end | 388,070\nNet burn (payments less customer receipts) | 92,340\nRunway at this month's net burn (months) | 4.2\nHeadcount at month end | 23\nGross margin, 12 months to Oct 2026: 29.3% (revenue 628,247, cost of revenue 444,255). Licence gross margin, 12 months to Oct 2026: 82.0% (licence revenue 574,747 less hosting, authenticator services and support tooling 103,455; excludes the deployment team and deployment fees).\nProfit and loss: May 2025 to Oct 2025\nMay 2025 | Jun 2025 | Jul 2025 | Aug 2025 | Sep 2025 | Oct 2025\nLicence fees | 16,800 | 17,900 | 19,400 | 21,600 | 22,700 | 24,000\nDeployment fees | 0 | 0 | 0 | 8,500 | 0 | 0\nTotal revenue | 16,800 | 17,900 | 19,400 | 30,100 | 22,700 | 24,000\nHosting and infrastructure | 1,680 | 1,790 | 1,940 | 2,160 | 2,270 | 2,400\nAuthenticator and attestation services | 840 | 895 | 970 | 1,080 | 1,135 | 1,200\nSupport tooling | 504 | 537 | 582 | 648 | 681 | 720\nDeployment team payroll | 9,600 | 9,600 | 14,400 | 14,400 | 14,400 | 19,200\nTotal cost of revenue | 12,624 | 12,822 | 17,892 | 18,288 | 18,486 | 23,520\nGross profit | 4,176 | 5,078 | 1,508 | 11,812 | 4,214 | 480\nPayroll - engineering | 30,000 | 30,000 | 30,000 | 36,000 | 36,000 | 36,000\nPayroll - sales | 5,600 | 5,600 | 5,600 | 11,200 | 11,200 | 11,200\nPayroll - operations | 4,800 | 4,800 | 4,800 | 4,800 | 4,800 | 4,800\nOffices (Edinburgh, Manchester) | 4,200 | 4,200 | 4,200 | 4,200 | 4,200 | 4,200\nSoftware and tools | 2,400 | 2,400 | 2,400 | 2,400 | 2,400 | 2,400\nProfessional fees | 4,500 | 4,500 | 4,500 | 4,500 | 4,500 | 4,500\nAssurance and certifications | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500\nInsurance | 900 | 900 | 900 | 900 | 900 | 900\nTravel and on-site deployment | 2,400 | 2,400 | 2,400 | 2,400 | 2,400 | 2,400\nRecruitment | 0 | 0 | 0 | 0 | 0 | 0\nOther | 1,600 | 1,600 | 1,600 | 1,600 | 1,600 | 1,600\nTotal operating expenses | 57,900 | 57,900 | 57,900 | 69,500 | 69,500 | 69,500\nNet result | -53,724 | -52,822 | -56,392 | -57,688 | -65,286 | -69,020\nHeadcount (month end) | 9 | 9 | 10 | 12 | 12 | 13\nProfit and loss: Nov 2025 to Apr 2026\nSYNTHETIC DEMO DOCUMENT\nHalyard Security Ltd | Management accounts, May 2025 to Oct 2026 Version 1.0 | Period: May 2025 to Oct 2026 | Issued 13 Nov 2026 | Page 1/3",
    },
    {
      page: 2,
      text: "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD\nNov 2025 | Dec 2025 | Jan 2026 | Feb 2026 | Mar 2026 | Apr 2026\nLicence fees | 27,000 | 29,232 | 32,300 | 35,604 | 39,800 | 43,366\nDeployment fees | 8,500 | 0 | 0 | 0 | 7,000 | 0\nTotal revenue | 35,500 | 29,232 | 32,300 | 35,604 | 46,800 | 43,366\nHosting and infrastructure | 2,700 | 2,923 | 3,230 | 3,560 | 3,980 | 4,337\nAuthenticator and attestation services | 1,350 | 1,462 | 1,615 | 1,780 | 1,990 | 2,168\nSupport tooling | 810 | 877 | 969 | 1,068 | 1,194 | 1,301\nDeployment team payroll | 19,200 | 19,200 | 24,000 | 24,000 | 24,000 | 28,800\nTotal cost of revenue | 24,060 | 24,462 | 29,814 | 30,408 | 31,164 | 36,606\nGross profit | 11,440 | 4,770 | 2,486 | 5,196 | 15,636 | 6,760\nPayroll - engineering | 42,000 | 42,000 | 42,000 | 42,000 | 48,000 | 48,000\nPayroll - sales | 11,200 | 11,200 | 11,200 | 11,200 | 11,200 | 16,800\nPayroll - operations | 4,800 | 4,800 | 9,600 | 9,600 | 9,600 | 9,600\nOffices (Edinburgh, Manchester) | 4,200 | 4,200 | 4,200 | 4,200 | 5,600 | 5,600\nSoftware and tools | 2,400 | 2,400 | 2,400 | 2,400 | 2,400 | 2,400\nProfessional fees | 4,500 | 4,500 | 4,500 | 4,500 | 4,500 | 4,500\nAssurance and certifications | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500\nInsurance | 900 | 900 | 900 | 900 | 900 | 900\nTravel and on-site deployment | 2,400 | 2,400 | 2,400 | 2,400 | 5,600 | 5,600\nRecruitment | 0 | 0 | 0 | 0 | 0 | 0\nOther | 1,600 | 1,600 | 1,600 | 1,600 | 1,600 | 1,600\nTotal operating expenses | 75,500 | 75,500 | 80,300 | 80,300 | 90,900 | 96,500\nNet result | -64,060 | -70,730 | -77,814 | -75,104 | -75,264 | -89,740\nHeadcount (month end) | 14 | 14 | 16 | 16 | 17 | 19\nProfit and loss: May 2026 to Oct 2026\nMay 2026 | Jun 2026 | Jul 2026 | Aug 2026 | Sep 2026 | Oct 2026\nLicence fees | 48,000 | 52,819 | 58,293 | 64,333 | 71,000 | 73,000\nDeployment fees | 8,500 | 0 | 7,000 | 8,500 | 14,000 | 0\nTotal revenue | 56,500 | 52,819 | 65,293 | 72,833 | 85,000 | 73,000\nHosting and infrastructure | 4,800 | 5,282 | 5,829 | 6,433 | 7,100 | 7,300\nAuthenticator and attestation services | 2,400 | 2,641 | 2,915 | 3,217 | 3,550 | 3,650\nSupport tooling | 1,440 | 1,585 | 1,749 | 1,930 | 2,130 | 2,190\nDeployment team payroll | 28,800 | 28,800 | 33,600 | 33,600 | 33,600 | 43,200\nTotal cost of revenue | 37,440 | 38,308 | 44,093 | 45,180 | 46,380 | 56,340\nGross profit | 19,060 | 14,511 | 21,200 | 27,653 | 38,620 | 16,660\nPayroll - engineering | 48,000 | 54,000 | 54,000 | 54,000 | 54,000 | 54,000\nPayroll - sales | 16,800 | 16,800 | 16,800 | 16,800 | 16,800 | 16,800\nPayroll - operations | 9,600 | 9,600 | 9,600 | 9,600 | 9,600 | 9,600\nOffices (Edinburgh, Manchester) | 5,600 | 5,600 | 5,600 | 5,600 | 5,600 | 5,600\nSoftware and tools | 2,400 | 2,400 | 2,400 | 2,400 | 2,400 | 2,400\nProfessional fees | 4,500 | 4,500 | 4,500 | 4,500 | 4,500 | 4,500\nAssurance and certifications | 1,500 | 1,500 | 1,500 | 1,500 | 1,500 | 1,500\nInsurance | 900 | 900 | 900 | 900 | 900 | 900\nTravel and on-site deployment | 5,600 | 5,600 | 5,600 | 5,600 | 5,600 | 5,600\nRecruitment | 0 | 0 | 0 | 0 | 0 | 4,500\nOther | 1,600 | 1,600 | 1,600 | 1,600 | 1,600 | 1,600\nTotal operating expenses | 96,500 | 102,500 | 102,500 | 102,500 | 102,500 | 107,000\nNet result | -77,440 | -87,989 | -81,300 | -74,847 | -63,880 | -90,340\nHeadcount (month end) | 19 | 20 | 21 | 21 | 21 | 23\nCash flow: May 2025 to Oct 2025\nMay 2025 | Jun 2025 | Jul 2025 | Aug 2025 | Sep 2025 | Oct 2025\nOpening cash | 228,310 | 173,986 | 120,064 | 1,562,172 | 1,502,284 | 1,435,898\nReceipts from customers | 16,200 | 16,800 | 17,900 | 27,900 | 21,600 | 22,700\nFunding received | 0 | 0 | 1,500,000 | 0 | 0 | 0\nPayments | 70,524 | 70,722 | 75,792 | 87,788 | 87,986 | 93,020\nClosing cash | 173,986 | 120,064 | 1,562,172 | 1,502,284 | 1,435,898 | 1,365,578\nNet burn | 54,324 | 53,922 | 57,892 | 59,888 | 66,386 | 70,320\nRunway (months) | 3.2 | 2.2 | 27.0 | 25.1 | 21.6 | 19.4\nSYNTHETIC DEMO DOCUMENT\nHalyard Security Ltd | Management accounts, May 2025 to Oct 2026 Version 1.0 | Period: May 2025 to Oct 2026 | Issued 13 Nov 2026 | Page 2/3",
    },
    {
      page: 3,
      text: "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD\nCash flow: Nov 2025 to Apr 2026\nNov 2025 | Dec 2025 | Jan 2026 | Feb 2026 | Mar 2026 | Apr 2026\nOpening cash | 1,365,578 | 1,298,518 | 1,225,556 | 1,144,674 | 1,066,266 | 986,806\nReceipts from customers | 32,500 | 27,000 | 29,232 | 32,300 | 42,604 | 39,800\nFunding received | 0 | 0 | 0 | 0 | 0 | 0\nPayments | 99,560 | 99,962 | 110,114 | 110,708 | 122,064 | 133,106\nClosing cash | 1,298,518 | 1,225,556 | 1,144,674 | 1,066,266 | 986,806 | 893,500\nNet burn | 67,060 | 72,962 | 80,882 | 78,408 | 79,460 | 93,306\nRunway (months) | 19.4 | 16.8 | 14.2 | 13.6 | 12.4 | 9.6\nCash flow: May 2026 to Oct 2026\nMay 2026 | Jun 2026 | Jul 2026 | Aug 2026 | Sep 2026 | Oct 2026\nOpening cash | 893,500 | 811,426 | 718,618 | 631,844 | 550,957 | 480,410\nReceipts from customers | 51,866 | 48,000 | 59,819 | 66,793 | 78,333 | 71,000\nFunding received | 0 | 0 | 0 | 0 | 0 | 0\nPayments | 133,940 | 140,808 | 146,593 | 147,680 | 148,880 | 163,340\nClosing cash | 811,426 | 718,618 | 631,844 | 550,957 | 480,410 | 388,070\nNet burn | 82,074 | 92,808 | 86,774 | 80,887 | 70,547 | 92,340\nRunway (months) | 9.9 | 7.7 | 7.3 | 6.8 | 6.8 | 4.2\nFunding received in the period\nDate | Round | Instrument | Amount (GBP)\n18 Jul 2025 | Advance subscription (pre-seed extension) | Advance subscription agreement (EIS); converts at the seed | 1,500,000\nround at a 20% discount\nBalance sheet summary at 31 Oct 2026\nGBP\nCash at bank | 388,070\nTrade receivables | 73,000\nTotal assets | 461,070\nDeferred revenue | 0\nOther payables and accruals | 22,000\nTotal liabilities | 22,000\nNet assets | 439,070\nCapital raised to date | 2,100,000\nAccumulated losses | -1,660,930\nTotal equity | 439,070\nFixed assets are expensed as bought in this summary. The detailed monthly figures are in the monthly actuals data file; revenue by customer and the invoice reconciliation are in the revenue breakdown.\nSYNTHETIC DEMO DOCUMENT\nHalyard Security Ltd | Management accounts, May 2025 to Oct 2026 Version 1.0 | Period: May 2025 to Oct 2026 | Issued 13 Nov 2026 | Page 3/3",
    },
  ],
  title: "Management accounts, May 2025 to Oct 2026",
  folder: "Financials",
  status: "READ",
  pageCount: 3,
  truncated: false,
  documentId: "7d1605cc-060f-491f-8ca1-b579045e2ccf",
  truthClass: "USER_CLAIM",
  sharedUnder: {
    say: "The founder shared this document with their organisation, so Q may read it for them. It is the company's own management material: say what it states as the company's figures (for example 'their management accounts show...'), not as independently verified, and never pass it on to anyone else.",
    grantId: "6e1e114d-715e-4a2f-ae80-03bdbfd7c421",
    expiresAt: "2027-02-14T07:38:56.610Z",
  },
  evidenceStatus: "DOCUMENT_SUPPORTED",
};

export const BANK_STATEMENT_READ = {
  pages: [
    {
      page: 1,
      text: "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD\nBusiness account statement, Aug 2026 to Oct 2026, with monthly balances\nHalyard Security Ltd | Period: May 2025 to Oct 2026 | Version 1.0 | Issued 13 Nov 2026\nAccount\nBank | Thistledown Merchant Bank (a fictitious institution created for this demonstration)\nAccount name | Halyard Security Ltd - business current account\nAccount number | XXXX XXXX 2093\nSort code | XX-XX-XX\nCurrency | GBP\nStatement period | 01 Aug 2026 to 31 Oct 2026\nMonthly balances, May 2025 to Oct 2026\nMonth | Opening balance | Money in | Money out | Closing balance\nMay 2025 | 228,310 | 16,200 | 70,524 | 173,986\nJun 2025 | 173,986 | 16,800 | 70,722 | 120,064\nJul 2025 | 120,064 | 1,517,900 | 75,792 | 1,562,172\nAug 2025 | 1,562,172 | 27,900 | 87,788 | 1,502,284\nSep 2025 | 1,502,284 | 21,600 | 87,986 | 1,435,898\nOct 2025 | 1,435,898 | 22,700 | 93,020 | 1,365,578\nNov 2025 | 1,365,578 | 32,500 | 99,560 | 1,298,518\nDec 2025 | 1,298,518 | 27,000 | 99,962 | 1,225,556\nJan 2026 | 1,225,556 | 29,232 | 110,114 | 1,144,674\nFeb 2026 | 1,144,674 | 32,300 | 110,708 | 1,066,266\nMar 2026 | 1,066,266 | 42,604 | 122,064 | 986,806\nApr 2026 | 986,806 | 39,800 | 133,106 | 893,500\nMay 2026 | 893,500 | 51,866 | 133,940 | 811,426\nJun 2026 | 811,426 | 48,000 | 140,808 | 718,618\nJul 2026 | 718,618 | 59,819 | 146,593 | 631,844\nAug 2026 | 631,844 | 66,793 | 147,680 | 550,957\nSep 2026 | 550,957 | 78,333 | 148,880 | 480,410\nOct 2026 | 480,410 | 71,000 | 163,340 | 388,070\nTransactions, August 2026\nDate | Description | Money in | Money out | Balance\n01 Aug 2026 | Opening balance | 631,844\n01 Aug 2026 | Office rent | 5,600 | 626,244\n03 Aug 2026 | Authenticator services provider | 3,217 | 623,027\n03 Aug 2026 | Cloud hosting provider | 6,433 | 616,594\n03 Aug 2026 | Support tooling subscription | 1,930 | 614,664\n05 Aug 2026 | Software subscriptions | 2,400 | 612,264\n10 Aug 2026 | Insurance premium | 900 | 611,364\n12 Aug 2026 | Professional fees | 4,500 | 606,864\n14 Aug 2026 | Receipt - Customer 9 (NHS ambulance trust) - HS-INV-0076 | 8,500 | 615,364\n14 Aug 2026 | Assurance and certification fees | 1,500 | 613,864\n18 Aug 2026 | Travel and on-site costs | 5,600 | 608,264\n22 Aug 2026 | Sundry payments | 1,600 | 606,664\n25 Aug 2026 | Payroll and employer costs | 114,000 | 492,664\n28 Aug 2026 | Receipt - Customer 1 (NHS acute trust) - HS-INV-0077 | 15,457 | 508,121\n28 Aug 2026 | Receipt - Customer 2 (Scottish health board) - HS-INV-0078 | 11,994 | 520,115\n28 Aug 2026 | Receipt - Customer 3 (Metropolitan borough council) - | 6,326 | 526,441\nHS-INV-0079\n28 Aug 2026 | Receipt - Customer 4 (NHS community trust) - HS-INV-0080 | 4,575 | 531,016\n28 Aug 2026 | Receipt - Customer 5 (NHS acute trust) - HS-INV-0081 | 9,800 | 540,816\n28 Aug 2026 | Receipt - Customer 6 (County council) - HS-INV-0082 | 4,216 | 545,032\n28 Aug 2026 | Receipt - Customer 7 (NHS mental health trust) - HS-INV-0083 | 3,325 | 548,357\n28 Aug 2026 | Receipt - Customer 8 (City council) - HS-INV-0084 | 2,600 | 550,957\n31 Aug 2026 | Closing balance | 550,957\nSYNTHETIC DEMO DOCUMENT\nHalyard Security Ltd | Business account statement, Aug 2026 to Oct 2026, with monthly balances Version 1.0 | Period: May 2025 to Oct 2026 | Issued 13 Nov 2026 | Page 1/2",
    },
    {
      page: 2,
      text: "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD\nTransactions, September 2026\nDate | Description | Money in | Money out | Balance\n01 Sep 2026 | Opening balance | 550,957\n01 Sep 2026 | Office rent | 5,600 | 545,357\n03 Sep 2026 | Authenticator services provider | 3,550 | 541,807\n03 Sep 2026 | Cloud hosting provider | 7,100 | 534,707\n03 Sep 2026 | Support tooling subscription | 2,130 | 532,577\n05 Sep 2026 | Software subscriptions | 2,400 | 530,177\n10 Sep 2026 | Insurance premium | 900 | 529,277\n12 Sep 2026 | Professional fees | 4,500 | 524,777\n14 Sep 2026 | Receipt - Customer 10 (District council) - HS-INV-0085 | 7,000 | 531,777\n14 Sep 2026 | Receipt - Customer 11 (Unitary authority) - HS-INV-0086 | 7,000 | 538,777\n14 Sep 2026 | Assurance and certification fees | 1,500 | 537,277\n18 Sep 2026 | Travel and on-site costs | 5,600 | 531,677\n22 Sep 2026 | Sundry payments | 1,600 | 530,077\n25 Sep 2026 | Payroll and employer costs | 114,000 | 416,077\n28 Sep 2026 | Receipt - Customer 1 (NHS acute trust) - HS-INV-0087 | 16,179 | 432,256\n28 Sep 2026 | Receipt - Customer 2 (Scottish health board) - HS-INV-0088 | 12,612 | 444,868\n28 Sep 2026 | Receipt - Customer 3 (Metropolitan borough council) - | 6,687 | 451,555\nHS-INV-0089\n28 Sep 2026 | Receipt - Customer 4 (NHS community trust) - HS-INV-0090 | 4,884 | 456,439\n28 Sep 2026 | Receipt - Customer 5 (NHS acute trust) - HS-INV-0091 | 9,800 | 466,239\n28 Sep 2026 | Receipt - Customer 6 (County council) - HS-INV-0092 | 4,628 | 470,867\n28 Sep 2026 | Receipt - Customer 7 (NHS mental health trust) - HS-INV-0093 | 3,634 | 474,501\n28 Sep 2026 | Receipt - Customer 8 (City council) - HS-INV-0094 | 2,909 | 477,410\n28 Sep 2026 | Receipt - Customer 9 (NHS ambulance trust) - HS-INV-0095 | 3,000 | 480,410\n30 Sep 2026 | Closing balance | 480,410\nTransactions, October 2026\nDate | Description | Money in | Money out | Balance\n01 Oct 2026 | Opening balance | 480,410\n01 Oct 2026 | Office rent | 5,600 | 474,810\n03 Oct 2026 | Authenticator services provider | 3,650 | 471,160\n03 Oct 2026 | Cloud hosting provider | 7,300 | 463,860\n03 Oct 2026 | Support tooling subscription | 2,190 | 461,670\n05 Oct 2026 | Software subscriptions | 2,400 | 459,270\n10 Oct 2026 | Insurance premium | 900 | 458,370\n12 Oct 2026 | Professional fees | 4,500 | 453,870\n14 Oct 2026 | Assurance and certification fees | 1,500 | 452,370\n18 Oct 2026 | Travel and on-site costs | 5,600 | 446,770\n20 Oct 2026 | Recruitment fee | 4,500 | 442,270\n22 Oct 2026 | Sundry payments | 1,600 | 440,670\n25 Oct 2026 | Payroll and employer costs | 123,600 | 317,070\n28 Oct 2026 | Receipt - Customer 1 (NHS acute trust) - HS-INV-0096 | 16,763 | 333,833\n28 Oct 2026 | Receipt - Customer 10 (District council) - HS-INV-0105 | 1,800 | 335,633\n28 Oct 2026 | Receipt - Customer 11 (Unitary authority) - HS-INV-0106 | 2,200 | 337,833\n28 Oct 2026 | Receipt - Customer 2 (Scottish health board) - HS-INV-0097 | 13,112 | 350,945\n28 Oct 2026 | Receipt - Customer 3 (Metropolitan borough council) - | 6,979 | 357,924\nHS-INV-0098\n28 Oct 2026 | Receipt - Customer 4 (NHS community trust) - HS-INV-0099 | 5,134 | 363,058\n28 Oct 2026 | Receipt - Customer 5 (NHS acute trust) - HS-INV-0100 | 9,800 | 372,858\n28 Oct 2026 | Receipt - Customer 6 (County council) - HS-INV-0101 | 4,961 | 377,819\n28 Oct 2026 | Receipt - Customer 7 (NHS mental health trust) - HS-INV-0102 | 3,884 | 381,703\n28 Oct 2026 | Receipt - Customer 8 (City council) - HS-INV-0103 | 3,159 | 384,862\n28 Oct 2026 | Receipt - Customer 9 (NHS ambulance trust) - HS-INV-0104 | 3,208 | 388,070\n31 Oct 2026 | Closing balance | 388,070\nSYNTHETIC DEMO DOCUMENT\nHalyard Security Ltd | Business account statement, Aug 2026 to Oct 2026, with monthly balances Version 1.0 | Period: May 2025 to Oct 2026 | Issued 13 Nov 2026 | Page 2/2",
    },
  ],
  title:
    "Business account statement, Aug 2026 to Oct 2026, with monthly balances",
  folder: "Other documents",
  status: "READ",
  pageCount: 2,
  truncated: false,
  documentId: "38864c09-3e4b-4bde-ae55-31fc2a2ed89b",
  truthClass: "USER_CLAIM",
  sharedUnder: {
    say: "The founder shared this document with their organisation, so Q may read it for them. It is the company's own management material: say what it states as the company's figures (for example 'their management accounts show...'), not as independently verified, and never pass it on to anyone else.",
    grantId: "1a3a13c5-c710-4f6d-a72e-40938fe48316",
    expiresAt: null,
  },
  evidenceStatus: "DOCUMENT_SUPPORTED",
};
