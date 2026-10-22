/**
 * The story's one budgeted audio controller (coordinator, 22 Oct): the
 * rendered beats are fetched as static, immutably cached files and decoded
 * a few beats ahead of the voice, never all at once (56 decoded beats are
 * about 100 MB of PCM). At most two fetches run at a time; beats well
 * behind the voice are let go.
 *
 * A beat that is not ready when its turn comes is waited for briefly; if
 * it still is not there, the narrator plays that beat's length in silence
 * on the same clock, so the screen and captions carry on and audio never
 * holds the story up.
 */
export const AUDIO_AHEAD = 3;
const CONCURRENT_FETCHES = 2;

export class StoryAudioBank {
  readonly #context: AudioContext;
  readonly #urlOf: (beat: number) => string | null;
  readonly #buffers = new Map<number, AudioBuffer>();
  readonly #loading = new Map<number, Promise<AudioBuffer | null>>();
  readonly #queue: (() => void)[] = [];
  #active = 0;
  /** The beats in play order (an edition's), by number. */
  #order: readonly number[] = Array.from({ length: 56 }, (_, i) => i + 1);

  constructor(context: AudioContext, urlOf: (beat: number) => string | null) {
    this.#context = context;
    this.#urlOf = urlOf;
  }

  /** The decoded beat, if it is ready now. */
  get(beat: number): AudioBuffer | null {
    return this.#buffers.get(beat) ?? null;
  }

  /** Fetch and decode one beat (once; later calls share the work). */
  load(beat: number): Promise<AudioBuffer | null> {
    const ready = this.#buffers.get(beat);
    if (ready !== undefined) return Promise.resolve(ready);
    const pending = this.#loading.get(beat);
    if (pending !== undefined) return pending;
    const url = this.#urlOf(beat);
    if (url === null) return Promise.resolve(null);
    const work = this.#slot()
      .then(() => fetch(url, { cache: "force-cache" }))
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((bytes) =>
        bytes === null ? null : this.#context.decodeAudioData(bytes),
      )
      .catch(() => null)
      .then((buffer) => {
        this.#release();
        this.#loading.delete(beat);
        if (buffer !== null) this.#buffers.set(beat, buffer);
        return buffer;
      });
    this.#loading.set(beat, work);
    return work;
  }

  /** Play order: an edition plays a subset of the beats. */
  follow(order: readonly number[]): void {
    this.#order = order;
  }

  /**
   * Keep `beat` and the next AUDIO_AHEAD beats (in play order) decoded;
   * let go of beats more than one behind (a "go back" re-fetches from the
   * HTTP cache).
   */
  window(beat: number, ahead: number = AUDIO_AHEAD): void {
    const at = Math.max(0, this.#order.indexOf(beat));
    for (const n of this.#order.slice(at, at + ahead + 1)) void this.load(n);
    const keep = new Set(this.#order.slice(Math.max(0, at - 1)));
    for (const n of [...this.#buffers.keys()]) {
      if (!keep.has(n)) this.#buffers.delete(n);
    }
  }

  /** The beat within `timeoutMs`, or null (the narrator then plays silence). */
  async ready(beat: number, timeoutMs: number): Promise<AudioBuffer | null> {
    const now = this.get(beat);
    if (now !== null) return now;
    return Promise.race([
      this.load(beat),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
  }

  #slot(): Promise<void> {
    if (this.#active < CONCURRENT_FETCHES) {
      this.#active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#queue.push(() => {
        this.#active += 1;
        resolve();
      });
    });
  }

  #release(): void {
    this.#active -= 1;
    this.#queue.shift()?.();
  }
}
