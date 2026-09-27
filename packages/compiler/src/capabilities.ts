// Capability model: the standard set (docs/spec/stdlib.md §2.5), the standard
// effects gated on it (§2.6), and parsing for the `kumiki.caps.json` manifest
// that registers project-specific capabilities.
// Pure (no I/O) so it stays browser-safe; the file-resolving wrapper lives in
// the node-only submodule (`@kumikijs/compiler/node`).

import type { TypeExpr } from "./ast.ts";
import { synthType } from "./stdlib-types.ts";

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

const { prim, ref, app, record } = synthType;
const text = prim("Text");
const textMap = app("Map", text, text);

/** A standard effect: the capability it is gated on and the input it takes. */
export type BuiltinEffect = {
  /** `null` for the one that needs none. */
  readonly cap: string | null;
  /** Its `in=`, as stdlib.md §2.6 declares it. */
  readonly in: TypeExpr;
  /**
   * Record fields a call may leave out beside the `Option(T)` ones, which may
   * always be: `navigate`'s `params` and `query` default to `{}` (routing.md
   * §3.7), and `confirm`'s `message` to none.
   */
  readonly defaulted?: readonly string[];
};

const navigation: BuiltinEffect["in"] = record({ path: text, params: textMap, query: textMap });

/**
 * The effects the runtime registers itself (docs/spec/stdlib.md §2.6): what
 * each is gated on and what it takes, in one table.
 *
 * They are not `effect` declarations, so nothing in a program says what they
 * require or accept. Without the capability the check had nothing to look at
 * and passed — the runtime refuses the effect and reports the refusal
 * (runtime.md §10.4.2), so `emit navigate(…)` under `caps=[]` compiled and the
 * first sign it could not work was a panic at run time. Without the input type
 * `emit navigate("/about")` compiled too, and the router read `.path` off a
 * string and never moved. An entry cannot have one without the other.
 */
export const BUILTIN_EFFECTS: ReadonlyMap<string, BuiltinEffect> = new Map<string, BuiltinEffect>([
  // `query` is routing.md §3.7's extension of the §2.6.1 `in=`.
  ["navigate", { cap: "nav.push", in: navigation, defaulted: ["params", "query"] }],
  ["navigate-replace", { cap: "nav.replace", in: navigation, defaulted: ["params", "query"] }],
  ["navigate-back", { cap: "nav.back", in: prim("Unit") }],
  ["scroll-to", { cap: null, in: record({ x: prim("Int"), y: prim("Int") }) }],
  [
    "toast",
    {
      cap: "notification.show",
      in: record({ kind: text, text, duration: app("Option", ref("Duration")) }),
    },
  ],
  [
    "confirm",
    {
      cap: "notification.show",
      // `message` is lifecycle.md §7.6's; left out, the dialog shows the title.
      in: record({ title: text, message: text, onYes: ref("Reducer"), onNo: ref("Reducer") }),
      defaulted: ["message"],
    },
  ],
  ["log", { cap: "log.write", in: record({ level: text, message: text, data: textMap }) }],
]);

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
