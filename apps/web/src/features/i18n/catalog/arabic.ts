import { ANSWERS_AR } from "./answers";
import { BOARD_AR } from "./board";
import { ADMIN_AR } from "./admin";
import { ANALYTICS_AR } from "./analytics";
import { COMPANY_AR } from "./company";
import { CORE_AR } from "./core";
import { ACCOUNT_AR } from "./account";
import { ORGANISATION_AR } from "./organisation";
import { CRM_DESIGN_AR } from "./crm-design";
import { CRM_IMPORT_AR } from "./crm-import";
import { WORK_DESIGN_AR } from "./work-design";
import { CRM_RECORD_AR } from "./crm-record";
import { DAILY_AR } from "./daily";
import { DISCOVER_AR } from "./discover";
import { DISCOVERY_PAGES_AR } from "./discovery-pages";
import { DOCUMENTS_AR } from "./documents";
import { GATEQ_AR } from "./gateq";
import { LANGUAGE_AR } from "./language";
import { Q_AR } from "./q";
import { RELATIONSHIPS_AR } from "./relationships";
import { SCORES_AR } from "./scores";
import { SETUP_AR } from "./setup";
import { SHELL_AR } from "./shell";
import { SITE_CONTENT_AR } from "./site-content";
import { SWEEP_AR } from "./sweep";
import { TAXONOMY_AR } from "./taxonomy";
import { WORK_AR } from "./work";
import { WORK_CHOSEN_AR } from "./work-chosen";

/**
 * Every area's Arabic, merged. An area adds `catalog/<area>.ts` and one
 * line here; the same English string means the same thing everywhere.
 */
export const ARABIC: Readonly<Record<string, string>> = {
  // First: what the live check of 2026-10-16 found; an area's own entry
  // for the same words wins. The Work designs' short words ("Save",
  // "Share") only fill gaps.
  ...WORK_CHOSEN_AR,
  // The work board (2026-10-23): first too, so an area's own word for a
  // shared one ("Add", "Done", "Move") still wins.
  ...BOARD_AR,
  // Organisation roles and activity (2026-10-21): first, so every area's
  // own word for a shared one ("Admin", "Team") still wins.
  ...ORGANISATION_AR,
  // Decision 107: the site content editor; first, so a shared word
  // ("Publish", "History") keeps its area's own Arabic.
  ...SITE_CONTENT_AR,
  // Decision 106: the CRM import; first too, so an area's own word for a
  // shared one ("Import", "Stage") keeps its Arabic.
  ...CRM_IMPORT_AR,
  ...ACCOUNT_AR,
  ...CRM_DESIGN_AR,
  ...DISCOVERY_PAGES_AR,
  ...WORK_DESIGN_AR,
  ...SWEEP_AR,
  ...CORE_AR,
  ...RELATIONSHIPS_AR,
  ...CRM_RECORD_AR,
  ...DOCUMENTS_AR,
  ...GATEQ_AR,
  ...WORK_AR,
  ...DAILY_AR,
  ...ADMIN_AR,
  ...ANALYTICS_AR,
  ...Q_AR,
  ...DISCOVER_AR,
  ...COMPANY_AR,
  ...SETUP_AR,
  ...SHELL_AR,
  ...ANSWERS_AR,
  ...LANGUAGE_AR,
  ...SCORES_AR,
  // Last: a taxonomy name reads the same on every screen (one term for
  // "Series A" everywhere), whatever an area catalogue says.
  ...TAXONOMY_AR,
};
