/**
 * @capital-q/test-support
 *
 * Owns: shared test fixtures, builders, fakes and helpers used across packages
 * and deployables (doc 23, 182).
 * Does not own: the test runner configuration, which is rooted at
 * vitest.config.ts and playwright.config.ts.
 *
 * Test-only. This package must always be consumed as a devDependency and must
 * never be imported by production runtime source in apps/web, apps/api,
 * apps/q-api or apps/workers. Test code must not be able to reach a running
 * deployable.
 *
 * Foundation package. It must not depend on business domains -- no companies,
 * investors, network or other future domain package. Domain-specific fixture
 * builders belong with the domain that owns them and may consume primitives
 * from here; this package must not become a universal dependency hub.
 *
 * No fixture framework exists yet. The factories, tenant fixtures, clocks,
 * deterministic IDs and provider fakes described in doc 24 (246-253) are built
 * by the packets that need them, not in advance. Its only current content is
 * the harness verification test under test/.
 *
 * Note: doc 11 (7) refers to this package as `testing`; doc 23 (11/28), which
 * is the later engineering-standards authority, names it `test-support`.
 */

export const PACKAGE_NAME = "@capital-q/test-support" as const;
