import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/index.js";

const BRIDGE_TOKEN = "orvia-admin-secret";
const RELEASE_KEY = "config/release.json";

function releaseEntry(version = "1.0.0", changes = ["支持测试安装"]) {
  return {
    version,
    releasedAt: "2026-08-26",
    summary: "Orvia 测试版本",
    changes,
  };
}

function releaseDocument(entry = releaseEntry(), history = [entry]) {
  return {
    current: entry,
    history,
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

function storedObject(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return {
    async text() {
      return raw;
    },
  };
}

class MemoryBucket {
  constructor(objects = {}) {
    this.objects = new Map(Object.entries(objects).map(([key, value]) => [key, storedObject(value)]));
    this.getKeys = [];
    this.puts = [];
    this.failGet = false;
    this.failPut = false;
  }

  async get(key) {
    this.getKeys.push(key);
    if (this.failGet) throw new Error("R2 read failed");
    return this.objects.get(key) ?? null;
  }

  async put(key, value, options) {
    if (this.failPut) throw new Error("R2 write failed");
    this.puts.push({ key, value, options });
    this.objects.set(key, storedObject(value));
  }

  async readJson(key) {
    const object = this.objects.get(key);
    return object ? JSON.parse(await object.text()) : null;
  }
}

function request(pathname, init = {}) {
  return new Request(`https://beta.ice329.me${pathname}`, init);
}

function env(bucket) {
  return {
    OTA_BUCKET: bucket,
    ORVIA_ADMIN_BRIDGE_TOKEN: BRIDGE_TOKEN,
  };
}

function adminHeaders() {
  return {
    "X-Orvia-Admin-Token": BRIDGE_TOKEN,
    "content-type": "application/json",
  };
}

test("public release endpoint returns the current version and history", async () => {
  const entry = releaseEntry("1.0.1");
  const bucket = new MemoryBucket({ [RELEASE_KEY]: releaseDocument(entry) });
  const response = await worker.fetch(request("/api/release"), env(bucket));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    available: true,
    ...releaseDocument(entry),
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("public release endpoint returns an empty state when no release is published", async () => {
  const response = await worker.fetch(request("/api/release"), env(new MemoryBucket()));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    available: false,
    current: null,
    history: [],
    updatedAt: null,
  });
});

test("public release endpoint hides R2 failures behind a generic error", async () => {
  const bucket = new MemoryBucket();
  bucket.failGet = true;
  const response = await worker.fetch(request("/api/release"), env(bucket));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal Server Error" });
});

test("release admin endpoint requires the bridge token before reading R2", async () => {
  const bucket = new MemoryBucket({ [RELEASE_KEY]: releaseDocument() });
  const response = await worker.fetch(request("/internal/admin/release"), env(bucket));

  assert.equal(response.status, 404);
  assert.deepEqual(bucket.getKeys, []);
});

test("release admin endpoint returns the current release with the bridge token", async () => {
  const entry = releaseEntry("1.0.2");
  const bucket = new MemoryBucket({ [RELEASE_KEY]: releaseDocument(entry) });
  const response = await worker.fetch(request("/internal/admin/release", { headers: adminHeaders() }), env(bucket));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, available: true, ...releaseDocument(entry) });
});

test("release admin POST adds a new version and keeps newest history first", async () => {
  const oldEntry = releaseEntry("1.0.0");
  const newEntry = releaseEntry("1.0.1", ["增加版本提示", "补充安装说明"]);
  const bucket = new MemoryBucket({ [RELEASE_KEY]: releaseDocument(oldEntry) });
  const response = await worker.fetch(request("/internal/admin/release", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(newEntry),
  }), env(bucket));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, available: true, current: newEntry, history: [newEntry, oldEntry], updatedAt: (await bucket.readJson(RELEASE_KEY)).updatedAt });
});

test("release admin POST replaces an existing version instead of duplicating it", async () => {
  const oldEntry = releaseEntry("1.0.1", ["旧说明"]);
  const correctedEntry = releaseEntry("1.0.1", ["修正后的说明"]);
  const bucket = new MemoryBucket({ [RELEASE_KEY]: releaseDocument(oldEntry) });
  const response = await worker.fetch(request("/internal/admin/release", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(correctedEntry),
  }), env(bucket));

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.current, correctedEntry);
  assert.deepEqual(result.history, [correctedEntry]);
});

test("release admin POST trims history to twenty records", async () => {
  const history = Array.from({ length: 20 }, (_, index) => releaseEntry(`0.9.${index}`));
  const newest = releaseEntry("1.0.0");
  const bucket = new MemoryBucket({ [RELEASE_KEY]: releaseDocument(history[0], history) });
  const response = await worker.fetch(request("/internal/admin/release", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(newest),
  }), env(bucket));

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.history.length, 20);
  assert.equal(result.history[0].version, newest.version);
  assert.equal(result.history.at(-1).version, history.at(-2).version);
});

test("release admin POST rejects invalid release fields without changing R2", async () => {
  const entry = releaseEntry();
  const bucket = new MemoryBucket({ [RELEASE_KEY]: releaseDocument(entry) });
  const original = await bucket.readJson(RELEASE_KEY);
  const invalidBodies = [
    { ...entry, version: "bad version" },
    { ...entry, releasedAt: "2026/08/26" },
    { ...entry, summary: "x".repeat(121) },
    { ...entry, changes: [] },
    { ...entry, changes: Array.from({ length: 21 }, () => "too many") },
    { ...entry, changes: ["x".repeat(241)] },
  ];

  for (const body of invalidBodies) {
    const response = await worker.fetch(request("/internal/admin/release", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }), env(bucket));
    assert.equal(response.status, 400);
    assert.deepEqual(await bucket.readJson(RELEASE_KEY), original);
  }
});
