import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const featuresDir = join(examplesDir, "features");
export const appsDir = join(examplesDir, "apps");

const appFile = (name: string): string => join(appsDir, name, "app.kumiki");

const featureNames = (): string[] =>
  readdirSync(featuresDir)
    .filter((f) => f.endsWith(".kumiki"))
    .map((f) => f.slice(0, -".kumiki".length))
    .sort();

const appNames = (): string[] =>
  readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

// A typo would otherwise hand a test a path to nothing, and a test expecting a failure
// would pass on the missing-file error instead of the reason it meant.
function existing(kind: string, path: string, name: string, known: () => string[]): string {
  if (existsSync(path)) return path;
  throw new Error(`no ${kind} example "${name}"; known: ${known().join(", ")}`);
}

export const feature = (name: string): string =>
  existing("feature", join(featuresDir, `${name}.kumiki`), name, featureNames);

export const app = (name: string): string => existing("app", appFile(name), name, appNames);

export const featureFiles = (): string[] =>
  featureNames().map((name) => join(featuresDir, `${name}.kumiki`));

// Throws on a directory without app.kumiki, so scenarios left behind by a renamed app fail
// instead of being skipped.
export const appFiles = (): string[] =>
  appNames().map((name) => {
    const file = appFile(name);
    if (!existsSync(file))
      throw new Error(`${exampleLabel(join(appsDir, name))} has no app.kumiki`);
    return file;
  });

export const allFiles = (): string[] => [...featureFiles(), ...appFiles()];

export type ScenarioCase = { kumiki: string; scenario: string; label: string };

const featureScenarios = (suffix: string): ScenarioCase[] =>
  readdirSync(featuresDir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => {
      const label = f.slice(0, -suffix.length);
      return { kumiki: feature(label), scenario: join(featuresDir, f), label };
    });

const appScenarios = (matches: (file: string) => boolean): ScenarioCase[] =>
  appFiles().flatMap((kumiki) => {
    const dir = dirname(kumiki);
    const name = basename(dir);
    return readdirSync(dir)
      .filter(matches)
      .sort()
      .map((f) => ({ kumiki, scenario: join(dir, f), label: `${name}/${f}` }));
  });

export const scenarioCases = (): ScenarioCase[] => [
  ...featureScenarios(".scenario.json"),
  ...appScenarios((f) => f === "scenario.json"),
];

export const browserScenarioCases = (): ScenarioCase[] => [
  ...featureScenarios(".browser.json"),
  ...appScenarios((f) => f.endsWith(".browser.json")),
];

export const exampleLabel = (file: string): string =>
  relative(examplesDir, file).replaceAll("\\", "/");
