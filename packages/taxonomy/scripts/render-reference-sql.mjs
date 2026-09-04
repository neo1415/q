// Render the reference taxonomy to SQL for a forward migration.
//
//   pnpm --filter @capital-q/taxonomy build
//   pnpm --filter @capital-q/taxonomy render:reference-sql > /tmp/reference.sql
//
// Output goes to stdout; the migration author appends it to a reviewed
// migration. Nothing here connects to a database.

import process from "node:process";

import { renderReferenceTaxonomySql } from "../dist/reference-data/sql.js";

process.stdout.write(renderReferenceTaxonomySql());
