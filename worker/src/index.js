import {
  dispatchSigningWorkflow,
  parseSigningForm,
  taskErrorKey,
  taskResultKey,
} from "./signing.js";
import { signingPageResponse } from "./site.js";

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TASK_PATH = new RegExp("^/sign/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(Orvia[.]ipa|manifest[.]plist|icon[.]png)$");
const STATUS_PATH = new RegExp("^/api/status/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$");
const CONTENT_TYPES = {
  "Orvia.ipa": "application/octet-stream",
  "manifest.plist": "application/xml",
  "icon.png": "image/png",
};
const DOT_SEGMENT = /^(?:[.]|%2e){1,2}$/i;

function hasRawDotSegment(rawUrl) {
  const schemeEnd = rawUrl.indexOf("://");
  const pathStart = rawUrl.indexOf("/", schemeEnd + 3);
  if (pathStart === -1) return false;

  const queryStart = rawUrl.indexOf("?", pathStart);
  const fragmentStart = rawUrl.indexOf("#", pathStart);
  const pathEnd = queryStart === -1
    ? fragmentStart
    : fragmentStart === -1
      ? queryStart
      : Math.min(queryStart, fragmentStart);
  const rawPath = rawUrl.slice(pathStart, pathEnd === -1 ? rawUrl.length : pathEnd);
  return rawPath.split("/").some((segment) => DOT_SEGMENT.test(segment));
}

export function resolveObjectPath(pathname) {
  const match = TASK_PATH.exec(pathname);
  if (!match) return null;
  const [, taskId, filename] = match;
  return { key: `sign/${taskId}/${filename}`, contentType: CONTENT_TYPES[filename] };
}

function notFound() {
  return new Response("Not Found", { status: 404 });
}

function methodNotAllowed(allow = "GET, HEAD") {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: allow },
  });
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isInstallUrl(value, taskId) {
  if (typeof value !== "string" || !value.startsWith("itms-services://?action=download-manifest&url=")) {
    return false;
  }
  const encodedManifestUrl = value.slice("itms-services://?action=download-manifest&url=".length);
  try {
    const manifestUrl = new URL(decodeURIComponent(encodedManifestUrl));
    return manifestUrl.protocol === "https:"
      && manifestUrl.hostname === "beta.ice329.me"
      && manifestUrl.pathname === `/sign/${taskId}/manifest.plist`
      && !manifestUrl.search;
  } catch {
    return false;
  }
}

async function readJsonObject(bucket, key) {
  let object;
  try {
    object = await bucket.get(key);
  } catch {
    return { error: true };
  }
  if (!object) return { missing: true };

  try {
    if (typeof object.json === "function") return { value: await object.json() };
    if (typeof object.text === "function") return { value: JSON.parse(await object.text()) };
    return { value: JSON.parse(await new Response(object.body).text()) };
  } catch {
    return { value: null };
  }
}

function safeCompleteStatus(taskId, value) {
  if (!value || value.taskId !== taskId || value.status !== "complete" || !isInstallUrl(value.installUrl, taskId)) {
    return null;
  }
  return { taskId, status: "complete", installUrl: value.installUrl };
}

function safeFailedStatus(taskId, value) {
  if (!value || value.taskId !== taskId || value.status !== "failed" || typeof value.message !== "string") {
    return null;
  }
  const message = value.message.trim().slice(0, 200);
  return message ? { taskId, status: "failed", message } : null;
}

async function statusResponse(taskId, env) {
  const result = await readJsonObject(env.OTA_BUCKET, taskResultKey(taskId));
  if (result.error) return jsonResponse({ error: "Internal Server Error" }, 500);
  const complete = safeCompleteStatus(taskId, result.value);
  if (complete) return jsonResponse(complete, 200);

  const error = await readJsonObject(env.OTA_BUCKET, taskErrorKey(taskId));
  if (error.error) return jsonResponse({ error: "Internal Server Error" }, 500);
  const failed = safeFailedStatus(taskId, error.value);
  if (failed) return jsonResponse(failed, 200);
  return jsonResponse({ taskId, status: "queued" }, 200);
}

async function signResponse(request, env) {
  const signingEnabled = typeof env.ORVIA_SIGNING_ENABLED === "string"
    && env.ORVIA_SIGNING_ENABLED.trim().toLowerCase() === "true";
  if (!signingEnabled) return jsonResponse({ error: "Signing temporarily disabled" }, 503);

  const parsed = await parseSigningForm(request, env);
  if (!parsed.ok) return parsed.response;

  const taskId = crypto.randomUUID();
  try {
    await dispatchSigningWorkflow(env, {
      taskId,
      p12Base64: parsed.p12Base64,
      profileBase64: parsed.profileBase64,
      p12Password: parsed.p12Password,
    }, env.GITHUB_FETCH || globalThis.fetch);
  } catch {
    return jsonResponse({ error: "Signing service unavailable" }, 502);
  }
  return jsonResponse({ taskId, status: "queued" }, 202);
}

function responseHeaders(object, contentType) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (object.size !== undefined && object.size !== null) {
    headers.set("Content-Length", String(object.size));
  }
  if (object.httpEtag !== undefined && object.httpEtag !== null) {
    headers.set("ETag", object.httpEtag);
  }
  if (object.uploaded !== undefined && object.uploaded !== null) {
    headers.set("Last-Modified", object.uploaded.toUTCString());
  }
  return headers;
}

const worker = {
  async fetch(request, env) {
    if (hasRawDotSegment(request.url)) return notFound();

    const url = new URL(request.url);
    if (url.search) return notFound();

    if (url.pathname === "/") {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
      return signingPageResponse(request.method === "GET");
    }

    if (url.pathname === "/api/sign") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return signResponse(request, env);
    }

    const statusMatch = STATUS_PATH.exec(url.pathname);
    if (statusMatch) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return statusResponse(statusMatch[1], env);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed();
    }

    const objectPath = resolveObjectPath(url.pathname);
    if (!objectPath) return notFound();

    let object;
    try {
      object = request.method === "HEAD"
        ? await env.OTA_BUCKET.head(objectPath.key)
        : await env.OTA_BUCKET.get(objectPath.key);
    } catch {
      return new Response("Internal Server Error", { status: 500 });
    }

    if (!object) return notFound();

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers: responseHeaders(object, objectPath.contentType),
    });
  },
};

export default worker;
