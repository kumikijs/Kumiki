import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { click, mountApp, waitUntil } from "./helpers/dom.ts";
import { type FetchDouble, stubFetch } from "./helpers/http-double.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("241-latest-per-key-record-key");

/** The URL's path as its body, a tick later — or an `AbortError` if the signal fires first. */
function answerATickLater(url: string, signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(new URL(url, "http://x/").pathname)), 0);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

let double: FetchDouble | undefined;

afterEach(() => {
  double?.restore();
  double = undefined;
});

/** Mount `app`, click `button`, wait for `settled` to be in the text, and report each request. */
async function clickAndSettle(
  app: AppShape,
  button: string,
  settled: string,
): Promise<{ urls: string[]; aborted: (boolean | undefined)[]; text: string }> {
  const fetches = stubFetch((call) => answerATickLater(call.url, call.init.signal));
  double = fetches;
  const { root, handle } = mountApp(app);
  try {
    click(root, button);
    await waitUntil(() => (root.textContent ?? "").includes(settled));
    return {
      urls: fetches.calls.map((c) => new URL(c.url, "http://x/").pathname),
      aborted: fetches.calls.map((c) => c.init.signal?.aborted),
      text: root.textContent ?? "",
    };
  } finally {
    handle.dispose();
    root.remove();
  }
}

describe("two record keys that are not `==` are two keys", () => {
  it("runs both requests to completion", async () => {
    // Page 2 is answered last, whether or not page 1 was aborted.
    const run = await clickAndSettle(await loadApp(EXAMPLE), "load pages 1 and 2", "/pages/2");
    expect(run.urls).toEqual(["/api/users/ada/pages/1", "/api/users/ada/pages/2"]);
    expect(run.aborted).toEqual([false, false]);
    expect(run.text).toContain("pages: /api/users/ada/pages/1, /api/users/ada/pages/2");
  });
});

/** `load` on `in=${input}`, keyed on its input, emitted with `first` and then `second` in one body. */
function twoEmits(input: string, first: string, second: string): string {
  return `slot done : List(Text) = []
effect load cap=http.get in=${input} out=Result(Text, HttpError)
            policy=latest-per-key($1)
            map-request={url: "/api/" + done.length.show, decode: Decoder.Text}
reducer go  on=ui.click(Go)        do= emit load(${first})
                                       emit load(${second})
reducer ok  on=load.ok($t, _)      do= done := done.push("ok")
reducer bad on=load.err($e, _)     do= done := done.push($e.message)
tile Go = button(text="Go")
tile App = column(Go, text("done: " + done.join(",") + "."))
app M caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]`;
}

describe("the second of two emits aborts the first exactly when their keys are `==`", () => {
  it.each([
    ["two records that differ", "{k: Text}", `{k: "x"}`, `{k: "y"}`, [false, false]],
    [
      "a List of one Text holding a comma, and of two",
      "List(Text)",
      `["a,b"]`,
      `["a", "b"]`,
      [false, false],
    ],
    ["two Options that differ", "Option(Text)", `Some("x")`, `Some("y")`, [false, false]],
    ["two variants that differ", "Option(Text)", `Some("x")`, "None", [false, false]],
    ["the same record twice", "{k: Text}", `{k: "x"}`, `{k: "x"}`, [true, false]],
    ["the same List twice", "List(Text)", `["a", "b"]`, `["a", "b"]`, [true, false]],
  ])("%s", { timeout: 30_000 }, async (_label, input, first, second, aborted) => {
    const app = await loadSource(twoEmits(input, first, second));
    const run = await clickAndSettle(app, "Go", ",");
    expect(run.urls).toHaveLength(2);
    expect(run.aborted).toEqual(aborted);
    expect(run.text).toContain(aborted[0] ? "done: aborted,ok." : "done: ok,ok.");
  });
});
