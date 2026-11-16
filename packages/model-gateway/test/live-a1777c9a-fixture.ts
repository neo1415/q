/**
 * Run a1777c9a and its follow-up 21272075 (conversation 28071f0c,
 * production 9c7b38925, 16 Nov 2026 23:09 UTC), as stored: Q's reply and
 * its FINDING blocks (q_runtime.conversation_messages), the follow-up's
 * reply, the one tool read new to this run (the KPI pack's pages,
 * q_runtime.conversation_tool_results call 12), Q's stored replies in the
 * four earlier conversations about the plan, and their summaries
 * (q_runtime.conversation_summary_revisions). The plan's passages and the
 * other tool reads are byte-identical to run 91bb8564's
 * (live-91bb8564-fixture.ts). A synthetic demo company; read-only copies,
 * verbatim.
 */

export const T1_QUESTION =
  "Walk me through Halyard Security's 2027 hiring plan by role";

/** Q's stored reply to T1, word for word. */
export const T1_LIVE =
  "Halyard Security’s planned 2027 hiring is conditional on the seed round closing. By role: in Q1, four public-sector account managers and one information security and assurance manager; in Q2, six deployment engineers and four product engineers; and in Q3, one finance and operations manager. That is 15 planned hires in total. The plan gives quarters, not specific months or days.";

/** Its FINDING blocks, in order (written by the extras' writer). */
export const T1_FINDINGS: readonly {
  readonly type: string;
  readonly statement: string;
}[] = [
  {
    type: "FACT",
    statement:
      "Halyard Security plans to hire 15 people in 2027 if the seed round closes: five in Q1, ten in Q2 and one in Q3.",
  },
  {
    type: "FACT",
    statement:
      "In Q1 2027, Halyard Security plans to hire four public-sector account managers and one information security and assurance manager.",
  },
  {
    type: "FACT",
    statement:
      "In Q2 2027, Halyard Security plans to hire six deployment engineers and four product engineers.",
  },
  {
    type: "FACT",
    statement:
      "In Q3 2027, Halyard Security plans to hire one finance and operations manager.",
  },
  {
    type: "UNCERTAINTY",
    statement:
      "The plan specifies quarters rather than individual months or days.",
  },
];

export const T2_QUESTION = "How many start in each quarter?";

/** The follow-up's stored reply (answered from the conversation's record). */
export const T2_LIVE =
  "Halyard Security plans to start five hires in Q1, ten in Q2, and one in Q3 2027. The plan does not specify individual months or days.";

/** company.data_room.document.pages.read of the KPI pack, as returned. */
export const KPI_PACK_READ = {
  pages: [
    {
      page: 1,
      text: "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD\nKPI and product metrics pack\nHalyard Security Ltd | Period: May 2025 to Oct 2026 | Version 1.0 | Issued 13 Nov 2026\nDefinitions\nNHS trusts, health boards and councils. Staff enrolled with passkeys. Licensed seats. Annual recurring revenue. Successful phishing takeovers of enrolled accounts.\nProduct and commercial metrics: May 2025 to Oct 2025\nMay 2025 | Jun 2025 | Jul 2025 | Aug 2025 | Sep 2025 | Oct 2025\nNHS trusts, health boards and councils | 3 | 3 | 3 | 4 | 4 | 4\nLicensed seats | 16,800 | 17,900 | 19,400 | 21,600 | 22,700 | 24,000\nStaff enrolled with passkeys | 9,800 | 11,000 | 12,600 | 14,500 | 15,800 | 17,000\nARR (GBP) | 201,600 | 214,800 | 232,800 | 259,200 | 272,400 | 288,000\nPhishing takeovers of enrolled accounts | 0 | 0 | 0 | 0 | 0 | 0\nProduct and commercial metrics: Nov 2025 to Apr 2026\nNov 2025 | Dec 2025 | Jan 2026 | Feb 2026 | Mar 2026 | Apr 2026\nNHS trusts, health boards and councils | 5 | 5 | 5 | 5 | 6 | 6\nLicensed seats | 27,000 | 29,232 | 32,300 | 35,604 | 39,800 | 43,366\nStaff enrolled with passkeys | 19,200 | 21,634 | 24,400 | 27,530 | 31,000 | 35,034\nARR (GBP) | 324,000 | 350,784 | 387,600 | 427,248 | 477,600 | 520,392\nPhishing takeovers of enrolled accounts | 0 | 0 | 0 | 0 | 0 | 0\nProduct and commercial metrics: May 2026 to Oct 2026\nMay 2026 | Jun 2026 | Jul 2026 | Aug 2026 | Sep 2026 | Oct 2026\nNHS trusts, health boards and councils | 7 | 7 | 8 | 9 | 11 | 11\nLicensed seats | 48,000 | 52,819 | 58,293 | 64,333 | 71,000 | 73,000\nStaff enrolled with passkeys | 39,600 | 44,582 | 50,292 | 56,734 | 64,000 | 66,900\nARR (GBP) | 576,000 | 633,828 | 699,516 | 771,996 | 852,000 | 876,000\nPhishing takeovers of enrolled accounts | 0 | 0 | 0 | 0 | 0 | 0\nFinancial position, October 2026\nARR GBP 876,000 (licensed seats x 12). Gross margin, 12 months to Oct 2026: 29.3%, with the deployment team in cost of sales. Net burn GBP 92,340; cash GBP 388,070; runway 4.2 months at this burn. Phishing takeovers are counted from customer security operations logs and identity-provider sign-in records.\nSYNTHETIC DEMO DOCUMENT\nHalyard Security Ltd | KPI and product metrics pack Version 1.0 | Period: May 2025 to Oct 2026 | Issued 13 Nov 2026 | Page 1/1",
    },
  ],
  title: "KPI and product metrics pack",
  folder: "Fundraising summary",
  status: "READ",
  pageCount: 1,
  truncated: false,
  documentId: "ebdded05-8b00-4e9b-932a-32e87829ac50",
  truthClass: "USER_CLAIM",
  evidenceStatus: "DOCUMENT_SUPPORTED",
};

/** Q's stored replies in the earlier conversations about the plan. */
export const EARLIER_Q_REPLIES: readonly string[] = [
  "Halyard Security’s hiring plan names five 2027 groups, adding 15 people in total if the planned seed round closes: 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. The plan does not give a specific month or day within each quarter. These are projected hires, not actual results.\n\nWant me to ask Halyard Security for a document that would settle this? I'll prepare the request for your approval.",
  "Halyard Security is planning to hire 15 people next year, assuming the planned seed round closes. The roles are 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. These are projected hires, not actual results, and the plan does not specify individual months or days.",
  "Halyard Security’s planned hiring groups start in Q1, Q2 and Q3 of 2027: Q1 is 4 public-sector account managers and 1 information security and assurance manager; Q2 is 6 deployment engineers and 4 product engineers; Q3 is 1 finance and operations manager. The plan is conditional on the seed round closing and does not specify individual months or days.",
  "Halyard Security plans to hire 15 people in 2027, conditional on the seed round closing: 5 in Q1, 10 in Q2 and 1 in Q3. The roles are 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. The plan identifies quarters, not individual start dates.",
  "Each hiring group is planned to start in a quarter, rather than on a specific month or day. The public-sector account managers and information security and assurance manager start in Q1 2027; the deployment engineers and product engineers start in Q2 2027; and the finance and operations manager starts in Q3 2027. The plan is conditional on the seed round closing.",
];

/** Their stored summaries, oldest first. */
export const EARLIER_SUMMARIES: readonly string[] = [
  "Amelia asked how Halyard Security’s 2027 hiring plan breaks down by role and start quarter. The plan projects 15 hires if the seed round closes: 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. It does not specify months or days, and the hires are projections rather than actual results. Amelia has not yet decided whether to request further documentation.",
  "Amelia asked how many people Halyard Security plans to hire next year and in which roles. Q reported a projected 15 hires, conditional on the planned seed round closing: four public-sector account managers and one information security and assurance manager in Q1, six deployment engineers and four product engineers in Q2, and one finance and operations manager in Q3. The plan does not specify individual months or days.",
  "Amelia asked which quarter each planned Halyard Security hiring group starts. Q reported that the 15 planned hires are scheduled for Q1, Q2 and Q3 of 2027: Q1 includes four public-sector account managers and one information security and assurance manager; Q2 includes six deployment engineers and four product engineers; Q3 includes one finance and operations manager. The plan is conditional on the seed round closing and does not specify individual months or days.",
  "Amelia asked what hiring Halyard Security has planned for 2027 by role. Q reported a conditional plan for 15 hires if the seed round closes: 5 in Q1, 10 in Q2 and 1 in Q3, across public-sector account management, information security and assurance, deployment engineering, product engineering, and finance and operations. Individual start dates remain unspecified.",
  "Amelia asked when each planned Halyard Security hiring group would start. Q clarified that the public-sector account managers and information security and assurance manager are planned for Q1 2027, deployment and product engineers for Q2 2027, and the finance and operations manager for Q3 2027, conditional on the seed round closing. Specific months and days remain unspecified.",
];
