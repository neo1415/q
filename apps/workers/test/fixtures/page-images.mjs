// Reports pages 2 and 3 as low-text and writes pictures for 2, 3 and 9
// (9 was never named low-text) plus an oversized one for 3 when asked to,
// so the test proves the parent reads back only what it may.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspace = process.argv[2];
const request = JSON.parse(
  readFileSync(join(workspace, "request.json"), "utf8"),
);
const oversize = request.filename === "oversize.pdf";
writeFileSync(join(workspace, "page-2.jpg"), Buffer.from("jpeg-two"));
writeFileSync(
  join(workspace, "page-3.jpg"),
  oversize
    ? Buffer.alloc(request.pageImages.maxBytes + 1)
    : Buffer.from("jpeg-three"),
);
writeFileSync(join(workspace, "page-9.jpg"), Buffer.from("jpeg-nine"));
process.stdout.write(
  JSON.stringify({
    ok: true,
    extractorId: "fixture",
    extractorVersion: "1.0.0",
    output: {
      blocks: [],
      metadata: {
        parser: "fixture",
        parserVersion: "1.0.0",
        pageCount: 3,
        lowTextPages: [2, 3],
      },
    },
    pageImages: [2, 3, 9],
  }),
);
