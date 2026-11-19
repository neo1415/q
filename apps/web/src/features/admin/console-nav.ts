/**
 * The console's sections in labelled groups (admin design 2026-11-19 §3.1,
 * replacing the 16-tab strip). A section shows only to a role that holds
 * one of its permissions; showing is a courtesy, and every page and API
 * route checks the permission again whatever the navigation shows.
 */

export type ConsoleGroupLabel =
  "Customers" | "Trust" | "Q" | "Money" | "Platform" | "Governance";

export type ConsoleSection = {
  readonly href: string;
  readonly label: string;
  /** Shown to a role holding any of these. */
  readonly permission: string | readonly string[];
  /**
   * Which server count, if any, the entry shows. Only Accounts has one:
   * the overview counts every person's profile. Its company and firm
   * totals are not the organisations listed here, so that entry has none.
   */
  readonly count?: "people" | undefined;
};

export type ConsoleGroup = {
  /** Null for the top entries, which need no label. */
  readonly label: ConsoleGroupLabel | null;
  readonly sections: readonly ConsoleSection[];
};

export const CONSOLE_GROUPS: readonly ConsoleGroup[] = [
  {
    label: null,
    sections: [
      { href: "/admin", label: "Overview", permission: "overview.read" },
      {
        href: "/admin/queue",
        label: "Queue",
        permission: ["verification.read", "reviews.read"],
      },
    ],
  },
  {
    label: "Customers",
    sections: [
      {
        href: "/admin/organisations",
        label: "Organisations",
        permission: "accounts.read",
      },
      {
        href: "/admin/accounts",
        label: "Accounts",
        permission: "accounts.read",
        count: "people",
      },
    ],
  },
  {
    label: "Trust",
    sections: [
      // P14: claims on unclaimed companies, and public company profiles.
      { href: "/admin/claims", label: "Claims", permission: "claims.read" },
      { href: "/admin/safety", label: "Safety", permission: "safety.read" },
    ],
  },
  {
    label: "Q",
    sections: [
      { href: "/admin/q", label: "Q monitor", permission: "q.monitor.read" },
    ],
  },
  {
    label: "Money",
    sections: [
      // BILLING block (ADR 0034)
      {
        href: "/admin/billing",
        label: "Billing",
        permission: "billing.fees.read",
      },
    ],
  },
  {
    label: "Platform",
    sections: [
      // Decision 107: the public site's pages (landing, pricing, FAQ, legal).
      {
        href: "/admin/content",
        label: "Site content",
        permission: "content.read",
      },
      { href: "/admin/email", label: "Email", permission: "email.read" },
      {
        href: "/admin/flags",
        label: "Kill switches",
        permission: "flags.read",
      },
      // Q Workspace §8: viewer identity, reveal and passive analytics.
      {
        href: "/admin/analytics",
        label: "Analytics privacy",
        permission: "analytics_settings.read",
      },
      { href: "/admin/brand", label: "Brand", permission: "flags.write" },
      {
        href: "/admin/etiquette",
        label: "Etiquette",
        permission: "flags.write",
      },
    ],
  },
  {
    label: "Governance",
    sections: [
      { href: "/admin/audit", label: "Audit", permission: "audit.read" },
      { href: "/admin/team", label: "Team", permission: "overview.read" },
    ],
  },
];

/** The groups a role may see, empty groups left out. */
export function consoleGroupsFor(
  permissions: readonly string[],
): readonly ConsoleGroup[] {
  const holds = (permission: ConsoleSection["permission"]) =>
    typeof permission === "string"
      ? permissions.includes(permission)
      : permission.some((one) => permissions.includes(one));
  return CONSOLE_GROUPS.map((group) => ({
    label: group.label,
    sections: group.sections.filter((section) => holds(section.permission)),
  })).filter((group) => group.sections.length > 0);
}

/**
 * The one current section: the most specific match, so /admin/audit marks
 * Audit and not Overview as well.
 */
export function activeConsoleHref(
  pathname: string,
  hrefs: readonly string[],
): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/** The server's totals the entries show, when the overview read gave them. */
export type ConsoleCounts = {
  readonly people: number;
};
