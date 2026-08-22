const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_FIELDS = new Set(["p12", "mobileprovision", "password"]);
const MAX_P12_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_BYTES = 4 * 1024 * 1024;
const MAX_PASSWORD_LENGTH = 256;

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function tokenMatches(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !provided || !expected) {
    return false;
  }

  const left = new TextEncoder().encode(provided);
  const right = new TextEncoder().encode(expected);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function isFile(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.arrayBuffer === "function"
    && typeof value.size === "number";
}

export async function parseSigningForm(request, env) {
  const providedToken = request.headers?.get("X-Orvia-Access-Token");
  if (!tokenMatches(providedToken, env.ORVIA_ACCESS_TOKEN)) {
    return { ok: false, response: jsonResponse({ error: "Unauthorized" }, 401) };
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: jsonResponse({ error: "Invalid form data" }, 400) };
  }

  for (const field of form.keys()) {
    if (!ALLOWED_FIELDS.has(field)) {
      return { ok: false, response: jsonResponse({ error: "Unsupported form field" }, 400) };
    }
  }

  const p12 = form.get("p12");
  const profile = form.get("mobileprovision");
  const password = form.get("password");
  if (!isFile(p12) || !isFile(profile) || typeof password !== "string") {
    return { ok: false, response: jsonResponse({ error: "Missing signing fields" }, 400) };
  }
  if (p12.size <= 0 || p12.size > MAX_P12_BYTES || profile.size <= 0 || profile.size > MAX_PROFILE_BYTES) {
    return { ok: false, response: jsonResponse({ error: "Signing file is too large" }, 400) };
  }
  if (!password || password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, response: jsonResponse({ error: "Invalid signing password" }, 400) };
  }

  try {
    return {
      ok: true,
      p12Base64: toBase64(await p12.arrayBuffer()),
      profileBase64: toBase64(await profile.arrayBuffer()),
      p12Password: password,
    };
  } catch {
    return { ok: false, response: jsonResponse({ error: "Invalid signing files" }, 400) };
  }
}

export async function dispatchSigningWorkflow(env, payload, fetchImpl = globalThis.fetch) {
  const owner = encodeURIComponent(env.GITHUB_OWNER ?? "");
  const repository = encodeURIComponent(env.GITHUB_REPO ?? "");
  const workflow = encodeURIComponent(env.GITHUB_WORKFLOW ?? "");
  if (!owner || !repository || !workflow || !env.GITHUB_TOKEN) {
    throw new Error("GitHub workflow dispatch failed");
  }

  const url = `https://api.github.com/repos/${owner}/${repository}/actions/workflows/${workflow}/dispatches`;
  const body = JSON.stringify({
    ref: env.GITHUB_REF || "main",
    inputs: {
      task_id: payload.taskId,
      p12_base64: payload.p12Base64,
      profile_base64: payload.profileBase64,
      p12_password: payload.p12Password,
    },
  });

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "orvia-ota-worker",
      },
      body,
    });
  } catch {
    throw new Error("GitHub workflow dispatch failed");
  }
  if (response.status !== 204) {
    throw new Error("GitHub workflow dispatch failed");
  }
}

function taskObjectKey(taskId, filename) {
  if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) {
    throw new TypeError("Invalid task id");
  }
  return `sign/${taskId}/${filename}`;
}

export function taskResultKey(taskId) {
  return taskObjectKey(taskId, "result.json");
}

export function taskErrorKey(taskId) {
  return taskObjectKey(taskId, "error.json");
}
