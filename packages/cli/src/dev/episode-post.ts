import type { Episode } from "@kumikijs/runtime";

/**
 * Sends each episode it is handed with `send`, one at a time: a send starts once the one before it
 * has settled, so the dev server appends the episodes in the order they were handed over rather
 * than the order their requests happen to arrive in. A failed send is dropped, and the episodes
 * after it are still sent: the log is best-effort in dev, and a failure must not break the page.
 */
export function postInOrder(send: (body: string) => Promise<unknown>): (ep: Episode) => void {
  let last: Promise<unknown> = Promise.resolve();
  return (ep) => {
    const body = JSON.stringify(ep);
    last = last.then(() => send(body)).catch(() => {});
  };
}
