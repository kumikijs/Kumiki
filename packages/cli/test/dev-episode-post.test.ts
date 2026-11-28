import type { Episode } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { postInOrder } from "../src/dev/episode-post.ts";

const episode = (id: string): Episode => ({
  id,
  trigger: { kind: "ui.click", ts: 1 },
  steps: [],
  status: "completed",
});

/** Lets every promise callback that is ready run. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A send that records the id of each episode it starts on and holds its answer for the test. */
function heldSend(): {
  send: (body: string) => Promise<void>;
  started: string[];
  answers: { ok: () => void; fail: () => void }[];
} {
  const started: string[] = [];
  const answers: { ok: () => void; fail: () => void }[] = [];
  const send = (body: string) =>
    new Promise<void>((resolve, reject) => {
      started.push((JSON.parse(body) as Episode).id);
      answers.push({ ok: resolve, fail: () => reject(new Error("offline")) });
    });
  return { send, started, answers };
}

describe("postInOrder", () => {
  it("starts each send once the one before it has settled, in the order it was handed them", async () => {
    const { send, started, answers } = heldSend();
    const post = postInOrder(send);
    post(episode("ep_a"));
    post(episode("ep_b"));
    await settled();
    expect(started).toEqual(["ep_a"]);

    answers[0]?.ok();
    await settled();
    expect(started).toEqual(["ep_a", "ep_b"]);
  });

  it("still sends the episodes after one whose send failed", async () => {
    const { send, started, answers } = heldSend();
    const post = postInOrder(send);
    post(episode("ep_a"));
    post(episode("ep_b"));
    await settled();
    answers[0]?.fail();
    await settled();
    expect(started).toEqual(["ep_a", "ep_b"]);
  });
});
