import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const featuresDir = join(examplesDir, "features");
export const appsDir = join(examplesDir, "apps");

export const feature = (name: string): string => join(featuresDir, `${name}.kumiki`);

export const app = (name: string): string => join(appsDir, name, "app.kumiki");

export const featureFiles = (): string[] =>
  readdirSync(featuresDir)
    .filter((f) => f.endsWith(".kumiki"))
    .sort()
    .map((f) => join(featuresDir, f));

export const appFiles = (): string[] =>
  readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => app(d.name))
    .filter((f) => existsSync(f))
    .sort();

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
