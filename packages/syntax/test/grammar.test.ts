import { describe, expect, it } from "vitest";
import { kumikiGrammar } from "../src/index.ts";

type Rule = {
  include?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: Rule[];
  captures?: Record<string, unknown>;
  beginCaptures?: Record<string, unknown>;
  endCaptures?: Record<string, unknown>;
};

function walk(rules: Rule[], onRule: (r: Rule) => void): void {
  for (const r of rules) {
    onRule(r);
    if (r.patterns) walk(r.patterns, onRule);
  }
}

describe("kumiki TextMate grammar", () => {
  const grammar = kumikiGrammar as unknown as {
    name: string;
    scopeName: string;
    patterns: Rule[];
    repository: Record<string, { patterns?: Rule[] }>;
  };

  it("declares the expected language identity", () => {
    expect(grammar.name).toBe("kumiki");
    expect(grammar.scopeName).toBe("source.kumiki");
  });

  it("resolves every #include to a repository entry", () => {
    const repoKeys = new Set(Object.keys(grammar.repository));
    const includes: string[] = [];

    walk(grammar.patterns, (r) => {
      if (r.include) includes.push(r.include);
    });
    for (const entry of Object.values(grammar.repository)) {
      walk(entry.patterns ?? [], (r) => {
        if (r.include) includes.push(r.include);
      });
    }

    for (const inc of includes) {
      expect(inc.startsWith("#"), `include must be local: ${inc}`).toBe(true);
      expect(repoKeys.has(inc.slice(1)), `missing repository key for ${inc}`).toBe(true);
    }
    expect(includes.length).toBeGreaterThan(0);
  });

  it("has only compilable regular expressions", () => {
    const collect = (entry: { patterns?: Rule[] }): string[] => {
      const out: string[] = [];
      walk(entry.patterns ?? [], (r) => {
        for (const src of [r.match, r.begin, r.end]) if (src) out.push(src);
      });
      return out;
    };

    const patterns = [
      ...collect({ patterns: grammar.patterns }),
      ...Object.values(grammar.repository).flatMap(collect),
    ];

    for (const src of patterns) {
      expect(() => new RegExp(src), `invalid regex: ${src}`).not.toThrow();
    }
    expect(patterns.length).toBeGreaterThan(0);
  });
});
