export const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
