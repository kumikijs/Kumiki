// Write verbs on one file from several processes at once: every op either
// lands and is logged, or is rejected and is not — the file and the op log
// never disagree, and no writer's edit is erased by another's.

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addDef, readOpLog } from "@kumikijs/cli";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER = resolve(here, "../../examples/apps/01-counter/app.kumiki");
const MUTATE = pathToFileURL(resolve(here, "../src/mutate.ts")).href;
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

let dir = "";
let file = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-concurrent-"));
  file = join(dir, "c.kumiki");
  copyFileSync(COUNTER, file);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Run a script under tsx in a child process; resolves with its stdout. */
const runChild = (script: string, args: string[]): Promise<string> =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--import", TSX, script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? done(out.trim()) : fail(new Error(err))));
  });

const slotsInFile = (): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^slot (extra\d+)\b/gm)].map((m) => m[1]!).sort();

describe("concurrent write verbs", () => {
  it("land every add from eight simultaneous writers, each logged once", {
    timeout: 120_000,
  }, async () => {
    const racer = join(dir, "racer.mts");
    writeFileSync(
      racer,
      [
        `import { addDef } from ${JSON.stringify(MUTATE)};`,
        "const [file, name, at] = process.argv.slice(2);",
        "while (Date.now() < Number(at)) {}",
        "try {",
        '  console.log(JSON.stringify({ name, opId: addDef(file, "slot", name, "Int = 0") }));',
        "} catch (e) {",
        "  console.log(JSON.stringify({ name, error: String(e) }));",
        "}",
      ].join("\n"),
    );
    const names = Array.from({ length: 8 }, (_, i) => `extra${i + 1}`);
    // Every child spins until the same instant, so their read-modify-writes
    // overlap rather than queue behind process start-up.
    const at = String(Date.now() + 8_000);
    const results = (await Promise.all(names.map((n) => runChild(racer, [file, n, at])))).map(
      (line) => JSON.parse(line) as { name: string; opId?: string; error?: string },
    );

    expect(results.filter((r) => r.error !== undefined)).toEqual([]);
    expect(slotsInFile()).toEqual([...names].sort());
    const logged = readOpLog(file).map((e) => e["op-id"]);
    expect(logged.sort()).toEqual(results.map((r) => r.opId).sort());
  });

  it("waits for another writer's lock instead of writing past it", {
    timeout: 60_000,
  }, () => {
    // A live process holds the lock and drops it after 1.5 s. The add has to
    // wait for that: when it returns, the holder's lock is already gone.
    const lock = `${file}.kumiki-write.lock`;
    const holder = spawn(
      process.execPath,
      ["-e", `setTimeout(() => require("fs").rmSync(${JSON.stringify(lock)}), 1500);`],
      { stdio: "ignore" },
    );
    writeFileSync(lock, JSON.stringify({ pid: holder.pid, host: hostname() }));
    const t0 = Date.now();
    try {
      addDef(file, "slot", "extra1", "Int = 0");
      expect(existsSync(lock)).toBe(false);
    } finally {
      holder.kill();
    }
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
    expect(slotsInFile()).toEqual(["extra1"]);
  });

  it("takes over a lock whose holder has exited", () => {
    const gone = spawnSync(process.execPath, ["-e", "console.log(process.pid)"]);
    const pid = Number(String(gone.stdout).trim());
    const lock = `${file}.kumiki-write.lock`;
    writeFileSync(lock, JSON.stringify({ pid, host: hostname() }));

    addDef(file, "slot", "extra1", "Int = 0");

    expect(slotsInFile()).toEqual(["extra1"]);
    // Taken over and released, not written around.
    expect(existsSync(lock)).toBe(false);
  });
});
