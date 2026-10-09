export async function withRoot<T>(run: (root: HTMLElement) => Promise<T>): Promise<T> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    return await run(root);
  } finally {
    root.remove();
  }
}
