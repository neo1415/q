import { ActivityPageView } from "@/features/organisation/admin-pages";

/** The Activity page's shape while it reads: the same rows, quiet. */
export default function ActivityLoading() {
  return (
    <ActivityPageView
      t={(english) => english}
      organisationName={null}
      activity={{ status: "LOADING" }}
      people={[]}
    />
  );
}
