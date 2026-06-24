import { createHash, randomInt } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sessionsRoot = resolve(repoRoot, ".sessions");
const sessionIdPattern = /^[1-9A-HJ-NP-Za-km-z]{10}$/;
const snapshotIdPattern = /^\d{6}$/;
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const commandTimeoutMs = 30000;
const bodyLimitBytes = 50 * 1024 * 1024;

const sessions = new Map();

await mkdir(sessionsRoot, { recursive: true });

const httpServer = createServer();
const vite = await createViteServer({
  root: __dirname,
  appType: "custom",
  server: {
    middlewareMode: true,
    hmr: { server: httpServer },
  },
});

httpServer.on("request", async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

const port = Number(process.env.PORT || "5173");
httpServer.listen(port, "127.0.0.1", () => {
  console.log(`sdf browser session server listening at http://127.0.0.1:${port}/`);
});

async function handleRequest(req, res) {
  const url = requestUrl(req);
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
    redirect(res, `/s/${generateSessionId()}`);
    return;
  }

  const route = parseSessionRoute(url.pathname);
  if (route) {
    await handleSessionRoute(req, res, url, route);
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && /^\/s\/[^/]+\/?$/.test(url.pathname)) {
    const sessionId = url.pathname.split("/")[2];
    validateSessionId(sessionId);
    ensureSession(sessionId);
    await serveIndex(req, res, url.pathname);
    return;
  }

  await runViteMiddleware(req, res);
}

async function handleSessionRoute(req, res, url, route) {
  const { sessionId, tail } = route;
  validateSessionId(sessionId);
  const session = ensureSession(sessionId);

  if (req.method === "GET" && tail.length === 1 && tail[0] === "connect.md") {
    sendText(res, renderConnectMarkdown(req, sessionId), "text/markdown; charset=utf-8");
    return;
  }

  if (req.method === "GET" && tail.length === 1 && tail[0] === "events") {
    registerEventClient(req, res, session, url.searchParams.get("client") || generateClientId());
    return;
  }

  if (req.method === "POST" && tail.length === 2 && tail[0] === "results") {
    await receiveCommandResult(req, res, session, tail[1]);
    return;
  }

  if (req.method === "GET" && tail.length === 1 && tail[0] === "status") {
    await sendSessionStatus(req, res, session);
    return;
  }

  if (req.method === "GET" && tail.length === 1 && tail[0] === "code") {
    await sendCurrentCode(res, session);
    return;
  }

  if (req.method === "PUT" && tail.length === 1 && tail[0] === "code") {
    await updateCurrentCode(req, res, url, session);
    return;
  }

  if (req.method === "GET" && tail.length === 1 && tail[0] === "screenshot.png") {
    await sendLiveScreenshot(req, res, url, session);
    return;
  }

  if (req.method === "GET" && tail.length === 1 && tail[0] === "snapshots") {
    await sendJson(res, { session: sessionSummary(session), snapshots: await listSnapshots(session.id, req) });
    return;
  }

  if (req.method === "POST" && tail.length === 1 && tail[0] === "snapshots") {
    await createSnapshot(req, res, session);
    return;
  }

  if (req.method === "GET" && tail.length === 3 && tail[0] === "snapshots" && tail[2] === "screenshot.png") {
    await sendSnapshotFile(res, session.id, tail[1], "screenshot.png", "image/png");
    return;
  }

  if (req.method === "GET" && tail.length === 3 && tail[0] === "snapshots" && tail[2] === "code.js") {
    await sendSnapshotFile(res, session.id, tail[1], "code.js", "text/javascript; charset=utf-8");
    return;
  }

  if (req.method === "POST" && tail.length === 1 && tail[0] === "undo") {
    await undoCode(req, res, session);
    return;
  }

  throw httpError(404, "Session route not found.");
}

function parseSessionRoute(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "sessions" || !parts[2]) return null;
  return {
    sessionId: parts[2],
    tail: parts.slice(3),
  };
}

function ensureSession(id) {
  let session = sessions.get(id);
  if (session) return session;

  session = {
    id,
    createdAt: new Date().toISOString(),
    clients: new Map(),
    activeClientId: null,
    pendingCommands: new Map(),
    nextSnapshotNumber: 1,
    lastActivity: null,
  };
  sessions.set(id, session);
  void initializeSessionDisk(session);
  return session;
}

async function initializeSessionDisk(session) {
  await mkdir(sessionDir(session.id), { recursive: true });
  await mkdir(snapshotsDir(session.id), { recursive: true });

  try {
    const existing = JSON.parse(await readFile(join(sessionDir(session.id), "session.json"), "utf8"));
    if (typeof existing.createdAt === "string") session.createdAt = existing.createdAt;
  } catch {
    await writeSessionMetadata(session);
  }

  session.nextSnapshotNumber = (await latestSnapshotNumber(session.id)) + 1;
  await writeSessionMetadata(session);
}

function registerEventClient(req, res, session, clientId) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");

  const client = {
    id: clientId,
    connectedAt: new Date().toISOString(),
    res,
    keepAlive: setInterval(() => {
      res.write(`: ${Date.now()}\n\n`);
    }, 15000),
  };
  session.clients.set(clientId, client);
  session.activeClientId = clientId;
  session.lastActivity = new Date().toISOString();
  void writeSessionMetadata(session);
  sendEvent(res, "hello", { sessionId: session.id, clientId });

  req.on("close", () => {
    clearInterval(client.keepAlive);
    session.clients.delete(clientId);
    if (session.activeClientId === clientId) {
      session.activeClientId = mostRecentClient(session)?.id ?? null;
    }
    void writeSessionMetadata(session);
  });
}

async function receiveCommandResult(req, res, session, commandId) {
  const pending = session.pendingCommands.get(commandId);
  if (!pending) throw httpError(404, "Command is no longer pending.");
  const body = await readJson(req);
  session.pendingCommands.delete(commandId);
  clearTimeout(pending.timer);
  if (body?.ok === false) pending.reject(new Error(String(body.error || "Command failed.")));
  else pending.resolve(body?.result ?? null);
  sendJson(res, { ok: true });
}

async function sendSessionStatus(req, res, session) {
  const snapshots = await listSnapshots(session.id, req);
  if (!activeClient(session)) {
    await sendJson(res, {
      session: sessionSummary(session),
      connected: false,
      snapshots,
    });
    return;
  }

  const app = await sendCommand(session, "get-status", {});
  await sendJson(res, {
    session: sessionSummary(session),
    connected: true,
    app,
    snapshots,
  });
}

async function sendCurrentCode(res, session) {
  const result = await sendCommand(session, "get-code", {});
  sendText(res, String(result?.code ?? ""), "text/plain; charset=utf-8");
}

async function updateCurrentCode(req, res, url, session) {
  const payload = await readCodePayload(req, url);
  if (typeof payload.code !== "string") throw httpError(400, "Missing code.");
  const result = await sendCommand(session, "set-code", {
    code: payload.code,
    comment: payload.comment,
  });
  const snapshot = await writeSnapshot(session, {
    kind: "code",
    comment: payload.comment,
    code: String(result?.code ?? payload.code),
    sourceValid: Boolean(result?.sourceValid),
    status: String(result?.status ?? ""),
    screenshotDataUrl: typeof result?.screenshotDataUrl === "string" ? result.screenshotDataUrl : null,
  }, req);
  await sendJson(res, {
    ok: true,
    sourceValid: Boolean(result?.sourceValid),
    status: String(result?.status ?? ""),
    snapshot,
  });
}

async function sendLiveScreenshot(req, res, url, session) {
  const comment = semanticComment(url.searchParams.get("comment") || "");
  const result = await sendCommand(session, "capture-screenshot", { comment });
  const screenshotDataUrl = String(result?.screenshotDataUrl || "");
  const snapshot = await writeSnapshot(session, {
    kind: "screenshot",
    comment,
    code: String(result?.code ?? ""),
    sourceValid: Boolean(result?.sourceValid),
    status: String(result?.status ?? ""),
    screenshotDataUrl,
  }, req);
  const png = pngBufferFromDataUrl(screenshotDataUrl);
  res.writeHead(200, {
    "content-type": "image/png",
    "cache-control": "no-store",
    "x-sdf-snapshot-id": snapshot.id,
    "x-sdf-snapshot-url": snapshot.screenshotUrl,
  });
  res.end(png);
}

async function createSnapshot(req, res, session) {
  const body = await readJson(req);
  let source = body;
  if (!source || typeof source.code !== "string") {
    source = await sendCommand(session, "capture-screenshot", {
      comment: semanticComment(body?.comment || ""),
    });
  }

  const snapshot = await writeSnapshot(session, {
    kind: typeof body?.kind === "string" ? body.kind : "manual",
    comment: semanticComment(body?.comment || source?.comment || ""),
    code: String(source?.code ?? ""),
    sourceValid: Boolean(source?.sourceValid),
    status: String(source?.status ?? ""),
    screenshotDataUrl: typeof source?.screenshotDataUrl === "string" ? source.screenshotDataUrl : null,
  }, req);
  await sendJson(res, { ok: true, snapshot });
}

async function undoCode(req, res, session) {
  const body = await readOptionalJson(req);
  const current = await sendCommand(session, "get-code", {});
  const currentCode = String(current?.code ?? "");
  const currentHash = hashText(currentCode);
  const snapshots = await listSnapshots(session.id, req, { absoluteUrls: false });

  let target = null;
  for (const snapshot of [...snapshots].reverse()) {
    if (!snapshot.codeUrl) continue;
    const code = await readSnapshotCode(session.id, snapshot.id);
    if (hashText(code) === currentHash) continue;
    target = { snapshot, code };
    break;
  }

  if (!target) throw httpError(409, "No earlier code snapshot is available.");

  const comment = semanticComment(body?.comment || `Restoring code from snapshot ${target.snapshot.id}.`);
  const result = await sendCommand(session, "set-code", {
    code: target.code,
    comment,
  });
  const snapshot = await writeSnapshot(session, {
    kind: "undo",
    comment,
    code: String(result?.code ?? target.code),
    sourceValid: Boolean(result?.sourceValid),
    status: String(result?.status ?? ""),
    screenshotDataUrl: typeof result?.screenshotDataUrl === "string" ? result.screenshotDataUrl : null,
    restoredSnapshotId: target.snapshot.id,
  }, req);

  await sendJson(res, {
    ok: true,
    restoredSnapshot: target.snapshot,
    snapshot,
    sourceValid: Boolean(result?.sourceValid),
    status: String(result?.status ?? ""),
  });
}

function sendCommand(session, type, payload) {
  const client = activeClient(session);
  if (!client) throw httpError(409, "No browser tab is connected for this session.");

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      session.pendingCommands.delete(id);
      rejectPromise(httpError(504, `Timed out waiting for browser command "${type}".`));
    }, commandTimeoutMs);
    session.pendingCommands.set(id, {
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
    });
    sendEvent(client.res, "command", { id, type, payload });
  });
}

function activeClient(session) {
  if (session.activeClientId && session.clients.has(session.activeClientId)) {
    return session.clients.get(session.activeClientId);
  }
  return mostRecentClient(session);
}

function mostRecentClient(session) {
  const clients = [...session.clients.values()];
  return clients[clients.length - 1] ?? null;
}

async function writeSnapshot(session, data, req) {
  await initializeSessionDisk(session);
  const id = String(session.nextSnapshotNumber++).padStart(6, "0");
  const dir = join(snapshotsDir(session.id), id);
  await mkdir(dir, { recursive: true });

  const code = typeof data.code === "string" ? data.code : "";
  const screenshotPng = data.screenshotDataUrl ? pngBufferFromDataUrl(data.screenshotDataUrl) : null;
  if (code) await writeFile(join(dir, "code.js"), code);
  if (screenshotPng) await writeFile(join(dir, "screenshot.png"), screenshotPng);

  const meta = {
    id,
    sessionId: session.id,
    createdAt: new Date().toISOString(),
    kind: String(data.kind || "snapshot"),
    comment: semanticComment(data.comment || ""),
    sourceValid: Boolean(data.sourceValid),
    status: String(data.status || ""),
    codeHash: code ? hashText(code) : null,
    codeUrl: code ? `/api/sessions/${session.id}/snapshots/${id}/code.js` : null,
    screenshotUrl: screenshotPng ? `/api/sessions/${session.id}/snapshots/${id}/screenshot.png` : null,
    restoredSnapshotId: data.restoredSnapshotId || null,
  };
  await writeFile(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  session.lastActivity = meta.createdAt;
  await writeSessionMetadata(session, meta.id);
  return absolutizeSnapshot(meta, req);
}

async function listSnapshots(sessionId, req, options = {}) {
  const absoluteUrls = options.absoluteUrls !== false;
  let entries = [];
  try {
    entries = await readdir(snapshotsDir(sessionId), { withFileTypes: true });
  } catch {
    return [];
  }

  const snapshots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !snapshotIdPattern.test(entry.name)) continue;
    try {
      const meta = JSON.parse(await readFile(join(snapshotsDir(sessionId), entry.name, "meta.json"), "utf8"));
      snapshots.push(absoluteUrls ? absolutizeSnapshot(meta, req) : meta);
    } catch {
      // Keep listing useful even if a snapshot was interrupted on disk.
    }
  }
  return snapshots.sort((a, b) => a.id.localeCompare(b.id));
}

async function sendSnapshotFile(res, sessionId, snapshotId, filename, contentType) {
  validateSnapshotId(snapshotId);
  const file = join(snapshotsDir(sessionId), snapshotId, filename);
  try {
    await stat(file);
  } catch {
    throw httpError(404, "Snapshot file not found.");
  }
  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
}

async function readSnapshotCode(sessionId, snapshotId) {
  validateSnapshotId(snapshotId);
  return readFile(join(snapshotsDir(sessionId), snapshotId, "code.js"), "utf8");
}

async function latestSnapshotNumber(sessionId) {
  try {
    const entries = await readdir(snapshotsDir(sessionId), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && snapshotIdPattern.test(entry.name))
      .reduce((max, entry) => Math.max(max, Number(entry.name)), 0);
  } catch {
    return 0;
  }
}

async function writeSessionMetadata(session, latestSnapshotId = null) {
  await mkdir(sessionDir(session.id), { recursive: true });
  const metadata = {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: new Date().toISOString(),
    activeClientId: session.activeClientId,
    connectedClients: session.clients.size,
    latestSnapshotId,
    snapshotsUrl: `/api/sessions/${session.id}/snapshots`,
  };
  await writeFile(join(sessionDir(session.id), "session.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

function sessionSummary(session) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    connectedClients: session.clients.size,
    activeClientId: session.activeClientId,
    lastActivity: session.lastActivity,
    snapshotsUrl: `/api/sessions/${session.id}/snapshots`,
  };
}

async function readCodePayload(req, url) {
  const contentType = req.headers["content-type"] || "";
  const raw = await readBody(req);
  if (contentType.includes("application/json")) {
    const json = raw.trim() ? JSON.parse(raw) : {};
    return {
      code: json.code,
      comment: semanticComment(json.comment || url.searchParams.get("comment") || ""),
    };
  }
  return {
    code: raw,
    comment: semanticComment(url.searchParams.get("comment") || req.headers["x-sdf-comment"] || ""),
  };
}

function renderConnectMarkdown(req, sessionId) {
  const base = `${requestOrigin(req)}/api/sessions/${sessionId}`;
  return `# sdf Browser Session ${sessionId}

You are connected to a live local sdf browser session. The browser is the renderer; this API is a post office that asks the active tab to update code or capture the shader canvas.

Prefer comments that explain why you are taking an action, or what you are checking when the reason is not obvious.

## Quick Start

\`\`\`sh
BASE=${JSON.stringify(base)}

# Inspect the live browser session.
curl -s "$BASE/status"

# Read the current editor source.
curl -s "$BASE/code"

# Replace the editor source, wait for the shader screenshot, and create a snapshot.
curl -sS -X PUT "$BASE/code" \\
  -H 'content-type: application/json' \\
  --data-binary @update.json

# update.json:
# {
#   "comment": "Tightening the silhouette so the lid clears the printer envelope.",
#   "code": "const shape = box([1, 1, 1]);\\nreturn shape;"
# }

# Capture the current shader canvas as PNG and create a snapshot.
curl -s "$BASE/screenshot.png?comment=Checking%20the%20current%20front%20silhouette" -o screenshot.png

# List saved session snapshots.
curl -s "$BASE/snapshots"

# Restore code from the most recent different code snapshot.
curl -sS -X POST "$BASE/undo" \\
  -H 'content-type: application/json' \\
  -d '{"comment":"Backtracking to the last readable version before trying a smaller fillet."}'
\`\`\`

The session id is the local capability for this workspace. There is no separate secret in this first version.

## API Reference

### GET /status

Returns the active browser tab state, app health, and the snapshot list. If no tab is connected, the response still includes session metadata and persisted snapshots.

\`\`\`sh
curl -s "$BASE/status"
\`\`\`

Response fields include:

- \`connected\`: whether a browser tab is currently attached
- \`app.sourceValid\`: whether the current editor source compiled
- \`app.status\`: the editor status text
- \`app.viewMode\`: currently expected to be \`shader\` for agent screenshots
- \`snapshots\`: persisted snapshot metadata

### GET /code

Returns the current editor source as plain text.

\`\`\`sh
curl -s "$BASE/code" > current-sdf.js
\`\`\`

### PUT /code

Replaces the editor source in the active browser tab, compiles it, switches to the shader view, captures a PNG screenshot, writes a code snapshot, and returns snapshot metadata.

JSON body:

\`\`\`json
{
  "comment": "Explaining why this code change is useful to check.",
  "code": "return sphere(1);"
}
\`\`\`

\`\`\`sh
curl -sS -X PUT "$BASE/code" \\
  -H 'content-type: application/json' \\
  --data-binary @update.json
\`\`\`

Plain-text bodies are also accepted. Put the comment in either \`?comment=\` or \`X-SDF-Comment\`.

\`\`\`sh
curl -sS -X PUT "$BASE/code?comment=Trying%20a%20smaller%20outer%20radius" \\
  -H 'content-type: text/plain' \\
  --data-binary @current-sdf.js
\`\`\`

Response fields:

- \`sourceValid\`: whether the new code compiled
- \`status\`: editor status text after compile
- \`snapshot.codeUrl\`: URL for the saved source
- \`snapshot.screenshotUrl\`: URL for the saved shader PNG

Failed code still creates a snapshot when the browser can respond, so the collaboration trail includes broken attempts.

### GET /screenshot.png

Switches the active tab to shader view, captures the current shader canvas, writes a screenshot snapshot, and returns PNG bytes.

\`\`\`sh
curl -s "$BASE/screenshot.png?comment=Checking%20whether%20the%20profile%20is%20legible" -o screenshot.png
\`\`\`

Useful response headers:

- \`X-SDF-Snapshot-Id\`
- \`X-SDF-Snapshot-Url\`

### GET /snapshots

Lists snapshots persisted under this session.

\`\`\`sh
curl -s "$BASE/snapshots"
\`\`\`

Each snapshot may include:

- \`id\`
- \`kind\`: \`code\`, \`screenshot\`, \`manual\`, or \`undo\`
- \`comment\`
- \`sourceValid\`
- \`status\`
- \`codeUrl\`
- \`screenshotUrl\`
- \`restoredSnapshotId\`

### POST /snapshots

Creates a snapshot. If called from outside the browser with only a comment, the server asks the active tab to capture the current shader state. The browser UI uses this same endpoint for the Snapshot button.

\`\`\`sh
curl -sS -X POST "$BASE/snapshots" \\
  -H 'content-type: application/json' \\
  -d '{"comment":"Saving the current baseline before trying a thinner wall."}'
\`\`\`

### GET /snapshots/:snapshotId/code.js

Returns the source saved for a snapshot.

\`\`\`sh
curl -s "$BASE/snapshots/000002/code.js"
\`\`\`

### GET /snapshots/:snapshotId/screenshot.png

Returns the PNG saved for a snapshot.

\`\`\`sh
curl -s "$BASE/snapshots/000002/screenshot.png" -o snapshot-000002.png
\`\`\`

### POST /undo

Restores only the editor code from the most recent snapshot whose code differs from the current editor contents. It then compiles, captures a shader screenshot, and writes an \`undo\` snapshot.

\`\`\`sh
curl -sS -X POST "$BASE/undo" \\
  -H 'content-type: application/json' \\
  -d '{"comment":"Returning to the last readable silhouette before changing the cutouts."}'
\`\`\`

## Snapshot Storage

Snapshots are stored on disk in this repo under:

\`\`\`text
.sessions/${sessionId}/
  session.json
  snapshots/
    000001/
      meta.json
      code.js
      screenshot.png
\`\`\`

The \`.sessions/\` directory is local-only and ignored by git.

## Internal Browser Transport

The browser tab connects to \`GET /events\` with Server-Sent Events and posts command results back to \`POST /results/:commandId\`. Agents usually should not call those endpoints directly.
`;
}

async function serveIndex(req, res, pathname) {
  let template = await readFile(join(__dirname, "index.html"), "utf8");
  if (pathname.startsWith("/s/")) {
    template = template.replace("<head>", "<head>\n    <base href=\"/\">");
  }
  const html = await vite.transformIndexHtml(pathname, template);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(req.method === "HEAD" ? "" : html);
}

function runViteMiddleware(req, res) {
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

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${body}\n`);
}

function sendText(res, text, contentType) {
  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

async function readJson(req) {
  const body = await readBody(req);
  return body.trim() ? JSON.parse(body) : {};
}

async function readOptionalJson(req) {
  try {
    return await readJson(req);
  } catch {
    return {};
  }
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let length = 0;
    req.on("data", (chunk) => {
      length += chunk.length;
      if (length > bodyLimitBytes) {
        rejectBody(httpError(413, "Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", rejectBody);
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
  });
}

function pngBufferFromDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw httpError(422, "Browser did not return a PNG data URL.");
  return Buffer.from(match[1], "base64");
}

function absolutizeSnapshot(snapshot, req) {
  const origin = req ? requestOrigin(req) : "";
  return {
    ...snapshot,
    ...(snapshot.codeUrl ? { codeUrl: `${origin}${snapshot.codeUrl}` } : {}),
    ...(snapshot.screenshotUrl ? { screenshotUrl: `${origin}${snapshot.screenshotUrl}` } : {}),
  };
}

function sessionDir(sessionId) {
  return join(sessionsRoot, sessionId);
}

function snapshotsDir(sessionId) {
  return join(sessionDir(sessionId), "snapshots");
}

function validateSessionId(sessionId) {
  if (!sessionIdPattern.test(sessionId)) throw httpError(404, "Invalid session id.");
}

function validateSnapshotId(snapshotId) {
  if (!snapshotIdPattern.test(snapshotId)) throw httpError(404, "Invalid snapshot id.");
}

function generateSessionId() {
  let id = "";
  for (let i = 0; i < 10; i += 1) {
    id += base58Alphabet[randomInt(base58Alphabet.length)];
  }
  return id;
}

function generateClientId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function semanticComment(value) {
  return String(value || "").trim().slice(0, 1000);
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requestUrl(req) {
  return new URL(req.url || "/", requestOrigin(req));
}

function requestOrigin(req) {
  const host = req.headers.host || `127.0.0.1:${port}`;
  return `http://${host}`;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendError(res, error) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const status = Number(error?.status || 500);
  const message = error instanceof Error ? error.message : String(error);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
}
