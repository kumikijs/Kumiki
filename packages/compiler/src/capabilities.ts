// Capability model: the standard set (docs/spec/stdlib.md §2.5) plus parsing for the
// `kumiki.caps.json` manifest that registers project-specific capabilities.
// Pure (no I/O) so it stays browser-safe; the file-resolving wrapper lives in
// the node-only submodule (`@kumikijs/compiler/node`).

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
 * The effects the runtime registers itself (docs/spec/stdlib.md §2.6), mapped
 * to the capability each one is gated on — `null` for the one that needs none.
 *
 * They are not `effect` declarations, so nothing in a program says what they
 * require; without this table the capability check has no capability to look
 * at and passes. The runtime has no such gap: an undeclared capability there
 * refuses the effect and reports the refusal (runtime.md §10.4.2), so
 * `emit navigate(…)` under `caps=[]` compiles and mounts, and the first sign
 * it cannot work is a panic at run time.
 */
export const BUILTIN_EFFECT_CAPS: ReadonlyMap<string, string | null> = new Map([
  ["navigate", "nav.push"],
  ["navigate-replace", "nav.replace"],
  ["navigate-back", "nav.back"],
  ["scroll-to", null],
  ["toast", "notification.show"],
  ["confirm", "notification.show"],
  ["log", "log.write"],
]);

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
