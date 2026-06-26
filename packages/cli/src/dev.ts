// `kumiki dev` — programmatic Vite dev server with HMR-preserving app.live,
// runtime panic/error overlay, episode timeline panel, and slot/tile/effect
// inspector (spec §10.7). Composes the @kumikijs/vite transform with an
// internal plugin that serves a virtual entry HTML + client + panel and
// exposes a /__kumiki/episode middleware for `--episode-log` JSONL append.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { kumiki as kumikiVitePlugin } from "@kumikijs/vite";
import type { Plugin, ViteDevServer } from "vite";
import { createServer } from "vite";

const require = createRequire(import.meta.url);

export type DevCmdOptions = {
  /** TCP port to bind. Defaults to 5173 to match the spec example. `0` picks an ephemeral port. */
  port?: number;
  /** Absolute path to append every committed Episode to (one JSON per line, matching `kumiki run`). */
  episodeLog?: string;
  /** Promote a11y warnings (E07xx) to compile errors via @kumikijs/vite. */
  strictA11y?: boolean;
};

const VIRTUAL_CLIENT_ID = "/@kumiki-dev/client.ts";
const VIRTUAL_PANEL_ID = "/@kumiki-dev/panel.ts";
const EPISODE_ENDPOINT = "/__kumiki/episode";

/**
 * Programmatic entry — used by tests. Returns the running server plus the
 * resolved URL so the test can probe it without parsing stdout.
 */
export async function startDevServer(
  kumikiPath: string,
  _capabilities: string[],
  opts: DevCmdOptions = {},
): Promise<{ server: ViteDevServer; url: string }> {
  const targetAbs = resolvePath(process.cwd(), kumikiPath);
  // The .kumiki file's directory is Vite's root so the static `import App`
  // resolves through normal module resolution; node_modules above the file
  // is reachable because we widen `server.fs.allow` below.
  const root = dirname(targetAbs);
  const port = opts.port ?? 5173;

  const server = await createServer({
    root,
    appType: "custom",
    server: {
      port,
      strictPort: port !== 0,
      fs: {
        // The monorepo / project may import the runtime from a node_modules
        // several levels up. Allowing everything above the .kumiki file is
        // appropriate for a dev-only server.
        allow: [root, findMonorepoRoot(root)],
      },
    },
    plugins: [
      kumikiVitePlugin({
        bundle: false,
        ...(opts.strictA11y ? { strictA11y: true } : {}),
      }),
      kumikiDevPlugin({
        targetAbs,
        ...(opts.episodeLog !== undefined ? { episodeLog: opts.episodeLog } : {}),
      }),
    ],
    // Suppress Vite's own banner — devCmd prints its own.
    logLevel: "warn",
    optimizeDeps: { include: ["@kumikijs/runtime"] },
  });

  await server.listen();

  const address = server.httpServer?.address();
  const boundPort = address && typeof address === "object" ? address.port : (opts.port ?? port);
  const url = `http://localhost:${boundPort}/`;
  return { server, url };
}

/**
 * CLI verb entry. Starts the dev server, prints its URL, and stays alive until
 * SIGINT closes it. Capabilities are passed through to the kumiki plugin's
 * compile so `app caps=[…]` is enforced exactly like build / smoke / run.
 */
export async function devCmd(
  kumikiPath: string,
  capabilities: string[],
  opts: DevCmdOptions = {},
): Promise<void> {
  const { server, url } = await startDevServer(kumikiPath, capabilities, opts);
  console.log(`kumiki dev — ${url}`);
  if (opts.episodeLog) console.log(`  recording episodes to ${opts.episodeLog}`);
  if (opts.strictA11y) console.log("  strict a11y on");

  await new Promise<void>((resolveDone) => {
    const stop = async () => {
      try {
        await server.close();
      } finally {
        resolveDone();
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

// --- internal Vite plugin ----------------------------------------------------

type InternalOptions = {
  targetAbs: string;
  episodeLog?: string;
};

function kumikiDevPlugin(opts: InternalOptions): Plugin {
  const devSrcDir = dirname(fileURLToPath(import.meta.url));
  // tsdown copies src/dev/ → dist/dev/, so this relative path works under both
  // tsx-from-src and the published build (see tsdown.config.ts).
  const clientTemplate = readFileSync(join(devSrcDir, "dev", "client.ts"), "utf8");
  const panelSource = readFileSync(join(devSrcDir, "dev", "panel.ts"), "utf8");

  // Pre-resolve @kumikijs/runtime from the CLI's perspective. Virtual modules
  // (the dev client/panel) have no real filesystem location, so Vite can't
  // walk node_modules upward from them; we hand it the absolute path instead.
  const runtimeAbs = require.resolve("@kumikijs/runtime");

  // The client.ts source has a `__KUMIKI_TARGET__` placeholder for the static
  // `import App from ...` line. Substitute the absolute target path up front;
  // it never changes for the lifetime of the server.
  // Forward slashes for Vite's URL parser, even on Windows.
  const targetUrl = opts.targetAbs.replace(/\\/g, "/");
  const clientSource = clientTemplate.replaceAll("__KUMIKI_TARGET__", targetUrl);

  return {
    name: "kumiki-dev-internal",
    enforce: "post",

    configureServer(server) {
      // 1. Middleware that captures /__kumiki/episode POSTs and appends JSONL
      //    when --episode-log is configured. Registered first so Vite's static
      //    layer doesn't try to serve "episode" as a path.
      server.middlewares.use(EPISODE_ENDPOINT, (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          if (opts.episodeLog) {
            const body = Buffer.concat(chunks).toString("utf8").trim();
            if (body.length > 0) {
              try {
                appendFileSync(opts.episodeLog, `${body}\n`);
              } catch (e) {
                server.config.logger.warn(
                  `[kumiki dev] failed to append episode log: ${(e as Error).message}`,
                );
              }
            }
          }
          res.statusCode = 204;
          res.end();
        });
      });

      // 2. Index.html responder — runs LAST (the returned post-hook), so a
      //    real index.html on disk and all virtual modules win over it.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== "GET") return next();
          const url = req.url ?? "/";
          if (url !== "/" && url !== "/index.html") return next();
          try {
            const html = await server.transformIndexHtml(url, INDEX_HTML, req.originalUrl ?? url);
            res.setHeader("Content-Type", "text/html");
            res.statusCode = 200;
            res.end(html);
          } catch (e) {
            next(e as Error);
          }
        });
      };
    },

    resolveId(id, importer) {
      if (id === VIRTUAL_CLIENT_ID || id === VIRTUAL_PANEL_ID) return id;
      // The virtual client/panel import @kumikijs/runtime as a bare specifier.
      // Vite resolves bare imports relative to the importer's directory, and
      // virtuals have none — so hand it the pre-resolved absolute path.
      if (
        id === "@kumikijs/runtime" &&
        (importer === VIRTUAL_CLIENT_ID || importer === VIRTUAL_PANEL_ID)
      ) {
        return runtimeAbs;
      }
      return null;
    },

    load(id) {
      if (id === VIRTUAL_CLIENT_ID) return clientSource;
      if (id === VIRTUAL_PANEL_ID) return panelSource;
      return null;
    },

    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module", src: VIRTUAL_CLIENT_ID },
          injectTo: "body",
        },
      ];
    },
  };
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>kumiki dev</title>
  </head>
  <body>
    <div id="app"></div>
    <div id="kumiki-dev-panel"></div>
  </body>
</html>
`;

// Walk parents until we find a pnpm-workspace.yaml / .git marker so node_modules
// a few levels up is reachable under server.fs.allow. Falls back to the start
// directory after a bounded number of steps to avoid an unbounded climb.
function findMonorepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
  return start;
}
