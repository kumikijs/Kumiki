import { describe, expect, it } from "vitest";
import { CASCADE_HELP } from "../src/mutate.ts";
import { runCli } from "./helpers/cli.ts";

const VERBS = ["list", "view", "refs", "remove", "rename", "lock", "unlock", "patch"];

describe("verb registration smoke", () => {
  for (const verb of VERBS) {
    it(`${verb} exposes --help (proves the verb is registered)`, { timeout: 60000 }, () => {
      const { out, code } = runCli([verb, "--help"]);
      expect(code).toBe(0);
      expect(out).toContain(`kumiki ${verb}`);
    });

    it(`${verb} exits 2 on missing required args (proves USAGE survived the refactor)`, {
      timeout: 60000,
    }, () => {
      const { out, code } = runCli([verb]);
      expect(code).toBe(2);
      // `patch` is a group command; its own bare help lands here.
      expect(out).toMatch(new RegExp(`kumiki ${verb}`));
    });
  }
});

describe("remove --help", () => {
  it("describes --cascade as taking the target's dependents", { timeout: 60000 }, () => {
    const { out, code } = runCli(["remove", "--help"]);
    expect(code).toBe(0);
    const help = out.replace(/\s+/g, " ");
    expect(help).toContain(`--cascade ${CASCADE_HELP}`);
    expect(help).toContain("every definition that references it");
  });
});
