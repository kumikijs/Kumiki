import { existsSync, readFileSync } from "node:fs";
import { episodeLogPathFor } from "@kumikijs/cli";
import { z } from "zod";
import { requireSourceFile } from "../input.ts";
import { json, text } from "../wire.ts";
import type { RegisterTool } from "./registrar.ts";

type Episode = {
  id?: string;
  trigger?: { kind?: string; target?: string };
  status?: string;
  steps?: unknown[];
};

type EpisodeWarning = { kind: "malformed-jsonl"; message: string };

type EpisodeLog = { entries: Episode[]; warnings: EpisodeWarning[] };

/** A line that fails to parse is skipped and counted, so one bad write does not hide the rest. */
function parseEpisodeLog(raw: string): EpisodeLog {
  const entries: Episode[] = [];
  let skipped = 0;
  let firstMalformedLine: number | undefined;
  raw.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      entries.push(JSON.parse(line) as Episode);
    } catch {
      skipped++;
      firstMalformedLine ??= i + 1;
    }
  });
  if (firstMalformedLine === undefined) return { entries, warnings: [] };
  const message = `skipped ${skipped} malformed line(s); first at line ${firstMalformedLine}`;
  return { entries, warnings: [{ kind: "malformed-jsonl", message }] };
}

/** `undefined` when the source has no log yet. */
function readEpisodeLog(path: string): EpisodeLog | undefined {
  const logPath = episodeLogPathFor(requireSourceFile(path));
  if (!existsSync(logPath)) return undefined;
  return parseEpisodeLog(readFileSync(logPath, "utf8"));
}

const NO_LOG = "(no episode log)";
const EMPTY_LOG = "(empty episode log)";

/** The bare array, or `{ [key]: items, warnings }` when lines were skipped. */
function withWarnings(key: string, log: EpisodeLog, items: unknown[]): ReturnType<typeof text> {
  if (log.warnings.length === 0) return text(json(items));
  return text(json({ [key]: items, warnings: log.warnings }));
}

export function registerEpisodeTools(tool: RegisterTool): void {
  tool(
    "kumiki_episode",
    {
      title: "Fetch a runtime episode",
      description:
        "Read one episode (from `<file>.kumiki-episodes.jsonl`) by id. Episodes are written by `kumiki run --episode-log` and `kumiki dev --episode-log` and capture the per-trigger trace described in docs/spec/runtime.md. Prefer `kumiki_episode_list` / `kumiki_episode_tail` to discover ids first.",
      inputSchema: { path: z.string(), episodeId: z.string() },
    },
    async ({ path, episodeId }) => {
      const log = readEpisodeLog(path);
      if (!log) return text(NO_LOG);
      const hit = log.entries.find((e) => e.id === episodeId);
      if (hit) return text(json(hit));
      throw new Error(`no episode with id ${episodeId}`);
    },
  );

  tool(
    "kumiki_episode_list",
    {
      title: "List recent runtime episodes",
      description:
        "List the most recent episodes in `<file>.kumiki-episodes.jsonl` as compact summaries (`id`, `trigger.kind`, `trigger.target`, `status`, `steps`), newest first. Use this to discover ids for `kumiki_episode` / `kumiki_episode_tail`. When some JSONL lines fail to parse (e.g. runtime logger bug), the response is wrapped as `{ summaries, warnings: [...] }` so the caller sees the drop count.",
      inputSchema: {
        path: z.string(),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum entries to return, newest first. Default 20."),
      },
    },
    async ({ path, limit }) => {
      const log = readEpisodeLog(path);
      if (!log) return text(NO_LOG);
      if (log.entries.length === 0) return text(EMPTY_LOG);
      const summaries = log.entries
        .slice(-(limit ?? 20))
        .reverse()
        .map((ep) => ({
          id: ep.id,
          trigger: { kind: ep.trigger?.kind, target: ep.trigger?.target },
          status: ep.status,
          steps: Array.isArray(ep.steps) ? ep.steps.length : 0,
        }));
      return withWarnings("summaries", log, summaries);
    },
  );

  tool(
    "kumiki_episode_tail",
    {
      title: "Tail the most recent runtime episodes",
      description:
        "Return the most recent N episodes from `<file>.kumiki-episodes.jsonl` as full JSON entries, newest first. Use `kumiki_episode_list` first if you only need summaries. Malformed JSONL lines are surfaced in a `warnings` field when present.",
      inputSchema: {
        path: z.string(),
        n: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Number of episodes to return, newest first. Default 5."),
      },
    },
    async ({ path, n }) => {
      const log = readEpisodeLog(path);
      if (!log) return text(NO_LOG);
      if (log.entries.length === 0) return text(EMPTY_LOG);
      return withWarnings("episodes", log, log.entries.slice(-(n ?? 5)).reverse());
    },
  );
}
