import { Skeleton } from "@capital-q/ui/states";

export default function AdminLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Skeleton lines={2} />
      <Skeleton lines={6} />
    </div>
  );
}
