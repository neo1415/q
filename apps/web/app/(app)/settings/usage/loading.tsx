import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { Skeleton } from "@capital-q/ui/states";

/** The usage page's shape while it loads: four cards, a chart, a table. */
export default function UsageLoading() {
  return (
    <PageContainer>
      <PageHeader title="Usage" />
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton
              key={tile}
              className={`h-28 w-full ${tile === 0 ? "col-span-2 lg:col-span-1" : ""}`}
            />
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </PageContainer>
  );
}
