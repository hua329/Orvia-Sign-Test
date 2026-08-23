import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/index.js";

const TASK_ID = "123e4567-e89b-12d3-a456-426614174000";
const P12_BYTES = "p12-secret-bytes";
const PROFILE_BYTES = "profile-secret-bytes";
const PASSWORD = "p12-password";

class MemoryBucket {
  constructor(objects = {}) {
    this.objects = new Map(Object.entries(objects));
    this.getKeys = [];
  }

  async get(key) {
    this.getKeys.push(key);
    return this.objects.get(key) ?? null;
  }
}

function request(pathname, init = {}) {
  return new Request(`https://beta.ice329.me${pathname}`, init);
}

function baseEnv(bucket = new MemoryBucket()) {
  return {
    OTA_BUCKET: bucket,
    GITHUB_OWNER: "ice-owner",
    GITHUB_REPO: "orvia-private",
    GITHUB_WORKFLOW: "sign.yml",
    GITHUB_TOKEN: "github-secret",
    ORVIA_SIGNING_ENABLED: "true",
    GITHUB_FETCH: async () => new Response(null, { status: 204 }),
  };
}

function signingRequest({ fields = {} } = {}) {
  const form = new FormData();
  form.set("p12", new Blob([P12_BYTES], { type: "application/x-pkcs12" }), "cert.p12");
  form.set("mobileprovision", new Blob([PROFILE_BYTES], { type: "application/octet-stream" }), "profile.mobileprovision");
  form.set("password", PASSWORD);
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return request("/api/sign", {
    method: "POST",
    body: form,
  });
}

function jsonObject(value) {
  return {
    async json() {
      return value;
    },
  };
}

function validInstallUrl(taskId) {
  return `itms-services://?action=download-manifest&url=https%3A%2F%2Fbeta.ice329.me%2Fsign%2F${taskId}%2Fmanifest.plist`;
}

test("serves the Orvia signing page without exposing worker secrets", async () => {
  const response = await worker.fetch(request("/"), baseEnv());
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^text\/html; charset=utf-8$/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(html, /Orvia OTA/);
  assert.match(html, /mobileprovision/);
  assert.match(html, /\/api\/sign/);
  assert.doesNotMatch(html, /访问令牌|access-token|X-Orvia-Access-Token/);
  assert.doesNotMatch(html, /GITHUB_TOKEN/);
  assert.doesNotMatch(html, /p12_password/);
  assert.match(html, /localStorage\.setItem\("orvia-ota:last-task-id", result\.taskId\)/);
  assert.match(html, /localStorage\.getItem\("orvia-ota:last-task-id"\)/);
  assert.match(html, /localStorage\.removeItem\("orvia-ota:last-task-id"\)/);
  assert.match(html, /poll\(savedTaskId\)/);
  assert.doesNotMatch(html, /localStorage\.setItem\("p12"/);
  assert.doesNotMatch(html, /localStorage\.setItem\("password"/);
});

test("blocks new signing when the Orvia switch is explicitly disabled", async () => {
  let dispatched = false;
  const env = baseEnv();
  env.ORVIA_SIGNING_ENABLED = "false";
  env.GITHUB_FETCH = async () => {
    dispatched = true;
    return new Response(null, { status: 204 });
  };
  const response = await worker.fetch(signingRequest(), env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Signing temporarily disabled" });
  assert.equal(dispatched, false);
});

test("keeps new signing disabled when the switch is missing", async () => {
  const env = baseEnv();
  delete env.ORVIA_SIGNING_ENABLED;
  const response = await worker.fetch(signingRequest(), env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Signing temporarily disabled" });
});

test("queues a signing request without an access token and forwards only the workflow payload", async () => {
  const calls = [];
  const env = baseEnv();
  env.GITHUB_FETCH = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  };

  const response = await worker.fetch(signingRequest(), env);
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.match(body.taskId, /^[0-9a-f-]{36}$/);
  assert.equal(body.status, "queued");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/ice-owner/orvia-private/actions/workflows/sign.yml/dispatches");
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.ref, "main");
  assert.equal(payload.inputs.task_id, body.taskId);
  assert.equal(payload.inputs.p12_password, PASSWORD);
  assert.equal(atob(payload.inputs.p12_base64), P12_BYTES);
  assert.equal(atob(payload.inputs.profile_base64), PROFILE_BYTES);
  assert.equal(calls[0].init.headers.Authorization, "Bearer github-secret");
  assert.doesNotMatch(JSON.stringify(body), /p12-password|p12-secret-bytes|profile-secret-bytes/);
});

test("returns queued when no task result exists", async () => {
  const bucket = new MemoryBucket();
  const response = await worker.fetch(request(`/api/status/${TASK_ID}`), baseEnv(bucket));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { taskId: TASK_ID, status: "queued" });
  assert.deepEqual(bucket.getKeys, [`sign/${TASK_ID}/result.json`, `sign/${TASK_ID}/error.json`]);
});

test("returns only a safe install URL for a completed task", async () => {
  const bucket = new MemoryBucket({
    [`sign/${TASK_ID}/result.json`]: jsonObject({
      taskId: TASK_ID,
      status: "complete",
      installUrl: `itms-services://?action=download-manifest&url=https%3A%2F%2Fbeta.ice329.me%2Fsign%2F${TASK_ID}%2Fmanifest.plist`,
      p12_password: PASSWORD,
      secret: "must-not-leak",
    }),
  });
  const response = await worker.fetch(request(`/api/status/${TASK_ID}`), baseEnv(bucket));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    taskId: TASK_ID,
    status: "complete",
    installUrl: `itms-services://?action=download-manifest&url=https%3A%2F%2Fbeta.ice329.me%2Fsign%2F${TASK_ID}%2Fmanifest.plist`,
  });
});

test("treats a validated legacy result without status as complete", async () => {
  const bucket = new MemoryBucket({
    [`sign/${TASK_ID}/result.json`]: jsonObject({
      taskId: TASK_ID,
      installUrl: validInstallUrl(TASK_ID),
    }),
  });
  const response = await worker.fetch(request(`/api/status/${TASK_ID}`), baseEnv(bucket));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    taskId: TASK_ID,
    status: "complete",
    installUrl: validInstallUrl(TASK_ID),
  });
});

test("does not treat an explicit non-complete result as complete", async () => {
  const bucket = new MemoryBucket({
    [`sign/${TASK_ID}/result.json`]: jsonObject({
      taskId: TASK_ID,
      status: "queued",
      installUrl: validInstallUrl(TASK_ID),
    }),
  });
  const response = await worker.fetch(request(`/api/status/${TASK_ID}`), baseEnv(bucket));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { taskId: TASK_ID, status: "queued" });
});

test("returns a safe failure message for a failed task", async () => {
  const bucket = new MemoryBucket({
    [`sign/${TASK_ID}/error.json`]: jsonObject({
      taskId: TASK_ID,
      status: "failed",
      message: "Signing failed",
      p12_password: PASSWORD,
    }),
  });
  const response = await worker.fetch(request(`/api/status/${TASK_ID}`), baseEnv(bucket));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { taskId: TASK_ID, status: "failed", message: "Signing failed" });
});

for (const pathname of ["/api/status/not-a-uuid", `/api/status/${TASK_ID.toUpperCase()}`, `/api/status/${TASK_ID}?debug=1`]) {
  test(`rejects malformed status route ${pathname}`, async () => {
    const bucket = new MemoryBucket();
    const response = await worker.fetch(request(pathname), baseEnv(bucket));
    assert.equal(response.status, 404);
    assert.deepEqual(bucket.getKeys, []);
  });
}

test("returns a generic error when GitHub dispatch is unavailable", async () => {
  const env = baseEnv();
  env.GITHUB_FETCH = async () => new Response("private GitHub details", { status: 500 });
  const response = await worker.fetch(signingRequest(), env);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Signing service unavailable" });
  assert.doesNotMatch(await response.text().catch(() => ""), /private GitHub details/);
});

for (const [method, allow] of [["GET", "POST"], ["PUT", "POST"]]) {
  test(`rejects ${method} on the signing endpoint`, async () => {
    const response = await worker.fetch(request("/api/sign", { method }), baseEnv());
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), allow);
  });
}
