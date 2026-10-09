import { readFileSync } from "node:fs";
import { parseEpisodeLogText } from "@kumikijs/compiler/node";
import {
  type EnvDrift,
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

function formatEnvDrift(env: EnvDrift): string {
  const parts: string[] = [];
  if (env.live > 0) parts.push(`${env.live} read live`);
  if (env.unused > 0) parts.push(`${env.unused} recorded unused`);
  if (env.malformed > 0) parts.push(`${env.malformed} malformed`);
  return parts.join(", ");
}

function jsonOrNull(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatStackForReplay(stack: string, message: string, indent: string): string[] {
  const raw = stack.split("\n");
  const trimmed =
    raw.length > 0 && raw[0] !== undefined && raw[0].includes(message) ? raw.slice(1) : raw;
  const out: string[] = [];
  for (const line of trimmed) {
    const l = line.replace(/\s+$/, "");
    if (l.length === 0) continue;
    out.push(`${indent}${l.trim()}`);
  }
  return out;
}

export function formatEvent(ev: ReplayEvent): string | null {
  switch (ev.kind) {
    case "episode-start": {
      const target = ev.trigger.target ? ` on ${ev.trigger.target}` : "";
      const missing = ev.entryResultMissing
        ? `  (no recorded result for ${ev.entryResultMissing})`
        : "";
      return `episode ${ev.episodeId} — ${ev.trigger.kind}${target}${missing}`;
    }
    case "reducer": {
      const diffs = ev.slotDiffs
        .map((d) => `${d.name}: ${jsonOrNull(d.before)} -> ${jsonOrNull(d.after)}`)
        .join(", ");
      const env = ev.env ? `  (env: ${formatEnvDrift(ev.env)})` : "";
      return `  [reducer] ${ev.name}${diffs ? `  ${diffs}` : ""}${env}`;
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
    case "panic": {
      const cat = ev.category ? `:${ev.category}` : "";
      const loc = ev.location ? `  ${ev.location}` : "";
      const lines: string[] = [`  [panic${cat}] ${ev.message}${loc}`];
      if (ev.stack !== undefined) {
        for (const line of formatStackForReplay(ev.stack, ev.message, "    ")) lines.push(line);
      }
      if (ev.cause !== undefined) {
        for (const link of ev.cause) {
          lines.push(`    Caused by: ${link.message}`);
          if (link.stack !== undefined) {
            for (const line of formatStackForReplay(link.stack, link.message, "      ")) {
              lines.push(line);
            }
          }
        }
      }
      return lines.join("\n");
    }
    case "episode-end":
      return null;
  }
}

export async function replayCmd(
  kumikiPath: string,
  capabilities: string[],
  opts: ReplayCmdOptions,
): Promise<void> {
  await ensureDom();
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

  const report = replayEpisodes({
    app: { live: app.live, slots: app.slots, reducers: app.reducers, effects: app.effects },
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
  const drift = report.envDrift;
  if (drift.live > 0 || drift.unused > 0 || drift.malformed > 0) {
    console.log(`environment reads: ${formatEnvDrift(drift)}`);
  }
  if (report.entryResultsMissing.length > 0) {
    const formatted = report.entryResultsMissing
      .map((m) => `${m.episodeId}: ${m.reducer}`)
      .join(", ");
    console.log(`entry results missing: ${formatted}`);
  }
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
