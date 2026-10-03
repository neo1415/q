import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { Skeleton } from "@capital-q/ui/states";

export default function UsageLoading() {
  return (
    <PageContainer width="reading">
      <PageHeader title="Usage" />
      <div aria-busy="true" className="flex flex-col gap-4">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-14 w-full" />
        ))}
      </div>
    </PageContainer>
  );
}
