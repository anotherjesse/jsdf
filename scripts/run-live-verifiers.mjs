#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const checks = [
  { page: "api-check.html", globalName: "__sdfApiVerification" },
  { page: "mesh-check.html", globalName: "__sdfMeshVerification" },
  { page: "preview-check.html", globalName: "__sdfPreviewVerification" },
  { page: "graph-check.html", globalName: "__sdfGraphVerification" },
  { page: "editor-check.html", globalName: "__sdfEditorVerification" },
  { page: "examples-visual-check.html" },
  { page: "app-health-check.html", globalName: "__sdfAppHealthVerification" },
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const defaultHost = "127.0.0.1";
const defaultTimeoutMs = 90_000;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

if (typeof WebSocket !== "function") {
  console.error("This verifier requires a Node runtime with a built-in WebSocket implementation.");
  console.error("Use a current Node release or run the browser verifier pages manually from checks.html.");
  process.exit(1);
}

let viteProcess = null;
let chromeProcess = null;
let chromeUserDataDir = null;
let exitRequested = false;

process.on("SIGINT", () => {
  exitRequested = true;
  void cleanup().finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  exitRequested = true;
  void cleanup().finally(() => process.exit(143));
});

try {
  const baseUrl = options.baseUrl ?? await startViteServer(options.port);
  const chrome = findChrome(options.chromePath);
  const debuggingPort = await freePort();
  const chromeEndpoint = await startChrome(chrome, debuggingPort, Boolean(options.headed));
  const results = [];

  console.log(`Live verifier base URL: ${baseUrl}`);
  for (const check of checks) {
    if (exitRequested) break;
    const result = await runCheck(chromeEndpoint, baseUrl, check, options.timeoutMs);
    results.push(result);
    printCheckResult(result);
  }

  const failed = results.filter((result) => !result.ok);
  console.log("");
  if (failed.length > 0) {
    console.error(`${failed.length}/${results.length} live verifier page${failed.length === 1 ? "" : "s"} failed.`);
    process.exitCode = 1;
  } else {
    console.log(`All ${results.length} live verifier pages passed.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
} finally {
  await cleanup();
}

function parseArgs(args) {
  const parsed = {
    baseUrl: null,
    chromePath: process.env.CHROME_PATH || process.env.CHROME || null,
    headed: false,
    help: false,
    port: null,
    timeoutMs: Number(process.env.SDF_VERIFY_TIMEOUT_MS || defaultTimeoutMs),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equalIndex = arg.indexOf("=");
    const name = equalIndex === -1 ? arg : arg.slice(0, equalIndex);
    const inlineValue = equalIndex === -1 ? undefined : arg.slice(equalIndex + 1);
    const value = inlineValue ?? args[index + 1];
    const consumedValue = inlineValue == null;

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (name === "--base-url") {
      parsed.baseUrl = normalizeBaseUrl(requiredValue("--base-url", value));
      if (consumedValue) index += 1;
    } else if (name === "--chrome") {
      parsed.chromePath = requiredValue("--chrome", value);
      if (consumedValue) index += 1;
    } else if (name === "--port") {
      parsed.port = Number(requiredValue("--port", value));
      if (!Number.isInteger(parsed.port) || parsed.port <= 0) throw new Error(`Invalid --port value: ${value}`);
      if (consumedValue) index += 1;
    } else if (name === "--timeout-ms") {
      parsed.timeoutMs = Number(requiredValue("--timeout-ms", value));
      if (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
        throw new Error(`Invalid --timeout-ms value: ${value}`);
      }
      if (consumedValue) index += 1;
    } else if (arg === "--headed") {
      parsed.headed = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requiredValue(name, value) {
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function printHelp() {
  console.log(`Run sdf browser verifier pages in headless Chrome.

Usage:
  npm run verify:live
  npm run verify:live -- --base-url http://127.0.0.1:5173/

Options:
  --base-url <url>    Reuse an already running Vite/server URL instead of starting Vite.
  --chrome <path>     Chrome or Chromium executable. Also reads CHROME_PATH or CHROME.
  --headed            Run Chrome with a visible window.
  --port <port>       Port for the temporary Vite server.
  --timeout-ms <ms>   Per-page verifier timeout. Default: ${defaultTimeoutMs}.
`);
}

async function startViteServer(port) {
  const viteBin = resolve(appRoot, "node_modules/vite/bin/vite.js");
  if (!existsSync(viteBin)) {
    throw new Error("Vite is not installed. Run npm install before npm run verify:live.");
  }

  const serverPort = port ?? await freePort();
  const logs = createProcessLog();
  viteProcess = spawn(process.execPath, [
    viteBin,
    "--host",
    defaultHost,
    "--port",
    String(serverPort),
    "--strictPort",
    "--base",
    "/",
  ], {
    cwd: appRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  collectProcessLogs(viteProcess, logs);

  const baseUrl = normalizeBaseUrl(`http://${defaultHost}:${serverPort}/`);
  try {
    await waitForHttp(`${baseUrl}checks.html`, 30_000);
  } catch (error) {
    throw new Error(`Vite verifier server did not start at ${baseUrl}\n${logs.text()}\n${error.message}`);
  }
  return baseUrl;
}

function findChrome(explicitPath) {
  const candidates = [
    explicitPath,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Could not find Chrome or Chromium. Set CHROME_PATH or pass --chrome <path>.");
  }
  return found;
}

async function startChrome(chromePath, debuggingPort, headed) {
  chromeUserDataDir = await mkdtemp(join(tmpdir(), "sdf-live-verifiers-"));
  const logs = createProcessLog();
  const args = [
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${chromeUserDataDir}`,
    "--no-first-run",
    "--disable-background-networking",
    "--disable-component-update",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--window-size=1440,1000",
    "about:blank",
  ];
  if (!headed) args.unshift("--headless=new");

  chromeProcess = spawn(chromePath, args, { stdio: ["ignore", "pipe", "pipe"] });
  collectProcessLogs(chromeProcess, logs);

  const endpoint = `http://${defaultHost}:${debuggingPort}`;
  try {
    await waitForJson(`${endpoint}/json/version`, 15_000);
  } catch (error) {
    throw new Error(`Chrome DevTools endpoint did not start.\n${logs.text()}\n${error.message}`);
  }
  return endpoint;
}

async function runCheck(chromeEndpoint, baseUrl, check, timeoutMs) {
  const pageUrl = new URL(check.page, baseUrl).href;
  const target = await fetchJson(`${chromeEndpoint}/json/new?about:blank`, { method: "PUT" });
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.ready();

  const consoleMessages = [];
  cdp.on("Runtime.consoleAPICalled", (params) => {
    const message = params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") ?? "";
    if (message) consoleMessages.push(message);
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    consoleMessages.push(params.exceptionDetails?.text || "Runtime exception");
  });

  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: pageUrl });

    const startedAt = Date.now();
    let snapshot = null;
    while (Date.now() - startedAt < timeoutMs) {
      snapshot = await readVerifierSnapshot(cdp, check.globalName);
      if (snapshot.ready) break;
      await sleep(250);
    }

    if (!snapshot?.ready) {
      return {
        page: check.page,
        ok: false,
        result: { ok: false, errors: [`Timed out after ${timeoutMs} ms waiting for ${check.page}`] },
        snapshot,
        consoleMessages,
      };
    }

    const result = snapshot.result ?? {};
    const ok = typeof result.ok === "boolean"
      ? result.ok
      : snapshot.statusState === "ok" || snapshot.title?.endsWith(" pass");
    return { page: check.page, ok, result, snapshot, consoleMessages };
  } finally {
    cdp.close();
    await fetch(`${chromeEndpoint}/json/close/${target.id}`).catch(() => undefined);
  }
}

async function readVerifierSnapshot(cdp, globalName) {
  const expression = globalName ? globalVerifierExpression(globalName) : reportVerifierExpression();
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.text || "Runtime evaluation failed");
  }
  return evaluation.result.value;
}

function globalVerifierExpression(globalName) {
  return `(() => {
    const result = window[${JSON.stringify(globalName)}];
    if (result) return { ready: true, result, title: document.title };
    return {
      ready: false,
      bodyStatus: document.body?.dataset?.status || "",
      statusState: document.querySelector("#status")?.dataset?.state || "",
      title: document.title,
      reportText: document.querySelector("#report")?.textContent || "",
    };
  })()`;
}

function reportVerifierExpression() {
  return `(() => {
    const reportText = document.querySelector("#report")?.textContent || "";
    const statusState = document.querySelector("#status")?.dataset?.state || "";
    const title = document.title;
    let result = null;
    try { result = reportText ? JSON.parse(reportText) : null; } catch {}
    return {
      ready: title.endsWith(" pass") || title.endsWith(" fail") || statusState === "ok" || statusState === "error",
      result,
      statusState,
      title,
      reportText,
    };
  })()`;
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  let closed = false;

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePending, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolvePending(message.result);
      return;
    }

    const callbacks = listeners.get(message.method) || [];
    for (const callback of callbacks) callback(message.params);
  });

  const rejectPending = (error) => {
    closed = true;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  const opened = new Promise((resolveOpened, rejectOpened) => {
    ws.addEventListener("open", resolveOpened, { once: true });
    ws.addEventListener("error", rejectOpened, { once: true });
  });
  ws.addEventListener("close", () => {
    rejectPending(new Error("Chrome DevTools socket closed"));
  });
  ws.addEventListener("error", () => {
    rejectPending(new Error("Chrome DevTools socket failed"));
  });

  return {
    async ready() {
      await opened;
    },
    send(method, params = {}) {
      if (closed || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Chrome DevTools socket is not open"));
      }
      const id = nextId;
      nextId += 1;
      return new Promise((resolvePending, reject) => {
        pending.set(id, { resolve: resolvePending, reject });
        try {
          ws.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    on(method, callback) {
      listeners.set(method, [...(listeners.get(method) || []), callback]);
    },
    close() {
      ws.close();
    },
  };
}

function printCheckResult(result) {
  const marker = result.ok ? "PASS" : "FAIL";
  console.log(`${marker} ${result.page}`);
  if (result.page === "examples-visual-check.html" && result.ok) {
    console.log(`  examples: ${result.result?.examples?.length ?? "unknown"}`);
  }
  if (result.page === "app-health-check.html" && result.ok) {
    const reveal = result.result?.codeGraphReveal;
    if (reveal) {
      console.log(`  code-to-graph focus: ${reveal.activeElement || "unknown"}; selected=${String(reveal.focusedSelectedNode)}`);
    }
  }
  if (!result.ok) {
    const errors = Array.isArray(result.result?.errors) ? result.result.errors : [];
    for (const error of errors.slice(0, 8)) console.error(`  ${error}`);
    if (errors.length > 8) console.error(`  ... ${errors.length - 8} more errors`);
    if (result.consoleMessages.length > 0) {
      console.error("  console:");
      for (const message of result.consoleMessages.slice(-5)) console.error(`    ${message}`);
    }
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${options?.method || "GET"} ${url} -> ${response.status}`);
  return response.json();
}

async function waitForJson(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchJson(url);
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until timeout.
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, defaultHost, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") reject(new Error("Could not allocate a TCP port"));
        else resolvePort(address.port);
      });
    });
  });
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function createProcessLog() {
  const chunks = [];
  return {
    push(chunk) {
      chunks.push(chunk.toString());
      while (chunks.join("").length > 8000) chunks.shift();
    },
    text() {
      return chunks.join("").trim();
    },
  };
}

function collectProcessLogs(processHandle, logs) {
  processHandle.stdout?.on("data", (chunk) => logs.push(chunk));
  processHandle.stderr?.on("data", (chunk) => logs.push(chunk));
}

async function cleanup() {
  await terminateProcess(chromeProcess);
  await terminateProcess(viteProcess);
  if (chromeUserDataDir) {
    await rm(chromeUserDataDir, { recursive: true, force: true });
  }
}

async function terminateProcess(processHandle) {
  if (!processHandle || hasProcessExited(processHandle)) return;

  processHandle.kill("SIGTERM");
  await waitForProcessExit(processHandle, 250);

  if (!hasProcessExited(processHandle)) {
    processHandle.kill("SIGKILL");
    await waitForProcessExit(processHandle, 250);
  }
}

function hasProcessExited(processHandle) {
  return processHandle.exitCode !== null || processHandle.signalCode !== null;
}

async function waitForProcessExit(processHandle, timeoutMs) {
  if (hasProcessExited(processHandle)) return;
  await Promise.race([
    once(processHandle, "exit"),
    sleep(timeoutMs),
  ]);
}
