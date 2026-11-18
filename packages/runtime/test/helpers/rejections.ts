import { onTestFinished } from "vitest";
import { defined } from "./defined.ts";

// The process the tests run in, which the runtime's own types leave out: the runtime targets a
// browser.
type HostProcess = {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};

/** Every promise rejection that nothing handles while the test runs. */
export function unhandledRejections(): unknown[] {
  const host = defined((globalThis as { process?: HostProcess }).process, "the test's process");
  const seen: unknown[] = [];
  const note = (reason: unknown): void => {
    seen.push(reason);
  };
  host.on("unhandledRejection", note);
  onTestFinished(() => {
    host.off("unhandledRejection", note);
  });
  return seen;
}
