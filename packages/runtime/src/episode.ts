export type EpisodeTrigger = {
  kind: string;
  /** Tile name, lifecycle name, route pattern — interpretation depends on `kind`. */
  target?: string;
  payload?: unknown;
  ts: number;
};

export type SlotDiff = { name: string; before: unknown; after: unknown };

export type EnvReadKind = "now" | "random" | "fresh-id" | "prefers-dark";

/** One environment read and what it answered (runtime.md §10.5.1). */
export type EnvRead = { kind: EnvReadKind; value: unknown };

export type PanicCategory =
  | "reducer"
  | "effect"
  | "capability"
  | "tile-render"
  | "hydrate"
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
      /** Flattened `Error.cause` chain, root-most first. Omitted when empty. */
      cause?: PanicCauseLink[];
      category?: PanicCategory;
      ts: number;
    };

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
  /** In-memory ring buffer cap (§10.5.2, default 100). */
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
  onEpisode?: (ep: Episode) => void;
};

export type EpisodeLogger = {
  beginTrigger(t: Omit<EpisodeTrigger, "ts"> & { ts?: number }): string;
  endTrigger(): void;
  recordReducer(
    name: string,
    slotDiffs: SlotDiff[],
    emits: string[],
    envReads?: readonly EnvRead[],
  ): void;
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
      /** What that body read from the environment before it threw (§10.5.1). */
      envReads?: readonly EnvRead[] | undefined;
    },
    token?: string,
  ): string | undefined;
  ingestBootstrap(ep: Episode): void;
  /** Snapshot of currently retained episodes (oldest first). */
  list(): Episode[];
  hasOpenEpisode(): boolean;
  currentId(): string | undefined;
};

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

  const memory: Episode[] = [];
  const stack: Episode[] = [];
  /** Effect-end attribution by token — survives across async boundaries. */
  const inflight = new Map<string, Episode>();
  /** Per-episode count of effect-starts whose effect-end has not landed yet. */
  const pending = new Map<Episode, number>();
  /** Episodes whose `endTrigger` fired while effects were still in flight. */
  const closedAwaiting = new Set<Episode>();

  function topEpisode(): Episode | null {
    return stack.length > 0 ? (stack[stack.length - 1] as Episode) : null;
  }

  function persistLocalStorage(): void {
    if (!useLs || !lsImpl) return;
    let slice = memory.slice(Math.max(0, memory.length - lsMax));
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

  function commit(ep: Episode): void {
    if (ep.status === "ongoing") ep.status = "completed";
    memory.push(ep);
    while (memory.length > memoryMax) memory.shift();
    persistLocalStorage();
    opts.onEpisode?.(ep);
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
      inflight.delete(token);
      ep.steps.push({ kind: "effect-end", name, result, value, ts: now() });
      stack.push(ep);
      let exited = false;
      return () => {
        if (exited) return;
        exited = true;
        const idx = stack.lastIndexOf(ep);
        if (idx >= 0) stack.splice(idx, 1);
        const count = pending.get(ep) ?? 0;
        if (count > 0) pending.set(ep, count - 1);
        settle(ep);
      };
    },
    recordEffectCancel(targetId) {
      const ep = topEpisode();
      if (!ep) return;
      ep.steps.push({ kind: "effect-cancel", targetId, ts: now() });
    },
    cancelPendingEffect(token, name) {
      const ep = inflight.get(token);
      if (!ep) return;
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
      memory.push(ep);
      while (memory.length > memoryMax) memory.shift();
      persistLocalStorage();
      opts.onEpisode?.(ep);
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
      ep.steps.push(step);
      ep.status = "panic";
      return ep.id;
    },
    list() {
      return memory.slice();
    },
    hasOpenEpisode() {
      return stack.length > 0;
    },
    currentId() {
      return topEpisode()?.id;
    },
  };
}
