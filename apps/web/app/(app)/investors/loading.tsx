import { IndexLoading } from "@/components/app-shell/page-loading";
import { HubRouteLoading } from "@/features/relationships/crm-loading";

/**
 * An investor's company requests are a CRM tab: the CRM's strip, that tab
 * underlined, while it loads. A founder's Investors page is a directory,
 * so it keeps the app's frame.
 */
export default function InvestorsLoading() {
  return (
    <IndexLoading path="/investors">
      <HubRouteLoading
        view="requests"
        label="Loading company requests"
        only="INVESTOR"
      />
    </IndexLoading>
  );
}
