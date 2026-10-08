import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import {
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
  RotateCw,
} from "@capital-q/ui/icons";

import { QControl } from "@/features/q/control/q-control";

import "../gateq.css";

/**
 * The GateQ page's own frame (F2, design a/gateq.html): the title, the
 * copy-link action for an investor, and the tabs. The tabs change by role:
 * a founder has their applications and "Find my startup"; an investor has
 * their inbox, "Find a startup" and their gate.
 */

export type GateqTab = "applications" | "claim" | "inbox" | "find" | "gate";

const FOUNDER_TABS: readonly (readonly [GateqTab, string])[] = [
  ["applications", "Applications"],
  ["claim", "Find my startup"],
];
const INVESTOR_TABS: readonly (readonly [GateqTab, string])[] = [
  ["inbox", "Inbox"],
  ["find", "Find a startup"],
  ["gate", "Your gate"],
];

/** Q's ids for the tabs (literal, for the capability parity matrix). */
const Q_GATEQ_TABS: Readonly<Record<GateqTab, string>> = {
  applications: "tab.applications",
  claim: "tab.claim",
  inbox: "tab.inbox",
  find: "tab.find",
  gate: "tab.gate",
};

export function GateqChrome({
  role,
  active,
  unread,
  action,
  hrefFor = (tab) => `/gateq?tab=${tab}`,
  children,
  maxWidth,
}: {
  readonly role: "FOUNDER" | "INVESTOR";
  readonly active: GateqTab;
  readonly unread?: number | undefined;
  readonly action?: ReactNode | undefined;
  readonly hrefFor?: ((tab: GateqTab) => string) | undefined;
  readonly children: ReactNode;
  readonly maxWidth?: number | undefined;
}) {
  const tabs = role === "FOUNDER" ? FOUNDER_TABS : INVESTOR_TABS;
  return (
    <div
      className="gq-wrap"
      style={maxWidth === undefined ? undefined : { maxWidth }}
    >
      <div className="gq-sect-h items-center flex-wrap">
        <h1 className="cq-title-lg">GateQ</h1>
        {action}
      </div>
      <nav className="gq-tabs" aria-label="GateQ">
        {tabs.map(([tab, label]) => (
          <QControl key={tab} id={Q_GATEQ_TABS[tab]} kind="TAB">
            <Link
              href={hrefFor(tab)}
              aria-current={tab === active ? "page" : undefined}
            >
              {label}
              {tab === "inbox" && unread !== undefined && unread > 0 ? (
                <span className="gq-n">{unread}</span>
              ) : null}
            </Link>
          </QControl>
        ))}
      </nav>
      {children}
    </div>
  );
}

export function StateBlock({
  icon,
  title,
  body,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="gq-state">
      <span className="gq-state-ic">{icon}</span>
      <h2 className="cq-title-sm">{title}</h2>
      <p className="cq-body-sm gq-t2">{body}</p>
      {children === undefined ? null : (
        <div className="flex flex-wrap gap-2">{children}</div>
      )}
    </div>
  );
}

export function ErrorBlock({
  what,
  retryHref,
}: {
  readonly what: string;
  readonly retryHref: string;
}) {
  return (
    <StateBlock
      icon={
        <CircleAlert
          size={ICON_SIZE.prominent}
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
      }
      title={`${what} didn't load`}
      body="The connection dropped before it finished. Nothing you did was lost."
    >
      <a href={retryHref} className={buttonClassName("secondary")}>
        <RotateCw
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
        Try again
      </a>
    </StateBlock>
  );
}

export function Skeleton({
  width,
  height,
  radius = 8,
}: {
  readonly width: string;
  readonly height: number;
  readonly radius?: number;
}) {
  return (
    <div
      className="gq-sk"
      style={{ width, height, borderRadius: radius }}
      aria-hidden
    />
  );
}
