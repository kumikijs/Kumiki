import type { AppShape, CapabilityProvider } from "@kumikijs/runtime";
import { mountApp, waitUntil } from "./dom.ts";

/**
 * A program whose one effect fails at boot and whose `.err` stores `$e` as it is in `problem`. `mapRequest: null` declares none, so the invoke receives no request.
 */
export const failingAtBoot = (cap: string, mapRequest: string | null, clauses = ""): string => `
slot problem : Text = ""
effect run cap=${cap} in=Unit out=Result(Unit, Text)
    ${mapRequest === null ? "" : `map-request=${mapRequest}`} ${clauses}
reducer boot   on=app.start      do= emit run()
reducer failed on=run.err($e, _) do= problem := $e
tile App = column(text("problem: " + problem))
app ErrPayload
    caps   = [${cap}]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

/** Mount `app`, wait for its `problem: …` line to fill, and return the page text. */
export async function problemShown(
  app: AppShape,
  providers?: Record<string, CapabilityProvider>,
): Promise<string> {
  const { root, handle } = mountApp(app, providers ? { providers } : {});
  try {
    await waitUntil(() => /problem: \S/.test(root.textContent ?? ""));
    return root.textContent ?? "";
  } finally {
    handle.dispose();
    root.remove();
  }
}
