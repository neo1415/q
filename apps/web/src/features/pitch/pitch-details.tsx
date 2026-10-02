"use client";

import { useId, useState } from "react";

import {
  PITCH_TITLE_MAX,
  type MediaAssetDto,
  type PitchAudience,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { Input } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";
import { InlineNotice } from "@capital-q/ui/states";

import { deletePitchMediaAction, setPitchDetailsAction } from "./pitch-actions";

/**
 * One video's name and who may watch it (ADR 0021/0022), and deleting it.
 *
 * The audience is a disclosure decision: "Investors only" is the default,
 * and "Everyone on Capital Q" also lets signed-in founders watch it. The
 * server decides and records; this form sends the version it saw, so a
 * stale screen never overwrites a newer choice.
 */

const AUDIENCE_OPTIONS: readonly {
  readonly value: PitchAudience;
  readonly label: string;
}[] = [
  { value: "INVESTORS", label: "Investors only" },
  { value: "NETWORK", label: "Everyone on Capital Q" },
];

export function PitchDetails({
  companyId,
  pitch,
  onSaved,
  onDeleted,
}: {
  readonly companyId: string;
  readonly pitch: MediaAssetDto;
  readonly onSaved: (pitch: MediaAssetDto) => void;
  /** Where the page goes once the video is gone. */
  readonly onDeleted: () => void;
}) {
  const id = useId();
  // The newest version this form has seen: its own save, or a newer record
  // the screen read since (the video can move on while it processes).
  const [saved, setSaved] = useState(pitch);
  const record = pitch.version > saved.version ? pitch : saved;
  const [title, setTitle] = useState(pitch.title ?? "");
  const [audience, setAudience] = useState<PitchAudience>(pitch.audience);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    readonly tone: "info" | "warning";
    readonly text: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const trimmed = title.trim();
  const changed =
    trimmed !== (record.title ?? "") || audience !== record.audience;

  const save = async () => {
    setSaving(true);
    setNotice(null);
    const result = await setPitchDetailsAction(
      companyId,
      pitch.mediaAssetId,
      { title: trimmed.length === 0 ? null : trimmed, audience },
      record.version,
    );
    setSaving(false);
    if (!result.ok) {
      setNotice({ tone: "warning", text: result.message });
      return;
    }
    setNotice({ tone: "info", text: "Saved." });
    setSaved(result.value);
    onSaved(result.value);
  };

  const remove = async () => {
    setDeleting(true);
    const result = await deletePitchMediaAction(companyId, pitch.mediaAssetId);
    setDeleting(false);
    if (!result.ok) {
      setConfirmDelete(false);
      setNotice({ tone: "warning", text: result.message });
      return;
    }
    onDeleted();
  };

  return (
    <div className="flex flex-col gap-4" data-pitch-details>
      <Input
        id={`${id}-title`}
        label="Title"
        description="Shown with the video. Leave blank to show it as your pitch."
        value={title}
        maxLength={PITCH_TITLE_MAX}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Pitch"
      />
      <Select
        id={`${id}-audience`}
        label="Who can watch it"
        description={
          // Live 2026-10-02 (Nixo): "Everyone on Capital Q" was chosen on a
          // pitch still private, and nobody could play it. The choice says
          // who may watch once it is shared; the words say it is not yet.
          (record.playbackPolicy === "PRIVATE"
            ? "It's private now: nobody outside your organisation can play it until you choose Let investors play this pitch. Then: "
            : "") +
          (audience === "NETWORK"
            ? "Investors who can find your company, and every founder signed in to Capital Q."
            : "Only investors who can find your company.")
        }
        options={AUDIENCE_OPTIONS}
        value={audience}
        onChange={(event) =>
          setAudience(
            event.target.value === "NETWORK" ? "NETWORK" : "INVESTORS",
          )
        }
      />
      {notice === null ? null : (
        <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!changed || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="quiet"
          disabled={deleting}
          onClick={() => setConfirmDelete(true)}
          data-pitch-delete
        >
          Delete video
        </Button>
      </div>
      <DialogRoot open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          title="Delete this video?"
          description="It stops playing everywhere on Capital Q straight away. Your other videos stay."
          actions={
            <>
              <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
              <Button
                variant="primary"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        />
      </DialogRoot>
    </div>
  );
}
