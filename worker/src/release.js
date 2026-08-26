import { tokenMatches } from "./signing.js";

export const RELEASE_CONFIG_KEY = "config/release.json";
const ORVIA_ADMIN_TOKEN_HEADER = "X-Orvia-Admin-Token";
const VERSION_PATTERN = /^[A-Za-z0-9._+\-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORY = 20;

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function emptyRelease() {
  return { ok: true, available: false, current: null, history: [], updatedAt: null };
}

function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function normalizeEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const version = typeof value.version === "string" ? value.version.trim() : "";
  const releasedAt = typeof value.releasedAt === "string" ? value.releasedAt.trim() : "";
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!version || version.length > 32 || !VERSION_PATTERN.test(version)) return null;
  if (!isValidDate(releasedAt)) return null;
  if (!summary || summary.length > 120) return null;
  if (!Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 20) return null;

  const changes = value.changes.map((change) => typeof change === "string" ? change.trim() : "");
  if (changes.some((change) => !change || change.length > 240)) return null;
  return { version, releasedAt, summary, changes };
}

function normalizeDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const current = normalizeEntry(value.current);
  const history = Array.isArray(value.history)
    ? value.history.map(normalizeEntry).filter(Boolean)
    : [];
  if (!current || !history.length) return null;

  const uniqueHistory = [];
  const versions = new Set();
  for (const entry of [current, ...history]) {
    if (versions.has(entry.version)) continue;
    versions.add(entry.version);
    uniqueHistory.push(entry);
    if (uniqueHistory.length >= MAX_HISTORY) break;
  }
  return {
    current: uniqueHistory[0],
    history: uniqueHistory,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function parseReleaseEntry(body) {
  return normalizeEntry(body);
}

export async function readReleaseDocument(bucket) {
  let object;
  try {
    object = await bucket.get(RELEASE_CONFIG_KEY);
  } catch {
    return { kind: "error" };
  }
  if (!object) return { kind: "missing" };

  try {
    const raw = typeof object.text === "function"
      ? await object.text()
      : typeof object.json === "function"
        ? JSON.stringify(await object.json())
        : await new Response(object.body).text();
    const document = normalizeDocument(JSON.parse(raw));
    return document ? { kind: "ok", value: document } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

export async function updateReleaseDocument(bucket, entry) {
  const existing = await readReleaseDocument(bucket);
  if (existing.kind === "error") throw new Error("Release metadata unavailable");

  const previousHistory = existing.kind === "ok" ? existing.value.history : [];
  const history = [entry, ...previousHistory.filter((item) => item.version !== entry.version)].slice(0, MAX_HISTORY);
  const document = {
    current: entry,
    history,
    updatedAt: new Date().toISOString(),
  };
  await bucket.put(RELEASE_CONFIG_KEY, JSON.stringify(document), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store",
    },
  });
  return document;
}

export async function publicReleaseResponse(env) {
  const result = await readReleaseDocument(env.OTA_BUCKET);
  if (result.kind === "error") return jsonResponse({ error: "Internal Server Error" }, 500);
  if (result.kind === "missing") return jsonResponse(emptyRelease(), 200);
  return jsonResponse({ ok: true, available: true, ...result.value }, 200);
}

function isOrviaAdminRequest(request, env) {
  return tokenMatches(request.headers.get(ORVIA_ADMIN_TOKEN_HEADER), env.ORVIA_ADMIN_BRIDGE_TOKEN);
}

export async function releaseAdminResponse(request, env) {
  if (!isOrviaAdminRequest(request, env)) return new Response("Not Found", { status: 404 });
  if (request.method === "GET") {
    const result = await readReleaseDocument(env.OTA_BUCKET);
    if (result.kind === "error") return jsonResponse({ error: "Internal Server Error" }, 500);
    if (result.kind === "missing") return jsonResponse(emptyRelease(), 200);
    return jsonResponse({ ok: true, available: true, ...result.value }, 200);
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const entry = parseReleaseEntry(body);
  if (!entry) return jsonResponse({ error: "Invalid release metadata" }, 400);

  try {
    const document = await updateReleaseDocument(env.OTA_BUCKET, entry);
    return jsonResponse({ ok: true, available: true, ...document }, 200);
  } catch {
    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
}
