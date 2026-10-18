import { PageContainer } from "@/components/app-shell/page-container";
import { SettingsNav, TeamSkeleton } from "@/features/team/settings-nav";

/** The Team page's shape while it loads: the same rows, quiet. */
export default function TeamLoading() {
  return (
    <PageContainer>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <SettingsNav current="team" />
        <div className="max-w-[52rem] min-w-0">
          <TeamSkeleton />
        </div>
      </div>
    </PageContainer>
  );
}
