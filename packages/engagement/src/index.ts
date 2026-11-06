export const PACKAGE_NAME = "@capital-q/engagement" as const;

export {
  createPostgresEngagementRepository,
  type AppendOutcome,
  type EngagementRepository,
  type EngagementViewer,
} from "./postgres-engagement-repository.js";
export {
  createEngagementService,
  viewerFrom,
  type EngagementService,
  type EngagementServiceDependencies,
} from "./service.js";
export {
  createPostgresCompanyEngagementReader,
  type CompanyEngagementReader,
} from "./postgres-engagement-reader.js";
export {
  createAnalyticsSettingsReader,
  settingsFromRow,
  type AnalyticsSettingsReader,
} from "./settings.js";
