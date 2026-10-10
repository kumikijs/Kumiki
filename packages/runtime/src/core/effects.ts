import type { EmitRefusal } from "./panic.ts";
import type {
  AppShape,
  CapabilityProvider,
  CapabilityRegistry,
  EffectResult,
  EffectSpec,
  EmitSpec,
} from "./types.ts";

export function makeCapabilityRegistry(
  allowed: string[],
  providers?: Record<string, CapabilityProvider>,
): CapabilityRegistry {
  const ok = new Set(allowed);
  return {
    has: (c) => ok.has(c),
    provider: (c) => providers?.[c],
  };
}

export function withAnalyticsDefault(
  app: AppShape,
  hostProviders?: Record<string, CapabilityProvider>,
): Record<string, CapabilityProvider> | undefined {
  const cfg = app.analytics;
  if (!cfg) return hostProviders;
  if (hostProviders?.["analytics.send"]) return hostProviders;
  const tag = (input: unknown): unknown => {
    if (cfg.appId === undefined) return input;
    if (input && typeof input === "object" && !Array.isArray(input)) {
      return { ...(input as Record<string, unknown>), appId: cfg.appId };
    }
    return { appId: cfg.appId, payload: input };
  };
  const provider: CapabilityProvider =
    cfg.provider === "console"
      ? (input) => {
          console.log("[kumiki:analytics]", tag(input));
          return { kind: "ok", value: null };
        }
      : () => ({ kind: "ok", value: null });
  return { ...(hostProviders ?? {}), "analytics.send": provider };
}

type Dispatcher = {
  dispatch(emit: EmitSpec): void;
  dispose(): void;
};

export function makeEffectDispatcher(
  app: AppShape,
  caps: CapabilityRegistry,
  onResult: (
    effect: string,
    outcome: "ok" | "err",
    value: unknown,
    key: unknown,
    token: string,
  ) => void,
  onRefusal: (effect: string, why: EmitRefusal, token?: string) => void,
  onLaunch?: (effect: string, input: unknown) => string,
  onCancel?: (targetId: string) => void,
  onPolicyCancel?: (token: string, effectName: string) => void,
): Dispatcher {
  type TimerEntry = {
    kind: "debounce" | "throttle";
    h: ReturnType<typeof setTimeout>;
    token?: string;
    effectName?: string;
  };
  type QueueEntry = { token: string; effectName: string };
  type Queue = { tail: Promise<void>; pending: QueueEntry[] };
  type RunState = {
    inflight: Map<string, AbortController>;
    timers: Map<string, TimerEntry>;
    onceSeen: Map<string, Set<string>>;
    queues: Map<string, Queue>;
  };
  const state: RunState = {
    inflight: new Map(),
    timers: new Map(),
    onceSeen: new Map(),
    queues: new Map(),
  };

  const launch = async (
    eff: EffectSpec,
    input: unknown,
    key: string,
    presetToken?: string,
  ): Promise<void> => {
    // Empty cap = standard presentation effect (e.g. scroll-to); no permission gate.
    if (eff.cap !== "" && !caps.has(eff.cap)) {
      try {
        onRefusal(eff.name, { category: "capability", cap: eff.cap }, presetToken);
      } finally {
        if (presetToken) onPolicyCancel?.(presetToken, eff.name);
      }
      return;
    }
    const token = presetToken ?? onLaunch?.(eff.name, input) ?? "";
    const id = `${eff.name}:${key}`;
    const ctl = new AbortController();
    state.inflight.set(id, ctl);
    try {
      const res = await runWithRetry(eff, input, caps, ctl.signal);
      onResult(eff.name, res.kind, res.value, input, token);
    } catch (e) {
      onResult(eff.name, "err", { message: String(e) }, input, token);
    } finally {
      if (state.inflight.get(id) === ctl) state.inflight.delete(id);
    }
  };

  return {
    dispatch(emit: EmitSpec): void {
      const eff = app.effects[emit.effect];
      if (!eff) {
        // No token: a policy is a property of an effect, so with none to read one off nothing
        // defers this, and the episode that owns the emit is the one in focus.
        onRefusal(emit.effect, { category: "effect" });
        return;
      }
      if (eff.cap === "http.cancel") {
        const target = String(emit.args[0] ?? "");
        if (target.length > 0) {
          const ic = state.inflight.get(target);
          if (ic) {
            ic.abort();
            state.inflight.delete(target);
          }
          const q = state.queues.get(target);
          if (q) {
            const waiting = q.pending.splice(0, q.pending.length);
            for (const e of waiting) {
              if (e.token) onPolicyCancel?.(e.token, e.effectName);
            }
          }
          const t = state.timers.get(target);
          if (t !== undefined && t.kind === "debounce") {
            clearTimeout(t.h);
            state.timers.delete(target);
            if (t.token && t.effectName) {
              onPolicyCancel?.(t.token, t.effectName);
            }
          }
          onCancel?.(target);
        }
        return;
      }
      const input = emit.args[0];
      const policy = eff.policy ?? { kind: "default" as const };
      const key = policy.kind === "latest-per-key" ? (emit.key ?? policy.keyOf(input)) : "_";
      const id = `${eff.name}:${key}`;
      if (policy.kind === "once") {
        const seen = state.onceSeen.get(eff.name) ?? new Set<string>();
        const k = JSON.stringify(input ?? null);
        if (seen.has(k)) return;
        seen.add(k);
        state.onceSeen.set(eff.name, seen);
        void launch(eff, input, key);
        return;
      }
      if (policy.kind === "debounce") {
        const prev = state.timers.get(id);
        if (prev) {
          clearTimeout(prev.h);
          if (prev.token && prev.effectName) {
            onPolicyCancel?.(prev.token, prev.effectName);
          }
        }
        const token = onLaunch?.(eff.name, input) ?? "";
        const h = setTimeout(() => {
          state.timers.delete(id);
          void launch(eff, input, key, token);
        }, policy.ms);
        state.timers.set(id, { kind: "debounce", h, token, effectName: eff.name });
        return;
      }
      if (policy.kind === "queue") {
        const token = onLaunch?.(eff.name, input) ?? "";
        const entry: QueueEntry = { token, effectName: eff.name };
        const q = state.queues.get(id) ?? { tail: Promise.resolve(), pending: [] };
        q.pending.push(entry);
        const runNext = async (): Promise<void> => {
          const idx = q.pending.indexOf(entry);
          if (idx === -1) return;
          q.pending.splice(idx, 1);
          await launch(eff, input, key, token);
        };
        q.tail = q.tail.then(runNext, runNext);
        state.queues.set(id, q);
        return;
      }
      if (policy.kind === "throttle") {
        if (state.timers.has(id)) return;
        const h = setTimeout(() => state.timers.delete(id), policy.ms);
        state.timers.set(id, { kind: "throttle", h });
        void launch(eff, input, key);
        return;
      }
      if (policy.kind === "latest" || policy.kind === "latest-per-key") {
        const ic = state.inflight.get(id);
        if (ic) {
          ic.abort();
          state.inflight.delete(id);
        }
        void launch(eff, input, key);
        return;
      }
      void launch(eff, input, key);
    },
    dispose(): void {
      const pendingTimers = [...state.timers.values()];
      state.timers.clear();
      for (const t of pendingTimers) {
        clearTimeout(t.h);
        if (t.kind === "debounce" && t.token && t.effectName) {
          onPolicyCancel?.(t.token, t.effectName);
        }
      }
      for (const q of state.queues.values()) {
        const waiting = q.pending.splice(0, q.pending.length);
        for (const e of waiting) {
          if (e.token) onPolicyCancel?.(e.token, e.effectName);
        }
      }
      state.queues.clear();
      for (const c of state.inflight.values()) c.abort();
      state.inflight.clear();
    },
  };
}

export function overridableInvoke(
  cap: string,
  fn: (input: unknown, signal?: AbortSignal) => Promise<EffectResult>,
): EffectSpec["invoke"] {
  return async (input, caps, signal) => {
    const p = caps.provider(cap);
    if (p) return p(input, caps, signal);
    return fn(input, signal);
  };
}

export function installLogEffect(app: AppShape): void {
  app.effects.log = {
    name: "log",
    cap: "log.write",
    invoke: overridableInvoke("log.write", async (input) => {
      console.log("[kumiki]", input);
      return { kind: "ok", value: null };
    }),
  };
}

/** Pull `status` off an HttpError-shaped err value; returns null otherwise. */
export function readStatus(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const s = (value as { status?: unknown }).status;
  return typeof s === "number" ? s : null;
}

async function runWithRetry(
  eff: EffectSpec,
  input: unknown,
  caps: CapabilityRegistry,
  signal?: AbortSignal,
): Promise<EffectResult> {
  const policy = eff.retry;
  if (!policy) return eff.invoke(input, caps, signal);
  let last: EffectResult = await eff.invoke(input, caps, signal);
  for (let attempt = 1; attempt < policy.n; attempt++) {
    if (last.kind !== "err" || last.final) return last;
    if (signal?.aborted) return last;
    const status = readStatus(last.value);
    const retriable = status === null || status === 0 || status >= 500;
    if (!retriable) return last;
    const delay = policy.kind === "linear" ? policy.ms : policy.ms * policy.factor ** (attempt - 1);
    await sleep(delay);
    last = await eff.invoke(input, caps, signal);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
