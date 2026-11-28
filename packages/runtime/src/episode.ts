import { type BindSegment, bindLabel } from "./core/path.ts";

export type EpisodeTrigger = {
  kind: string;
  /** Tile name, lifecycle name, route pattern — interpretation depends on `kind`. */
  target?: string;
  payload?: unknown;
  ts: number;
};

export type SlotDiff = { name: string; before: unknown; after: unknown };

export type EnvReadKind = "now" | "random" | "fresh-id" | "effect-id" | "prefers-dark";

/** One environment read and what it answered. */
export type EnvRead = { kind: EnvReadKind; value: unknown };

export type PanicCategory =
  | "reducer"
  | "effect"
  | "capability"
  | "tile-render"
  | "hydrate"
  /** Replay's own: a bound control's write it cannot make again. No recorded step carries it. */
  | "bind"
  | "unknown";

export type PanicCauseLink = { message: string; stack?: string };

export type EpisodeStep =
  | {
      kind: "reducer";
      name: string;
      "slot-diffs": SlotDiff[];
      emits: string[];
      "env-reads"?: EnvRead[];
      ts: number;
    }
  | {
      kind: "bind";
      /** The slot a bound control wrote. */
      slot: string;
      /** Where in that slot, for a control bound through a path; absent for the slot itself. */
      path?: BindSegment[];
      /** What the control wrote, at `path`. */
      value: unknown;
      "slot-diffs": SlotDiff[];
      ts: number;
    }
  | { kind: "effect-start"; name: string; args: unknown; ts: number }
  | {
      kind: "effect-end";
      name: string;
      result: "ok" | "err";
      value: unknown;
      ts: number;
    }
  | { kind: "effect-cancel"; targetId: string; ts: number }
  | {
      kind: "signal-update";
      "dirty-slots": string[];
      "binds-updated": string[];
      ts: number;
    }
  | {
      kind: "panic";
      message: string;
      /** Human-readable source label (`reducer "addTodo"`, `"render"`, ...). */
      location?: string;
      name?: string;
      "env-reads"?: EnvRead[];
      /** `Error.stack` of the caught throw, when available. */
      stack?: string;
      /** Flattened `Error.cause` chain, nearest cause first. Omitted when empty. */
      cause?: PanicCauseLink[];
      category?: PanicCategory;
      /** An `error-boundary` caught it; absent on every other panic step. */
      handled?: boolean;
      ts: number;
    };

export type PanicStep = Extract<EpisodeStep, { kind: "panic" }>;

/**
 * A panic step nothing handled. A step without `handled` counts as unhandled, so a log written
 * before the field existed still reports every panic.
 */
export function isUnhandledPanic(step: EpisodeStep): step is PanicStep & { handled?: false } {
  return step.kind === "panic" && step.handled !== true;
}

export type EpisodeStatus = "completed" | "panic" | "cancelled" | "ongoing";

export type Episode = {
  id: string;
  trigger: EpisodeTrigger;
  steps: EpisodeStep[];
  status: EpisodeStatus;
};

export type EpisodeLocalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type EpisodeLoggerOptions = {
  /** In-memory ring buffer cap, default 100. */
  memoryMax?: number;
  localStorage?: boolean;
  localStorageMax?: number;
  localStorageKey?: string;
  /** Soft byte cap; oldest episodes are evicted until the JSON string fits. */
  localStorageBytes?: number;
  /** Defaults to `globalThis.localStorage` if not provided. */
  localStorageImpl?: EpisodeLocalStorage;
  /** Test seam — wall-clock by default. */
  now?: () => number;
  /** Test seam — ULID-shape default. */
  idGen?: () => string;
  /**
   * Handed each episode as it commits, in the order episodes commit: at once, even while one begun
   * before it still waits on an effect.
   */
  onCommit?: (ep: Episode) => void;
  /**
   * Handed each episode in the order its trigger began, once it and every episode begun before it
   * have committed. Each episode after one that still waits is held until it commits. A hook that
   * throws keeps no other episode from being handed over: the commit rethrows its first throw.
   */
  onEpisode?: (ep: Episode) => void;
};

/** A write a bound control made, as {@link EpisodeLogger.recordBind} journals it. */
export type BindWrite = {
  /** The control that wrote: the event a choice writes on is `change`, the rest `input`. */
  control: Element;
  slot: string;
  /** Where in the slot, for a control bound through a path; absent or empty for the slot itself. */
  path?: readonly BindSegment[] | undefined;
  /** What the control wrote, at `path`. */
  written: unknown;
  /** The whole slot before the write. */
  before: unknown;
  /** The whole slot after it. */
  after: unknown;
  /** The slot is `volatile`: the write is not journalled. */
  volatile?: boolean | undefined;
};

/** An episode the ring holds, and its place among the episodes its logger opened. */
type Kept = { seq: number; ep: Episode };

export type EpisodeLogger = {
  beginTrigger(t: Omit<EpisodeTrigger, "ts"> & { ts?: number }): string;
  endTrigger(): void;
  recordReducer(
    name: string,
    slotDiffs: SlotDiff[],
    emits: string[],
    envReads?: readonly EnvRead[],
  ): void;
  /**
   * Journal a write a bound control made, once the slot has taken it, as an episode of its own
   * that commits as it opens: `onCommit` and `onEpisode` are handed it before this returns, after
   * any episode begun earlier. A write to a `volatile` slot is not journalled.
   */
  recordBind(write: BindWrite): void;
  recordEffectStart(name: string, args: unknown): string;
  recordEffectEnd(token: string, name: string, result: "ok" | "err", value: unknown): () => void;
  recordEffectCancel(targetId: string): void;
  cancelPendingEffect(token: string, name: string): void;
  /** Append a `{kind: "signal-update", ...}` step to the open episode. */
  recordSignalUpdate(dirtySlots: string[], bindsUpdated?: string[]): void;
  recordPanic(
    info: {
      message: string;
      location?: string | undefined;
      stack?: string | undefined;
      cause?: PanicCauseLink[] | undefined;
      category?: PanicCategory | undefined;
      /** The reducer that threw, when the throw came from a reducer body. */
      name?: string | undefined;
      /** What that body read from the environment before it threw. */
      envReads?: readonly EnvRead[] | undefined;
      /** An `error-boundary` caught it; the step carries `handled: true` only when this is `true`. */
      handled?: boolean | undefined;
    },
    token?: string,
  ): string | undefined;
  ingestBootstrap(ep: Episode): void;
  /** Snapshot of currently retained episodes, in the order their triggers began. */
  list(): Episode[];
  hasOpenEpisode(): boolean;
  currentId(): string | undefined;
};

/** The event a bound control writes on: `change` for a choice (a select, a box, a radio), `input` for the rest. */
function bindTrigger(control: Element): "ui.input" | "ui.change" {
  const type = (control as HTMLInputElement).type;
  return control.tagName === "SELECT" || type === "checkbox" || type === "radio"
    ? "ui.change"
    : "ui.input";
}

function defaultIdGen(): () => string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let lastTs = 0;
  let counter = 0;
  return () => {
    const ts = Date.now();
    if (ts === lastTs) counter++;
    else {
      counter = 0;
      lastTs = ts;
    }
    let s = "";
    let t = ts;
    for (let i = 0; i < 10; i++) {
      s = alphabet[t % 32] + s;
      t = Math.floor(t / 32);
    }
    let r = counter;
    for (let i = 0; i < 16; i++) {
      const idx = (r & 0x1f) ^ Math.floor(Math.random() * 32);
      s += alphabet[idx & 0x1f];
      r = Math.floor(r / 2);
    }
    return `ep_${s}`;
  };
}

export function createEpisodeLogger(opts: EpisodeLoggerOptions = {}): EpisodeLogger {
  const memoryMax = Math.max(1, opts.memoryMax ?? 100);
  const useLs = !!opts.localStorage;
  const lsMax = Math.max(1, opts.localStorageMax ?? 20);
  const lsKey = opts.localStorageKey ?? "kumiki.episodes";
  const lsBytes = opts.localStorageBytes ?? 5 * 1024 * 1024;
  const lsImpl: EpisodeLocalStorage | null =
    opts.localStorageImpl ??
    (useLs && typeof globalThis !== "undefined"
      ? ((globalThis as unknown as { localStorage?: EpisodeLocalStorage }).localStorage ?? null)
      : null);
  const now = opts.now ?? (() => Date.now());
  const idGen = opts.idGen ?? defaultIdGen();

  const memory: Kept[] = [];
  const stack: Episode[] = [];
  /** Effect-end attribution by token — survives across async boundaries. */
  const inflight = new Map<string, Episode>();
  /**
   * The scope each recorded `effect-end` opened, by token, until it closes. `cancelPendingEffect`
   * closes one whose caller never got it back, as when a logger wrapping this one throws after it.
   */
  const ending = new Map<string, () => void>();
  /** Per-episode count of effect-starts whose effect-end has not landed yet. */
  const pending = new Map<Episode, number>();
  /** Episodes whose `endTrigger` fired while effects were still in flight. */
  const closedAwaiting = new Set<Episode>();
  /** How many episodes this logger had opened when each one's trigger began, until it commits. */
  const openedAt = new Map<Episode, number>();
  let opened = 0;
  /**
   * With `onEpisode` only: the opened episodes it has not been handed yet, in the order their
   * triggers began, and those of them that have committed. One that commits while an earlier one
   * still waits on an effect waits behind it, so a file appended from the hook lists the triggers
   * in the order they came without inserting a line. Without the hook nothing waits here, so an
   * effect that never settles keeps no later episode alive once the ring has dropped it.
   */
  const unsent: Episode[] = [];
  const held = new Set<Episode>();

  function topEpisode(): Episode | null {
    return stack.length > 0 ? (stack[stack.length - 1] as Episode) : null;
  }

  function persistLocalStorage(): void {
    if (!useLs || !lsImpl) return;
    let slice = memory.slice(Math.max(0, memory.length - lsMax)).map((kept) => kept.ep);
    let raw = JSON.stringify(slice);
    while (raw.length > lsBytes && slice.length > 1) {
      slice = slice.slice(1);
      raw = JSON.stringify(slice);
    }
    try {
      lsImpl.setItem(lsKey, raw);
    } catch {
      // Quota / serialization issues are non-fatal — logging is best-effort.
    }
  }

  function open(ep: Episode): void {
    openedAt.set(ep, opened++);
    if (opts.onEpisode) unsent.push(ep);
  }

  function store(ep: Episode): void {
    const seq = openedAt.get(ep);
    if (seq === undefined) throw new Error(`episode ${ep.id} committed without being opened`);
    openedAt.delete(ep);
    const at = memory.reduce((i, kept, k) => (kept.seq < seq ? k + 1 : i), 0);
    memory.splice(at, 0, { seq, ep });
    while (memory.length > memoryMax) memory.shift();
    persistLocalStorage();
    const thrown: unknown[] = [];
    const hand = (hook: (ep: Episode) => void, handed: Episode): void => {
      try {
        hook(handed);
      } catch (error) {
        thrown.push(error);
      }
    };
    if (opts.onCommit) hand(opts.onCommit, ep);
    const onEpisode = opts.onEpisode;
    if (onEpisode) {
      held.add(ep);
      for (let head = unsent[0]; head !== undefined && held.delete(head); head = unsent[0]) {
        unsent.shift();
        hand(onEpisode, head);
      }
    }
    if (thrown.length > 0) throw thrown[0];
  }

  function commit(ep: Episode): void {
    if (ep.status === "ongoing") ep.status = "completed";
    store(ep);
  }

  function settle(ep: Episode): void {
    const count = pending.get(ep) ?? 0;
    if (count > 0) return;
    pending.delete(ep);
    if (closedAwaiting.has(ep)) {
      closedAwaiting.delete(ep);
      commit(ep);
    }
  }

  return {
    beginTrigger(t) {
      const ts = t.ts ?? now();
      const trigger: EpisodeTrigger = { kind: t.kind, ts };
      if (t.target !== undefined) trigger.target = t.target;
      if (t.payload !== undefined) trigger.payload = t.payload;
      const ep: Episode = { id: idGen(), trigger, steps: [], status: "ongoing" };
      stack.push(ep);
      open(ep);
      return ep.id;
    },
    endTrigger() {
      const ep = stack.pop();
      if (!ep) return;
      const count = pending.get(ep) ?? 0;
      if (count > 0) {
        closedAwaiting.add(ep);
      } else {
        commit(ep);
      }
    },
    recordReducer(name, slotDiffs, emits, envReads) {
      const ep = topEpisode();
      if (!ep) return;
      ep.steps.push({
        kind: "reducer",
        name,
        "slot-diffs": slotDiffs,
        emits,
        ...(envReads !== undefined && envReads.length > 0 ? { "env-reads": envReads.slice() } : {}),
        ts: now(),
      });
    },
    recordBind({ control, slot, path = [], written, before, after, volatile }) {
      if (volatile) return;
      const ts = now();
      // Committed as it opens: a bind runs no reducer and emits nothing, so nothing follows it.
      const ep: Episode = {
        id: idGen(),
        trigger: { kind: bindTrigger(control), target: bindLabel(slot, path), ts },
        steps: [
          {
            kind: "bind",
            slot,
            ...(path.length > 0 ? { path: [...path] } : {}),
            value: written,
            "slot-diffs": [{ name: slot, before, after }],
            ts,
          },
        ],
        status: "completed",
      };
      open(ep);
      store(ep);
    },
    recordEffectStart(name, args) {
      const ep = topEpisode();
      if (!ep) return "";
      const token = idGen();
      ep.steps.push({ kind: "effect-start", name, args, ts: now() });
      inflight.set(token, ep);
      pending.set(ep, (pending.get(ep) ?? 0) + 1);
      return token;
    },
    recordEffectEnd(token, name, result, value) {
      const ep = inflight.get(token) ?? topEpisode();
      if (!ep) return () => {};
      // Read before anything changes, so a clock that throws leaves the request in flight, where
      // `cancelPendingEffect` can still release it.
      const ts = now();
      inflight.delete(token);
      ep.steps.push({ kind: "effect-end", name, result, value, ts });
      stack.push(ep);
      let exited = false;
      const exit = (): void => {
        if (exited) return;
        exited = true;
        ending.delete(token);
        const idx = stack.lastIndexOf(ep);
        if (idx >= 0) stack.splice(idx, 1);
        const count = pending.get(ep) ?? 0;
        if (count > 0) pending.set(ep, count - 1);
        settle(ep);
      };
      if (token !== "") ending.set(token, exit);
      return exit;
    },
    recordEffectCancel(targetId) {
      const ep = topEpisode();
      if (!ep) return;
      ep.steps.push({ kind: "effect-cancel", targetId, ts: now() });
    },
    cancelPendingEffect(token, name) {
      const ep = inflight.get(token);
      if (!ep) {
        // Its `effect-end` is recorded, so there is nothing to cancel, only the scope to close.
        ending.get(token)?.();
        return;
      }
      inflight.delete(token);
      ep.steps.push({ kind: "effect-cancel", targetId: name, ts: now() });
      const count = pending.get(ep) ?? 0;
      if (count > 0) pending.set(ep, count - 1);
      settle(ep);
    },
    recordSignalUpdate(dirtySlots, bindsUpdated) {
      const ep = topEpisode();
      if (!ep) return;
      ep.steps.push({
        kind: "signal-update",
        "dirty-slots": dirtySlots,
        "binds-updated": bindsUpdated ?? [],
        ts: now(),
      });
    },
    ingestBootstrap(ep) {
      open(ep);
      store(ep);
    },
    recordPanic(info, token) {
      const ep = (token !== undefined ? inflight.get(token) : undefined) ?? topEpisode();
      if (!ep) return undefined;
      const step: EpisodeStep = { kind: "panic", message: info.message, ts: now() };
      if (info.location !== undefined) step.location = info.location;
      if (info.name !== undefined) step.name = info.name;
      if (info.envReads !== undefined && info.envReads.length > 0) {
        step["env-reads"] = info.envReads.slice();
      }
      if (info.stack !== undefined) step.stack = info.stack;
      if (info.cause !== undefined && info.cause.length > 0) step.cause = info.cause;
      if (info.category !== undefined) step.category = info.category;
      if (info.handled === true) step.handled = true;
      ep.steps.push(step);
      ep.status = "panic";
      return ep.id;
    },
    list() {
      return memory.map((kept) => kept.ep);
    },
    hasOpenEpisode() {
      return stack.length > 0;
    },
    currentId() {
      return topEpisode()?.id;
    },
  };
}
