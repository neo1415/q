# Proposal: one "Work" page instead of a Workspace folder

Status: **PROPOSED, for owner approval** (2026-10-17). Not built.

## The problem

After tonight's changes the sidebar is Discover · Explore · Q · CRM, then a folded **Workspace** group:

- **Investor:** Work, Documents, Rehearsals, The Q Daily.
- **Founder:** Work, Pitch & media, Data room & deck, Documents, Rehearsals, The Q Daily.

That is four to six more destinations. A busy investor won't open each one. The owner's goal is that a week of use lets a person say they've "been everywhere", and that Q does the navigating.

## Proposal

Replace the Workspace folder with **one sidebar entry, "Work"**: a single page that is the person's desk. Sidebar becomes:

```
Discover · Explore · Q · CRM · Work            (You: Profile, Settings in the footer)
```

The Work page has one strip of tabs, in the CRM's style, and opens on what needs them:

| Tab | Investor | Founder | Today's page (address unchanged) |
| --- | --- | --- | --- |
| **Tasks** (default) | Q's running and finished work, approvals | same | `/work` |
| **Documents** | uploads, Q-made reports, opened in-app | same | `/documents` |
| **Pitch** | — | pitch video, deck, data room | `/pitch`, `/company/data-room` |
| **Rehearsals** | practice calls | practice calls | `/rehearsals` |
| **The Q Daily** | today's edition | today's edition | `/daily` |

## Rules

- **Every page keeps its address.** Q's route table and voice destinations keep opening each one instantly, with no model call. This is the same pattern as tonight's GateQ and Company requests CRM tabs.
- **No new data or contracts.** It is navigation only: the tab strip goes on each existing page, and the sidebar keeps one entry.
- **Phone:** the bottom bar is Discover · Explore · Q · CRM · More. Work moves to the first item in More, or replaces More if the owner prefers.
- **Rejected:** a "hub of cards" landing page. It would add a click and recreate the clutter the owner asked to remove.

## Cost

About half a day:

- a tab component, built like the CRM tabs;
- the sidebar change;
- test updates (sidebar groups, Q control ids).

Low risk, because no page moves.

## Decision needed

1. Approve **one "Work" entry** with the tabs above?
2. On a phone: **Work under More**, or **Work replaces More**?
