import { requireSourceFile } from "../../store.ts";

export function sourceFileArg(arg: string): string {
  try {
    return requireSourceFile(arg);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
