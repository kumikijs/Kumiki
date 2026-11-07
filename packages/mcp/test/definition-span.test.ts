import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { feature } from "@kumikijs/examples";
import { beforeEach, describe, expect, it } from "vitest";
import { call, useWorkdir, withClient } from "./helpers/client.ts";

const EXAMPLE = feature("282-definition-token-span");
const ORIGINAL = readFileSync(EXAMPLE, "utf8");

const DOUBLE = "fn double(x: Int) -> Int = x * 2";
/** `fn double` and `slot step` on one line. */
const SHARED = `${DOUBLE}   slot step : Int = 2`;
/** A string over two lines, the second of which starts with `#`. */
const NOTES = 'slot notes : Text = "Counts up by two.\n## Doubled"';
const REDUCER = "reducer inc on=ui.click(IncBtn) do= count := count + step";

describe("the definition tools take a definition from its first token to its last", () => {
  const workdir = useWorkdir();
  let file: string;
  beforeEach(() => {
    file = join(workdir.path, "span.kumiki");
    copyFileSync(EXAMPLE, file);
  });

  it("kumiki_list and kumiki_view give each definition its own lines and text", async () => {
    const line = ORIGINAL.split("\n").indexOf(SHARED) + 1;

    const [list, double, notes] = await withClient((client) =>
      Promise.all([
        call(client, "kumiki_list", { path: file, layer: "fn" }),
        call(client, "kumiki_view", { path: file, name: "fn.double" }),
        call(client, "kumiki_view", { path: file, name: "slot.notes" }),
      ]),
    );

    expect(list).toEqual({ isError: false, body: `fn.double  (lines ${line}-${line})` });
    expect(double).toEqual({ isError: false, body: DOUBLE });
    expect(notes).toEqual({ isError: false, body: NOTES });
  });

  it.each([
    {
      tool: "kumiki_replace",
      args: { name: "slot.step", body: "Int = 3" },
      expected: ORIGINAL.replace(SHARED, `${DOUBLE}   slot step : Int = 3`),
    },
    {
      tool: "kumiki_edit",
      args: { name: "slot.step", patch: { find: "2", replace: "3" } },
      expected: ORIGINAL.replace(SHARED, `${DOUBLE}   slot step : Int = 3`),
    },
    {
      tool: "kumiki_remove",
      args: { name: "slot.step", cascade: true },
      expected: ORIGINAL.replace(SHARED, DOUBLE).replace(`${REDUCER}\n`, ""),
    },
    {
      tool: "kumiki_replace",
      args: { name: "slot.notes", body: 'Text = "Counts up."' },
      expected: ORIGINAL.replace(NOTES, 'slot notes : Text = "Counts up."'),
    },
  ])("$tool $args.name writes that definition and no other", async ({ tool, args, expected }) => {
    const res = await withClient((client) => call(client, tool, { path: file, ...args }));

    expect(res.isError, res.body).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(expected);
  });
});
