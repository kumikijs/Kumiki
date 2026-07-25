// Runtime smoke coverage: every example must not only compile, but actually
// mount, render, and survive having its UI exercised — catching the "compiles
// but throws / renders nothing when used" bugs that previously needed a human
// clicking through the app in a browser.

import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { smoke } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "..", "examples");

function featureExamples(): string[] {
  const dir = join(examplesDir, "features");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".kumiki"))
    .map((f) => join(dir, f));
}

function appExamples(): string[] {
  const dir = join(examplesDir, "apps");
  return readdirSync(dir)
    .map((name) => join(dir, name, "app.kumiki"))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

async function smokeFile(file: string): Promise<void> {
  const app = await loadApp(file);
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    const report = await smoke(app, root, { settleMs: 20 });
    if (!report.ok) {
      const detail = report.issues
        .map((i) => `  [${i.phase}] ${i.message}${i.trigger ? ` (on ${i.trigger})` : ""}`)
        .join("\n");
      throw new Error(
        `${file} failed runtime smoke (mounted=${report.mounted}, rendered=${report.rendered}, interactions=${report.interactions}):\n${detail}`,
      );
    }
    expect(report.rendered).toBe(true);
  } finally {
    root.remove();
  }
}

describe("feature examples — runtime smoke", () => {
  for (const file of featureExamples()) {
    it(`runs ${file.split(/[\\/]/).slice(-1)[0]}`, () => smokeFile(file));
  }
});

describe("app examples — runtime smoke", () => {
  for (const file of appExamples()) {
    const label = file.split(/[\\/]/).slice(-2).join("/");
    it(`runs ${label}`, () => smokeFile(file));
  }
});

describe("reconcile diagnostics reach the smoke report", () => {
  // The one example authored to trip an identity-losing rebuild: its `Notes`
  // column holds an unkeyed `when` child, so toggling the hint changes the
  // sibling count and the whole column is rebuilt. Two things are asserted
  // together on purpose — the diagnostic must actually surface end to end
  // (compile → mount → drive → report), AND it must not fail the run, because
  // every example above shares this harness and unkeyed siblings are ordinary
  // Kumiki.
  it("reports the unkeyed sibling rebuild without failing the run", async () => {
    const file = join(examplesDir, "features", "58-unkeyed-conditional-rebuild.kumiki");
    const app = await loadApp(file);
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const report = await smoke(app, root, { settleMs: 20 });
      expect(report.ok).toBe(true);
      const fallbacks = report.diagnostics
        .map((d) => d.diagnostic)
        .filter((d) => d.kind === "reconcile-fallback");
      // The unkeyed `Notes` column rebuilds when its `when` child appears.
      expect(fallbacks.map((d) => d.reason)).toContain("child-count-change");
      // …and the keyed `Tags` column beside it does NOT, even though smoke's
      // "add tag" click grows it. That contrast is the example's whole point,
      // so it is asserted rather than left to the reader: every reported
      // rebuild must be the unkeyed column.
      for (const d of fallbacks) {
        expect(d.id).not.toBe("Tags");
        expect(d.tile).not.toBe("Tags");
      }
    } finally {
      root.remove();
    }
  });
});
