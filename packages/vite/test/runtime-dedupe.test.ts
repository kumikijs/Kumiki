import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { type KumikiPluginOptions, kumiki } from "../src/index.ts";
import { buildInto, configOf, project, resolveIdOf, transformCode } from "./helpers/plugin.ts";
import { scratchRoot } from "./helpers/scratch.ts";

const COUNTER = app("01-counter");
const TMP = scratchRoot(import.meta.url);

/** A literal the runtime carries and nothing else does — one hit set per copy. */
const RUNTIME_MARK = "kumiki-state-styles";

/** `where` defaults to the workspace, where the project itself resolves `@kumikijs/runtime`. */
function buildProject(
  main: string,
  opts?: KumikiPluginOptions,
  where: string = TMP,
): Promise<string> {
  const root = project(where, readFileSync(COUNTER, "utf8"), main);
  return buildInto(root, join(root, "dist"), [kumiki(opts)]);
}

const marks = (code: string): number => code.split(RUNTIME_MARK).length - 1;

const MOUNTS_THE_APP = `
import App from "./app.kumiki";
import { mount } from "@kumikijs/runtime";
mount(App, document.body);
`;

describe("the built app carries one runtime", () => {
  // Three `vite build`s: the baseline, then the two modes measured against it.
  it("ships exactly the runtime the importer already imports", async () => {
    const baseline = marks(
      await buildProject(`import { mount } from "@kumikijs/runtime";\nconsole.log(mount);\n`),
    );
    expect(baseline).toBeGreaterThan(0);

    const dflt = marks(await buildProject(MOUNTS_THE_APP));
    expect(dflt).toBe(baseline);

    const bundled = marks(await buildProject(MOUNTS_THE_APP, { bundle: true }));
    expect(bundled).toBe(baseline * 2);
  }, 60_000);

  it("builds where the project cannot resolve the runtime at all", async () => {
    const out = await buildProject(
      MOUNTS_THE_APP,
      undefined,
      mkdtempSync(join(tmpdir(), "kumiki-")),
    );
    expect(out).toContain(RUNTIME_MARK);
  }, 60_000);

  it("compiles to a module that imports the runtime by default", async () => {
    const code = await transformCode(readFileSync(COUNTER, "utf8"), COUNTER);
    expect(code).toMatch(/from "@kumikijs\/runtime"/);
    expect(code).not.toContain(RUNTIME_MARK);
  });
});

describe("resolving the runtime", () => {
  /** The hook, plus a context whose `resolve` answers however the case needs. */
  function resolverWith(answer: unknown) {
    const fn = resolveIdOf();
    const calls: unknown[][] = [];
    const ctx = {
      resolve(...args: unknown[]) {
        calls.push(args);
        return Promise.resolve(answer);
      },
    };
    return {
      calls,
      run: (source: string) => fn.call(ctx as never, source, "/proj/src/main.ts", {} as never),
    };
  }

  it("says nothing when the project resolves the runtime itself", async () => {
    const { run, calls } = resolverWith({ id: "/proj/node_modules/@kumikijs/runtime/index.js" });
    await expect(run("@kumikijs/runtime")).resolves.toBeNull();
    expect(calls[0]?.[2]).toMatchObject({ skipSelf: true });
  });

  it("resolves the runtime from the plugin when the project cannot", async () => {
    const { run } = resolverWith(null);
    const id = (await run("@kumikijs/runtime")) as string;
    expect(typeof id).toBe("string");
    expect(id).not.toContain("\\");
    expect(readFileSync(id, "utf8").length).toBeGreaterThan(0);
  });

  it("leaves every other specifier alone", async () => {
    const { run, calls } = resolverWith(null);
    await expect(run("react")).resolves.toBeNull();
    await expect(run("@kumikijs/runtime/modules/core")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("asks the bundler to keep one copy of the runtime", () => {
    const partial = configOf().call({} as never, {}, { command: "build", mode: "production" }) as
      | { resolve?: { dedupe?: string[] } }
      | null
      | undefined;
    expect(partial?.resolve?.dedupe).toContain("@kumikijs/runtime");
  });
});
