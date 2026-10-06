#!/usr/bin/env bash
# Rebuild every seed asset locally (no network, no paid providers). One Chromium at a time.
set -euo pipefail
cd "$(dirname "$0")"
W=/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad/seed-assets/_work
[ -f "$W/faces.json" ] || python3 faces.py detect
python3 brand.py   && node render.mjs "$W/jobs-brand.json"
python3 people.py
python3 deck.py    && node render.mjs "$W/jobs-deck.json"
python3 dataroom.py && node render.mjs "$W/jobs-dr.json"
python3 qguide.py
python3 preview.py
