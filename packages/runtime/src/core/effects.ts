import { newId, readEnv } from "./env.ts";
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

// The id a reducer body keeps and the one the dispatcher runs the request under must agree, so
// both ask here. `latest` and `latest-per-key` run one request per key, and the id names it.
// Under every other policy each emit gets an id of its own. Inside a body its new part is recorded
// as an `effect-id` environment read, so replay yields the same id; a statement `emit` or an
// `app.init` entry is minted at dispatch, unrecorded, because no program value holds its id.
export function emitId(eff: Pick<EffectSpec, "policy"> | undefined, emit: EmitSpec): string {
  const p = eff?.policy;
  if (p?.kind === "latest") return `${emit.effect}:_`;
  if (p?.kind === "latest-per-key") return `${emit.effect}:${emit.key ?? p.keyOf(emit.args[0])}`;
  return emit.id ?? `${emit.effect}#${readEnv("effect-id", newId)}`;
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
  onCapabilityRefusal: (effect: string, cap: string, token?: string) => void,
  onLaunch?: (effect: string, input: unknown) => string,
  onCancel?: (targetId: string) => void,
  onPolicyCancel?: (token: string, effectName: string) => void,
): Dispatcher {
  type Timer = ReturnType<typeof setTimeout>;
  type TimerEntry =
    | { kind: "debounce"; h: Timer; id: string; token: string }
    | { kind: "throttle"; h: Timer; id: string };
  type QueueEntry = { id: string; token: string };
  type Queue = { tail: Promise<void>; pending: QueueEntry[] };
  type RunState = {
    // Keyed by `EffectId`: what `http.cancel` names and `latest` replaces.
    inflight: Map<string, AbortController>;
    // The id of an emit a policy dropped, to the id of the request that absorbed it, so a cancel
    // through either one reaches that request. An entry goes when that request settles.
    absorbedBy: Map<string, string>;
    // Keyed by effect name: a debounce or throttle window, a once table and a queue belong to the
    // effect, not to one emit.
    timers: Map<string, TimerEntry>;
    onceSeen: Map<string, Map<string, string>>;
    queues: Map<string, Queue>;
  };
  const state: RunState = {
    inflight: new Map(),
    absorbedBy: new Map(),
    timers: new Map(),
    onceSeen: new Map(),
    queues: new Map(),
  };

  // `dropped` now names the request `into` names, and so does every id that named `dropped`.
  const absorb = (dropped: string, into: string): void => {
    for (const [from, to] of state.absorbedBy) {
      if (to === dropped) state.absorbedBy.set(from, into);
    }
    state.absorbedBy.set(dropped, into);
  };
  // The request under `id` is over, so the ids it absorbed name nothing any more.
  const settle = (id: string): void => {
    for (const [from, to] of state.absorbedBy) {
      if (to === id) state.absorbedBy.delete(from);
    }
  };

  const launch = async (
    eff: EffectSpec,
    input: unknown,
    id: string,
    presetToken?: string,
  ): Promise<void> => {
    // Empty cap = standard presentation effect (e.g. scroll-to); no permission gate.
    if (eff.cap !== "" && !caps.has(eff.cap)) {
      settle(id);
      try {
        onCapabilityRefusal(eff.name, eff.cap, presetToken);
      } finally {
        if (presetToken) onPolicyCancel?.(presetToken, eff.name);
      }
      return;
    }
    const token = presetToken ?? onLaunch?.(eff.name, input) ?? "";
    const ctl = new AbortController();
    state.inflight.set(id, ctl);
    try {
      let outcome: "ok" | "err";
      let value: unknown;
      try {
        const res = await runWithRetry(eff, input, caps, ctl.signal);
        outcome = res.kind;
        value = res.value;
      } catch (e) {
        // An invoke that throws is this request's err, in the form `eff` fails with.
        outcome = "err";
        value = standInValue(eff, "err", { message: String(e) });
      }
      // Outside the catch: this is the request's one result, and what its delivery throws is
      // the app's to report, not a second result.
      onResult(eff.name, outcome, value, input, token);
    } finally {
      if (state.inflight.get(id) === ctl) {
        state.inflight.delete(id);
        settle(id);
      }
    }
  };

  return {
    dispatch(emit: EmitSpec): void {
      const eff = app.effects[emit.effect];
      if (!eff) return;
      if (eff.cap === "http.cancel") {
        const named = String(emit.args[0] ?? "");
        if (named.length > 0) {
          const target = state.absorbedBy.get(named) ?? named;
          const ic = state.inflight.get(target);
          if (ic) {
            ic.abort();
            state.inflight.delete(target);
          }
          for (const [name, q] of state.queues) {
            const i = q.pending.findIndex((e) => e.id === target);
            if (i === -1) continue;
            const [e] = q.pending.splice(i, 1);
            if (e?.token) onPolicyCancel?.(e.token, name);
            break;
          }
          for (const [name, t] of state.timers) {
            if (t.kind !== "debounce" || t.id !== target) continue;
            clearTimeout(t.h);
            state.timers.delete(name);
            if (t.token) onPolicyCancel?.(t.token, name);
            break;
          }
          settle(target);
          onCancel?.(named);
        }
        return;
      }
      const input = emit.args[0];
      const policy = eff.policy ?? { kind: "default" as const };
      const id = emitId(eff, emit);
      if (policy.kind === "once") {
        const seen = state.onceSeen.get(eff.name) ?? new Map<string, string>();
        const k = JSON.stringify(input ?? null);
        const first = seen.get(k);
        if (first !== undefined) {
          if (state.inflight.has(first)) absorb(id, first);
          return;
        }
        seen.set(k, id);
        state.onceSeen.set(eff.name, seen);
        void launch(eff, input, id);
        return;
      }
      if (policy.kind === "debounce") {
        const prev = state.timers.get(eff.name);
        if (prev?.kind === "debounce") {
          clearTimeout(prev.h);
          absorb(prev.id, id);
          if (prev.token) onPolicyCancel?.(prev.token, eff.name);
        }
        const token = onLaunch?.(eff.name, input) ?? "";
        const h = setTimeout(() => {
          state.timers.delete(eff.name);
          void launch(eff, input, id, token);
        }, policy.ms);
        state.timers.set(eff.name, { kind: "debounce", h, id, token });
        return;
      }
      if (policy.kind === "queue") {
        const token = onLaunch?.(eff.name, input) ?? "";
        const entry: QueueEntry = { id, token };
        const q = state.queues.get(eff.name) ?? { tail: Promise.resolve(), pending: [] };
        q.pending.push(entry);
        const runNext = async (): Promise<void> => {
          const idx = q.pending.indexOf(entry);
          if (idx === -1) return;
          q.pending.splice(idx, 1);
          await launch(eff, input, id, token);
        };
        q.tail = q.tail.then(runNext, runNext);
        state.queues.set(eff.name, q);
        return;
      }
      if (policy.kind === "throttle") {
        const open = state.timers.get(eff.name);
        if (open) {
          if (state.inflight.has(open.id)) absorb(id, open.id);
          return;
        }
        const h = setTimeout(() => state.timers.delete(eff.name), policy.ms);
        state.timers.set(eff.name, { kind: "throttle", h, id });
        void launch(eff, input, id);
        return;
      }
      if (policy.kind === "latest" || policy.kind === "latest-per-key") {
        const ic = state.inflight.get(id);
        if (ic) {
          ic.abort();
          state.inflight.delete(id);
        }
        void launch(eff, input, id);
        return;
      }
      void launch(eff, input, id);
    },
    dispose(): void {
      const pendingTimers = [...state.timers];
      state.timers.clear();
      for (const [name, t] of pendingTimers) {
        clearTimeout(t.h);
        if (t.kind === "debounce" && t.token) onPolicyCancel?.(t.token, name);
      }
      for (const [name, q] of state.queues) {
        const waiting = q.pending.splice(0, q.pending.length);
        for (const e of waiting) {
          if (e.token) onPolicyCancel?.(e.token, name);
        }
      }
      state.queues.clear();
      for (const c of state.inflight.values()) c.abort();
      state.inflight.clear();
      state.absorbedBy.clear();
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

// The value `.ok` / `.err` receives from a result that stands in for `eff`'s invoke: an err on
// an effect that fails with `Text` reads through `eff.errText`, as that invoke's own err does.
// Any other value goes through unchanged, and a missing one becomes `null`.
export function standInValue(
  eff: Pick<EffectSpec, "errText"> | undefined,
  outcome: "ok" | "err",
  value: unknown,
): unknown {
  return outcome === "err" && eff?.errText ? eff.errText(value) : (value ?? null);
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
