/**
 * The sections of the Settings page, in page order: each is an anchor
 * (`/settings#<id>`), a jump-index entry and a section Q can name (its
 * page manifest and the Q Workspace site map read this one list).
 */
export const SETTINGS_PAGE_SECTIONS = [
  { id: "profile", label: "Your profile" },
  { id: "account", label: "Account" },
  { id: "security", label: "Security" },
  { id: "team", label: "Team" },
  { id: "appearance", label: "Appearance" },
  { id: "q", label: "Q" },
  { id: "speaking", label: "How Q speaks for you" },
  { id: "notifications", label: "Notifications" },
  { id: "connections", label: "Connections" },
  { id: "billing", label: "Plan and billing" },
  { id: "privacy", label: "Privacy" },
] as const;

export type SettingsPageSectionId =
  (typeof SETTINGS_PAGE_SECTIONS)[number]["id"];
