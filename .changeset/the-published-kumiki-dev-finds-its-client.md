---
"@kumikijs/cli": patch
---

The installed `kumiki dev` starts again (#459). The build copied the dev-server client and panel to `dist/dev/dev/`, while the built dev chunk reads them from `dist/dev/`, so every `kumiki dev <app>` from the published package failed with `ENOENT … dist/dev/client.ts` before listening. They now land in `dist/dev/`.
