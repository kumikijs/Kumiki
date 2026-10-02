// Capability model: the standard set (docs/spec/stdlib.md §2.5), the standard
// effects gated on it (§2.6), and parsing for the `kumiki.caps.json` manifest
// that registers project-specific capabilities.
// Pure (no I/O) so it stays browser-safe; the file-resolving wrapper lives in
// the node-only submodule (`@kumikijs/compiler/node`).

import type { TypeExpr } from "./ast.ts";
import { appType, primType, recordType, refType } from "./stdlib-types.ts";

/** Capabilities that may appear in `app.caps` without any manifest. */
export const STANDARD_CAPABILITIES: ReadonlySet<string> = new Set([
  "http.get",
  "http.post",
  "http.put",
  "http.patch",
  "http.delete",
  "http.cancel",
  "storage.read",
  "storage.write",
  "session.read",
  "session.write",
  "indexed.read",
  "indexed.write",
  "indexed.delete",
  "nav.push",
  "nav.replace",
  "nav.back",
  "clipboard.read",
  "clipboard.write",
  "notification.show",
  "analytics.send",
  "log.write",
  "crypto.random",
  "crypto.hash",
  "media.camera",
  "media.microphone",
  "geo.read",
  "socket.connect",
  "socket.send",
]);

const text = primType("Text");
const textMap = appType("Map", text, text);
const navigation: TypeExpr = recordType({ path: text, params: textMap, query: textMap });

/**
 * The capabilities whose effects declare their failure as `Text`
 * (`out=Result(T, Text)`, docs/spec/http.md §6.7) — localStorage,
 * sessionStorage and IndexedDB. Their built-in handlers deliver that `Text` to
 * `.err`, so the checker types an `.err` bind on one of them from `out=`, and
 * codegen turns a throw inside one of their invokes (a `map-request` that
 * throws, a host provider that throws) into the same `Text` rather than
 * leaving it to the dispatcher, which cannot know the effect's `E`.
 */
const TEXT_FAILURE_CAPABILITIES: ReadonlySet<string> = new Set([
  "storage.read",
  "storage.write",
  "session.read",
  "session.write",
  "indexed.read",
  "indexed.write",
  "indexed.delete",
]);

/** Whether an effect on `cap` fails with the `Text` its `out=` declares. */
export function failsWithText(cap: string): boolean {
  return TEXT_FAILURE_CAPABILITIES.has(cap);
}

/**
 * `confirm`'s `onYes` / `onNo` (stdlib.md §2.6.5, lifecycle.md §7.6): a
 * reducer's name, written bare, which the runtime dispatches by name. It is not
 * a type a program can write, so the checker matches this node itself rather
 * than the name, and a program's own `type ReducerRef` cannot stand in for it.
 */
export const REDUCER_REF: TypeExpr = refType("ReducerRef");

/** A standard effect: the capability it is gated on and the input it takes. */
export type BuiltinEffect = {
  /** `null` for the one that needs none. */
  readonly cap: string | null;
  /** Its `in=`, as stdlib.md §2.6 declares it. */
  readonly inType: TypeExpr;
  /**
   * Record fields a call may leave out beside the `Option(T)` ones, which may
   * always be: `navigate`'s `params` and `query` default to `{}` (routing.md
   * §3.7), and `confirm`'s `message` to none.
   */
  readonly defaulted?: readonly string[];
};

/**
 * The effects the runtime registers itself (docs/spec/stdlib.md §2.6): what
 * each is gated on and what it takes, in one table. They are not `effect`
 * declarations, so nothing in a program says either. An entry cannot have one
 * without the other.
 */
export const BUILTIN_EFFECTS: ReadonlyMap<string, BuiltinEffect> = new Map<string, BuiltinEffect>([
  // `query` is routing.md §3.7's extension of the §2.6.1 `in=`.
  ["navigate", { cap: "nav.push", inType: navigation, defaulted: ["params", "query"] }],
  ["navigate-replace", { cap: "nav.replace", inType: navigation, defaulted: ["params", "query"] }],
  ["navigate-back", { cap: "nav.back", inType: primType("Unit") }],
  ["scroll-to", { cap: null, inType: recordType({ x: primType("Int"), y: primType("Int") }) }],
  [
    "toast",
    {
      cap: "notification.show",
      inType: recordType({ kind: text, text, duration: appType("Option", refType("Duration")) }),
    },
  ],
  [
    "confirm",
    {
      cap: "notification.show",
      // `message` is lifecycle.md §7.6's; left out, the dialog shows the title.
      inType: recordType({ title: text, message: text, onYes: REDUCER_REF, onNo: REDUCER_REF }),
      defaulted: ["message"],
    },
  ],
  ["log", { cap: "log.write", inType: recordType({ level: text, message: text, data: textMap }) }],
]);

/**
 * Whether a call to the standard effect `builtin` may leave `field` out of its
 * record argument: an `Option(T)` field always may, and so may the entry's
 * `defaulted` ones (stdlib.md §2.6).
 */
export function builtinFieldOmittable(
  builtin: BuiltinEffect,
  field: { readonly name: string; readonly type: TypeExpr },
): boolean {
  return (
    (builtin.defaulted ?? []).includes(field.name) ||
    (field.type.kind === "TypeApp" && field.type.name === "Option")
  );
}

/** Each standard effect's capability, read off `BUILTIN_EFFECTS`. */
export const BUILTIN_EFFECT_CAPS: ReadonlyMap<string, string | null> = new Map(
  [...BUILTIN_EFFECTS].map(([name, e]) => [name, e.cap]),
);

export type CapabilityManifest = { capabilities: string[] };

export type ManifestResult =
  | { ok: true; manifest: CapabilityManifest }
  | { ok: false; error: string };

/** A capability name must look like `group.action` (lowercase, dot-separated). */
const CAP_NAME = /^[a-z][a-z0-9]*\.[a-z][a-z0-9-]*$/;

/**
 * Validate a parsed `kumiki.caps.json` value. Accepts either bare strings or
 * `{ name, description? }` objects in the `capabilities` array. Pure — the
 * caller does the file read + JSON parse and reports the location.
 */
export function parseCapabilityManifest(raw: unknown): ManifestResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "manifest must be a JSON object" };
  }
  const caps = (raw as Record<string, unknown>).capabilities;
  if (!Array.isArray(caps)) {
    return { ok: false, error: '"capabilities" must be an array' };
  }
  const names: string[] = [];
  for (let i = 0; i < caps.length; i++) {
    const entry = caps[i];
    const name = typeof entry === "string" ? entry : pickName(entry);
    if (typeof name !== "string" || name.length === 0) {
      return {
        ok: false,
        error: `capabilities[${i}] must be a string or an object with a non-empty "name"`,
      };
    }
    if (!CAP_NAME.test(name)) {
      return {
        ok: false,
        error: `capability "${name}" must look like "group.action" (lowercase, dot-separated)`,
      };
    }
    if (STANDARD_CAPABILITIES.has(name)) {
      return {
        ok: false,
        error: `capability "${name}" is already a standard capability — remove it from the manifest`,
      };
    }
    names.push(name);
  }
  return { ok: true, manifest: { capabilities: names } };
}

function pickName(entry: unknown): unknown {
  if (typeof entry === "object" && entry !== null) {
    return (entry as Record<string, unknown>).name;
  }
  return undefined;
}
