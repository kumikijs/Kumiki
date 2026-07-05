// Kumiki runtime episode logger (docs/spec/runtime.md §10.5). One episode = the
// causal chain derived from one trigger (a DOM event, a lifecycle fire, a timer
// tick, a route change, an async effect result, ...). The synchronous variant
// implemented here groups every reducer / effect-start / effect-end /
// signal-update / panic that happens between `beginTrigger` and `endTrigger`
// into a single Episode. An async effect that resolves AFTER `endTrigger` lands
// its `effect-end` on the same episode if the originating handle (`token` from
// `recordEffectStart`) is still in flight; otherwise a fresh episode is the
// caller's job to open. We keep this minimal: an in-memory ring buffer (§10.5.2,
// default 100), and — when the caller opts in — a localStorage mirror (default
// max 20, 5 MB byte cap).

export type EpisodeTrigger = {
  /**
   * "ui.click" / "ui.submit" / "lifecycle" / "route.enter" / "timer" /
   * "effect.end" / "init" / "ssr.hydrate" (server-generated bootstrap, see
   * docs/spec/runtime.md §10.5.1 + §10.6.2 — the client side never opens
   * episodes with this kind via `beginTrigger`; only `ingestBootstrap`
   * injects them).
   */
  kind: string;
  /** Tile name, lifecycle name, route pattern — interpretation depends on `kind`. */
  target?: string;
  payload?: unknown;
  ts: number;
};

export type SlotDiff = { name: string; before: unknown; after: unknown };

export type EpisodeStep =
  | {
      kind: "reducer";
      name: string;
      "slot-diffs": SlotDiff[];
      emits: string[];
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
  | { kind: "panic"; message: string; location?: string; ts: number };

export type EpisodeStatus = "completed" | "panic" | "cancelled" | "ongoing";

export type Episode = {
  id: string;
  trigger: EpisodeTrigger;
  steps: EpisodeStep[];
  status: EpisodeStatus;
};

/**
 * Minimal localStorage shape — `globalThis.localStorage` satisfies it. Spelt out
 * as an interface so tests can inject a Map-backed double without touching the
 * real browser storage.
 */
export type EpisodeLocalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type EpisodeLoggerOptions = {
  /** In-memory ring buffer cap (§10.5.2, default 100). */
  memoryMax?: number;
  /**
   * Off by default. happy-dom / SSR / Web-Component shadow contexts often have
   * no usable `localStorage`, so the runtime stays passive unless the host
   * mount opts in explicitly.
   */
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
  /**
   * Open a new episode for `trigger` and make it the current target of every
   * `record*` call. Returns the episode id (`ep_<ULID>`) so callers can stash
   * it across async boundaries if needed.
   */
  beginTrigger(t: Omit<EpisodeTrigger, "ts"> & { ts?: number }): string;
  /**
   * Close the currently open episode. If at least one effect dispatched during
   * the episode is still in flight, the episode stays `ongoing` and commits
   * when its last `recordEffectEnd` fires.
   */
  endTrigger(): void;
  /** Append a `{kind: "reducer", ...}` step to the open episode. */
  recordReducer(name: string, slotDiffs: SlotDiff[], emits: string[]): void;
  /**
   * Append a `{kind: "effect-start", ...}` step. The returned token lets the
   * caller hand the matching `effect-end` back to the SAME episode, even after
   * the synchronous handler has already returned.
   */
  recordEffectStart(name: string, args: unknown): string;
  /**
   * Append a `{kind: "effect-end", ...}` step to the episode identified by
   * `token` (or, as a fallback, the currently open episode), and push that
   * episode back into focus so the `.ok` / `.err` reducer chain that runs
   * next records its steps on the SAME episode (spec §10.5.1 keeps the whole
   * causal chain from one trigger together). The returned function must be
   * called once the chain is done — it pops the episode and commits if it
   * was the last outstanding effect.
   */
  recordEffectEnd(token: string, name: string, result: "ok" | "err", value: unknown): () => void;
  /**
   * Append a `{kind: "effect-cancel", ...}` step to the open episode. Used by
   * the dispatcher's `http.cancel` branch (spec http.md §6.4) so the trace
   * carries both the cancel intent AND the cancelled effect's `.err`
   * (`message: "aborted"`) — without the cancel step the `.err` looks like a
   * generic network failure. For a deferred-policy launch (debounce) that
   * was claimed at dispatch time but never actually fired, see the sibling
   * `cancelPendingEffect` — that one resolves the originating episode by
   * `token` and settles its `pending` counter, which `recordEffectCancel`
   * deliberately does not do.
   */
  recordEffectCancel(targetId: string): void;
  /**
   * Cancel a pending effect-start that was claimed (token + step) at dispatch
   * time but whose `launch` never actually fired. Used by the dispatcher
   * (spec §10.5.1) for debounce timers that were replaced before firing, by
   * `dispose()` draining still-pending debounces at unmount, by the
   * `http.cancel` branch when it clears a pending debounce timer, and by
   * `launch`'s capability early-return so a missing `cap` doesn't strand the
   * originating episode. We resolve the token to its originating episode,
   * append an `effect-cancel` step there, decrement that episode's `pending`
   * counter, and `settle` it so a `closedAwaiting` episode commits. Unknown
   * tokens are a silent no-op. Distinct from `recordEffectCancel` (which
   * annotates the CURRENT top episode, leaves `inflight` intact, and relies
   * on the subsequent AbortError to commit the cancelled episode).
   */
  cancelPendingEffect(token: string, name: string): void;
  /** Append a `{kind: "signal-update", ...}` step to the open episode. */
  recordSignalUpdate(dirtySlots: string[], bindsUpdated?: string[]): void;
  /** Record a panic; the episode commits with `status = "panic"`. */
  recordPanic(message: string, location?: string): void;
  /**
   * Inject an already-completed episode at the tail of the memory ring (and
   * the localStorage mirror, when enabled). Used by SSR hydration to seat
   * the server-side bootstrap episode (`trigger.kind = "ssr.hydrate"`) on
   * the client logger BEFORE any client-opened episode runs, so
   * `list()[0]` reflects the SSR causal chain (§10.5.1 + §10.6.2). Does not
   * touch the trigger stack — bootstrap episodes are externally finalised.
   */
  ingestBootstrap(ep: Episode): void;
  /** Snapshot of currently retained episodes (oldest first). */
  list(): Episode[];
  /**
   * True when at least one episode is in focus (`beginTrigger` not yet matched
   * by `endTrigger`, or `recordEffectEnd`'s scope is open). The runtime uses
   * this to decide whether the next `applyReducer` should auto-open a new
   * episode or join the existing one.
   */
  hasOpenEpisode(): boolean;
};

/**
 * Cryptographically-uninteresting ULID-ish ids (`ep_<26-char-Crockford>`). We
 * only need lexicographically-sortable, collision-resistant-enough strings; the
 * MCP `kumiki_episode` reader matches by exact string so format stability is
 * what matters, not entropy.
 */
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
    recordReducer(name, slotDiffs, emits) {
      const ep = topEpisode();
      if (!ep) return;
      ep.steps.push({
        kind: "reducer",
        name,
        "slot-diffs": slotDiffs,
        emits,
        ts: now(),
      });
    },
    recordEffectStart(name, args) {
      const ep = topEpisode();
      // No open episode = no causal home for this start. Returning a fresh
      // `idGen()` here would hand the caller a phantom token that is never
      // resolvable via `inflight`, so the matching `recordEffectEnd` /
      // `cancelPendingEffect` would silently no-op and the invariant
      // violation (dispatcher fired a `recordEffectStart` from outside any
      // open episode) would be unobservable. Empty string makes that case
      // explicit at the dispatcher seam, which treats `""` as "no episode
      // attribution".
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
    recordPanic(message, location) {
      const ep = topEpisode();
      if (!ep) return;
      const step: EpisodeStep =
        location === undefined
          ? { kind: "panic", message, ts: now() }
          : { kind: "panic", message, location, ts: now() };
      ep.steps.push(step);
      ep.status = "panic";
    },
    list() {
      return memory.slice();
    },
    hasOpenEpisode() {
      return stack.length > 0;
    },
  };
}
