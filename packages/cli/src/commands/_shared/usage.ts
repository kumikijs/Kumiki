export function requireValue(usage: string): (raw: string) => string {
  return (raw) => {
    if (raw.startsWith("--")) {
      console.error(usage);
      process.exit(2);
    }
    return raw;
  };
}
