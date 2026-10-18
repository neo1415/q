import { IndexLoading } from "@/components/app-shell/page-loading";
import { HubRouteLoading } from "@/features/relationships/crm-loading";

/** GateQ is a CRM tab: the CRM's strip, GateQ underlined, while it loads. */
export default function GateqLoading() {
  return (
    <IndexLoading path="/gateq">
      <HubRouteLoading view="gateq" label="Loading GateQ" />
    </IndexLoading>
  );
}
