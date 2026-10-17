import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { kumiki as kumikiVitePlugin } from "@kumikijs/vite";
import type { Plugin, ViteDevServer } from "vite";
import { createServer } from "vite";
import { messageOf } from "./text.ts";

export type DevCmdOptions = {
  /** TCP port to bind; defaults to Vite's 5173. `0` picks an ephemeral port. */
  port?: number;
  /** Absolute path to append every committed Episode to (one JSON per line, matching `kumiki run`). */
  episodeLog?: string;
  /** Promote a11y warnings (E07xx) to compile errors via @kumikijs/vite. */
  strictA11y?: boolean;
};

const VIRTUAL_CLIENT_ID = "/@kumiki-dev/client.ts";
const VIRTUAL_PANEL_ID = "/@kumiki-dev/panel.ts";
const EPISODE_ENDPOINT = "/__kumiki/episode";

export async function startDevServer(
  kumikiPath: string,
  opts: DevCmdOptions = {},
): Promise<{ server: ViteDevServer; url: string }> {
  const targetAbs = resolvePath(process.cwd(), kumikiPath);
  const root = dirname(targetAbs);
  const port = opts.port ?? 5173;

  const server = await createServer({
    root,
    appType: "custom",
    server: {
      port,
      strictPort: port !== 0,
      fs: {
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
  });

  await server.listen();

  const address = server.httpServer?.address();
  const boundPort = address && typeof address === "object" ? address.port : port;
  const url = `http://localhost:${boundPort}/`;
  return { server, url };
}

export async function devCmd(kumikiPath: string, opts: DevCmdOptions = {}): Promise<void> {
  const { server, url } = await startDevServer(kumikiPath, opts);
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

type InternalOptions = {
  targetAbs: string;
  episodeLog?: string;
};

function kumikiDevPlugin(opts: InternalOptions): Plugin {
  const devSrcDir = dirname(fileURLToPath(import.meta.url));
  const clientTemplate = readFileSync(join(devSrcDir, "dev", "client.ts"), "utf8");
  const panelSource = readFileSync(join(devSrcDir, "dev", "panel.ts"), "utf8");

  const targetUrl = opts.targetAbs.replace(/\\/g, "/");
  const clientSource = clientTemplate.replaceAll("__KUMIKI_TARGET__", targetUrl);

  return {
    name: "kumiki-dev-internal",
    enforce: "post",

    configureServer(server) {
      server.middlewares.use(EPISODE_ENDPOINT, (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        const fail = (status: number, message: string) => {
          server.config.logger.error(`[kumiki dev] ${message}`);
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        };
        req.on("error", (e) => fail(400, `request stream error: ${e.message}`));
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8").trim();
          if (body.length === 0) {
            res.statusCode = 204;
            res.end();
            return;
          }
          try {
            JSON.parse(body);
          } catch (e) {
            fail(400, `invalid episode JSON: ${messageOf(e)}`);
            return;
          }
          if (opts.episodeLog) {
            try {
              appendFileSync(opts.episodeLog, `${body}\n`);
            } catch (e) {
              fail(500, `failed to append episode log: ${messageOf(e)}`);
              return;
            }
          }
          res.statusCode = 204;
          res.end();
        });
      });

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

    // The client's bare `@kumikijs/runtime` import is not answered here: a
    // virtual importer has no directory, so Vite resolves it from the root,
    // and @kumikijs/vite answers it exactly as it answers the compiled app's.
    resolveId(id) {
      if (id === VIRTUAL_CLIENT_ID || id === VIRTUAL_PANEL_ID) return id;
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
