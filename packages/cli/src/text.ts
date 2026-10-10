export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
