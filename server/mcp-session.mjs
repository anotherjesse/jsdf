const latestProtocolVersion = "2025-11-25";
const supportedProtocolVersions = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);
const jsonRpcVersion = "2.0";
const mcpBodyLimitBytes = 4 * 1024 * 1024;
const snapshotIdPattern = /^\d{6}$/;

export async function handleMcpSessionRoute(req, res, context) {
  if (!validMcpOrigin(req.headers.origin, context.origin)) {
    sendMcpJson(res, mcpError(null, -32000, "Forbidden origin."), 403);
    return;
  }

  if (req.method === "GET") {
    sendMcpMethodNotAllowed(res);
    return;
  }
  if (req.method !== "POST") {
    sendMcpMethodNotAllowed(res);
    return;
  }

  const protocolVersion = req.headers["mcp-protocol-version"];
  if (protocolVersion && !supportedProtocolVersions.has(String(protocolVersion))) {
    sendMcpJson(res, mcpError(null, -32600, `Unsupported MCP protocol version: ${protocolVersion}`), 400);
    return;
  }

  let message;
  try {
    message = JSON.parse(await readMcpBody(req));
  } catch (error) {
    const status = error?.status || 400;
    const text = status === 413 ? "Request body is too large." : "Parse error.";
    sendMcpJson(res, mcpError(null, status === 413 ? -32600 : -32700, text), status);
    return;
  }

  if (!isJsonRpcObject(message)) {
    sendMcpJson(res, mcpError(null, -32600, "Invalid JSON-RPC request."), 400);
    return;
  }

  if (!("method" in message)) {
    sendMcpAccepted(res);
    return;
  }

  if (!("id" in message)) {
    sendMcpAccepted(res);
    return;
  }

  const id = message.id;
  try {
    const result = await handleMcpRequest(message, context);
    sendMcpJson(res, { jsonrpc: jsonRpcVersion, id, result });
  } catch (error) {
    const code = Number.isInteger(error?.code) ? error.code : -32603;
    const messageText = error instanceof Error ? error.message : String(error);
    sendMcpJson(res, mcpError(id, code, messageText), error?.status || 200);
  }
}

function handleMcpRequest(message, context) {
  switch (message.method) {
    case "initialize":
      return initializeResult(message.params, context);
    case "ping":
      return {};
    case "tools/list":
      return { tools: mcpTools(context) };
    case "tools/call":
      return callMcpTool(message.params, context);
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      throw protocolError(-32601, `Method not found: ${message.method}`);
  }
}

function initializeResult(params, context) {
  const requested = params && typeof params === "object" ? params.protocolVersion : null;
  const protocolVersion = supportedProtocolVersions.has(String(requested)) ? String(requested) : latestProtocolVersion;
  return {
    protocolVersion,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: {
      name: "sdf-browser",
      title: "sdf Browser Session",
      version: context.version,
      description: "Controls one local sdf browser project/session.",
      websiteUrl: context.origin,
    },
    instructions: [
      `This MCP server controls sdf browser session ${context.sessionId}.`,
      "Keep the matching browser tab open so tools can compile source, render previews, and save snapshots.",
      "Use sdf_set_code for source edits; it records a snapshot after the live browser tab reports the result.",
    ].join(" "),
  };
}

async function callMcpTool(params, context) {
  if (!params || typeof params !== "object") throw protocolError(-32602, "Missing tools/call params.");
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};

  try {
    switch (name) {
      case "sdf_status":
        return structuredResult("Session status", await readMcpStatus(context));
      case "sdf_get_code":
        return await getCode(context);
      case "sdf_set_code":
        return await setCode(args, context);
      case "sdf_capture_screenshot":
        return await captureScreenshot(args, context);
      case "sdf_list_snapshots":
        return await listSnapshots(args, context);
      case "sdf_restore_snapshot":
        return await restoreSnapshot(args, context);
      default:
        throw protocolError(-32602, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error?.mcpProtocol) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return toolError(message);
  }
}

async function readMcpStatus(context) {
  const snapshots = await context.listSnapshots();
  if (!context.connectedClients()) {
    return {
      session: context.sessionSummary(),
      project: await context.projectSummary(),
      connected: false,
      snapshots,
    };
  }

  const app = await context.sendCommand("get-status", {});
  return {
    session: context.sessionSummary(),
    project: await context.projectSummary(),
    connected: true,
    app,
    snapshots,
  };
}

async function getCode(context) {
  const result = await context.sendCommand("get-code", {});
  const code = String(result?.code ?? "");
  return {
    content: [{ type: "text", text: code }],
    structuredContent: { code },
    isError: false,
  };
}

async function setCode(args, context) {
  if (typeof args.code !== "string") return toolError("Missing required string argument: code.");
  const comment = semanticComment(args.comment || "MCP set code.");
  const result = await context.sendCommand("set-code", {
    code: args.code,
    comment,
  });
  const snapshot = await context.writeSnapshot({
    kind: "code",
    comment,
    code: String(result?.code ?? args.code),
    sourceValid: Boolean(result?.sourceValid),
    status: String(result?.status ?? ""),
    screenshotDataUrl: typeof result?.screenshotDataUrl === "string" ? result.screenshotDataUrl : null,
  });
  return structuredResult("Source updated and snapshotted", {
    sourceValid: Boolean(result?.sourceValid),
    status: String(result?.status ?? ""),
    snapshot,
  });
}

async function captureScreenshot(args, context) {
  const comment = semanticComment(args.comment || "MCP screenshot.");
  const result = await context.sendCommand("capture-screenshot", { comment });
  const screenshotDataUrl = typeof result?.screenshotDataUrl === "string" ? result.screenshotDataUrl : "";
  const snapshot = await context.writeSnapshot({
    kind: "screenshot",
    comment,
    code: String(result?.code ?? ""),
    sourceValid: Boolean(result?.sourceValid),
    status: String(result?.status ?? ""),
    screenshotDataUrl,
  });
  const data = {
    sourceValid: Boolean(result?.sourceValid),
    status: String(result?.status ?? ""),
    snapshot,
  };
  const content = [{ type: "text", text: `Screenshot captured.\n\n${JSON.stringify(data, null, 2)}` }];
  const image = pngImageContent(screenshotDataUrl);
  if (image) content.push(image);
  return {
    content,
    structuredContent: data,
    isError: false,
  };
}

async function listSnapshots(args, context) {
  const snapshots = await context.listSnapshots();
  const limit = Number.isInteger(args.limit) ? Math.max(1, Math.min(1000, args.limit)) : null;
  const visible = limit ? snapshots.slice(-limit) : snapshots;
  return structuredResult("Session snapshots", {
    snapshots: visible,
    count: snapshots.length,
  });
}

async function restoreSnapshot(args, context) {
  const snapshotId = typeof args.snapshotId === "string" ? args.snapshotId : "";
  if (!snapshotIdPattern.test(snapshotId)) return toolError("snapshotId must be a six-digit snapshot id like 000002.");
  const comment = semanticComment(args.comment || `MCP restoring snapshot ${snapshotId}.`);
  return structuredResult("Snapshot restored as latest", await context.restoreSnapshot(snapshotId, comment));
}

function mcpTools(context) {
  return [
    {
      name: "sdf_status",
      title: "Read Session Status",
      description: "Read the live browser status, project summary, and persisted snapshot list for this sdf session.",
      inputSchema: noArgsSchema(),
    },
    {
      name: "sdf_get_code",
      title: "Read Editor Source",
      description: "Read the current JavaScript SDF source from the connected browser tab.",
      inputSchema: noArgsSchema(),
    },
    {
      name: "sdf_set_code",
      title: "Update Editor Source",
      description: "Replace the live editor source, compile/render it in the browser tab, and save a code snapshot.",
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Complete JavaScript SDF source. It should return an SDF3.",
          },
          comment: {
            type: "string",
            description: "Short reason for this change, saved with the snapshot.",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
    {
      name: "sdf_capture_screenshot",
      title: "Capture Screenshot",
      description: "Render the current shader preview in the connected browser tab and save a screenshot snapshot.",
      inputSchema: {
        type: "object",
        properties: {
          comment: {
            type: "string",
            description: "Short reason for this capture, saved with the snapshot.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "sdf_list_snapshots",
      title: "List Snapshots",
      description: "List saved snapshots for this project/session.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 1000,
            description: "Optional maximum number of most recent snapshots to return.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "sdf_restore_snapshot",
      title: "Restore Snapshot",
      description: "Restore a saved source snapshot as the live editor state and append a new restore snapshot.",
      inputSchema: {
        type: "object",
        properties: {
          snapshotId: {
            type: "string",
            pattern: "^\\d{6}$",
            description: "Snapshot id to restore, for example 000002.",
          },
          comment: {
            type: "string",
            description: "Short reason for restoring this snapshot.",
          },
        },
        required: ["snapshotId"],
        additionalProperties: false,
      },
    },
  ].map((tool) => ({
    ...tool,
    description: `${tool.description} Endpoint session: ${context.sessionId}.`,
  }));
}

function noArgsSchema() {
  return {
    type: "object",
    additionalProperties: false,
  };
}

function structuredResult(label, data) {
  return {
    content: [{ type: "text", text: `${label}.\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data,
    isError: false,
  };
}

function toolError(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function pngImageContent(dataUrl) {
  const match = /^data:(image\/png);base64,(.+)$/u.exec(dataUrl);
  if (!match) return null;
  return {
    type: "image",
    mimeType: match[1],
    data: match[2],
  };
}

function isJsonRpcObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.jsonrpc === jsonRpcVersion);
}

function mcpError(id, code, message) {
  return {
    jsonrpc: jsonRpcVersion,
    id,
    error: {
      code,
      message,
    },
  };
}

function protocolError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.mcpProtocol = true;
  return error;
}

function semanticComment(value) {
  return String(value || "").trim().slice(0, 1000);
}

function validMcpOrigin(origin, requestOrigin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const expected = new URL(requestOrigin);
    return parsed.origin === expected.origin || localHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function localHostname(hostname) {
  const normalized = hostname.replace(/^\[/u, "").replace(/\]$/u, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function readMcpBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let length = 0;
    req.on("data", (chunk) => {
      length += chunk.length;
      if (length > mcpBodyLimitBytes) {
        const error = new Error("Request body is too large.");
        error.status = 413;
        rejectBody(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

function sendMcpAccepted(res) {
  res.writeHead(202, {
    "cache-control": "no-store",
  });
  res.end();
}

function sendMcpMethodNotAllowed(res) {
  res.writeHead(405, {
    allow: "POST",
    "cache-control": "no-store",
  });
  res.end("MCP endpoint accepts POST JSON-RPC requests.\n");
}

function sendMcpJson(res, value, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}
