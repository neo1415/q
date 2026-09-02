import { Textarea } from "../components/input.js";

/**
 * Short narrative entry: a growing text area now, and the seam where voice
 * arrives later. Voice is progressive enhancement gated by a real capability
 * flag; while `voiceEnabled` is false nothing microphone-shaped is rendered,
 * and no permission is ever requested from here. The future path is
 * record → transcript → edit transcript → Q extracts → founder confirms,
 * and it slots in without replacing this component's callers.
 */
export type NarrativeInputProps = {
  readonly id: string;
  readonly label: string;
  readonly labelHidden?: boolean | undefined;
  readonly description?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength?: number | undefined;
  readonly voiceEnabled?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly error?: string | undefined;
};

export function NarrativeInput({
  id,
  label,
  labelHidden,
  description,
  placeholder,
  value,
  onChange,
  maxLength = 600,
  voiceEnabled = false,
  disabled = false,
  error,
}: NarrativeInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        id={id}
        label={label}
        labelHidden={labelHidden}
        description={description}
        error={error}
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
          {value.length}/{maxLength}
        </span>
        {/* Voice affordance is rendered only by a caller with a working provider. */}
        {voiceEnabled ? (
          <span className="cq-caption text-(--cq-text-tertiary)">
            Voice available
          </span>
        ) : null}
      </div>
    </div>
  );
}
