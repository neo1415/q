import { crc32, deflateRawSync } from "node:zlib";

/**
 * A minimal ZIP writer for the data export: deflated entries, a central
 * directory, no encryption, no ZIP64. Node's own zlib does the work, so no
 * archive dependency is added for one producer. Limits: under 65,535
 * entries and 4 GiB in all (the export refuses to grow past its own, much
 * smaller, ceiling first).
 */

export type ZipEntry = {
  /** Forward-slash path inside the archive; no leading slash, no "..". */
  readonly path: string;
  readonly data: Uint8Array;
};

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\0]{1,240}$/u;

/** A DOS date and time for every entry: the export's own timestamp. */
function dosDateTime(at: Date): {
  readonly date: number;
  readonly time: number;
} {
  const year = Math.max(1980, at.getUTCFullYear());
  return {
    date:
      ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    time:
      (at.getUTCHours() << 11) |
      (at.getUTCMinutes() << 5) |
      Math.floor(at.getUTCSeconds() / 2),
  };
}

export function buildZip(
  entries: readonly ZipEntry[],
  at: Date = new Date(),
): Uint8Array {
  if (entries.length >= 0xffff) throw new Error("ZIP_TOO_MANY_ENTRIES");
  const { date, time } = dosDateTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!SAFE_PATH.test(entry.path) || seen.has(entry.path)) {
      throw new Error("ZIP_BAD_PATH");
    }
    seen.add(entry.path);
    const name = Buffer.from(entry.path, "utf8");
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
    if (offset > 0xffffffff) throw new Error("ZIP_TOO_LARGE");
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
}
