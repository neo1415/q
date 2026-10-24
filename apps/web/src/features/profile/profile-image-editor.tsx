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
import {
  Camera,
  ICON_SIZE,
  ICON_STROKE,
  Pencil,
  Upload,
  X,
} from "@capital-q/ui/icons";

import { CrmSheet } from "@/features/relationships/crm-kit";
import { accountButton } from "@/features/settings/account-kit";

import {
  clampCrop,
  drawRect,
  fitZoom,
  initialCrop,
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
import { useT } from "@/features/i18n/language";

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
  /**
   * The chosen designs' sheet (2026-10-21): the trigger opens a sheet with
   * the current image large, Upload and (when there is one) Remove. Pass
   * the current image's signed URL, or null for none.
   */
  readonly previewUrl?: string | null | undefined;
  /** Whose image it is, for the initials when there is none. */
  readonly previewName?: string | undefined;
  /** A small round pencil trigger over the photo's corner. */
  readonly compact?: boolean | undefined;
  /** An organisation's logo: a rounded square rather than a circle. */
  readonly square?: boolean | undefined;
  /** Design review only (/dev/account-review): opens with the sheet showing. */
  readonly initiallyOpen?: boolean | undefined;
};

type Phase =
  | { readonly step: "IDLE" }
  | { readonly step: "MENU" }
  | { readonly step: "SHEET" }
  | { readonly step: "CROP"; readonly src: string; readonly image: Size }
  | { readonly step: "SAVING"; readonly message: string };

export function ProfileImageEditor(props: ProfileImageEditorProps) {
  const t = useT();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(
    props.initiallyOpen === true && props.previewUrl !== undefined
      ? { step: "SHEET" }
      : { step: "IDLE" },
  );
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

  const sheetMode = props.previewUrl !== undefined;
  const open = () => {
    setError(null);
    if (sheetMode) setPhase({ step: "SHEET" });
    else if (props.hasImage) setPhase({ step: "MENU" });
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
          (props.compact === true
            ? // A 32px mark with a 44px target around it.
              "relative inline-flex size-8 items-center justify-center rounded-full border border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-(--cq-shadow-xs) transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-60"
            : "inline-flex size-11 items-center justify-center rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-(--cq-shadow-sm) transition-colors hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-60")
        }
        data-image-editor={props.kind}
      >
        {props.compact === true ? (
          <Pencil
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        ) : (
          <Camera
            size={ICON_SIZE.regular}
            strokeWidth={ICON_STROKE}
            aria-hidden
          />
        )}
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

      {sheetMode ? (
        <CrmSheet
          open={phase.step === "SHEET"}
          onOpenChange={(next) => {
            if (!next) setPhase({ step: "IDLE" });
          }}
          title={capitalise(props.label)}
          sub={
            props.kind === "COVER"
              ? t("Shown across the top of your profile")
              : props.square === true
                ? t("Shown on your Q Card and your organisation’s profile")
                : t("Shown on your Q Card and profile")
          }
          data-image-sheet={props.kind}
        >
          <div className="grid place-items-center p-3">
            <span
              className={`grid overflow-hidden border border-(--cq-border) bg-(--cq-surface-subtle) ${
                props.kind === "COVER"
                  ? "aspect-[4/1] w-full rounded-(--cq-radius-md)"
                  : props.square === true
                    ? "size-24 rounded-2xl"
                    : "size-24 rounded-full"
              }`}
            >
              {props.previewUrl === null || props.previewUrl === undefined ? (
                <span
                  aria-hidden
                  className="grid size-full place-items-center text-[28px] font-semibold text-(--cq-text-secondary)"
                >
                  {props.kind === "COVER"
                    ? null
                    : initialsOf(props.previewName ?? "")}
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
                <img
                  src={props.previewUrl}
                  alt=""
                  className="size-full object-cover"
                />
              )}
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              className={accountButton("secondary")}
              onClick={() => {
                setPhase({ step: "IDLE" });
                fileInput.current?.click();
              }}
              data-image-upload
            >
              <Upload
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
                aria-hidden
              />
              {props.hasImage ? t("Upload a new one") : t("Upload a photo")}
            </button>
            {props.hasImage ? (
              <button
                type="button"
                className={accountButton("quiet")}
                onClick={() => void remove()}
                data-image-remove
              >
                {t("Remove")}
              </button>
            ) : null}
          </div>
          <span className="text-xs text-(--cq-text-tertiary)">
            {props.kind === "COVER"
              ? t(
                  "A wide picture works best. You can crop before saving. JPEG, PNG or WebP, up to 25 MB.",
                )
              : t(
                  "Square works best. You can crop before saving. JPEG, PNG or WebP, up to 25 MB.",
                )}
          </span>
        </CrmSheet>
      ) : null}

      <DialogRoot
        open={phase.step === "MENU"}
        onOpenChange={(next) => {
          if (!next) setPhase({ step: "IDLE" });
        }}
      >
        <DialogContent
          title={capitalise(props.label)}
          description={t("Upload a new one, or remove it.")}
          actions={
            <>
              <Button
                variant="quiet"
                onClick={() => void remove()}
                data-image-remove
              >
                {t("Remove")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setPhase({ step: "IDLE" });
                  fileInput.current?.click();
                }}
              >
                {t("Upload new")}
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
            // A company's or a firm's logo can be kept whole (a wide
            // wordmark), and keeps its transparency; a person's photo
            // always fills the frame.
            fitWhole={props.kind === "AVATAR" && props.subjectType !== "PERSON"}
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
  const t = useT();
  useEffect(() => {
    if (tone === "error") return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [tone, message, onDismiss]);
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className="fixed inset-x-4 bottom-[calc(var(--cq-bottom-nav-height)+var(--cq-safe-bottom)+16px)] z-(--cq-z-toast) mx-auto flex max-w-md items-center justify-between gap-3 border border-(--cq-border-subtle) bg-(--cq-surface-raised) py-2 pe-2 ps-4 shadow-(--cq-shadow-overlay) lg:bottom-6"
      data-image-toast={tone}
      data-q-notice={tone === "error" ? "TOAST:FAILED" : "TOAST:DONE"}
    >
      <p
        className={`cq-body-sm ${tone === "error" ? "text-(--cq-danger)" : "text-(--cq-text-primary)"}`}
      >
        {message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("Dismiss")}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle)"
      >
        <X size={ICON_SIZE.compact} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/u)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function CropDialog({
  kind,
  fitWhole,
  label,
  src,
  image,
  onCancel,
  onCropped,
}: {
  readonly kind: ProfileImageKind;
  readonly fitWhole: boolean;
  readonly label: string;
  readonly src: string;
  readonly image: Size;
  readonly onCancel: () => void;
  readonly onCropped: (blob: Blob) => void;
}) {
  const t = useT();
  const id = useId();
  const [frame, setFrame] = useState<Size | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const drag = useRef<{ x: number; y: number; start: CropState } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const minZoomFor = useCallback(
    (size: Size) =>
      fitWhole ? Math.min(MIN_ZOOM, fitZoom(image, size)) : MIN_ZOOM,
    [fitWhole, image],
  );
  const minZoom = frame === null ? MIN_ZOOM : minZoomFor(frame);

  // Measure the frame whenever it is laid out (and on resize), keeping the
  // crop. A callback ref, not an effect: the dialog portals its content in
  // after this component's first effects run, so a ref read in an effect
  // was still null, nothing was ever measured and the photo never showed
  // (founder live 2026-09-28).
  const frameRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      const measure = () => {
        const next = {
          width: element.clientWidth,
          height: element.clientHeight,
        };
        if (next.width === 0 || next.height === 0) return;
        setFrame(next);
        // A logo opens whole; a photo opens covering the frame.
        setCrop((current) =>
          current === null
            ? initialCrop(image, next, minZoomFor(next))
            : clampCrop(current, image, next, minZoomFor(next)),
        );
      };
      measure();
      if (typeof ResizeObserver !== "function") return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [image, minZoomFor],
  );

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
        minZoom,
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
        minZoom,
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
      const { dx, dy, dw, dh } = drawRect(crop, image, frame, output);
      context.imageSmoothingQuality = "high";
      context.drawImage(element, dx, dy, dw, dh);
      // Re-encoding through a canvas keeps pixels only: no EXIF, no GPS.
      canvas.toBlob(
        (blob) => {
          if (blob === null || blob.size > PROFILE_IMAGE_MAX_BYTES) {
            setExportError("This browser couldn't prepare the image.");
            return;
          }
          onCropped(blob);
        },
        // JPEG has no transparency: a logo's clear background would
        // become black (owner QA 23 Oct), so a logo is kept as PNG.
        fitWhole ? "image/png" : "image/jpeg",
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
      description={t("Drag to reposition. Use the slider to zoom.")}
      // The dialog sets max-w-md itself and `cx` does not merge classes, so
      // the wider cover frame has to take precedence explicitly.
      className={kind === "COVER" ? "max-w-2xl!" : undefined}
      actions={
        <>
          <Button variant="quiet" onClick={onCancel}>
            {t("Cancel")}
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
            kind === "AVATAR" ? "aspect-square" : "aspect-[4/1]"
          }`}
          data-crop-frame={kind}
        >
          {crop === null ? null : (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL being cropped, not a served image
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-0 start-0 max-w-none origin-top-left"
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
          <span className="cq-label text-(--cq-text-secondary)">
            {t("Zoom")}
          </span>
          <input
            id={`${id}-zoom`}
            type="range"
            min={minZoom}
            max={MAX_ZOOM}
            step={0.01}
            value={crop?.zoom ?? 1}
            disabled={crop === null}
            onChange={(event) => {
              if (crop === null || frame === null) return;
              setCrop(
                zoomTo(crop, Number(event.target.value), image, frame, minZoom),
              );
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
