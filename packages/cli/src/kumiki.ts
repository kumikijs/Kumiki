#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { check, compile, type KumikiError } from "@kumikijs/compiler";
import {
  CapabilityManifestError,
  resolveBuiltinIcons,
  resolveCapabilities,
} from "@kumikijs/compiler/node";
import type { EpisodeMockPolicy } from "@kumikijs/runtime";
import { devCmd } from "./dev.ts";
import { fixCmd, fixFromTest } from "./fix.ts";
import {
  addDef,
  editDef,
  lockDef,
  patchApplyFile,
  patchRevert,
  removeDef,
  renameDef,
  replaceDef,
  unlockDef,
  viewHash,
  viewHistory,
} from "./mutate.ts";
import { parseMockArg, replayCmd } from "./replay.ts";
import { runCmd, smokeCmd, testCmd } from "./smoke.ts";
import { findReferences, listDefs, load, viewDef, viewWithDeps } from "./store.ts";

const require = createRequire(import.meta.url);

function usage(): never {
  console.error("Usage:");
  console.error("  kumiki build <input.kumiki> <outdir>");
  console.error("  kumiki list <input.kumiki> [layer]");
  console.error("  kumiki view <input.kumiki> <qname> [--with-deps|--hash|--history]");
  console.error("  kumiki refs <input.kumiki> <qname>");
  console.error(
    "  kumiki check <input.kumiki> [--strict-a11y|--strict-icons|--types|--refs|--effects]",
  );
  console.error("  kumiki dev <input.kumiki> [--port <n>] [--episode-log <file>] [--strict-a11y]");
  console.error("  kumiki smoke <input.kumiki>");
  console.error("  kumiki run <input.kumiki> <scenario.json> [--episode-log <file>]");
  console.error(
    "  kumiki replay <input.kumiki> --from-log <log.jsonl> [<episode-id>] [--mock '<eff>:<spec>']* [--until-step N]",
  );
  console.error("  kumiki test <input.kumiki> [name|prefix*]");
  console.error("  kumiki fix <input.kumiki> [--apply] [<code>]");
  console.error("  kumiki fix <input.kumiki> --auto-patch <test-name> [--apply]");
  console.error("  kumiki edit <input.kumiki> <qname> <patch-json>");
  console.error("  kumiki patch apply <input.kumiki> <ops.jsonl>");
  console.error("  kumiki patch revert <input.kumiki> <op-id>");
  console.error("  kumiki lock <input.kumiki> <agent-id> <pattern>");
  console.error("  kumiki unlock <input.kumiki> <agent-id>");
  process.exit(2);
}

/** Resolve manifest capabilities, exiting cleanly on a malformed manifest. */
function capsFor(inputPath: string): string[] {
  try {
    return resolveCapabilities(inputPath);
  } catch (e) {
    if (e instanceof CapabilityManifestError) {
      console.error(`capability manifest error: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

async function buildCmd(inputArg: string, outdirArg: string): Promise<void> {
  const inputPath = resolve(process.cwd(), inputArg);
  const outdir = resolve(process.cwd(), outdirArg);
  const source = readFileSync(inputPath, "utf8");
  const baseOpts = {
    runtimeSpecifier: "./runtime/core.js",
    runtimeModulesDir: "./runtime",
    capabilities: capsFor(inputPath),
  };
  const first = compile(source, baseOpts);
  if (first.kind === "fail") {
    for (const err of first.errors) {
      console.error(`${err.code} ${err.kind} at ${err.pos.line}:${err.pos.col}: ${err.message}`);
    }
    process.exit(1);
  }
  // Bake referenced icons into App.icons (#101). When @kumikijs/icons is
  // installed in the project, look up each used name and re-codegen with the
  // resolved subset so the output ships only the paths the app actually
  // references. Falls through silently when the package is absent.
  let result = first;
  if (first.usedIcons.length > 0) {
    const registry = await resolveBuiltinIcons(inputPath);
    if (registry) {
      const subset: Record<string, string> = {};
      for (const name of first.usedIcons) {
        const path = registry[name];
        if (typeof path === "string") subset[name] = path;
      }
      if (Object.keys(subset).length > 0) {
        const second = compile(source, { ...baseOpts, icons: subset });
        if (second.kind === "ok") result = second;
      }
    }
  }
  mkdirSync(outdir, { recursive: true });
  writeFileSync(resolve(outdir, "app.js"), result.js);
  // Per-app DCE (#71): ship only the runtime feature modules the compiled app
  // imports (codegen reports them) — a counter-class app gets core + stdlib +
  // its tile families, no router/table/overlay/effect code.
  mkdirSync(resolve(outdir, "runtime"), { recursive: true });
  for (const mod of result.runtimeModules) {
    writeFileSync(resolve(outdir, "runtime", `${mod}.js`), readRuntimeModule(mod));
  }
  writeFileSync(resolve(outdir, "index.html"), buildHtml());
  console.log(`Wrote ${outdir}/index.html, app.js, runtime/ (${result.runtimeModules.join(", ")})`);
}

function listCmd(inputArg: string, layer?: string): void {
  const store = load(resolve(process.cwd(), inputArg));
  const entries = listDefs(store, layer);
  for (const e of entries) {
    console.log(`${e.layer.padEnd(8)} ${e.name}  (${e.range.startLine}-${e.range.endLine})`);
  }
}

type ViewMode = "text" | "with-deps" | "hash" | "history";

function viewCmd(inputArg: string, qname: string, mode: ViewMode): void {
  const path = resolve(process.cwd(), inputArg);
  if (mode === "history") {
    const log = viewHistory(path, qname);
    if (log.length === 0) {
      console.log(`(no history for ${qname})`);
      return;
    }
    for (const e of log) {
      console.log(`${e["op-id"]}  ${new Date(e.ts).toISOString()}  ${e.op}  by ${e.author}`);
    }
    return;
  }
  const store = load(path);
  if (mode === "hash") {
    if (!store.byQName.has(qname)) {
      console.error(`Definition "${qname}" not found`);
      process.exit(1);
    }
    console.log(viewHash(store, qname));
    return;
  }
  const out = mode === "with-deps" ? viewWithDeps(store, qname) : viewDef(store, qname);
  if (out === null) {
    console.error(`Definition "${qname}" not found`);
    process.exit(1);
  }
  console.log(out);
}

function refsCmd(inputArg: string, qname: string): void {
  const store = load(resolve(process.cwd(), inputArg));
  const refs = findReferences(store, qname);
  if (refs.length === 0) {
    console.log(`(no references to ${qname})`);
    return;
  }
  for (const r of refs) console.log(`${r.qname}  ${inputArg}:${r.line}`);
}

type CheckScope = "all" | "types" | "refs" | "effects";

function filterByScope(errors: KumikiError[], scope: CheckScope): KumikiError[] {
  if (scope === "all") return errors;
  return errors.filter((e) => {
    const code = e.code;
    if (scope === "types")
      return code.startsWith("E02") || code.startsWith("E04") || code.startsWith("E06");
    if (scope === "refs") return code.startsWith("E01") || code.startsWith("E05");
    if (scope === "effects") return code.startsWith("E03");
    return true;
  });
}

async function checkCmd(
  inputArg: string,
  strictA11y: boolean,
  strictIcons: boolean,
  scope: CheckScope,
): Promise<void> {
  const inputPath = resolve(process.cwd(), inputArg);
  const store = load(inputPath);
  // When --strict-icons is on, resolve @kumikijs/icons up front so its closed
  // name set extends the per-source `theme.icons` domain (#127). When the
  // package isn't installed, fall through with an empty list — `theme.icons`
  // alone then defines the domain, matching standalone apps.
  let iconNames: string[] = [];
  if (strictIcons) {
    const registry = await resolveBuiltinIcons(inputPath);
    if (registry) iconNames = Object.keys(registry);
  }
  const all = check(store.program, {
    strictA11y,
    strictIcons,
    iconNames,
    capabilities: capsFor(inputPath),
  });
  const errors = filterByScope(all, scope);
  if (errors.length === 0) {
    console.log("ok");
    return;
  }
  for (const err of errors) {
    console.error(`${err.code} ${err.kind} at ${err.pos.line}:${err.pos.col}: ${err.message}`);
  }
  process.exit(1);
}

function viewModeFrom(argv: string[]): ViewMode {
  if (argv.includes("--history")) return "history";
  if (argv.includes("--hash")) return "hash";
  if (argv.includes("--with-deps")) return "with-deps";
  return "text";
}

function checkScopeFrom(argv: string[]): CheckScope {
  if (argv.includes("--types")) return "types";
  if (argv.includes("--refs")) return "refs";
  if (argv.includes("--effects")) return "effects";
  return "all";
}

async function main(argv: string[]): Promise<void> {
  const cmd = argv[2];
  if (!cmd) usage();
  switch (cmd) {
    case "build": {
      const input = argv[3];
      const out = argv[4];
      if (!input || !out) usage();
      await buildCmd(input, out);
      return;
    }
    case "list": {
      const input = argv[3];
      if (!input) usage();
      listCmd(input, argv[4]);
      return;
    }
    case "view": {
      const input = argv[3];
      const qname = argv[4];
      if (!input || !qname) usage();
      viewCmd(input, qname, viewModeFrom(argv));
      return;
    }
    case "refs": {
      const input = argv[3];
      const qname = argv[4];
      if (!input || !qname) usage();
      refsCmd(input, qname);
      return;
    }
    case "check": {
      const input = argv[3];
      if (!input) usage();
      const strictA11y = argv.includes("--strict-a11y");
      const strictIcons = argv.includes("--strict-icons");
      await checkCmd(input, strictA11y, strictIcons, checkScopeFrom(argv));
      return;
    }
    case "smoke": {
      const input = argv[3];
      if (!input) usage();
      const inputPath = resolve(process.cwd(), input);
      await smokeCmd(inputPath, capsFor(inputPath));
      return;
    }
    case "dev": {
      const input = argv[3];
      if (!input) usage();
      const inputPath = resolve(process.cwd(), input);
      const portIdx = argv.indexOf("--port");
      let port: number | undefined;
      if (portIdx !== -1) {
        const raw = argv[portIdx + 1];
        const n = Number(raw);
        if (!raw || raw.startsWith("--") || !Number.isInteger(n) || n < 0 || n > 65535) {
          console.error(`invalid --port '${raw}': expected integer 0..65535`);
          process.exit(2);
        }
        port = n;
      }
      const epIdx = argv.indexOf("--episode-log");
      let episodeLog: string | undefined;
      if (epIdx !== -1) {
        const value = argv[epIdx + 1];
        if (!value || value.startsWith("--")) {
          console.error(
            "Usage: kumiki dev <input.kumiki> [--port <n>] [--episode-log <file>] [--strict-a11y]",
          );
          process.exit(2);
        }
        episodeLog = resolve(process.cwd(), value);
      }
      const strictA11y = argv.includes("--strict-a11y");
      await devCmd(inputPath, {
        ...(port !== undefined ? { port } : {}),
        ...(episodeLog !== undefined ? { episodeLog } : {}),
        ...(strictA11y ? { strictA11y: true } : {}),
      });
      return;
    }
    case "test": {
      const input = argv[3];
      if (!input) usage();
      const inputPath = resolve(process.cwd(), input);
      const filter = argv.find((a, i) => i > 3 && !a.startsWith("--"));
      await testCmd(inputPath, filter, capsFor(inputPath), {
        coverage: argv.includes("--coverage"),
        watch: argv.includes("--watch"),
      });
      return;
    }
    case "run": {
      const input = argv[3];
      const scenario = argv[4];
      if (!input || !scenario) usage();
      const inputPath = resolve(process.cwd(), input);
      const epIdx = argv.indexOf("--episode-log");
      let runOpts: { episodeLog?: string } = {};
      if (epIdx !== -1) {
        const value = argv[epIdx + 1];
        if (!value || value.startsWith("--")) {
          console.error("Usage: kumiki run <input.kumiki> <scenario.json> [--episode-log <file>]");
          process.exit(2);
        }
        runOpts = { episodeLog: resolve(process.cwd(), value) };
      }
      await runCmd(inputPath, resolve(process.cwd(), scenario), capsFor(inputPath), runOpts);
      return;
    }
    case "replay": {
      const input = argv[3];
      if (!input) usage();
      const inputPath = resolve(process.cwd(), input);

      // --from-log <path> is required in this implementation (#117). The
      // <episode-id>-only form against the in-memory dev-server store is out
      // of scope here.
      const fromLogIdx = argv.indexOf("--from-log");
      if (fromLogIdx === -1) {
        console.error(
          "Usage: kumiki replay <input.kumiki> --from-log <log.jsonl> [<episode-id>] [--mock '<eff>:<spec>']* [--until-step N]",
        );
        process.exit(2);
      }
      const fromLog = argv[fromLogIdx + 1];
      if (!fromLog || fromLog.startsWith("--")) usage();

      const untilIdx = argv.indexOf("--until-step");
      let untilStep: number | undefined;
      if (untilIdx !== -1) {
        const v = Number(argv[untilIdx + 1]);
        // Spec §10.5.3: step counter is 1-indexed (the Nth observed step).
        // `0` would carry no useful meaning — every step would satisfy
        // `n >= 0`, so the first step's emit triggers stop. Reject it loudly
        // instead of silently treating it like `--until-step 1`.
        if (!Number.isInteger(v) || v < 1) {
          console.error(
            `invalid --until-step '${argv[untilIdx + 1]}': expected positive integer (1-indexed)`,
          );
          process.exit(2);
        }
        untilStep = v;
      }

      const mocks: Record<string, EpisodeMockPolicy> = {};
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--mock") {
          const value = argv[i + 1];
          if (!value || value.startsWith("--")) {
            console.error("invalid --mock: missing value");
            process.exit(2);
          }
          try {
            const m = parseMockArg(value);
            mocks[m.effect] = m.policy;
          } catch (e) {
            console.error((e as Error).message);
            process.exit(2);
          }
        }
      }

      // Collect indexes of flag-value tokens so the positional <episode-id>
      // scan skips them. Without this, the value after `--mock` would be
      // mistaken for an episode id.
      const consumedIdxs = new Set<number>();
      for (let i = 4; i < argv.length; i++) {
        if (argv[i] === "--from-log" || argv[i] === "--mock" || argv[i] === "--until-step") {
          consumedIdxs.add(i);
          consumedIdxs.add(i + 1);
        }
      }
      const positional = argv.filter(
        (a, i) => i > 3 && !consumedIdxs.has(i) && !a.startsWith("--"),
      );
      if (positional.length > 1) {
        // §10.5.3 only accepts one `<episode-id>` positional. Silently ignoring
        // the extras would mask `kumiki replay <file> ep_0001 ep_0002` typos.
        console.error(
          `kumiki replay: unexpected positional arguments after <episode-id>: ${positional.slice(1).join(", ")}`,
        );
        process.exit(2);
      }
      const episodeId = positional[0];

      await replayCmd(inputPath, capsFor(inputPath), {
        fromLog: resolve(process.cwd(), fromLog),
        ...(episodeId !== undefined ? { episodeId } : {}),
        mocks,
        ...(untilStep !== undefined ? { untilStep } : {}),
      });
      return;
    }
    case "add": {
      // kumiki add <file> <layer> <name> <body>
      const [, , , file, layer, name, ...rest] = argv;
      if (!file || !layer || !name || rest.length === 0) {
        console.error("Usage: kumiki add <file> <layer> <name> <body>");
        process.exit(2);
      }
      const body = rest.join(" ");
      try {
        const opId = addDef(resolve(process.cwd(), file), layer, name, body);
        console.log(`added ${layer}.${name}  (${opId})`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
      return;
    }
    case "replace": {
      // kumiki replace <file> <qname> <body>
      const [, , , file, qname, ...rest] = argv;
      if (!file || !qname || rest.length === 0) {
        console.error("Usage: kumiki replace <file> <qname> <body>");
        process.exit(2);
      }
      const body = rest.join(" ");
      try {
        const opId = replaceDef(resolve(process.cwd(), file), qname, body);
        console.log(`replaced ${qname}  (${opId})`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
      return;
    }
    case "remove": {
      const [, , , file, qname] = argv;
      if (!file || !qname) {
        console.error("Usage: kumiki remove <file> <qname> [--cascade]");
        process.exit(2);
      }
      try {
        const opId = removeDef(resolve(process.cwd(), file), qname, argv.includes("--cascade"));
        console.log(`removed ${qname}  (${opId})`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
      return;
    }
    case "rename": {
      const [, , , file, qname, newName] = argv;
      if (!file || !qname || !newName) {
        console.error("Usage: kumiki rename <file> <qname> <new-name>");
        process.exit(2);
      }
      try {
        const opId = renameDef(resolve(process.cwd(), file), qname, newName);
        console.log(`renamed ${qname} -> ${newName}  (${opId})`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
      return;
    }
    case "edit": {
      const [, , , file, qname, patchJson] = argv;
      if (!file || !qname || !patchJson) {
        console.error("Usage: kumiki edit <file> <qname> <patch-json>");
        process.exit(2);
      }
      try {
        const patch = JSON.parse(patchJson) as unknown;
        const opId = editDef(resolve(process.cwd(), file), qname, patch);
        console.log(`edited ${qname}  (${opId})`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
      return;
    }
    case "patch": {
      const sub = argv[3];
      if (sub === "apply") {
        const [, , , , file, opsFile] = argv;
        if (!file || !opsFile) {
          console.error("Usage: kumiki patch apply <file> <ops.jsonl>");
          process.exit(2);
        }
        try {
          const ids = patchApplyFile(resolve(process.cwd(), file), resolve(process.cwd(), opsFile));
          console.log(`applied ${ids.length} ops: ${ids.join(", ")}`);
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
        return;
      }
      if (sub === "revert") {
        const [, , , , file, opId] = argv;
        if (!file || !opId) {
          console.error("Usage: kumiki patch revert <file> <op-id>");
          process.exit(2);
        }
        try {
          const newId = patchRevert(resolve(process.cwd(), file), opId);
          console.log(`reverted ${opId}  (${newId})`);
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
        return;
      }
      console.error("Usage: kumiki patch apply <file> <ops.jsonl>");
      console.error("       kumiki patch revert <file> <op-id>");
      process.exit(2);
      return;
    }
    case "lock": {
      const [, , , file, agentId, pattern] = argv;
      if (!file || !agentId || !pattern) {
        console.error("Usage: kumiki lock <file> <agent-id> <pattern>");
        process.exit(2);
      }
      try {
        lockDef(resolve(process.cwd(), file), agentId, pattern);
        console.log(`locked ${pattern} for ${agentId}`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
      return;
    }
    case "unlock": {
      const [, , , file, agentId] = argv;
      if (!file || !agentId) {
        console.error("Usage: kumiki unlock <file> <agent-id>");
        process.exit(2);
      }
      try {
        unlockDef(resolve(process.cwd(), file), agentId);
        console.log(`unlocked ${agentId}`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
      return;
    }
    case "fix": {
      const file = argv[3];
      if (!file) {
        console.error("Usage: kumiki fix <file> [--apply] [<code>]");
        console.error("       kumiki fix <file> --auto-patch <test-name> [--apply]");
        process.exit(2);
      }
      const apply = argv.includes("--apply");
      const autoIdx = argv.indexOf("--auto-patch");
      if (autoIdx !== -1) {
        const testName = argv[autoIdx + 1];
        if (!testName || testName.startsWith("--")) {
          console.error("Usage: kumiki fix <file> --auto-patch <test-name> [--apply]");
          process.exit(2);
        }
        const fixPath = resolve(process.cwd(), file);
        const outcome = await fixFromTest(fixPath, testName, apply, capsFor(fixPath));
        if (!outcome.ok) process.exitCode = 1;
        return;
      }
      const code = argv.find((a, i) => i > 3 && a !== "--apply");
      const plainPath = resolve(process.cwd(), file);
      fixCmd(plainPath, apply, code, capsFor(plainPath));
      return;
    }
    default:
      usage();
  }
}

/**
 * Read one prebuilt (minified) runtime feature module. The modules are plain
 * browser ESM whose cross-imports are relative (`./core.js`, `./stdlib.js`),
 * so copying them side by side under `<outdir>/runtime/` keeps them resolvable.
 * (The unminified `./bundle` monolith still serves the inlining path used by
 * smoke/run/test.)
 */
function readRuntimeModule(name: string): string {
  const modulePath = require.resolve(`@kumikijs/runtime/modules/${name}.js`);
  return readFileSync(modulePath, "utf8");
}

function buildHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kumiki App</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #fafafa; color: #1a1a1a; }
    button { padding: 6px 12px; font-size: 16px; cursor: pointer; }
    h1 { margin: 0 0 12px; }
  </style>
</head>
<body>
  <base href="/">
  <div id="root"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
`;
}

main(process.argv).catch((e) => {
  console.error(String(e));
  process.exit(1);
});
