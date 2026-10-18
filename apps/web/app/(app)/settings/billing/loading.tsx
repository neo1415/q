import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { Skeleton } from "@capital-q/ui/states";

/** The billing page's shape while it loads: the plan, three tiers, payment. */
export default function BillingLoading() {
  return (
    <PageContainer>
      <PageHeader title="Billing" />
      <div aria-busy="true" className="flex flex-col gap-8">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-3 lg:grid-cols-3">
          {[0, 1, 2].map((tier) => (
            <Skeleton key={tier} className="h-72 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    </PageContainer>
  );
}
