"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import type {
  InvitableRole,
  TeamDto,
  TeamMemberDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Avatar } from "@capital-q/ui/avatar";
import { buttonClassName } from "@capital-q/ui/button";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  ICON_SIZE,
  ICON_STROKE,
  Lock,
  LogOut,
  Mail,
  MoreHorizontal,
  Search,
  UserPlus,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import {
  changeRoleAction,
  decideJoinAction,
  inviteAction,
  leaveAction,
  offerOwnershipAction,
  removeAction,
  resendAction,
  respondOwnershipAction,
  revokeAction,
} from "./team-actions";
import { splitEmailInput, teamWords, timeAgo } from "./team-words";

/**
 * Settings → Team (G2), built to docs/design/2026-10-06/a/orgs.html.
 *
 * What the person may do comes from the server (`team.you.can`, decided
 * from their role there); the controls follow it, and every change still
 * goes through the API, which decides again. Hiding is never the guard.
 *
 * Plain words: "Company" for founders, "Firm" for investors, never
 * "organisation".
 */

type Sheet =
  | { readonly kind: "invite" }
  | { readonly kind: "role"; readonly member: TeamMemberDto }
  | { readonly kind: "remove"; readonly member: TeamMemberDto }
  | { readonly kind: "leave" }
  | { readonly kind: "transfer"; readonly member: TeamMemberDto | null };

const ROLE_WORD = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" } as const;

const firstName = (name: string) => name.split(" ")[0] ?? name;

/** Dark, quiet confirm for removing or leaving: never red, never loud. */
const INK =
  "inline-flex h-11 select-none items-center justify-center gap-2 rounded-md bg-(--cq-text-primary) px-4 cq-body-sm font-medium whitespace-nowrap text-(--cq-canvas) transition-opacity duration-(--cq-motion-fast) hover:opacity-90 disabled:opacity-50 lg:h-10";

export function TeamPage({ initial }: { readonly initial: TeamDto }) {
  const [team, setTeam] = useState(initial);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // P15: invitations whose email did not go, with their one-time links.
  const [unsent, setUnsent] = useState<readonly UnsentInvite[]>([]);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // A fresh read from the server (after a change elsewhere) replaces ours.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setTeam(initial);
  }
  useEffect(() => {
    if (toast === null) return;
    const handle = window.setTimeout(() => {
      setToast(null);
    }, 2600);
    return () => {
      window.clearTimeout(handle);
    };
  }, [toast]);

  const words = teamWords(team.organisation.kind);
  const name = team.organisation.name;
  const can = team.you.can;
  const me = team.members.find((member) => member.isYou);
  const solo =
    team.members.length === 1 &&
    team.invitations.length === 0 &&
    team.joinRequests.length === 0;

  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return wanted === ""
      ? team.members
      : team.members.filter(
          (member) =>
            member.name.toLowerCase().includes(wanted) ||
            (member.email ?? "").toLowerCase().includes(wanted),
        );
  }, [team.members, query]);

  /** Runs a change; the fresh team replaces the old one, or the reason shows. */
  const change = (
    work: () => Promise<
      { ok: true; value: TeamDto } | { ok: false; message: string }
    >,
    done: string,
  ) => {
    startTransition(async () => {
      const out = await work();
      if (out.ok) {
        setTeam(out.value);
        setSheet(null);
        setToast(done);
      } else {
        setToast(out.message);
      }
    });
  };

  const head = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="cq-title-lg text-(--cq-text-primary)">Team</h1>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          People who work on{" "}
          {solo && team.organisation.kind === "FIRM" ? "your investing" : name}{" "}
          with you. Everyone here acts for the {words.word}.
        </p>
      </div>
      {can.invite ? (
        <button
          type="button"
          className={buttonClassName(
            "primary",
            "regular",
            "shrink-0 self-start",
          )}
          onClick={() => {
            setSheet({ kind: "invite" });
          }}
          data-team-invite
        >
          <UserPlus
            aria-hidden="true"
            size={ICON_SIZE.regular}
            strokeWidth={ICON_STROKE}
          />
          Invite people
        </button>
      ) : null}
    </div>
  );

  const body = solo ? (
    <>
      {head}
      <section className="cq-panel flex flex-col gap-3.5 p-5" data-team-solo>
        <div className="flex items-center gap-3">
          <Avatar name={me?.name ?? "You"} size="lg" />
          <span className="flex min-w-0 flex-col">
            <span className="cq-body font-medium text-(--cq-text-primary)">
              {me?.name ?? "You"}{" "}
              <span className="cq-caption font-normal text-(--cq-text-tertiary)">
                You
              </span>
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {ROLE_WORD[team.you.role]}
            </span>
          </span>
        </div>
        <h2 className="cq-title-sm text-(--cq-text-primary)">
          Just you, for now
        </h2>
        <p className="max-w-[56ch] cq-body-sm text-(--cq-text-secondary)">
          {words.soloLine(name)}
        </p>
        {can.invite ? (
          <div>
            <button
              type="button"
              className={buttonClassName("primary")}
              onClick={() => {
                setSheet({ kind: "invite" });
              }}
            >
              <UserPlus
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
              Invite someone
            </button>
          </div>
        ) : null}
      </section>
      <RolesHelp words={words} />
    </>
  ) : (
    <>
      {head}
      {can.invite ? null : (
        <p
          className="flex items-start gap-2.5 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-3.5 py-3 cq-body-sm text-(--cq-text-secondary)"
          data-team-limited
        >
          <Lock
            aria-hidden="true"
            size={ICON_SIZE.regular}
            strokeWidth={ICON_STROKE}
            className="mt-0.5 shrink-0"
          />
          <span>
            You&apos;re a{" "}
            <b className="font-medium text-(--cq-text-primary)">
              {ROLE_WORD[team.you.role]}
            </b>
            . Admins invite people and change roles. <AskAnAdmin team={team} />
          </span>
        </p>
      )}

      <WaitingForYou team={team} pending={pending} change={change} />

      <section className="flex flex-col gap-2" aria-labelledby="team-people">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="team-people" className="cq-title-sm text-(--cq-text-primary)">
            {team.members.length}{" "}
            {team.members.length === 1 ? "person" : "people"}
          </h2>
          {team.members.length > 5 ? (
            <label className="flex min-h-10 w-full items-center gap-2 rounded-full bg-(--cq-surface-subtle) px-3.5 text-(--cq-text-tertiary) sm:w-56">
              <span className="sr-only">Search people</span>
              <Search
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent cq-body text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary)"
              />
            </label>
          ) : null}
        </div>
        <ul>
          {shown.map((member) => (
            <MemberRow
              key={member.membershipId}
              member={member}
              team={team}
              onRole={() => {
                setSheet({ kind: "role", member });
              }}
              onMore={() => {
                setSheet(
                  member.isYou ? { kind: "leave" } : { kind: "remove", member },
                );
              }}
            />
          ))}
        </ul>
        {shown.length === 0 ? (
          <p className="py-3 cq-body-sm text-(--cq-text-secondary)">
            Nobody matches that.
          </p>
        ) : null}
      </section>

      {can.invite && team.invitations.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="team-invited">
          <h2
            id="team-invited"
            className="cq-title-sm text-(--cq-text-primary)"
          >
            Invited
          </h2>
          <ul>
            {team.invitations.map((invitation) => (
              <li
                key={invitation.invitationId}
                className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-(--cq-border-subtle) py-3"
                data-team-invitation
              >
                <span className="grid size-11 place-items-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-tertiary)">
                  <Mail
                    aria-hidden="true"
                    size={ICON_SIZE.prominent}
                    strokeWidth={ICON_STROKE}
                  />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate cq-body font-medium text-(--cq-text-primary)">
                    {invitation.email}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {ROLE_WORD[invitation.role]} ·{" "}
                    {invitation.state === "EXPIRED"
                      ? `Expired · sent ${timeAgo(invitation.sentAt)}`
                      : `Sent ${timeAgo(invitation.sentAt)}`}
                  </span>
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    className={buttonClassName("quiet", "compact")}
                    onClick={() => {
                      change(
                        () => resendAction(invitation.invitationId),
                        `Sent again to ${invitation.email}.`,
                      );
                    }}
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className={buttonClassName("quiet", "compact")}
                    onClick={() => {
                      change(
                        () => revokeAction(invitation.invitationId),
                        "Invitation cancelled.",
                      );
                    }}
                  >
                    Cancel
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <RolesHelp words={words} />

      <section className="flex flex-col gap-2.5" aria-labelledby="team-leave">
        <h2 id="team-leave" className="cq-title-sm text-(--cq-text-primary)">
          Leave {name}
        </h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          You&apos;ll lose access to its relationships, notes and Q&apos;s
          memory for the {words.word}.
        </p>
        <div>
          <button
            type="button"
            className={buttonClassName("secondary")}
            onClick={() => {
              setSheet({ kind: "leave" });
            }}
            data-team-leave
          >
            <LogOut
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
            />
            Leave {name}
          </button>
        </div>
      </section>
    </>
  );

  const close = () => {
    setSheet(null);
  };
  const lastOwner = team.you.role === "OWNER" && team.ownerCount <= 1;

  return (
    <div className="flex flex-col gap-6" data-team-page>
      <UnsentInvites
        items={unsent}
        onDismiss={() => {
          setUnsent([]);
        }}
      />
      {body}

      <SheetRoot
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {sheet?.kind === "invite" ? (
          <InviteSheet
            name={name}
            pending={pending}
            onSend={(emails, role, message) => {
              startTransition(async () => {
                const out = await inviteAction(emails, role, message);
                if (!out.ok) {
                  setToast(out.message);
                  return;
                }
                setTeam(out.value.team);
                setSheet(null);
                setUnsent(
                  out.value.invited.flatMap((i) =>
                    !i.emailed && i.link !== undefined
                      ? [{ email: i.email, link: i.link }]
                      : [],
                  ),
                );
                const sent = out.value.invited.length;
                const notEmailed = out.value.invited.filter(
                  (i) => !i.emailed,
                ).length;
                setToast(
                  sent === 0
                    ? out.value.skipped.some(
                        (s) => s.reason === "ALREADY_INVITED",
                      )
                      ? "They're already invited. Resend from the list."
                      : "Nobody new to invite."
                    : notEmailed > 0
                      ? "Couldn't send the email. Copy the invite link."
                      : `${String(sent)} ${sent === 1 ? "invitation" : "invitations"} sent. They expire in 7 days.`,
                );
              });
            }}
          />
        ) : sheet?.kind === "role" ? (
          <RoleSheet
            member={sheet.member}
            canOwn={can.own}
            pending={pending}
            onSave={(role) => {
              change(
                () => changeRoleAction(sheet.member.membershipId, role),
                `${sheet.member.name} is now ${role === "ADMIN" ? "an Admin" : "a Member"}.`,
              );
            }}
            onOwner={() => {
              setSheet({ kind: "transfer", member: sheet.member });
            }}
          />
        ) : sheet?.kind === "remove" ? (
          <RemoveSheet
            member={sheet.member}
            team={team}
            pending={pending}
            onClose={close}
            onRemove={(handOverTo) => {
              change(
                () => removeAction(sheet.member.membershipId, handOverTo),
                `${firstName(sheet.member.name)} was removed.`,
              );
            }}
            onOwner={
              can.own && sheet.member.role !== "OWNER"
                ? () => {
                    setSheet({ kind: "transfer", member: sheet.member });
                  }
                : null
            }
          />
        ) : sheet?.kind === "leave" ? (
          lastOwner ? (
            <SheetContent side="side" title="You're the only owner">
              <div
                className="flex flex-col gap-3.5"
                data-team-sheet="leave-owner"
              >
                <p className="cq-body text-(--cq-text-secondary)">
                  {name} always needs an owner. Make someone else owner first.
                  Then you can leave.
                </p>
                <div className="flex flex-wrap gap-2">
                  {team.members.length > 1 ? (
                    <button
                      type="button"
                      className={buttonClassName("primary")}
                      onClick={() => {
                        setSheet({ kind: "transfer", member: null });
                      }}
                    >
                      Choose a new owner
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={buttonClassName("quiet")}
                    onClick={close}
                  >
                    Stay
                  </button>
                </div>
                {team.members.length > 1 ? null : (
                  <p className="cq-caption text-(--cq-text-tertiary)">
                    You&apos;re the only person here. Invite someone and make
                    them owner first.
                  </p>
                )}
              </div>
            </SheetContent>
          ) : (
            <SheetContent side="side" title={`Leave ${name}?`}>
              <div className="flex flex-col gap-3.5" data-team-sheet="leave">
                <p className="cq-body text-(--cq-text-secondary)">
                  You&apos;ll lose access to its relationships, notes and
                  documents straight away. An admin can invite you back.
                </p>
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  Your own profile and your other companies and firms
                  aren&apos;t affected.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    className={INK}
                    onClick={() => {
                      startTransition(async () => {
                        const out = await leaveAction();
                        if (!out.ok) {
                          setToast(out.message);
                          return;
                        }
                        setSheet(null);
                        router.push("/home");
                        router.refresh();
                      });
                    }}
                  >
                    Leave
                  </button>
                  <button
                    type="button"
                    className={buttonClassName("quiet")}
                    onClick={close}
                  >
                    Stay
                  </button>
                </div>
              </div>
            </SheetContent>
          )
        ) : sheet?.kind === "transfer" ? (
          <TransferSheet
            member={sheet.member}
            team={team}
            words={words}
            pending={pending}
            onClose={close}
            onSend={(member) => {
              change(
                () => offerOwnershipAction(member.membershipId),
                `Request sent to ${firstName(member.name)}.`,
              );
            }}
          />
        ) : null}
      </SheetRoot>

      <div
        role="status"
        aria-live="polite"
        className={cx(
          "pointer-events-none fixed inset-x-4 bottom-[calc(var(--cq-safe-bottom,0px)+88px)] z-(--cq-z-toast) mx-auto w-fit max-w-[min(420px,calc(100vw-32px))] rounded-full bg-(--cq-text-primary) px-4 py-2.5 text-center cq-body-sm text-(--cq-canvas) shadow-(--cq-shadow-overlay) transition-opacity duration-(--cq-motion-base) lg:bottom-8",
          toast === null ? "opacity-0" : "opacity-100",
        )}
      >
        {toast}
      </div>
    </div>
  );
}

function AskAnAdmin({ team }: { readonly team: TeamDto }) {
  const admin = team.members.find(
    (member) =>
      !member.isYou && member.role !== "MEMBER" && member.email !== null,
  );
  return admin?.email == null ? null : (
    <a href={`mailto:${admin.email}`} className="underline underline-offset-2">
      Ask an admin
    </a>
  );
}

function MemberRow({
  member,
  team,
  onRole,
  onMore,
}: {
  readonly member: TeamMemberDto;
  readonly team: TeamDto;
  readonly onRole: () => void;
  readonly onMore: () => void;
}) {
  const can = team.you.can;
  // Admins change Admins and Members; owners are changed by hand-over only.
  const roleButton =
    can.changeRoles && member.role !== "OWNER" && !member.isYou;
  // Yourself: leave. Someone else: remove (an owner only by an owner).
  const more =
    member.isYou || (can.removeMembers && (member.role !== "OWNER" || can.own));
  return (
    <li
      className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-(--cq-border-subtle) py-3"
      data-team-member
    >
      <Avatar name={member.name} size="md" className="size-11!" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate cq-body font-medium text-(--cq-text-primary)">
          {member.name}
          {member.isYou ? (
            <span className="ml-1.5 cq-caption font-normal text-(--cq-text-tertiary)">
              You
            </span>
          ) : null}
        </span>
        <span className="truncate cq-caption text-(--cq-text-secondary)">
          {[member.title, member.email]
            .filter((part) => part !== null && part !== "")
            .join(" · ")}
        </span>
      </span>
      <span className="flex items-center gap-1">
        {roleButton ? (
          <button
            type="button"
            aria-label={`Role for ${member.name}: ${ROLE_WORD[member.role]}. Change`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-(--cq-border) bg-(--cq-surface-raised) pr-2.5 pl-3 cq-body-sm whitespace-nowrap text-(--cq-text-primary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) lg:min-h-10"
            onClick={onRole}
          >
            {ROLE_WORD[member.role]}
            <ChevronDown
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </button>
        ) : (
          <span className="px-1 cq-body-sm text-(--cq-text-secondary)">
            {ROLE_WORD[member.role]}
          </span>
        )}
        {more ? (
          <button
            type="button"
            aria-label={
              member.isYou ? "More for you" : `More for ${member.name}`
            }
            className="grid size-11 place-items-center rounded-full text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle)"
            onClick={onMore}
          >
            <MoreHorizontal
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          </button>
        ) : (
          <span aria-hidden="true" className="w-11" />
        )}
      </span>
    </li>
  );
}

function WaitingForYou({
  team,
  pending,
  change,
}: {
  readonly team: TeamDto;
  readonly pending: boolean;
  readonly change: (
    work: () => Promise<
      { ok: true; value: TeamDto } | { ok: false; message: string }
    >,
    done: string,
  ) => void;
}) {
  const offers = team.ownershipOffers.filter(
    (offer) => offer.direction !== "OTHER",
  );
  if (team.joinRequests.length === 0 && offers.length === 0) return null;
  const name = team.organisation.name;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="team-waiting">
      <h2 id="team-waiting" className="cq-title-sm text-(--cq-text-primary)">
        Waiting for you
      </h2>
      {team.joinRequests.map((request) => (
        <Waiting
          key={request.requestId}
          avatar={request.name}
          title={request.name}
          line={`${request.email ?? "Someone"} wants to join ${name}`}
          data="join-request"
        >
          <button
            type="button"
            disabled={pending}
            className={buttonClassName("primary", "compact")}
            onClick={() => {
              change(
                () => decideJoinAction(request.requestId, true),
                `${firstName(request.name)} is in, as a Member.`,
              );
            }}
          >
            Let in
          </button>
          <button
            type="button"
            disabled={pending}
            className={buttonClassName("secondary", "compact")}
            onClick={() => {
              change(
                () => decideJoinAction(request.requestId, false),
                "Declined.",
              );
            }}
          >
            Decline
          </button>
        </Waiting>
      ))}
      {offers.map((offer) => (
        <Waiting
          key={offer.offerId}
          avatar={offer.direction === "TO_YOU" ? offer.fromName : offer.toName}
          title={
            offer.direction === "TO_YOU"
              ? `${offer.fromName} asked you to be an owner`
              : `Waiting for ${offer.toName}`
          }
          line={
            offer.direction === "TO_YOU"
              ? `Owners can also handle billing, hand over ownership and close the ${teamWords(team.organisation.kind).word}.`
              : `You asked ${firstName(offer.toName)} to become an owner of ${name}.`
          }
          data="ownership-offer"
        >
          {offer.direction === "TO_YOU" ? (
            <>
              <button
                type="button"
                disabled={pending}
                className={buttonClassName("primary", "compact")}
                onClick={() => {
                  change(
                    () => respondOwnershipAction(offer.offerId, true),
                    "You're an owner now.",
                  );
                }}
              >
                Accept
              </button>
              <button
                type="button"
                disabled={pending}
                className={buttonClassName("secondary", "compact")}
                onClick={() => {
                  change(
                    () => respondOwnershipAction(offer.offerId, false),
                    "Declined.",
                  );
                }}
              >
                Decline
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              className={buttonClassName("secondary", "compact")}
              onClick={() => {
                change(
                  () => respondOwnershipAction(offer.offerId, false),
                  "Request withdrawn.",
                );
              }}
            >
              Withdraw
            </button>
          )}
        </Waiting>
      ))}
    </section>
  );
}

function Waiting({
  avatar,
  title,
  line,
  data,
  children,
}: {
  readonly avatar: string;
  readonly title: string;
  readonly line: string;
  readonly data: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-3.5 py-3"
      data-team-waiting={data}
    >
      <Avatar name={avatar} size="md" className="size-11!" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="cq-body font-medium text-(--cq-text-primary)">
          {title}
        </span>
        <span className="cq-caption text-(--cq-text-secondary)">{line}</span>
      </span>
      <span className="flex gap-1.5">{children}</span>
    </div>
  );
}

function RolesHelp({
  words,
}: {
  readonly words: ReturnType<typeof teamWords>;
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="team-roles">
      <h2 id="team-roles" className="cq-title-sm text-(--cq-text-primary)">
        What each role can do
      </h2>
      <dl>
        {(
          [
            [
              "Owner",
              `Everything an admin can do, plus billing, handing over ownership and closing the ${words.word}. There's always at least one.`,
            ],
            ["Admin", words.admin],
            ["Member", words.member],
          ] as const
        ).map(([role, does]) => (
          <div
            key={role}
            className="grid grid-cols-[90px_minmax(0,1fr)] gap-2.5 border-t border-(--cq-border-subtle) py-2.5 cq-body-sm"
          >
            <dt className="font-medium text-(--cq-text-primary)">{role}</dt>
            <dd className="text-(--cq-text-secondary)">{does}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function InviteSheet({
  name,
  pending,
  onSend,
}: {
  readonly name: string;
  readonly pending: boolean;
  readonly onSend: (
    emails: readonly string[],
    role: InvitableRole,
    message: string,
  ) => void;
}) {
  const [raw, setRaw] = useState("");
  const [role, setRole] = useState<InvitableRole>("MEMBER");
  const [message, setMessage] = useState("");
  const emails = splitEmailInput(raw);
  const count = emails.length;
  return (
    <SheetContent side="side" title={`Invite people to ${name}`}>
      <form
        className="flex flex-col gap-4"
        data-team-sheet="invite"
        onSubmit={(event) => {
          event.preventDefault();
          if (count > 0) onSend(emails, role, message);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="team-emails"
            className="cq-label text-(--cq-text-primary)"
          >
            Email addresses
          </label>
          <textarea
            id="team-emails"
            rows={3}
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
            }}
            placeholder="One or more, separated by commas"
            className="w-full rounded-md border border-(--cq-border) bg-(--cq-surface) px-3.5 py-3 cq-body leading-normal text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary) focus-visible:border-(--cq-accent)"
          />
          <span className="cq-caption text-(--cq-text-tertiary)">
            Personal emails are fine.
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span
            id="team-role-label"
            className="cq-label text-(--cq-text-primary)"
          >
            Role
          </span>
          <div
            role="radiogroup"
            aria-labelledby="team-role-label"
            className="flex gap-0.5 rounded-[10px] bg-(--cq-surface-subtle) p-[3px]"
          >
            {(["MEMBER", "ADMIN"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={role === option}
                onClick={() => {
                  setRole(option);
                }}
                className={cx(
                  "min-h-10 flex-1 rounded-lg cq-body-sm font-medium transition-colors duration-(--cq-motion-fast)",
                  role === option
                    ? "border border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-primary)"
                    : "text-(--cq-text-secondary)",
                )}
              >
                {ROLE_WORD[option]}
              </button>
            ))}
          </div>
          <span className="cq-caption text-(--cq-text-secondary)">
            Members work day to day. Admins can also invite people and approve
            what Q sends.
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="team-message"
            className="cq-label text-(--cq-text-primary)"
          >
            Message (optional)
          </label>
          <input
            id="team-message"
            value={message}
            maxLength={500}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
            placeholder="Welcome aboard!"
            className="min-h-11 w-full rounded-md border border-(--cq-border) bg-(--cq-surface) px-3.5 cq-body text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary) focus-visible:border-(--cq-accent)"
          />
        </div>
        <button
          type="submit"
          disabled={pending || count === 0}
          className={buttonClassName("primary", "regular", "w-full")}
        >
          {count <= 1 ? "Send invitation" : `Send ${String(count)} invitations`}
        </button>
      </form>
    </SheetContent>
  );
}

function RoleSheet({
  member,
  canOwn,
  pending,
  onSave,
  onOwner,
}: {
  readonly member: TeamMemberDto;
  readonly canOwn: boolean;
  readonly pending: boolean;
  readonly onSave: (role: InvitableRole) => void;
  readonly onOwner: () => void;
}) {
  const [role, setRole] = useState<InvitableRole>(
    member.role === "ADMIN" ? "ADMIN" : "MEMBER",
  );
  return (
    <SheetContent side="side" title={`${member.name}'s role`}>
      <div className="flex flex-col gap-3" data-team-sheet="role">
        <div className="flex flex-col">
          {(
            [
              [
                "ADMIN",
                "Invites people, changes settings, approves what Q sends.",
              ],
              ["MEMBER", "Works day to day; suggests, doesn't approve."],
            ] as const
          ).map(([option, does]) => (
            <label
              key={option}
              className="flex cursor-pointer gap-3 border-b border-(--cq-border-subtle) py-3.5"
            >
              <input
                type="radio"
                name="team-role"
                checked={role === option}
                onChange={() => {
                  setRole(option);
                }}
                className="mt-0.5 size-5 accent-(--cq-accent)"
              />
              <span className="flex flex-col">
                <span className="cq-body font-medium text-(--cq-text-primary)">
                  {ROLE_WORD[option]}
                </span>
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  {does}
                </span>
              </span>
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={pending}
          className={buttonClassName("primary", "regular", "w-full")}
          onClick={() => {
            onSave(role);
          }}
        >
          Save
        </button>
        {canOwn ? (
          <button
            type="button"
            className={buttonClassName("quiet", "regular", "w-full")}
            onClick={onOwner}
          >
            Make {firstName(member.name)} an owner…
          </button>
        ) : null}
      </div>
    </SheetContent>
  );
}

function RemoveSheet({
  member,
  team,
  pending,
  onClose,
  onRemove,
  onOwner,
}: {
  readonly member: TeamMemberDto;
  readonly team: TeamDto;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onRemove: (handOverTo: string | null) => void;
  readonly onOwner: (() => void) | null;
}) {
  const first = firstName(member.name);
  const words = teamWords(team.organisation.kind);
  const heirs = team.members.filter(
    (m) => m.membershipId !== member.membershipId,
  );
  const [heir, setHeir] = useState(team.you.membershipId);
  return (
    <SheetContent side="side" title={`Remove ${member.name}?`}>
      <div className="flex flex-col gap-3.5" data-team-sheet="remove">
        <p className="cq-body text-(--cq-text-secondary)">
          {first} loses access to {team.organisation.name} right away. Their
          notes and work stay with the {words.word}.
        </p>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="team-heir"
            className="cq-label text-(--cq-text-primary)"
          >
            Who picks up {first}&apos;s open work?
          </label>
          <select
            id="team-heir"
            value={heir}
            onChange={(event) => {
              setHeir(event.target.value);
            }}
            className="min-h-11 w-full rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 cq-body text-(--cq-text-primary)"
          >
            {heirs.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.isYou ? `${m.name} (you)` : m.name}
              </option>
            ))}
          </select>
        </div>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Anything {first} already approved stays approved, and the history
          keeps who did what.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            className={INK}
            onClick={() => {
              onRemove(heir === team.you.membershipId ? null : heir);
            }}
          >
            Remove {first}
          </button>
          <button
            type="button"
            className={buttonClassName("quiet")}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
        {onOwner === null ? null : (
          <button
            type="button"
            className="self-start cq-body-sm text-(--cq-text-secondary) underline underline-offset-2"
            onClick={onOwner}
          >
            Make {first} an owner instead
          </button>
        )}
      </div>
    </SheetContent>
  );
}

function TransferSheet({
  member,
  team,
  words,
  pending,
  onClose,
  onSend,
}: {
  readonly member: TeamMemberDto | null;
  readonly team: TeamDto;
  readonly words: ReturnType<typeof teamWords>;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onSend: (member: TeamMemberDto) => void;
}) {
  const choices = team.members.filter((m) => m.role !== "OWNER" && !m.isYou);
  const [chosen, setChosen] = useState<string>(
    member?.membershipId ?? choices[0]?.membershipId ?? "",
  );
  const target =
    member ?? choices.find((m) => m.membershipId === chosen) ?? null;
  const first = target === null ? "They" : firstName(target.name);
  return (
    <SheetContent
      side="side"
      title={
        target === null || member === null
          ? "Choose a new owner"
          : `Make ${target.name} an owner`
      }
    >
      <div className="flex flex-col gap-3.5" data-team-sheet="transfer">
        {member === null ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="team-owner"
              className="cq-label text-(--cq-text-primary)"
            >
              New owner
            </label>
            <select
              id="team-owner"
              value={chosen}
              onChange={(event) => {
                setChosen(event.target.value);
              }}
              className="min-h-11 w-full rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 cq-body text-(--cq-text-primary)"
            >
              {choices.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <p className="cq-body text-(--cq-text-secondary)">
          {first} gets a request to accept. Once they do, you&apos;re both
          owners, and you can step down or leave.
        </p>
        <ul className="flex flex-col gap-2">
          {[
            "Billing and the plan",
            `Closing the ${words.word}`,
            "Making or removing owners",
          ].map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 cq-body-sm text-(--cq-text-primary)"
            >
              <Check
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
                className="text-(--cq-accent)"
              />
              {item}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending || target === null}
            className={buttonClassName("primary")}
            onClick={() => {
              if (target !== null) onSend(target);
            }}
          >
            Send request
          </button>
          <button
            type="button"
            className={buttonClassName("quiet")}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </SheetContent>
  );
}

type UnsentInvite = { readonly email: string; readonly link: string };

/**
 * P15: when an invitation email did not go, the admin who sent it passes
 * the link on themselves. The link is shown once, here, and never listed
 * again (the server keeps only its hash); Resend makes a new one.
 */
export function UnsentInvites({
  items,
  onDismiss,
}: {
  readonly items: readonly UnsentInvite[];
  readonly onDismiss: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <section
      role="status"
      aria-label="Invitations not emailed"
      className="flex flex-col gap-3 rounded-[14px] border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-4"
      data-team-unsent
    >
      <p className="flex items-center gap-2 cq-body-sm font-medium text-(--cq-text-primary)">
        <CircleAlert
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
        Couldn&apos;t send the email — copy the invite link
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.link}
            className="flex min-h-11 items-center justify-between gap-3"
          >
            <span className="min-w-0 truncate cq-body-sm text-(--cq-text-secondary)">
              {item.email}
            </span>
            <button
              type="button"
              className={buttonClassName("secondary", "compact", "gap-1.5")}
              onClick={() => {
                void navigator.clipboard
                  .writeText(item.link)
                  .then(() => {
                    setCopied(item.link);
                  })
                  .catch(() => {
                    setCopied(null);
                  });
              }}
              data-team-copy-link
            >
              <Copy
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
              {copied === item.link ? "Copied" : "Copy invite link"}
            </button>
          </li>
        ))}
      </ul>
      <p className="cq-caption text-(--cq-text-tertiary)">
        Each link works once, for 7 days, for the person it was made for.{" "}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={onDismiss}
        >
          Done
        </button>
      </p>
    </section>
  );
}
