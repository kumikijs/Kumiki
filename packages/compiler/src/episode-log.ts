export function parseEpisodeLogText(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("episode log: JSON root must be an array");
    return arr;
  }
  const out: unknown[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]?.trim() ?? "";
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch (e) {
      throw new Error(`episode log: invalid JSON at line ${i + 1}: ${(e as Error).message}`);
    }
  }
  return out;
}
