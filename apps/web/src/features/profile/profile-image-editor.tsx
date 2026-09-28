"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  PROFILE_IMAGE_MAX_BYTES,
  type ProfileImageKind,
  type ProfileImageSubjectType,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { Camera, ICON_SIZE, ICON_STROKE, X } from "@capital-q/ui/icons";

import {
  clampCrop,
  initialCrop,
  sourceRect,
  zoomTo,
  MAX_ZOOM,
  MIN_ZOOM,
  type CropState,
  type Size,
} from "./image-crop";
import {
  completeProfileImageUploadAction,
  removeProfileImageAction,
  requestProfileImageUploadAction,
} from "./profile-image-actions";

/**
 * Change a profile photo or cover, the LinkedIn way: the camera button
 * opens the choices (a new photo, or remove the current one); a new photo
 * opens a crop at the fixed aspect (1:1 photo, 4:1 cover) -- drag to
 * reposition, slide to zoom. The crop is drawn to a canvas in the browser
 * (which also drops the file's metadata), then PUT straight to storage on
 * the signed URL the API minted: the bytes never touch Next.js. The API
 * re-encodes it again server-side before it becomes current, and the page
 * refreshes to show it.
 */

const ACCEPT = "image/jpeg,image/png,image/webp";
const OUTPUT: Readonly<Record<ProfileImageKind, Size>> = {
  AVATAR: { width: 1024, height: 1024 },
  COVER: { width: 1584, height: 396 },
};

export type ProfileImageEditorProps = {
  readonly subjectType: ProfileImageSubjectType;
  readonly subjectId: string;
  readonly kind: ProfileImageKind;
  /** "profile photo", "cover photo", "logo". */
  readonly label: string;
  readonly hasImage: boolean;
  readonly className?: string | undefined;
};

type Phase =
  | { readonly step: "IDLE" }
  | { readonly step: "MENU" }
  | { readonly step: "CROP"; readonly src: string; readonly image: Size }
  | { readonly step: "SAVING"; readonly message: string };

export function ProfileImageEditor(props: ProfileImageEditorProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ step: "IDLE" });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const subject = {
    subjectType: props.subjectType,
    subjectId: props.subjectId,
  };

  // Object URLs are released when the crop closes.
  useEffect(() => {
    if (phase.step !== "CROP") return;
    const src = phase.src;
    return () => URL.revokeObjectURL(src);
  }, [phase]);

  const open = () => {
    setError(null);
    if (props.hasImage) setPhase({ step: "MENU" });
    else fileInput.current?.click();
  };

  const onFile = (file: File | undefined) => {
    if (file === undefined) return;
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      setPhase({ step: "IDLE" });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("That image is too large. Choose one under 25 MB.");
      setPhase({ step: "IDLE" });
      return;
    }
    const src = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () =>
      setPhase({
        step: "CROP",
        src,
        image: { width: probe.naturalWidth, height: probe.naturalHeight },
      });
    probe.onerror = () => {
      URL.revokeObjectURL(src);
      setError("That file couldn't be read as an image.");
      setPhase({ step: "IDLE" });
    };
    probe.src = src;
  };

  const save = async (blob: Blob) => {
    setPhase({ step: "SAVING", message: `Saving your ${props.label}…` });
    const minted = await requestProfileImageUploadAction(subject, props.kind, {
      contentType: blob.type,
      byteSize: blob.size,
    });
    if (!minted.ok) return fail(minted.message);
    try {
      // Browser -> storage directly, on the one-object signed URL.
      const response = await fetch(minted.value.upload.url, {
        method: minted.value.upload.method,
        headers: minted.value.upload.headers,
        body: blob,
      });
      if (!response.ok) return fail("The upload didn't go through. Try again.");
    } catch {
      return fail("The upload didn't go through. Check your connection.");
    }
    const done = await completeProfileImageUploadAction(minted.value.uploadId);
    if (!done.ok) return fail(done.message);
    finish(`${capitalise(props.label)} updated.`);
  };

  const remove = async () => {
    setPhase({ step: "SAVING", message: `Removing your ${props.label}…` });
    const result = await removeProfileImageAction(subject, props.kind);
    if (!result.ok) return fail(result.message);
    finish(`${capitalise(props.label)} removed.`);
  };

  const fail = (message: string) => {
    setError(message);
    setPhase({ step: "IDLE" });
  };
  const finish = (message: string) => {
    setPhase({ step: "IDLE" });
    setStatus(message);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={`Change ${props.label}`}
        disabled={phase.step === "SAVING"}
        className={
          props.className ??
          "inline-flex size-11 items-center justify-center rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-(--cq-shadow-sm) transition-colors hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-60"
        }
        data-image-editor={props.kind}
      >
        <Camera
          size={ICON_SIZE.regular}
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
      </button>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {phase.step === "SAVING" ? phase.message : status}
      </span>
      {error === null && status === "" ? null : (
        <Toast
          tone={error === null ? "info" : "error"}
          message={error ?? status}
          onDismiss={() => {
            setError(null);
            setStatus("");
          }}
        />
      )}

      <DialogRoot
        open={phase.step === "MENU"}
        onOpenChange={(next) => {
          if (!next) setPhase({ step: "IDLE" });
        }}
      >
        <DialogContent
          title={capitalise(props.label)}
          description="Upload a new one, or remove it."
          actions={
            <>
              <Button
                variant="quiet"
                onClick={() => void remove()}
                data-image-remove
              >
                Remove
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setPhase({ step: "IDLE" });
                  fileInput.current?.click();
                }}
              >
                Upload new
              </Button>
            </>
          }
        />
      </DialogRoot>

      <DialogRoot
        open={phase.step === "CROP"}
        onOpenChange={(next) => {
          if (!next) setPhase({ step: "IDLE" });
        }}
      >
        {phase.step === "CROP" ? (
          <CropDialog
            key={phase.src}
            kind={props.kind}
            label={props.label}
            src={phase.src}
            image={phase.image}
            onCancel={() => setPhase({ step: "IDLE" })}
            onCropped={(blob) => void save(blob)}
          />
        ) : null}
      </DialogRoot>
    </>
  );
}

/**
 * One line at the bottom of the screen, above the navigation: the result
 * of the change, or why it failed. Success clears itself; an error stays
 * until dismissed.
 */
function Toast({
  tone,
  message,
  onDismiss,
}: {
  readonly tone: "info" | "error";
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  useEffect(() => {
    if (tone === "error") return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [tone, message, onDismiss]);
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className="fixed inset-x-4 bottom-[calc(var(--cq-bottom-nav-height)+var(--cq-safe-bottom)+16px)] z-(--cq-z-toast) mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) py-2 pr-2 pl-4 shadow-(--cq-shadow-overlay) lg:bottom-6"
      data-image-toast={tone}
    >
      <p
        className={`cq-body-sm ${tone === "error" ? "text-(--cq-danger)" : "text-(--cq-text-primary)"}`}
      >
        {message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle)"
      >
        <X size={ICON_SIZE.compact} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
    </div>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function CropDialog({
  kind,
  label,
  src,
  image,
  onCancel,
  onCropped,
}: {
  readonly kind: ProfileImageKind;
  readonly label: string;
  readonly src: string;
  readonly image: Size;
  readonly onCancel: () => void;
  readonly onCropped: (blob: Blob) => void;
}) {
  const id = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Size | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const drag = useRef<{ x: number; y: number; start: CropState } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Measure the frame once laid out (and on resize), keeping the crop.
  const measure = useCallback(() => {
    const element = frameRef.current;
    if (element === null) return;
    const next = { width: element.clientWidth, height: element.clientHeight };
    if (next.width === 0 || next.height === 0) return;
    setFrame(next);
    setCrop((current) =>
      current === null
        ? initialCrop(image, next)
        : clampCrop(current, image, next),
    );
  }, [image]);
  useEffect(() => {
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (observer !== null && frameRef.current !== null) {
      observer.observe(frameRef.current);
    }
    return () => observer?.disconnect();
  }, [measure]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (crop === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, start: crop };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (from === null || frame === null) return;
    setCrop(
      clampCrop(
        {
          zoom: from.start.zoom,
          x: from.start.x + (event.clientX - from.x),
          y: from.start.y + (event.clientY - from.y),
        },
        image,
        frame,
      ),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (crop === null || frame === null) return;
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    setCrop(
      clampCrop(
        { zoom: crop.zoom, x: crop.x + move[0], y: crop.y + move[1] },
        image,
        frame,
      ),
    );
  };

  const apply = () => {
    if (crop === null || frame === null) return;
    const output = OUTPUT[kind];
    const canvas = document.createElement("canvas");
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext("2d");
    const element = new Image();
    element.onload = () => {
      if (context === null) {
        setExportError("This browser couldn't prepare the image.");
        return;
      }
      const { sx, sy, sw, sh } = sourceRect(crop, image, frame);
      context.imageSmoothingQuality = "high";
      context.drawImage(
        element,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        output.width,
        output.height,
      );
      // Re-encoding through a canvas keeps pixels only: no EXIF, no GPS.
      canvas.toBlob(
        (blob) => {
          if (blob === null || blob.size > PROFILE_IMAGE_MAX_BYTES) {
            setExportError("This browser couldn't prepare the image.");
            return;
          }
          onCropped(blob);
        },
        "image/jpeg",
        0.9,
      );
    };
    element.src = src;
  };

  const scale =
    crop === null || frame === null
      ? 1
      : Math.max(frame.width / image.width, frame.height / image.height) *
        crop.zoom;

  return (
    <DialogContent
      title={`Position your ${label}`}
      description="Drag to reposition. Use the slider to zoom."
      className={kind === "COVER" ? "max-w-2xl" : "max-w-md"}
      actions={
        <>
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply} disabled={crop === null}>
            Save {label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          ref={frameRef}
          role="img"
          aria-label={`Crop preview of your ${label}. Arrow keys move it.`}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className={`relative w-full cursor-grab touch-none overflow-hidden bg-(--cq-surface-sunken) select-none focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) active:cursor-grabbing ${
            kind === "AVATAR"
              ? "aspect-square rounded-lg"
              : "aspect-[4/1] rounded-md"
          }`}
          data-crop-frame={kind}
        >
          {crop === null ? null : (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL being cropped, not a served image
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
              style={{
                width: image.width * scale,
                height: image.height * scale,
                transform: `translate(${crop.x}px, ${crop.y}px)`,
              }}
            />
          )}
          {kind === "AVATAR" ? (
            // The round mask: what the profile will show.
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_var(--cq-overlay)]"
            />
          ) : null}
        </div>
        <label htmlFor={`${id}-zoom`} className="flex items-center gap-3">
          <span className="cq-label text-(--cq-text-secondary)">Zoom</span>
          <input
            id={`${id}-zoom`}
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop?.zoom ?? 1}
            disabled={crop === null}
            onChange={(event) => {
              if (crop === null || frame === null) return;
              setCrop(zoomTo(crop, Number(event.target.value), image, frame));
            }}
            className="min-h-11 flex-1 accent-(--cq-accent)"
          />
        </label>
        {exportError === null ? null : (
          <p role="alert" className="cq-body-sm text-(--cq-danger)">
            {exportError}
          </p>
        )}
      </div>
    </DialogContent>
  );
}
