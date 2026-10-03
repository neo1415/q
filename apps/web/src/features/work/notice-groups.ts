import type { NotificationDto } from "@capital-q/contracts";

/**
 * The notification centre's grouping (design-48), presentation only.
 *
 * A standing instruction that fires every few hours writes a fresh
 * "5 things need your yes for ..." each time; the sheet showed five
 * near-identical rows. Notices with the same kind, title and destination
 * fold into their newest one, which carries how many it stands for.
 * "Needs you" comes first; updates follow under their day. Nothing is
 * dropped: every folded notice's id stays on its group, so opening the
 * centre still marks all of them read.
 */
export type NoticeGroup = {
  readonly key: string;
  /** The newest notice of the group, shown. */
  readonly notice: NotificationDto;
  readonly ids: readonly string[];
  readonly count: number;
  readonly unread: boolean;
};

export type NoticeDay = {
  readonly label: string;
  readonly groups: readonly NoticeGroup[];
};

const keyOf = (notice: NotificationDto): string =>
  `${notice.kind}\u0000${notice.title}\u0000${notice.linkPath ?? ""}`;

function fold(notices: readonly NotificationDto[]): NoticeGroup[] {
  const groups = new Map<string, NotificationDto[]>();
  const newestFirst = notices.toSorted((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  for (const notice of newestFirst) {
    const key = keyOf(notice);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [notice]);
    else group.push(notice);
  }
  return [...groups.entries()].flatMap(([key, members]) => {
    const [newest] = members;
    if (newest === undefined) return [];
    return [
      {
        key,
        notice: newest,
        ids: members.map((member) => member.id),
        count: members.length,
        unread: members.some((member) => !member.read),
      },
    ];
  });
}

function dayLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  const day = (value: Date) => value.toDateString();
  if (day(at) === day(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(at) === day(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(at);
}

export function groupNotices(
  items: readonly NotificationDto[],
  now: Date = new Date(),
): {
  readonly needsYou: readonly NoticeGroup[];
  readonly days: readonly NoticeDay[];
} {
  const needsYou = fold(items.filter((item) => item.priority === "NEEDS_YOU"));
  const updates = fold(items.filter((item) => item.priority !== "NEEDS_YOU"));
  const days: { label: string; groups: NoticeGroup[] }[] = [];
  for (const group of updates) {
    const label = dayLabel(group.notice.createdAt, now);
    const last = days.at(-1);
    if (last?.label === label) last.groups.push(group);
    else days.push({ label, groups: [group] });
  }
  return { needsYou, days };
}
