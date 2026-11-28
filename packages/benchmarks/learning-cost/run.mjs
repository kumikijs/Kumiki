// Run one vendor's coding agent on one task, in a fresh workspace that holds only what the track
// allows, and record the program it wrote:
//
//   node learning-cost/run.mjs <task-dir> <Claude|Codex|Gemini> <spec|toolchain>
//
// - spec: task-spec.md and the spec documents only. There is no compiler, so the program is
//   written in one pass.
// - toolchain: the same, plus the Kumiki CLI installed from the tarballs in $KUMIKI_TARBALLS, which
//   the agent may run as often as it likes: check, build, smoke, run, test and guide.
//
// A task with a base.kumiki is a change request: the workspace's app.kumiki starts as that file.
// The result goes to vN-*/results/<Vendor>[-toolchain]/: output.kumiki, and run.json with what
// the agent ran and how long it took. The transcript stays in the workspace, which is printed.
// Gemini reads its key from GEMINI_API_KEY in the environment.

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, "..", "..", "..", "docs", "spec");

const [taskArg, vendor, track] = process.argv.slice(2);
const VENDORS = ["Claude", "Codex", "Gemini"];
const TRACKS = ["spec", "toolchain"];
if (!taskArg || !VENDORS.includes(vendor) || !TRACKS.includes(track)) {
  console.error("Usage: node run.mjs <task-dir> <Claude|Codex|Gemini> <spec|toolchain>");
  process.exit(2);
}
const task = join(here, basename(taskArg));
const base = join(task, "base.kumiki");
const changes = existsSync(base);
const toolchain = track === "toolchain";
const label = toolchain ? `${vendor}-toolchain` : vendor;

// The toolchain track gets more time: it is expected to compile, run and fix.
const TIMEOUT_MS = (toolchain ? 30 : 45) * 60_000;

const MODELS = {
  Claude: "opus",
  Codex: "gpt-6.1-terra",
  Gemini: "gemini-4-neon-high",
};

const ws = mkdtempSync(join(tmpdir(), `kumiki-lc-${basename(task)}-${label}-`));
mkdirSync(join(ws, "spec"));
for (const f of readdirSync(specDir).filter((f) => f.endsWith(".md"))) {
  copyFileSync(join(specDir, f), join(ws, "spec", f));
}
copyFileSync(join(task, "task-spec.md"), join(ws, "task-spec.md"));
const app = join(ws, "app.kumiki");
if (changes) copyFileSync(base, app);

const env = { ...process.env };
if (toolchain) {
  const tarballs = process.env.KUMIKI_TARBALLS;
  if (!tarballs) {
    console.error(
      "The toolchain track installs the CLI from $KUMIKI_TARBALLS, a directory of .tgz",
    );
    process.exit(2);
  }
  writeFileSync(join(ws, "package.json"), '{ "name": "workspace", "private": true }\n');
  const packs = readdirSync(tarballs)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => join(tarballs, f));
  const npm = spawnSync("npm", ["install", "--no-audit", "--no-fund", ...packs], {
    cwd: ws,
    shell: true,
    stdio: "inherit",
  });
  if (npm.status !== 0) process.exit(1);
  // npx keeps its cache in the workspace, which every vendor's sandbox lets it write.
  env.npm_config_cache = join(ws, ".npm-cache");
}

const prompt = [
  "You are taking part in an experiment that measures how well an LLM writes code in Kumiki, a new DSL for web apps, from its documentation. Kumiki is not in your training data.",
  "",
  `Your workspace is ${ws}. Work only inside it. It holds:`,
  "- task-spec.md: the task. Read it first.",
  "- spec/: the Kumiki specification. language.md and stdlib.md are the core; read the others the task needs.",
  ...(changes ? ["- app.kumiki: the program the task asks you to change."] : []),
  ...(toolchain
    ? [
        "- node_modules/: the Kumiki CLI, which you run as `npx kumiki <command>` from the workspace.",
      ]
    : []),
  "",
  "Rules:",
  ...(toolchain
    ? [
        "- Use the CLI as often as you like: `npx kumiki guide` lists its guides (start with `npx kumiki guide author`), and `check`, `build`, `smoke`, `run` and `test` tell you whether what you wrote works. You may write your own scenario files.",
        "- Run no other commands, except to read files in the workspace.",
        "- You have 30 minutes.",
      ]
    : [
        "- There is no Kumiki compiler here. Write the program from the documentation in one pass, then stop.",
        "- Run no commands, except to read files in the workspace.",
      ]),
  "- Do not use TypeScript or JSX syntax.",
  "",
  changes
    ? `Edit ${app} in place. It must stay pure Kumiki: no markdown fences, XML tags or commentary outside Kumiki comments.`
    : `Write the program to ${app}: pure Kumiki, with no markdown fences, XML tags or commentary outside Kumiki comments.`,
  "",
  'When you are done, reply with one line of JSON: {"self_confidence": "high|med|low", "notable_uncertainties": ["..."]}',
].join("\n");
writeFileSync(join(ws, "prompt.txt"), prompt);

const readTools = "Read,Write,Edit,Glob,Grep";
// Commands that only read or list files, which the rules leave every agent free to run.
const READ_COMMANDS = ["Get-ChildItem", "Get-Content", "Select-String", "ls", "dir", "cat", "type"];
const invocations = {
  Claude: {
    cmd: "claude",
    args: [
      "-p",
      "--model",
      MODELS.Claude,
      "--effort",
      "high",
      "--tools",
      toolchain ? `${readTools},Bash` : readTools,
      "--allowedTools",
      toolchain ? `${readTools},Bash(npx kumiki:*)` : readTools,
      "--permission-mode",
      "acceptEdits",
      // The user's MCP servers (documentation search among them) are not part of the workspace.
      "--strict-mcp-config",
      "--output-format",
      "stream-json",
      "--verbose",
    ],
    stdin: prompt,
  },
  Codex: {
    cmd: "codex",
    args: [
      "exec",
      "-m",
      MODELS.Codex,
      "-s",
      "workspace-write",
      "-c",
      'model_reasoning_effort="high"',
      "--skip-git-repo-check",
      "-C",
      ws,
      "--json",
      "-",
    ],
    stdin: prompt,
  },
  Gemini: {
    cmd: "agy",
    args: [
      "--model",
      MODELS.Gemini,
      "--sandbox",
      "--mode",
      "accept-edits",
      "--add-dir",
      ws,
      // Headless agy ends the session at the first command it denies, where the others go on
      // without it, so the commands the rules allow anyway are allowed here.
      "--settings",
      JSON.stringify({
        permissions: {
          allow: [
            `command(regex:^(${READ_COMMANDS.join("|")})\\b.*)`,
            ...(toolchain ? ["command(regex:^npx kumiki\\b.*)"] : []),
          ],
        },
      }),
      "--output-format",
      "stream-json",
      "--print",
      prompt,
    ],
    stdin: null,
  },
};

const { cmd, args, stdin } = invocations[vendor];
const started = Date.now();
console.log(`workspace: ${ws}`);
const child = spawn(cmd, args, { cwd: ws, env, stdio: ["pipe", "pipe", "pipe"] });
let transcript = "";
child.stdout.on("data", (d) => {
  transcript += d;
});
child.stderr.on("data", (d) => process.stderr.write(d));
if (stdin !== null) child.stdin.end(stdin);
else child.stdin.end();
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  // The agent runs a tree of processes; take the whole tree down.
  spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
}, TIMEOUT_MS);
const exitCode = await new Promise((done) => child.on("close", done));
clearTimeout(timer);
const durationMs = Date.now() - started;
writeFileSync(join(ws, "transcript.jsonl"), transcript);

/** Every shell command the agent ran, read from its transcript. */
function commandsRun(vendor, lines) {
  const events = lines.flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  if (vendor === "Claude") {
    return events
      .filter((e) => e.type === "assistant")
      .flatMap((e) => e.message?.content ?? [])
      .filter((c) => c.type === "tool_use" && c.name === "Bash")
      .map((c) => c.input.command);
  }
  if (vendor === "Codex") {
    return events
      .filter((e) => e.type === "item.completed" && e.item?.type === "command_execution")
      .map((e) => e.item.command);
  }
  // agy reports each tool step as it starts and again as it ends.
  return events
    .map((e) => e.step_update)
    .filter((s) => s?.tool_name === "run_command" && s.state !== "ACTIVE")
    .map((s) => s.tool_info.parameters.CommandLine);
}

const commands = commandsRun(vendor, transcript.split("\n"));
const kumikiCalls = {};
for (const c of commands) {
  const verb = /\bkumiki\s+([a-z]+)/.exec(c)?.[1];
  if (verb) kumikiCalls[verb] = (kumikiCalls[verb] ?? 0) + 1;
}

const out = join(task, "results", label);
mkdirSync(out, { recursive: true });
const wrote =
  existsSync(app) && (!changes || readFileSync(app, "utf8") !== readFileSync(base, "utf8"));
if (wrote) copyFileSync(app, join(out, "output.kumiki"));
const run = {
  vendor,
  model: MODELS[vendor],
  track,
  durationMs,
  timedOut,
  exitCode,
  wrote,
  kumikiCalls,
  commands: commands.length,
};
writeFileSync(join(out, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
console.log(JSON.stringify(run));
