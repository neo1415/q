import type { NotificationDto } from "@capital-q/contracts";

/**
 * The notification centre's grouping (design-48), presentation only.
 *
 * A standing instruction that fires every few hours writes a fresh
 * "5 things need your yes for ..." each time; the sheet showed five
 * near-identical rows. Notices with the same kind, title and destination
 * fold into their newest one, which carries how many it stands for.
 * "Needs you" comes first; updates follow under their day. Nothing is
 * dropped: every folded notice's id stays on its group, so marking a group
 * read marks all of them.
 *
 * A NEEDS_YOU notice stays under "Needs you" only while it is unread. For
 * one, read means dealt with -- resolved on the server once answered (an
 * interest accepted or declined), or opened from its row -- never merely
 * shown (live QA: Brightkloof's "Savanna Seed Partners is interested..."
 * was resolved on accept and still sat under "Needs you" with Open). A
 * resolved one moves to its day, as history.
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

/**
 * Recovery D-13: an instruction's "N things need your yes" notice only
 * summarises approval cards that Needs you already shows one by one.
 * Counted (or listed) beside them, one card was counted twice.
 */
export function summarisesCards(notice: NotificationDto): boolean {
  return /^\d+ things? needs? your yes for /u.test(notice.title);
}

export function groupNotices(
  items: readonly NotificationDto[],
  now: Date = new Date(),
): {
  readonly needsYou: readonly NoticeGroup[];
  readonly days: readonly NoticeDay[];
} {
  const waiting = (item: NotificationDto) =>
    item.priority === "NEEDS_YOU" && !item.read;
  const needsYou = fold(items.filter(waiting));
  const updates = fold(items.filter((item) => !waiting(item)));
  const days: { label: string; groups: NoticeGroup[] }[] = [];
  for (const group of updates) {
    const label = dayLabel(group.notice.createdAt, now);
    const last = days.at(-1);
    if (last?.label === label) last.groups.push(group);
    else days.push({ label, groups: [group] });
  }
  return { needsYou, days };
}

/**
 * "Waiting on you" as the Work page lists it (live 2026-10-29: the Work
 * badge said 7 while the page said "8 waiting on you"; the eighth was an
 * approval card no notice announced, and the badges counted raw notices
 * where the page folds them). The badges, the Tasks tab and the page's
 * heading all read this: the folded notices that need the person, less a
 * notice that only summarises the approval cards when those are counted,
 * plus the approvals themselves. Approvals not known: notices only, as
 * the page shows when its approvals could not be read.
 */
export function waitingOnYouCount(input: {
  readonly items: readonly NotificationDto[];
  readonly approvals: number | null;
}): number {
  const groups = groupNotices(input.items).needsYou.filter(
    (group) => input.approvals === null || !summarisesCards(group.notice),
  );
  return groups.length + (input.approvals ?? 0);
}

/** One organisation's notices on the rail: what needs the person, then updates. */
export type RailGroup = {
  readonly key: string;
  /** The organisation the notices name; null: Q's own notices. */
  readonly named: NonNullable<NotificationDto["named"]> | null;
  /** Their name, from the person's own relationships; null: not known here. */
  readonly name: string | null;
  readonly needsYou: readonly NoticeGroup[];
  readonly updates: readonly NoticeGroup[];
};

type RailEntry = {
  key: string;
  named: NonNullable<NotificationDto["named"]> | null;
  name: string | null;
  needsYou: NoticeGroup[];
  updates: NoticeGroup[];
  latest: string;
};

/**
 * The notification rail (owner 2026-10-21, option 3): grouped by who each
 * notice is about, each organisation once, those with something that
 * needs the person first, then by their newest notice. Notices that name
 * no one are Q's own and come last, under one group.
 */
export function railGroups(
  items: readonly NotificationDto[],
  names: Readonly<Record<string, string>>,
  now: Date = new Date(),
): readonly RailGroup[] {
  const { needsYou, days } = groupNotices(items, now);
  const entries = new Map<string, RailEntry>();
  const add = (group: NoticeGroup, needs: boolean) => {
    const named = group.notice.named ?? null;
    const key = named === null ? "q" : `${named.kind}:${named.id}`;
    const entry: RailEntry = entries.get(key) ?? {
      key,
      named,
      name: named === null ? null : (names[named.id] ?? null),
      needsYou: [],
      updates: [],
      latest: group.notice.createdAt,
    };
    (needs ? entry.needsYou : entry.updates).push(group);
    if (group.notice.createdAt > entry.latest) {
      entry.latest = group.notice.createdAt;
    }
    entries.set(key, entry);
  };
  for (const group of needsYou) add(group, true);
  for (const day of days) {
    for (const group of day.groups) add(group, false);
  }
  const rank = (one: RailEntry) =>
    one.key === "q" ? 2 : one.needsYou.length > 0 ? 0 : 1;
  return [...entries.values()]
    .sort((a, b) => rank(a) - rank(b) || b.latest.localeCompare(a.latest))
    .map((one) => ({
      key: one.key,
      named: one.named,
      name: one.name,
      needsYou: one.needsYou,
      updates: one.updates,
    }));
}
