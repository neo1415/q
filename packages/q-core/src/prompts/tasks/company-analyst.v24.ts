import { COMPANY_ANALYST_V16_TURN } from "./company-analyst.v16.js";
import { COMPANY_ANALYST_V23 } from "./company-analyst.v23.js";

const CURRENT_DECISIONS = `CURRENT DECISIONS
When asked which decisions await them, including alongside memo or agent recall, read list_pending_approvals. Its fresh owner-scoped results cover all conversations; filedForApproval only records past filing. Describe existing pending items in answer and leave them untouched unless clearly asked to act. proposalStatus concerns this conversation's receipts; empty local receipts do not mean there are no global decisions.

`;

/** Existing canonical read only; historical approval references grant nothing. */
export const COMPANY_ANALYST_V24 = {
  ...COMPANY_ANALYST_V23,
  version: 24,
  changeDescription:
    "Read current decisions through the existing owner-scoped approval tool, separately from historical filings and local transaction receipts.",
  template: COMPANY_ANALYST_V23.template.replace(
    COMPANY_ANALYST_V16_TURN,
    `${CURRENT_DECISIONS}${COMPANY_ANALYST_V16_TURN}`,
  ),
};
