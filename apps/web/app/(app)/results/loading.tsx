import { Skeleton } from "@capital-q/ui/states";

export default function ResultsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6 p-4">
      <Skeleton lines={2} />
      <Skeleton lines={5} />
      <Skeleton lines={5} />
    </div>
  );
}
