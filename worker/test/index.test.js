import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { resolveObjectPath } from "../src/index.js";

const TASK_ID = "123e4567-e89b-12d3-a456-426614174000";
const IPA_KEY = `sign/${TASK_ID}/Orvia.ipa`;
const MANIFEST_KEY = `sign/${TASK_ID}/manifest.plist`;
const ICON_KEY = `sign/${TASK_ID}/icon.png`;
const IPA_BYTES = "ipa-bytes";
const MANIFEST_BYTES = "manifest-bytes";
const ICON_BYTES = "png-bytes";
const IPA_ETAG = '"ipa-etag"';
const MANIFEST_ETAG = '"manifest-etag"';
const UPLOADED = new Date("2026-08-22T12:34:56.000Z");
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const ORVIA_ADMIN_TOKEN = "orvia-admin-secret";

class MemoryBucket {
  constructor(objects) {
    this.objects = new Map(Object.entries(objects));
    this.getKeys = [];
    this.headKeys = [];
    this.putKeys = [];
  }

  async get(key) {
    this.getKeys.push(key);
    return this.objects.get(key) ?? null;
  }

  async head(key) {
    this.headKeys.push(key);
    return this.objects.get(key) ?? null;
  }

  async put(key, value, options = {}) {
    this.putKeys.push(key);
    const body = typeof value === "string" ? value : await new Response(value).text();
    this.objects.set(key, r2Object(body, options.httpMetadata?.contentType ?? "application/octet-stream", '"config-etag"'));
  }
}

class FailingBucket {
  async get() {
    throw new Error("R2 unavailable");
  }

  async head() {
    throw new Error("R2 unavailable");
  }
}

function r2Object(body, contentType, httpEtag) {
  return {
    body,
    size: Buffer.byteLength(body),
    httpEtag,
    uploaded: UPLOADED,
    writeHttpMetadata(headers) {
      headers.set("Content-Type", contentType);
    },
  };
}

function bucket() {
  return new MemoryBucket({
    [IPA_KEY]: r2Object(IPA_BYTES, "application/octet-stream", IPA_ETAG),
    [MANIFEST_KEY]: r2Object(MANIFEST_BYTES, "application/xml", MANIFEST_ETAG),
    [ICON_KEY]: r2Object(ICON_BYTES, "image/png", '"icon-etag"'),
  });
}

function request(pathname, init = {}) {
  return new Request(`https://beta.ice329.me${pathname}`, init);
}

function rawRequest(pathname, init = {}) {
  return {
    method: init.method ?? "GET",
    url: `https://beta.ice329.me${pathname}`,
  };
}

function env(store) {
  return { OTA_BUCKET: store, ORVIA_ADMIN_BRIDGE_TOKEN: ORVIA_ADMIN_TOKEN };
}

test("rejects the Orvia admin signing endpoint without its bridge token", async () => {
  const store = bucket();
  const response = await worker.fetch(request("/internal/admin/signing"), env(store));
  assert.equal(response.status, 404);
  assert.deepEqual(store.getKeys, []);
  assert.deepEqual(store.putKeys, []);
});

test("allows the existing admin Worker to read and change the signing switch", async () => {
  const store = bucket();
  const initial = await worker.fetch(request("/internal/admin/signing", {
    headers: { "X-Orvia-Admin-Token": ORVIA_ADMIN_TOKEN },
  }), env(store));
  assert.equal(initial.status, 200);
  assert.deepEqual(await initial.json(), { enabled: false, updatedAt: null });

  const update = await worker.fetch(request("/internal/admin/signing", {
    method: "POST",
    headers: {
      "X-Orvia-Admin-Token": ORVIA_ADMIN_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: true }),
  }), env(store));
  assert.equal(update.status, 200);
  const updateBody = await update.json();
  assert.equal(updateBody.enabled, true);
  assert.equal(typeof updateBody.updatedAt, "string");
  assert.deepEqual(store.putKeys, ["config/signing.json"]);

  const current = await worker.fetch(request("/internal/admin/signing", {
    headers: { "X-Orvia-Admin-Token": ORVIA_ADMIN_TOKEN },
  }), env(store));
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), updateBody);
});

test("serves the task IPA", async () => {
  const store = bucket();
  const response = await worker.fetch(request(`/sign/${TASK_ID}/Orvia.ipa`), env(store));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ipa-bytes");
  assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("Content-Length"), String(Buffer.byteLength(IPA_BYTES)));
  assert.equal(response.headers.get("ETag"), IPA_ETAG);
  assert.equal(response.headers.get("Last-Modified"), UPLOADED.toUTCString());
  assert.deepEqual(store.getKeys, [IPA_KEY]);
  assert.deepEqual(store.headKeys, []);
});

test("serves the task manifest", async () => {
  const store = bucket();
  const response = await worker.fetch(request(`/sign/${TASK_ID}/manifest.plist`), env(store));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), MANIFEST_BYTES);
  assert.equal(response.headers.get("Content-Type"), "application/xml");
  assert.equal(response.headers.get("Cache-Control"), CACHE_CONTROL);
  assert.deepEqual(store.getKeys, [MANIFEST_KEY]);
  assert.deepEqual(store.headKeys, []);
});

test("serves the task icon", async () => {
  const store = bucket();
  const response = await worker.fetch(request(`/sign/${TASK_ID}/icon.png`), env(store));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), ICON_BYTES);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), CACHE_CONTROL);
  assert.deepEqual(store.getKeys, [ICON_KEY]);
  assert.deepEqual(store.headKeys, []);
});

test("serves a manifest HEAD response from head without a body", async () => {
  const store = bucket();
  const response = await worker.fetch(
    request(`/sign/${TASK_ID}/manifest.plist`, { method: "HEAD" }),
    env(store),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Content-Type"), "application/xml");
  assert.equal(response.headers.get("Cache-Control"), CACHE_CONTROL);
  assert.equal(response.headers.get("Content-Length"), String(Buffer.byteLength(MANIFEST_BYTES)));
  assert.equal(response.headers.get("ETag"), MANIFEST_ETAG);
  assert.equal(response.headers.get("Last-Modified"), UPLOADED.toUTCString());
  assert.deepEqual(store.headKeys, [MANIFEST_KEY]);
  assert.deepEqual(store.getKeys, []);
});

test("resolves the exact task object paths", async () => {
  assert.deepEqual(resolveObjectPath(`/sign/${TASK_ID}/Orvia.ipa`), {
    key: IPA_KEY,
    contentType: "application/octet-stream",
  });
  assert.deepEqual(resolveObjectPath(`/sign/${TASK_ID}/manifest.plist`), {
    key: MANIFEST_KEY,
    contentType: "application/xml",
  });
  assert.deepEqual(resolveObjectPath(`/sign/${TASK_ID}/icon.png`), {
    key: ICON_KEY,
    contentType: "image/png",
  });
});

const invalidPaths = [
  ["uppercase UUIDs", `/sign/${TASK_ID.toUpperCase()}/Orvia.ipa`],
  ["percent-encoded filenames", `/sign/${TASK_ID}/Orvia%2Eipa`],
  ["extra path segments", `/sign/${TASK_ID}/Orvia.ipa/extra`],
  ["unknown filenames", `/sign/${TASK_ID}/unknown`],
  ["query strings", `/sign/${TASK_ID}/Orvia.ipa?download=1`],
  ["non-UUID task IDs", "/sign/not-a-uuid/Orvia.ipa"],
];

for (const [description, pathname] of invalidPaths) {
  test(`rejects ${description}`, async () => {
    const store = bucket();
    const response = await worker.fetch(request(pathname), env(store));
    assert.equal(response.status, 404);
    assert.deepEqual(store.getKeys, []);
    assert.deepEqual(store.headKeys, []);
  });
}

const dotAliasPaths = [
  ["literal dot segments", `/sign/${TASK_ID}/./Orvia.ipa`],
  ["literal dot-dot segments", `/sign/${TASK_ID}/x/../Orvia.ipa`],
  ["percent-encoded dot segments", `/sign/${TASK_ID}/%2e/Orvia.ipa`],
  ["uppercase percent-encoded dot segments", `/sign/${TASK_ID}/%2E/Orvia.ipa`],
  ["mixed-case percent-encoded dot-dot segments", `/sign/${TASK_ID}/%2e%2E/Orvia.ipa`],
];

for (const [description, pathname] of dotAliasPaths) {
  test(`rejects ${description} before URL normalization without touching R2`, async () => {
    const store = bucket();
    const response = await worker.fetch(rawRequest(pathname), env(store));
    assert.equal(response.status, 404);
    assert.deepEqual(store.getKeys, []);
    assert.deepEqual(store.headKeys, []);
  });
}

test("returns 404 when the requested object is missing", async () => {
  const store = bucket();
  store.objects.delete(IPA_KEY);
  const response = await worker.fetch(request(`/sign/${TASK_ID}/Orvia.ipa`), env(store));
  assert.equal(response.status, 404);
  assert.deepEqual(store.getKeys, [IPA_KEY]);
  assert.deepEqual(store.headKeys, []);
});

for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
  test(`rejects ${method} without touching R2`, async () => {
    const store = bucket();
    const response = await worker.fetch(
      request(`/sign/${TASK_ID}/Orvia.ipa`, { method }),
      env(store),
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD");
    assert.deepEqual(store.getKeys, []);
    assert.deepEqual(store.headKeys, []);
  });
}

test("returns a generic 500 when R2 fails", async () => {
  const response = await worker.fetch(
    request(`/sign/${TASK_ID}/Orvia.ipa`),
    env(new FailingBucket()),
  );
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "Internal Server Error");
});
