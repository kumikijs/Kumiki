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
