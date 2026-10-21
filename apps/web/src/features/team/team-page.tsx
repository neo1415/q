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
  Search,
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
import {
  accountButton,
  Field,
  fieldClassName,
  Pending,
  RadioList,
} from "@/features/settings/account-kit";
import { useT } from "@/features/i18n/language";

/**
 * Settings → Team (G2; chosen design "Invite first", 2026-10-21): the
 * invite on one line at the top, with what the role can do under it; then
 * the people and the invitations still open, each with what may be done.
 *
 * What the person may do comes from the server (`team.you.can`, decided
 * from their role there); the controls follow it, and every change still
 * goes through the API, which decides again. Hiding is never the guard.
 *
 * Plain words: "Company" for founders, "Firm" for investors, never
 * "organisation".
 */

type Sheet =
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
  const t = useT();
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

  const pendingInvites = can.invite ? team.invitations : [];
  const peopleNote = [
    `${String(team.members.length)} ${team.members.length === 1 ? "person" : "people"}`,
    pendingInvites.length === 0
      ? null
      : `${String(pendingInvites.length)} ${pendingInvites.length === 1 ? "invitation" : "invitations"}`,
  ]
    .filter((part) => part !== null)
    .join(", ");

  const body = (
    <>
      {can.invite ? (
        <InviteCard
          words={words}
          pending={pending}
          domain={emailDomain(me?.email ?? null)}
          onSend={(emails, role) =>
            new Promise<boolean>((resolve) => {
              startTransition(async () => {
                const out = await inviteAction(emails, role, "");
                if (!out.ok) {
                  setToast(out.message);
                  resolve(false);
                  return;
                }
                setTeam(out.value.team);
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
                      : sent === 1
                        ? `Invitation sent to ${out.value.invited[0]?.email ?? "them"}. It expires in 7 days.`
                        : `${String(sent)} invitations sent. They expire in 7 days.`,
                );
                resolve(sent > 0);
              });
            })
          }
        />
      ) : (
        <p
          className="m-0 flex items-start gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-3.5 py-3 text-sm text-(--cq-text-secondary)"
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
              {t(ROLE_WORD[team.you.role])}
            </b>
            . Admins invite people and change roles. <AskAnAdmin team={team} />
          </span>
        </p>
      )}

      <WaitingForYou team={team} pending={pending} change={change} />

      <section aria-labelledby="team-people">
        <div className="mt-2 mb-3 flex flex-wrap items-baseline gap-2.5">
          <h2
            id="team-people"
            className="m-0 text-[15px] font-semibold text-(--cq-text-primary)"
          >
            {t("People")}
          </h2>
          <span className="ms-auto text-xs text-(--cq-text-tertiary)">
            {t(peopleNote)}
          </span>
        </div>
        {team.members.length > 5 ? (
          <label className="mb-3 flex min-h-11 w-full items-center gap-2 rounded-full bg-(--cq-surface-subtle) px-3.5 text-(--cq-text-tertiary) sm:w-64">
            <span className="sr-only">{t("Search people")}</span>
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
              placeholder={t("Search")}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary)"
            />
          </label>
        ) : null}
        <ul className="m-0 flex list-none flex-col rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-1">
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
          {shown.length === 0 ? (
            <li className="py-3 text-sm text-(--cq-text-secondary)">
              {t("Nobody matches that.")}
            </li>
          ) : null}
          {pendingInvites.map((invitation) => (
            <li
              key={invitation.invitationId}
              className="cq-crm-swap grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-(--cq-border-subtle) py-3"
              data-team-invitation
            >
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-full border border-(--cq-border) bg-(--cq-surface-subtle) text-sm font-semibold text-(--cq-text-secondary)"
              >
                ?
              </span>
              <span className="min-w-0">
                <b className="block truncate text-[15px] font-semibold text-(--cq-text-primary)">
                  {invitation.email}
                </b>
                <span className="text-[13px] text-(--cq-text-secondary)">
                  {t(ROLE_WORD[invitation.role])}.{" "}
                  {invitation.state === "EXPIRED"
                    ? t(`Expired. Sent ${timeAgo(invitation.sentAt)}`)
                    : `${t(`Invited ${timeAgo(invitation.sentAt)}`)}. ${t(expiresIn(invitation.expiresAt))}.`}
                </span>
              </span>
              <span className="flex gap-1">
                {invitation.state === "EXPIRED" ? (
                  <button
                    type="button"
                    disabled={pending}
                    className={accountButton("quiet", "sm")}
                    onClick={() => {
                      change(
                        () => resendAction(invitation.invitationId),
                        `Sent again to ${invitation.email}.`,
                      );
                    }}
                  >
                    {t("Resend")}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={pending}
                  className={accountButton("quiet", "sm")}
                  onClick={() => {
                    change(
                      () => revokeAction(invitation.invitationId),
                      "Invitation cancelled.",
                    );
                  }}
                  data-team-cancel-invitation
                >
                  {t("Cancel")}
                </button>
              </span>
            </li>
          ))}
        </ul>
        {solo ? (
          <p
            className="mt-3 max-w-[60ch] text-sm text-(--cq-text-secondary)"
            data-team-solo
          >
            {t(words.soloLine(name))}
          </p>
        ) : null}
      </section>
    </>
  );

  const close = () => {
    setSheet(null);
  };
  const lastOwner = team.you.role === "OWNER" && team.ownerCount <= 1;

  return (
    <div className="flex flex-col gap-4" data-team-page>
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
        {sheet?.kind === "role" ? (
          <RoleSheet
            member={sheet.member}
            words={words}
            canOwn={can.own}
            pending={pending}
            onSave={(role) => {
              change(
                () => changeRoleAction(sheet.member.membershipId, role),
                `${sheet.member.name} is now ${role === "ADMIN" ? "an Admin" : "a Member"}. It applies from their next action.`,
              );
            }}
            onOwner={() => {
              setSheet({ kind: "transfer", member: sheet.member });
            }}
            onRemove={
              can.removeMembers && (sheet.member.role !== "OWNER" || can.own)
                ? () => {
                    setSheet({ kind: "remove", member: sheet.member });
                  }
                : null
            }
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
            <SheetContent side="side" title={t("You're the only owner")}>
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
                      {t("Choose a new owner")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={buttonClassName("quiet")}
                    onClick={close}
                  >
                    {t("Stay")}
                  </button>
                </div>
                {team.members.length > 1 ? null : (
                  <p className="cq-caption text-(--cq-text-tertiary)">
                    {t(
                      "You're the only person here. Invite someone and make them owner first.",
                    )}
                  </p>
                )}
              </div>
            </SheetContent>
          ) : (
            <SheetContent side="side" title={`Leave ${name}?`}>
              <div className="flex flex-col gap-3.5" data-team-sheet="leave">
                <p className="cq-body text-(--cq-text-secondary)">
                  {t(
                    "You'll lose access to its relationships, notes and documents straight away. An admin can invite you back.",
                  )}
                </p>
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  {t(
                    "Your own profile and your other companies and firms aren't affected.",
                  )}
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
                    {t("Leave")}
                  </button>
                  <button
                    type="button"
                    className={buttonClassName("quiet")}
                    onClick={close}
                  >
                    {t("Stay")}
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
        data-q-notice={toast === null ? undefined : "TOAST"}
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
  const t = useT();
  const admin = team.members.find(
    (member) =>
      !member.isYou && member.role !== "MEMBER" && member.email !== null,
  );
  return admin?.email == null ? null : (
    <a href={`mailto:${admin.email}`} className="underline underline-offset-2">
      {t("Ask an admin")}
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
  const t = useT();
  const can = team.you.can;
  // Admins change Admins and Members; owners are changed by hand-over only.
  const roleButton =
    can.changeRoles && member.role !== "OWNER" && !member.isYou;
  // Yourself: leave. Someone else: remove (an owner only by an owner).
  const removable =
    !member.isYou && can.removeMembers && (member.role !== "OWNER" || can.own);
  return (
    <li
      className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-(--cq-border-subtle) py-3 first:border-t-0"
      data-team-member
    >
      <Avatar
        name={member.name}
        size="md"
        className="size-10!"
        src={member.avatarUrl ?? undefined}
      />
      <span className="min-w-0">
        <b className="block truncate text-[15px] font-semibold text-(--cq-text-primary)">
          {member.name}
        </b>
        <span className="block truncate text-[13px] text-(--cq-text-secondary)">
          {t(ROLE_WORD[member.role])}.{" "}
          {member.isYou ? t("You") : t(`Joined ${joinedOn(member.joinedAt)}`)}
          {member.title === null || member.title === ""
            ? null
            : ` · ${member.title}`}
        </span>
      </span>
      <span className="flex items-center gap-1">
        {roleButton ? (
          <button
            type="button"
            aria-label={`Role for ${member.name}: ${ROLE_WORD[member.role]}. Change`}
            className={accountButton("quiet", "sm")}
            onClick={onRole}
            data-team-change-role
          >
            {t("Change role")}
          </button>
        ) : removable ? (
          <button
            type="button"
            className={accountButton("quiet", "sm")}
            onClick={onMore}
            aria-label={`Remove ${member.name}`}
          >
            {t("Remove")}
          </button>
        ) : member.isYou ? (
          <button
            type="button"
            className={accountButton("quiet", "sm")}
            onClick={onMore}
            data-team-leave
          >
            {t("Leave")}
          </button>
        ) : null}
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
  const t = useT();
  const offers = team.ownershipOffers.filter(
    (offer) => offer.direction !== "OTHER",
  );
  if (team.joinRequests.length === 0 && offers.length === 0) return null;
  const name = team.organisation.name;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="team-waiting">
      <h2 id="team-waiting" className="cq-title-sm text-(--cq-text-primary)">
        {t("Waiting for you")}
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
            {t("Let in")}
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
            {t("Decline")}
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
                {t("Accept")}
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
                {t("Decline")}
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
              {t("Withdraw")}
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

/** "2 Sept": when someone joined. */
function joinedOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "Expires in 5 days", "Expires today": an invitation's time left. */
export function expiresIn(iso: string, now: Date = new Date()): string {
  const days = Math.ceil(
    (new Date(iso).getTime() - now.getTime()) / 86_400_000,
  );
  if (!Number.isFinite(days) || days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${String(days)} days`;
}

/** The person's own email domain, for the invite field's example. */
function emailDomain(email: string | null): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  return email === null || at < 0 ? null : email.slice(at + 1);
}

/**
 * Invite first (chosen design "Invite first", 2026-10-21): their work
 * email and a role on one line, with what that role can do written
 * underneath, and Send. The new invitation joins the list at once, with
 * its expiry; the API decides again who may invite.
 */
function InviteCard({
  words,
  pending,
  domain,
  onSend,
}: {
  readonly words: ReturnType<typeof teamWords>;
  readonly pending: boolean;
  readonly domain: string | null;
  readonly onSend: (
    emails: readonly string[],
    role: InvitableRole,
  ) => Promise<boolean>;
}) {
  const t = useT();
  const [raw, setRaw] = useState("");
  const [role, setRole] = useState<InvitableRole>("MEMBER");
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const emails = splitEmailInput(raw);
  const looksRight = emails.length > 0 && emails.every((e) => e.includes("@"));
  return (
    <form
      className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-5 py-[18px]"
      data-team-invite
      onSubmit={(event) => {
        event.preventDefault();
        if (!looksRight || phase !== "idle") return;
        setPhase("pending");
        void onSend(emails, role).then((sent) => {
          if (!sent) {
            setPhase("idle");
            return;
          }
          setPhase("done");
          setRaw("");
          setTimeout(() => setPhase("idle"), 1600);
        });
      }}
    >
      <h2 className="m-0 flex items-center gap-2 text-[13px] font-medium text-(--cq-text-secondary)">
        {t("Invite a colleague")}
      </h2>
      <div className="grid grid-cols-1 items-end gap-2.5 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <Field label={t("Work email")} htmlFor="team-invite-email">
          <input
            id="team-invite-email"
            type="text"
            inputMode="email"
            autoComplete="off"
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
            }}
            placeholder={
              domain === null ? "name@company.com" : `name@${domain}`
            }
            className={fieldClassName}
          />
        </Field>
        <Field label={t("Role")} htmlFor="team-invite-role">
          <span className="relative block">
            <select
              id="team-invite-role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value === "ADMIN" ? "ADMIN" : "MEMBER");
              }}
              className={cx(fieldClassName, "appearance-none pe-9")}
            >
              <option value="MEMBER">{t("Member")}</option>
              <option value="ADMIN">{t("Admin")}</option>
            </select>
            <ChevronDown
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
              className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-(--cq-text-secondary)"
            />
          </span>
        </Field>
        <button
          type="submit"
          disabled={pending || phase !== "idle" || !looksRight}
          aria-busy={phase === "pending"}
          className={accountButton(phase === "done" ? "done" : "primary")}
          data-team-invite-send
        >
          {phase === "pending" ? (
            <Pending>{t("Sending…")}</Pending>
          ) : phase === "done" ? (
            <>
              <Check size={14} aria-hidden="true" />
              {t("Sent")}
            </>
          ) : (
            t("Send invitation")
          )}
        </button>
      </div>
      <span className="text-xs text-(--cq-text-tertiary)" data-team-role-says>
        {t(
          `${ROLE_WORD[role]}: ${(role === "ADMIN" ? words.admin : words.member).replace(/^./u, (c) => c.toLowerCase())}`,
        )}
      </span>
    </form>
  );
}

function RoleSheet({
  member,
  words,
  canOwn,
  pending,
  onSave,
  onOwner,
  onRemove,
}: {
  readonly member: TeamMemberDto;
  readonly words: ReturnType<typeof teamWords>;
  readonly canOwn: boolean;
  readonly pending: boolean;
  readonly onSave: (role: InvitableRole) => void;
  readonly onOwner: () => void;
  /** Null when the person may not remove them. */
  readonly onRemove: (() => void) | null;
}) {
  const t = useT();
  const [role, setRole] = useState<InvitableRole>(
    member.role === "ADMIN" ? "ADMIN" : "MEMBER",
  );
  return (
    <SheetContent side="side" title={`${member.name}'s role`}>
      <div className="flex flex-col gap-3" data-team-sheet="role">
        {member.email === null ? null : (
          <span className="text-xs text-(--cq-text-tertiary)">
            {member.email}
          </span>
        )}
        <RadioList
          name="team-role"
          label={t("Role")}
          value={role}
          onChange={setRole}
          choices={[
            { key: "ADMIN", title: t("Admin"), description: t(words.admin) },
            {
              key: "MEMBER",
              title: t("Member"),
              description: t(words.member),
            },
          ]}
        />
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          className={accountButton("primary", "regular", "w-full")}
          onClick={() => {
            onSave(role);
          }}
          data-team-role-save
        >
          {pending ? <Pending>{t("Saving…")}</Pending> : t("Save role")}
        </button>
        {canOwn ? (
          <button
            type="button"
            className={accountButton("quiet", "regular", "w-full")}
            onClick={onOwner}
          >
            Make {firstName(member.name)} an owner…
          </button>
        ) : null}
        {onRemove === null ? null : (
          <button
            type="button"
            className={accountButton("quiet", "regular", "w-full")}
            onClick={onRemove}
            data-team-remove
          >
            {t("Remove from team")}
          </button>
        )}
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
  const t = useT();
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
            {t("Cancel")}
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
  const t = useT();
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
              {t("New owner")}
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
            {t("Send request")}
          </button>
          <button
            type="button"
            className={buttonClassName("quiet")}
            onClick={onClose}
          >
            {t("Cancel")}
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
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <section
      role="status"
      aria-label={t("Invitations not emailed")}
      className="flex flex-col gap-3 rounded-[14px] border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-4"
      data-team-unsent
    >
      <p className="flex items-center gap-2 cq-body-sm font-medium text-(--cq-text-primary)">
        <CircleAlert
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
        {t("Couldn't send the email — copy the invite link")}
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
          {t("Done")}
        </button>
      </p>
    </section>
  );
}
