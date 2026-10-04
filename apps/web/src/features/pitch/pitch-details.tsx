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
 * Who can watch it is ONE choice (live 2026-10-02, Nixo: "Everyone on
 * Capital Q" was chosen while playback stayed private, so nobody could
 * watch): only their organisation (playback PRIVATE), investors who can
 * find the company, or also every signed-in founder (playback AUTHORISED
 * with that audience), saved in one server call. The
 * server decides and records; this form sends the version it saw, so a
 * stale screen never overwrites a newer choice.
 */

type Sharing = "ORGANISATION" | PitchAudience;

const SHARING_OPTIONS: readonly {
  readonly value: Sharing;
  readonly label: string;
}[] = [
  { value: "ORGANISATION", label: "Only my organisation" },
  { value: "INVESTORS", label: "Investors who can find us" },
  { value: "NETWORK", label: "Everyone on Capital Q" },
];

/** The one choice a record stands at. */
export function sharingOf(pitch: {
  readonly playbackPolicy: string;
  readonly audience: PitchAudience;
}): Sharing {
  return pitch.playbackPolicy === "PRIVATE" ? "ORGANISATION" : pitch.audience;
}

/** What one choice writes: the audience and who may play it, together. */
export function detailsFor(
  sharing: Sharing,
  current: PitchAudience,
): {
  readonly audience: PitchAudience;
  readonly playbackPolicy: "AUTHORISED" | "PRIVATE";
} {
  return sharing === "ORGANISATION"
    ? { audience: current, playbackPolicy: "PRIVATE" }
    : { audience: sharing, playbackPolicy: "AUTHORISED" };
}

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
  const [sharing, setSharing] = useState<Sharing>(sharingOf(pitch));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    readonly tone: "info" | "warning";
    readonly text: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savingDownloads, setSavingDownloads] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const trimmed = title.trim();
  const changed =
    trimmed !== (record.title ?? "") || sharing !== sharingOf(record);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    const result = await setPitchDetailsAction(
      companyId,
      pitch.mediaAssetId,
      {
        title: trimmed.length === 0 ? null : trimmed,
        ...detailsFor(sharing, record.audience),
      },
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

  /*
   * ADR 0047: the founder's own switch, saved the moment it is flipped, on
   * the record as it stands (never the title or audience being edited
   * above). Q can flip it too, from anywhere, as a card the founder
   * approves.
   */
  const setDownloads = async (next: boolean) => {
    setSavingDownloads(true);
    setNotice(null);
    const result = await setPitchDetailsAction(
      companyId,
      pitch.mediaAssetId,
      {
        title: record.title,
        audience: record.audience,
        downloadable: next,
      },
      record.version,
    );
    setSavingDownloads(false);
    if (!result.ok) {
      setNotice({ tone: "warning", text: result.message });
      return;
    }
    setNotice({
      tone: "info",
      text: next
        ? "Investors who can watch it can now download it."
        : "Watch-only now: investors can watch it, not download it.",
    });
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
          sharing === "ORGANISATION"
            ? "Private: only people in your organisation can play it."
            : sharing === "NETWORK"
              ? "Investors who can find your company, and every founder signed in to Capital Q."
              : "Investors who can find your company."
        }
        options={SHARING_OPTIONS}
        value={sharing}
        onChange={(event) =>
          setSharing(
            event.target.value === "NETWORK"
              ? "NETWORK"
              : event.target.value === "INVESTORS"
                ? "INVESTORS"
                : "ORGANISATION",
          )
        }
      />
      <div className="flex items-center gap-4 border-t border-(--cq-border-subtle) pt-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className="cq-body font-medium text-(--cq-text-primary)"
            id={`${id}-downloads`}
          >
            Let investors download my pitch
          </span>
          <span
            className="cq-body-sm text-(--cq-text-secondary)"
            id={`${id}-downloads-help`}
          >
            {record.downloadable
              ? "On: investors who can watch it can save a copy from the video's options. Copies already saved can't be recalled."
              : "Off: investors can watch it, but can't save a copy."}{" "}
            You can change this any time, here or by asking Q.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={record.downloadable}
          aria-labelledby={`${id}-downloads`}
          aria-describedby={`${id}-downloads-help`}
          disabled={savingDownloads}
          onClick={() => void setDownloads(!record.downloadable)}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-60"
          data-pitch-downloadable
        >
          <span
            aria-hidden="true"
            className="cq-switch"
            data-on={record.downloadable ? "" : undefined}
          />
        </button>
      </div>
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
