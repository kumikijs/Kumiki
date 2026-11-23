import { feature } from "@kumikijs/examples";
import { type AppShape, type CapabilityProvider, renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitUntil, withMounted } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = "305-err-reducer-panics-on-the-server";

/** `/note` answers 404 and anything else 503, so each init request fails into a reducer that panics. */
const failing: CapabilityProvider = async (request) => {
  const status = (request as { url: string }).url === "/note" ? 404 : 503;
  return { kind: "err", value: { status, message: `HTTP ${status}`, body: { _tag: "None" } } };
};

const providers = (): Record<string, CapabilityProvider> => ({ "http.get": failing });

/** What a pass reported: its console errors, and where each panic it reported was. */
type Reported = { errors: string[]; panickedIn: string[] };

const panicLines = (errors: string[]): string[] =>
  errors.flatMap((e) => /^\[kumiki\] (?:panic|error) in (.+?): /.exec(e)?.[1] ?? []);

const PASSES: Record<"mount" | "server", (app: AppShape, errors: string[]) => Promise<string[]>> = {
  mount: (app, errors) =>
    withMounted(
      app,
      async () => {
        // A mount that never reports both panics is left for the assertion to show.
        await waitUntil(() => panicLines(errors).length >= 2).catch(() => undefined);
        return panicLines(errors);
      },
      { providers: providers() },
    ),
  server: async (app) => {
    const { bootstrapEpisode } = await renderToString(app, { providers: providers() });
    return bootstrapEpisode.steps.flatMap((s) => (s.kind === "panic" ? (s.location ?? []) : []));
  },
};

async function reportedOn(pass: keyof typeof PASSES): Promise<Reported> {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  const panickedIn = await PASSES[pass](await loadApp(feature(EXAMPLE)), errors);
  return { errors, panickedIn };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an init error whose reducer panics", () => {
  it.each(
    Object.keys(PASSES) as (keyof typeof PASSES)[],
  )("is reported on the %s pass as that reducer's panic, not as an error with no .err reducer", async (pass) => {
    const { errors, panickedIn } = await reportedOn(pass);

    expect(errors.filter((e) => e.includes("no .err reducer"))).toEqual([]);
    expect([...panickedIn].sort()).toEqual(['reducer "noteFailed"', 'reducer "serverDown"']);
  });
});
