import { HubLoading } from "@/features/relationships/crm-loading";

/** The CRM's shape while it loads: the same header, tabs and rows, no spinner. */
export default function RelationshipsLoading() {
  return <HubLoading />;
}
