import { requireSourceFile } from "../../store.ts";

/**
 * The absolute path of the `.kumiki` file a verb was given. When there is no
 * file at it, the verb prints the message naming the path and exits `1`
 * (§9.2.5): whether a file is there is learned by looking, so it is the
 * operation that failed, not the arguments' shape. Every verb that takes a
 * source file calls this once its arguments are known to have the right
 * shape, and before it reads or writes anything else.
 */
export function sourceFileArg(arg: string): string {
  try {
    return requireSourceFile(arg);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
