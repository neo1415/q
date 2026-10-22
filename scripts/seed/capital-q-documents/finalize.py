"""Stamp PDF metadata and write manifest.json for Capital Q's demo documents.

Run after build_xlsx.py, build_html.py and print_pdfs.mjs:
python3 scripts/seed/capital-q-documents/finalize.py supabase/seed-assets/capital-q-documents
"""

import hashlib
import json
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter

WATERMARK = (
    "DEMONSTRATION DOCUMENT — illustrative, prepared for the Capital Q product "
    "demo. Not a legal or financial record."
)
PDF, XLSX = "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DOCS = [
    ("capital-q-pitch-deck-q3-2026.pdf", "Pitch deck, Q3 2026", "pitch_deck", PDF),
    ("capital-q-financial-model-2026-2028.xlsx", "Financial model 2026–2028", "financial_model", XLSX),
    ("capital-q-cap-table.xlsx", "Cap table summary", "cap_table", XLSX),
    ("capital-q-certificate-of-incorporation-summary.pdf", "Certificate of incorporation — summary", "legal_summary", PDF),
    ("capital-q-shareholder-agreement-summary.pdf", "Shareholder agreement — summary", "legal_summary", PDF),
    ("capital-q-board-composition-note.pdf", "Board composition note", "governance", PDF),
]
VIDEO = Path("docs/ai-handoff/evidence/q-story/master/q-story-master-720p.mp4")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stamp(path, title):
    reader = PdfReader(path)
    writer = PdfWriter(clone_from=reader)
    writer.add_metadata(
        {
            "/Title": f"Capital Q — {title} (DEMONSTRATION DOCUMENT)",
            "/Subject": WATERMARK,
            "/Author": "Capital Q product demo (illustrative)",
            "/Keywords": "demonstration; illustrative; not a legal or financial record",
        }
    )
    with open(path, "wb") as fh:
        writer.write(fh)
    return len(reader.pages)


def main(out_dir):
    entries = []
    for name, title, kind, mime in DOCS:
        path = out_dir / name
        entry = {"file": name, "title": title, "kind": kind, "mimeType": mime}
        if mime == PDF:
            entry["pages"] = stamp(path, title)
        entry.update({"bytes": path.stat().st_size, "sha256": sha256(path)})
        entries.append(entry)
    manifest = {
        "$comment": "Capital Q's demonstration data room (owner direction 2026-10-22). Loaded by the S6 demo-companies seed. Every file carries the watermark below on every page or sheet and in its file properties. Documents are not verification and must never create a verification claim. Figures match supabase/seed-assets/demo-companies/companies.json; the SAFE valuation cap and the founder/ESOP split are illustrative placeholders that the owner confirms.",
        "seedKey": "capital-q-documents-v1",
        "company": "capital-q",
        "asOf": "2026-09-30",
        "watermark": WATERMARK,
        "documents": entries,
        "pitchVideo": {
            "$comment": "Q genuinely pitching Capital Q (the Q Story master). Not a founder video. Upload through the normal /pitch/new path at the owner-approved deploy step; never fabricated.",
            "source": str(VIDEO),
            "bytes": VIDEO.stat().st_size if VIDEO.exists() else None,
            "sha256": sha256(VIDEO) if VIDEO.exists() else None,
            "title": "Capital Q — the Q Story",
            "audience": "Everyone on Capital Q",
            "uploadPath": "/pitch/new",
        },
        "illustrativeValues": {
            "safePostMoneyValuationCapUsd": "10000000",
            "foundersSharesPreRound": {"david": 6000000, "zino": 3000000},
            "esopReservedShares": 1000000,
        },
        "build": [
            "python3 scripts/seed/capital-q-documents/build_xlsx.py supabase/seed-assets/capital-q-documents",
            "python3 <xlsx skill>/scripts/recalc.py <each .xlsx>  # LibreOffice computes cached values",
            "python3 scripts/seed/capital-q-documents/build_html.py <scratch html dir>",
            "node scripts/seed/capital-q-documents/print_pdfs.mjs <scratch html dir> supabase/seed-assets/capital-q-documents",
            "python3 scripts/seed/capital-q-documents/finalize.py supabase/seed-assets/capital-q-documents",
        ],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
