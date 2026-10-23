// Capital Q's pitch video: the manifest check and the step decision.
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadPitchVideo, pitchStep } from "./pitch.mjs";

test("the video is the owner-approved file the manifest names", () => {
  const video = loadPitchVideo();
  assert.equal(video.ownerApprovedForAudience, true);
  assert.equal(video.bytes.byteLength, video.sizeBytes);
  assert.equal(video.audience, "Everyone on Capital Q");
});

test("a pitch is uploaded once, then only its details are corrected", () => {
  const title = "Capital Q — the story, for investors";
  assert.equal(pitchStep(null, title), "UPLOAD");
  assert.equal(pitchStep({ status: "READY", title: "Old" }, title), "UPLOAD");
  assert.equal(pitchStep({ status: "PROCESSING", title }, title), "UPLOAD");
  assert.equal(
    pitchStep(
      {
        status: "READY",
        title,
        audience: "INVESTORS",
        playbackPolicy: "AUTHORISED",
      },
      title,
    ),
    "DETAILS",
  );
  assert.equal(
    pitchStep(
      {
        status: "READY",
        title,
        audience: "NETWORK",
        playbackPolicy: "AUTHORISED",
      },
      title,
    ),
    "NOTHING",
  );
});
