// Where a `kumiki.caps.json` is allowed to live. The manifest registers a
// project's custom capabilities, so the project root is the natural place to
// put it — and a lookup that only checked the `.kumiki` file's own directory
// ignored it there in silence: the app failed E0302 with nothing to say about
// where the toolchain had looked.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CapabilityManifestError,
  resolveCapabilities,
  resolveCapabilityManifest,
} from "@kumikijs/compiler/node";
import { describe, expect, it } from "vitest";

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

/** A throwaway `<root>/pkg/src/app.kumiki` tree; returns the directories. */
function project(): { root: string; pkg: string; src: string; file: string } {
  const root = mkdtempSync(join(TMP_ROOT, "caps-"));
  const pkg = join(root, "pkg");
  const src = join(pkg, "src");
  mkdirSync(src, { recursive: true });
  const file = join(src, "app.kumiki");
  writeFileSync(file, "");
  return { root, pkg, src, file };
}

const manifest = (dir: string, ...names: string[]): void =>
  writeFileSync(join(dir, "kumiki.caps.json"), JSON.stringify({ capabilities: names }));

const packageJson = (dir: string): void =>
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p" }));

describe("kumiki.caps.json resolution", () => {
  it("finds a manifest beside the source file", () => {
    const p = project();
    manifest(p.src, "telemetry.track");
    expect(resolveCapabilities(p.file)).toEqual(["telemetry.track"]);
  });

  it("finds a manifest in a parent directory", () => {
    const p = project();
    manifest(p.pkg, "telemetry.track");
    expect(resolveCapabilities(p.file)).toEqual(["telemetry.track"]);
  });

  it("takes the nearest manifest when several are on the path", () => {
    const p = project();
    manifest(p.src, "near.one");
    manifest(p.pkg, "far.one");
    const found = resolveCapabilityManifest(p.file);
    expect(found.capabilities).toEqual(["near.one"]);
    expect(found.manifestPath).toBe(join(p.src, "kumiki.caps.json"));
  });

  it("stops at the directory holding package.json", () => {
    const p = project();
    packageJson(p.pkg);
    manifest(p.root, "too.far");
    expect(resolveCapabilities(p.file)).toEqual([]);
  });

  it("still reads a manifest sitting in the package root itself", () => {
    const p = project();
    packageJson(p.pkg);
    manifest(p.pkg, "telemetry.track");
    expect(resolveCapabilities(p.file)).toEqual(["telemetry.track"]);
  });

  it("stops at an explicit root, that directory included", () => {
    const p = project();
    manifest(p.pkg, "telemetry.track");
    expect(resolveCapabilities(p.file, { root: p.pkg })).toEqual(["telemetry.track"]);
    expect(resolveCapabilities(p.file, { root: p.src })).toEqual([]);
  });

  it("reports the directories it consulted, nearest first", () => {
    const p = project();
    packageJson(p.pkg);
    const found = resolveCapabilityManifest(p.file);
    expect(found.manifestPath).toBeNull();
    expect(found.capabilities).toEqual([]);
    expect(found.searched).toEqual([p.src, p.pkg]);
  });

  it("names the offending file when a manifest on the path is malformed", () => {
    const p = project();
    writeFileSync(join(p.pkg, "kumiki.caps.json"), "{ not json");
    let thrown: unknown;
    try {
      resolveCapabilities(p.file);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CapabilityManifestError);
    expect((thrown as Error).message).toContain(join(p.pkg, "kumiki.caps.json"));
  });

  it("names the offending file when a manifest on the path has an invalid shape", () => {
    const p = project();
    writeFileSync(join(p.pkg, "kumiki.caps.json"), JSON.stringify({ capabilities: [42] }));
    expect(() => resolveCapabilities(p.file)).toThrow(CapabilityManifestError);
  });
});
