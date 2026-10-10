import { describe, expect, it } from "vitest";
import { CASCADE_HELP } from "../src/mutate.ts";
import { runCli, SPAWN } from "./helpers/cli.ts";

const VERBS = ["list", "view", "refs", "remove", "rename", "lock", "unlock", "patch"];

describe("verb registration", () => {
  it.each(VERBS)("%s answers --help with its own usage", SPAWN, (verb) => {
    const { out, code } = runCli([verb, "--help"]);
    expect(code).toBe(0);
    expect(out).toContain(`kumiki ${verb}`);
  });

  it.each(VERBS)("%s exits 2 with its usage when required arguments are missing", SPAWN, (verb) => {
    const { out, code } = runCli([verb]);
    expect(code).toBe(2);
    expect(out).toContain(`kumiki ${verb}`);
  });
});

describe("remove --help", () => {
  it("describes --cascade as taking the target's dependents", SPAWN, () => {
    const { out, code } = runCli(["remove", "--help"]);
    expect(code).toBe(0);
    const help = out.replace(/\s+/g, " ");
    expect(help).toContain(`--cascade ${CASCADE_HELP}`);
    expect(help).toContain("every definition that references it");
  });
});
