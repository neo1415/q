import { InvestorDataRoom } from "@/features/company/material/data-room";
import {
  REVIEW_COMPANY_ID,
  reviewInvestorRoom,
} from "@/features/company/material/review-fixtures";

/**
 * The real investor data room over fictional documents; `?doc=<id>` asks
 * the viewer to open that one. Here the open's server action has no
 * session and says so, which is the evidence the open was made.
 */
export default function HarnessDataRoom() {
  return (
    <>
      <h1 className="cq-title-md text-(--cq-text-primary)">Data room</h1>
      <InvestorDataRoom
        companyId={REVIEW_COMPANY_ID}
        companyName="Kora Health"
        view={reviewInvestorRoom()}
      />
    </>
  );
}
