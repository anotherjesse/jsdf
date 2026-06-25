import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer as createViteServer } from "vite";

const staticHtmlPages = new Set([
  "api-check.html",
  "app-health-check.html",
  "checks.html",
  "editor-check.html",
  "examples-visual-check.html",
  "graph-check.html",
  "index.html",
  "mesh-check.html",
  "preview-check.html",
  "raymarch-hello.html",
]);
const viteFsDeny = [".env", ".env.*", "*.{crt,pem}", "**/.git/**", ".sessions", "**/.sessions/**"];

export async function createStaticAppServer({ repoRoot, httpServer }) {
  const staticRoot = resolve(repoRoot, "static");
  const sourceRoot = resolve(repoRoot, "src");
  const vite = await createViteServer({
    root: staticRoot,
    appType: "custom",
    resolve: {
      alias: {
        "/src": sourceRoot,
      },
    },
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
      fs: {
        allow: [repoRoot],
        deny: viteFsDeny,
      },
    },
  });

  return {
    isPrivatePath: isPrivateStaticPath,
    isStaticHtmlPage,
    runMiddleware: (req, res) => runViteMiddleware(vite, req, res),
    serveIndex: (req, res, pathname) => serveIndex(vite, staticRoot, req, res, pathname),
    serveStaticHtml: (req, res, pathname) => serveStaticHtml(vite, staticRoot, req, res, pathname),
  };
}

function isPrivateStaticPath(pathname) {
  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  return decodedPathname === "/.sessions" || decodedPathname.startsWith("/.sessions/");
}

function isStaticHtmlPage(pathname) {
  const page = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return staticHtmlPages.has(page);
}

async function serveIndex(vite, staticRoot, req, res, pathname) {
  let template = await readFile(join(staticRoot, "index.html"), "utf8");
  if (pathname.startsWith("/s/")) {
    template = template.replace("<head>", "<head>\n    <base href=\"/\">");
  }
  const html = await vite.transformIndexHtml(pathname, template);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(req.method === "HEAD" ? "" : html);
}

async function serveStaticHtml(vite, staticRoot, req, res, pathname) {
  const page = pathname.slice(1);
  const template = await readFile(join(staticRoot, page), "utf8");
  const html = await vite.transformIndexHtml(pathname, template);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(req.method === "HEAD" ? "" : html);
}

function runViteMiddleware(vite, req, res) {
  return new Promise((resolveMiddleware, rejectMiddleware) => {
    vite.middlewares(req, res, (error) => {
      if (error) {
        rejectMiddleware(error);
        return;
      }
      if (!res.headersSent) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
      }
      resolveMiddleware();
    });
  });
}
