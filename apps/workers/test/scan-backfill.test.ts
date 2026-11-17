import { describe, expect, it } from "vitest";

import {
  createUnavailableMalwareScanner,
  type MalwareScanner,
  type MalwareVerdictStatus,
} from "../src/documents/malware.js";
import {
  scanNotScannedDocuments,
  scanNotScannedDocumentsAtStart,
  type NotScannedVersion,
  type ScanBackfillStore,
} from "../src/documents/scan-backfill.js";

/**
 * Decision 104, ADR 0042 reversal step 2: every version recorded NOT_SCANNED
 * is scanned once a scanner exists. Only a CLEAN verdict writes CLEAN; an
 * INFECTED one quarantines the version; an error leaves it for the next
 * run. Bounded, and a second run changes nothing twice.
 */

const TENANT = "a0000000-0000-4000-8000-000000000001";

function version(n: number): NotScannedVersion {
  return {
    documentVersionId: `e0000000-0000-4000-8000-00000000000${String(n)}`,
    tenantId: TENANT,
    bucket: "cq-documents-private",
    key: `uploads/${String(n)}.pdf`,
    sizeBytes: 100,
    mimeType: "application/pdf",
  };
}

/** An in-memory store with compare-and-set semantics, like the SQL. */
function memoryStore(versions: readonly NotScannedVersion[]) {
  const status = new Map<string, string>(
    versions.map((v) => [v.documentVersionId, "NOT_SCANNED"]),
  );
  const revokedFor: string[] = [];
  const limits: number[] = [];
  const store: ScanBackfillStore = {
    select: (limit) => {
      limits.push(limit);
      return Promise.resolve(
        versions
          .filter((v) => status.get(v.documentVersionId) === "NOT_SCANNED")
          .slice(0, limit),
      );
    },
    markClean: (v) => {
      if (status.get(v.documentVersionId) !== "NOT_SCANNED") {
        return Promise.resolve(false);
      }
      status.set(v.documentVersionId, "CLEAN");
      return Promise.resolve(true);
    },
    quarantine: (v) => {
      if (status.get(v.documentVersionId) !== "NOT_SCANNED") {
        return Promise.resolve(false);
      }
      status.set(v.documentVersionId, "BLOCKED");
      revokedFor.push(v.documentVersionId);
      return Promise.resolve(true);
    },
  };
  return { store, status, revokedFor, limits };
}

function scannerBy(
  verdicts: Readonly<Record<string, MalwareVerdictStatus | "THROW">>,
): MalwareScanner & { readonly scanned: string[] } {
  const scanned: string[] = [];
  return {
    id: "clamav",
    scanned,
    scan: (target) => {
      scanned.push(target.key);
      const status = verdicts[target.key] ?? "CLEAN";
      if (status === "THROW") return Promise.reject(new Error("socket"));
      return Promise.resolve({
        status,
        scannerId: "clamav",
        scannerVersion: "1.4.1/27460",
        ...(status === "INFECTED" ? { signature: "Eicar-Test-Signature" } : {}),
      });
    },
  };
}

describe("scanning the versions recorded NOT_SCANNED", () => {
  it("refuses without a scanner, and changes nothing", async () => {
    const world = memoryStore([version(1)]);
    const result = await scanNotScannedDocuments({
      store: world.store,
      scanner: createUnavailableMalwareScanner(),
      apply: true,
    });
    expect(result.kind).toBe("REFUSED");
    expect([...world.status.values()]).toEqual(["NOT_SCANNED"]);
  });

  it("a dry run lists and scans nothing", async () => {
    const world = memoryStore([version(1), version(2)]);
    const scanner = scannerBy({});
    const result = await scanNotScannedDocuments({
      store: world.store,
      scanner,
      apply: false,
    });
    expect(result).toMatchObject({ kind: "DRY_RUN", selected: 2 });
    expect(scanner.scanned).toEqual([]);
    expect([...world.status.values()]).toEqual(["NOT_SCANNED", "NOT_SCANNED"]);
  });

  it("follows each verdict: CLEAN, quarantine on INFECTED, and an error stays NOT_SCANNED", async () => {
    const world = memoryStore([version(1), version(2), version(3), version(4)]);
    const scanner = scannerBy({
      "uploads/2.pdf": "INFECTED",
      "uploads/3.pdf": "ERROR",
      "uploads/4.pdf": "THROW",
    });

    const result = await scanNotScannedDocuments({
      store: world.store,
      scanner,
      apply: true,
    });

    expect(result).toMatchObject({
      kind: "APPLIED",
      selected: 4,
      clean: 1,
      infected: 1,
      failed: 2,
      skipped: 0,
    });
    expect(world.status.get(version(1).documentVersionId)).toBe("CLEAN");
    expect(world.status.get(version(2).documentVersionId)).toBe("BLOCKED");
    expect(world.status.get(version(3).documentVersionId)).toBe("NOT_SCANNED");
    expect(world.status.get(version(4).documentVersionId)).toBe("NOT_SCANNED");
    expect(world.revokedFor).toEqual([version(2).documentVersionId]);
    if (result.kind === "APPLIED") {
      expect(
        result.versions.find((v) => v.outcome === "INFECTED")?.signature,
      ).toBe("Eicar-Test-Signature");
    }
  });

  it("is idempotent: a second run scans only what is still NOT_SCANNED", async () => {
    const world = memoryStore([version(1), version(2)]);
    const scanner = scannerBy({ "uploads/2.pdf": "ERROR" });
    await scanNotScannedDocuments({ store: world.store, scanner, apply: true });
    scanner.scanned.length = 0;

    const again = await scanNotScannedDocuments({
      store: world.store,
      scanner: scannerBy({}),
      apply: true,
    });

    expect(again).toMatchObject({ selected: 1, clean: 1 });
    expect(world.status.get(version(1).documentVersionId)).toBe("CLEAN");
    expect(world.status.get(version(2).documentVersionId)).toBe("CLEAN");
  });

  it("counts a version another run already settled as skipped, never overwritten", async () => {
    const world = memoryStore([version(1)]);
    const store: ScanBackfillStore = {
      ...world.store,
      // Selected, then settled by a concurrent run before this one writes.
      select: async (limit) => {
        const rows = await world.store.select(limit);
        world.status.set(version(1).documentVersionId, "BLOCKED");
        return rows;
      },
    };
    const result = await scanNotScannedDocuments({
      store,
      scanner: scannerBy({}),
      apply: true,
    });
    expect(result).toMatchObject({ clean: 0, skipped: 1 });
    expect(world.status.get(version(1).documentVersionId)).toBe("BLOCKED");
  });

  it("is bounded", async () => {
    const world = memoryStore([version(1)]);
    await scanNotScannedDocuments({
      store: world.store,
      scanner: scannerBy({}),
      apply: true,
      limit: 1_000_000,
    });
    await scanNotScannedDocuments({
      store: world.store,
      scanner: scannerBy({}),
      apply: true,
    });
    expect(world.limits).toEqual([1_000, 200]);
  });

  it("at start: runs only with a scanner, logs ids and the signature, never fails the worker", async () => {
    const lines: { fields: Record<string, unknown>; message: string }[] = [];
    const logger = {
      info: (fields: Record<string, unknown>, message: string) =>
        lines.push({ fields, message }),
      warn: (fields: Record<string, unknown>, message: string) =>
        lines.push({ fields, message }),
    };
    const untouched = memoryStore([version(1)]);
    await scanNotScannedDocumentsAtStart({
      store: untouched.store,
      scanner: createUnavailableMalwareScanner(),
      logger,
    });
    expect(untouched.limits).toEqual([]);

    const world = memoryStore([version(1), version(2)]);
    await scanNotScannedDocumentsAtStart({
      store: world.store,
      scanner: scannerBy({ "uploads/2.pdf": "INFECTED" }),
      logger,
    });
    expect(lines.map((line) => line.message)).toEqual([
      "evidence.documents.not_scanned_scanned_at_start",
      "evidence.documents.quarantined_infected",
    ]);
    expect(lines[1]?.fields).toEqual({
      documentVersionId: version(2).documentVersionId,
      tenantId: TENANT,
      signature: "Eicar-Test-Signature",
    });

    const broken: ScanBackfillStore = {
      ...world.store,
      select: () => Promise.reject(new Error("database down")),
    };
    await expect(
      scanNotScannedDocumentsAtStart({
        store: broken,
        scanner: scannerBy({}),
        logger,
      }),
    ).resolves.toBeUndefined();
    expect(lines.at(-1)?.message).toBe(
      "evidence.documents.not_scanned_scan_failed",
    );
  });
  it("at start: drains the whole backlog in batches, and stops on a scanner failure", async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({
      ...version(1),
      documentVersionId: `e0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      key: `uploads/many-${String(i)}.pdf`,
    }));
    const logger = { info: () => undefined, warn: () => undefined };
    const world = memoryStore(many);
    await scanNotScannedDocumentsAtStart({
      store: world.store,
      scanner: scannerBy({}),
      logger,
      pauseMs: 0,
    });
    expect(world.limits).toEqual([200, 200, 200]);
    expect([...world.status.values()].every((s) => s === "CLEAN")).toBe(true);

    const capped = memoryStore(many);
    await scanNotScannedDocumentsAtStart({
      store: capped.store,
      scanner: scannerBy({}),
      logger,
      pauseMs: 0,
      maxBatches: 2,
    });
    expect(capped.limits).toEqual([200, 200]);

    // A batch with a scanner error leaves those NOT_SCANNED: no retry loop.
    const flaky = memoryStore(many);
    await scanNotScannedDocumentsAtStart({
      store: flaky.store,
      scanner: scannerBy({ "uploads/many-3.pdf": "THROW" }),
      logger,
      pauseMs: 0,
    });
    expect(flaky.limits).toEqual([200]);
  });
});
