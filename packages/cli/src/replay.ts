// `kumiki replay` — replay a recorded episode log against a compiled .kumiki
// app and print the per-step trace (spec/runtime.md §10.5.3). The runtime's
// `replayEpisodes` (testkit.ts) does the actual reducer/effect mechanics; this
// module is the CLI surface: argv parsing, log loading, formatter, exit codes.

import { readFileSync } from "node:fs";
import { parseEpisodeLogText } from "@kumikijs/compiler/node";
import {
  type EpisodeLogEntry,
  type EpisodeMockPolicy,
  type ReplayEvent,
  replayEpisodes,
} from "@kumikijs/runtime";
import { ensureDom, loadApp } from "./smoke.ts";

export type ReplayCmdOptions = {
  fromLog: string;
  /** Optional `<episode-id>` positional — filters the log to a single episode. */
  episodeId?: string;
  mocks: Record<string, EpisodeMockPolicy>;
  /** `--until-step N` — 1-indexed step counter, counted globally across episodes. */
  untilStep?: number;
};

/**
 * Parse one `--mock 'name: spec'` argument into a policy entry.
 *
 * Grammar:
 *   <effect-name> ':' ('from-log' | 'ignore' | 'ok(' <json>? ')' | 'err(' <json>? ')')
 *
 * `ok(...)` / `err(...)` values are parsed as JSON — spec §8.5's literal
 * mock values (`ok({id: "u1"})` etc.) are JSON-compatible when written with
 * double-quoted keys, which is the format CLI users naturally type.
 */
export function parseMockArg(arg: string): { effect: string; policy: EpisodeMockPolicy } {
  const sep = arg.indexOf(":");
  if (sep === -1) {
    throw new Error(`invalid --mock '${arg}': expected '<effect>: <spec>'`);
  }
  const name = arg.slice(0, sep).trim();
  const spec = arg.slice(sep + 1).trim();
  if (!/^[A-Za-z_][\w-]*$/.test(name)) {
    throw new Error(`invalid --mock '${arg}': '${name}' is not a valid effect name`);
  }
  if (spec === "from-log") return { effect: name, policy: { policy: "from-log" } };
  if (spec === "ignore") return { effect: name, policy: { policy: "ignore" } };
  const call = /^(ok|err)\((.*)\)$/.exec(spec);
  if (!call) {
    throw new Error(
      `invalid --mock '${arg}': expected from-log | ignore | ok(<json>) | err(<json>)`,
    );
  }
  const outcome = call[1] as "ok" | "err";
  const payload = call[2]?.trim() ?? "";
  let value: unknown = null;
  if (payload !== "") {
    try {
      value = JSON.parse(payload);
    } catch (e) {
      throw new Error(`invalid --mock '${arg}': value is not valid JSON — ${(e as Error).message}`);
    }
  }
  return { effect: name, policy: { policy: "fixed", outcome, value } };
}

function jsonOrNull(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatEvent(ev: ReplayEvent): string | null {
  switch (ev.kind) {
    case "episode-start": {
      const target = ev.trigger.target ? ` on ${ev.trigger.target}` : "";
      return `episode ${ev.episodeId} — ${ev.trigger.kind}${target}`;
    }
    case "reducer": {
      const diffs = ev.slotDiffs
        .map((d) => `${d.name}: ${jsonOrNull(d.before)} -> ${jsonOrNull(d.after)}`)
        .join(", ");
      return `  [reducer] ${ev.name}${diffs ? `  ${diffs}` : ""}`;
    }
    case "effect-start":
      return `  [effect-start] ${ev.name}(${jsonOrNull(ev.args)})`;
    case "effect-end": {
      if (ev.source === "ignored") {
        return `  [effect-end] ${ev.name} (ignored)`;
      }
      const tag = ev.source === "from-log" ? "" : ` (mock:${ev.source})`;
      return `  [effect-end] ${ev.name} ${ev.outcome} = ${jsonOrNull(ev.value)}${tag}`;
    }
    case "signal-update":
      return `  [signal-update] dirty=[${ev.dirty.join(",")}]`;
    case "panic":
      return `  [panic] ${ev.message}`;
    case "episode-end":
      return null;
  }
}

/**
 * CLI entry: load the .kumiki app, load the episode log, optionally filter to
 * one `<episode-id>`, replay through `replayEpisodes`, and stream the per-step
 * trace. Exits 1 if any panic / unhandled effect error surfaced during replay.
 */
export async function replayCmd(
  kumikiPath: string,
  capabilities: string[],
  opts: ReplayCmdOptions,
): Promise<void> {
  ensureDom();
  const source = readFileSync(kumikiPath, "utf8");
  const app = await loadApp(source, capabilities, { sourcePath: kumikiPath });

  const raw = readFileSync(opts.fromLog, "utf8");
  let parsed: EpisodeLogEntry[];
  try {
    parsed = parseEpisodeLogText(raw) as EpisodeLogEntry[];
  } catch (e) {
    console.error(`invalid episode log '${opts.fromLog}': ${(e as Error).message}`);
    process.exit(1);
  }

  let episodes = parsed;
  if (opts.episodeId !== undefined) {
    episodes = parsed.filter((ep) => ep.id === opts.episodeId);
    if (episodes.length === 0) {
      console.error(`episode ${opts.episodeId} not found in ${opts.fromLog}`);
      process.exit(1);
    }
  }

  // Stream each step as the executor emits it — keeps `--until-step` output
  // useful as a live trace and matches spec §10.5.3's "streams" wording.
  const report = replayEpisodes({
    app: { live: app.live, slots: app.slots, reducers: app.reducers },
    episodes,
    mocks: opts.mocks,
    ...(opts.untilStep !== undefined ? { untilStep: opts.untilStep } : {}),
    observer: (ev) => {
      const formatted = formatEvent(ev);
      if (formatted !== null) console.log(formatted);
      return "continue";
    },
  });

  console.log(`final slots: ${jsonOrNull(report.finalSlots)}`);
  if (report.stoppedAt !== null) {
    console.log(`(stopped at step ${report.stoppedAt})`);
  }
  console.log(`\n${episodes.length} episode(s) replayed`);
  if (report.panics.length > 0) {
    console.error(`panics: ${report.panics.map((p) => `${p.episodeId}: ${p.message}`).join("; ")}`);
  }
  if (report.unhandledErrors.length > 0) {
    const formatted = report.unhandledErrors.map((u) => `${u.episodeId}: ${u.effect}`).join(", ");
    console.error(`unhandled effect errors: ${formatted}`);
  }
  if (report.panics.length > 0 || report.unhandledErrors.length > 0) process.exit(1);
}
