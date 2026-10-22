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
# Everything is uploaded (owner, 22 Oct 2026). documentType values are the
# evidence.documents types (migration 20261228121200); folderCode values are
# evidence.data_room_folders codes (migration 20261207110000).
DOCS = [
    ("pitch-deck.pdf", "Pitch deck, Q3 2026", "PITCH_DECK", PDF, "PUBLIC", "fundraising"),
    ("financial-model.xlsx", "Financial model 2026–2028", "FINANCIAL_MODEL", XLSX, "ON_REQUEST", "financials"),
    ("capital-q-cap-table.xlsx", "Cap table summary (illustrative)", "CORPORATE", XLSX, "ON_REQUEST", "cap_table"),
    (
        "capital-q-certificate-of-incorporation-summary.pdf",
        "Certificate of incorporation — summary",
        "CORPORATE",
        PDF,
        "ON_REQUEST",
        "corporate",
    ),
    (
        "capital-q-shareholder-agreement-summary.pdf",
        "Shareholder agreement — summary",
        "LEGAL",
        PDF,
        "ON_REQUEST",
        "legal_ip",
    ),
    ("capital-q-board-composition-note.pdf", "Board composition note", "GOVERNANCE", PDF, "ON_REQUEST", "corporate"),
]
# A copy of the Q Story master (docs/ai-handoff/evidence/q-story/master/q-story-master-720p.mp4).
VIDEO_NAME = "capital-q-pitch-video.mp4"


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
    for name, title, doc_type, mime, level, folder in DOCS:
        path = out_dir / name
        if mime == PDF:
            stamp(path, title)
        entries.append(
            {
                "file": name,
                "title": title,
                "documentType": doc_type,
                "mime": mime,
                "sha256": sha256(path),
                "dataRoomLevel": level,
                "folderCode": folder,
                "watermark": WATERMARK,
            }
        )
    manifest = {
        "$comment": "Capital Q's demonstration data room (owner direction 2026-10-22). Loaded by the S6 demo-companies seed. Every file carries the watermark below on every page or sheet and in its file properties. Documents are not verification and must never create a verification claim. Figures match supabase/seed-assets/demo-companies/companies.json; the SAFE valuation cap and the founder/ESOP split are illustrative values the owner approved on 22 Oct 2026.",
        "seedKey": "capital-q-documents-v1",
        "company": "capital-q",
        "asOf": "2026-09-30",
        "watermark": WATERMARK,
        "documents": entries,
        "pitchVideo": {
            "$comment": "Q genuinely pitching Capital Q: a copy of the Q Story master, not a founder video. Upload through /pitch/new (founder session and stream provider) with the audience below.",
            "file": VIDEO_NAME,
            "source": "docs/ai-handoff/evidence/q-story/master/q-story-master-720p.mp4",
            "mime": "video/mp4",
            "bytes": (out_dir / VIDEO_NAME).stat().st_size,
            "sha256": sha256(out_dir / VIDEO_NAME),
            "title": "Capital Q — the Q Story",
            "audience": "Everyone on Capital Q",
            "uploadPath": "/pitch/new",
        },
        "illustrativeValues": {
            "$comment": "Owner approved these illustrative values on 22 Oct 2026; each stays marked illustrative.",
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
