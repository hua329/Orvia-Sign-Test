import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { resolveObjectPath } from "../src/index.js";

const TASK_ID = "123e4567-e89b-12d3-a456-426614174000";
const IPA_KEY = `sign/${TASK_ID}/Orvia.ipa`;
const MANIFEST_KEY = `sign/${TASK_ID}/manifest.plist`;
const IPA_BYTES = "ipa-bytes";
const MANIFEST_BYTES = "manifest-bytes";
const IPA_ETAG = '"ipa-etag"';
const MANIFEST_ETAG = '"manifest-etag"';
const UPLOADED = new Date("2026-08-22T12:34:56.000Z");
const CACHE_CONTROL = "public, max-age=31536000, immutable";

class MemoryBucket {
  constructor(objects) {
    this.objects = new Map(Object.entries(objects));
    this.getKeys = [];
    this.headKeys = [];
  }

  async get(key) {
    this.getKeys.push(key);
    return this.objects.get(key) ?? null;
  }

  async head(key) {
    this.headKeys.push(key);
    return this.objects.get(key) ?? null;
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
  });
}

function request(pathname, init = {}) {
  return new Request(`https://beta.ice329.me${pathname}`, init);
}

function env(store) {
  return { OTA_BUCKET: store };
}

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
