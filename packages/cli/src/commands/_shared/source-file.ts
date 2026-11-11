import { requireSourceFile } from "../../store.ts";
import { messageOf } from "../../text.ts";

export function sourceFileArg(arg: string): string {
  try {
    return requireSourceFile(arg);
  } catch (e) {
    console.error(messageOf(e));
    process.exit(1);
  }
}
