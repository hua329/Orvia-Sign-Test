# Orvia OTA Phase 2 Worker/R2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Cloudflare Worker on `beta.ice329.me` that serves the existing Phase 1 task-scoped IPA and `manifest.plist` objects from the isolated `orvia-install` R2 bucket, while leaving the validated signing chain unchanged.

**Architecture:** Keep `tools/publish_ota.py` as the only upload path. Add a focused `worker/` module Worker that accepts only canonical task object paths, reads through one R2 binding, and returns immutable OTA responses for `GET`/`HEAD`. Validate it locally with Node's built-in test runner and pinned Wrangler dry-run; live deployment and iPhone installation remain manual acceptance steps.

**Tech Stack:** Cloudflare Workers module syntax, Cloudflare R2 Worker binding, Wrangler `4.125.0`, Node.js built-in `node:test`, Python 3.10+ existing `unittest` suite, JSONC Wrangler configuration.

## Global Constraints

- Bundle ID remains exactly `com.ice.orvia`; do not implement `com.ice.Orvia` in this phase.
- R2 bucket remains exactly `orvia-install`.
- Object keys remain exactly `sign/{taskId}/Orvia.ipa` and `sign/{taskId}/manifest.plist`.
- Worker is read-only: only `GET` and `HEAD`; no public `PUT`, `POST`, `DELETE`, browser upload, p12, profile, or signing logic.
- The existing Zsign/Xcode workflow, `.github/workflows/sign.yml`, and tracked `Orvia.ipa` are not modified.
- The Worker accepts only lowercase canonical UUID task IDs and the two exact filenames.
- IPA responses use `application/octet-stream`; manifest responses use `application/xml`.
- Use `beta.ice329.me` as the Phase 2 base URL; do not attach the Worker to `ice329.me`, `www.ice329.me`, or `downloads.ice329.me`.
- No Cloudflare resource mutation is performed during local implementation.

---

### Task 1: Define the Worker contract with failing tests

**Files:**
- Create: `worker/test/index.test.js`
- Read: `docs/superpowers/specs/2026-08-22-orvia-ota-phase2-design.md`

**Interfaces:**
- Consumes: the future default Worker export from `worker/src/index.js` and named `resolveObjectPath(pathname)`.
- Produces: tests defining exact paths, R2 keys, methods, headers, status codes, and error boundaries for Task 2.

- [ ] **Step 1: Add the in-memory R2 fixture and request helpers**

Create `worker/test/index.test.js` with Node's built-in `node:test`, a `MemoryBucket` exposing `get()`/`head()`, constants for the fixed UUID and the two exact keys, and helpers that create `Request` objects for `https://beta.ice329.me`.

The fixture must return objects with `body`, `size`, `httpEtag`, `uploaded`, and `writeHttpMetadata(headers)` so response metadata is tested against the same surface used by R2.

- [ ] **Step 2: Add valid GET/HEAD and path-resolution tests**

Add tests that assert: IPA GET returns `200`, `ipa-bytes`, `application/octet-stream`, immutable cache control, `Content-Length`, ETag, and the exact IPA key; manifest GET returns `200`, `manifest-bytes`, and `application/xml`; manifest HEAD returns `200`, empty text, metadata headers, and calls `head()` rather than `get()`; `resolveObjectPath()` returns the exact two task keys and content types.

Use this concrete assertion shape for the IPA case:

```js
test("serves the task IPA", async () => {
  const store = bucket();
  const response = await worker.fetch(request(`/sign/${TASK_ID}/Orvia.ipa`), env(store));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ipa-bytes");
  assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.deepEqual(store.getKeys, [IPA_KEY]);
});
```

- [ ] **Step 3: Add rejection and failure tests**

Add table-driven assertions that uppercase UUIDs, percent-encoded filenames, extra segments, unknown filenames, query strings, and non-UUID task IDs return `404`; missing objects return `404`; `POST`, `PUT`, `DELETE`, and `OPTIONS` return `405` with `Allow: GET, HEAD` without touching R2; and a failing bucket returns `500` with exactly `Internal Server Error`.

- [ ] **Step 4: Run the tests to verify RED**

Run `node --test test/index.test.js` from `worker/`. Expected failure: `worker/src/index.js` is missing. Fix only test/import errors if the failure is not caused by the missing implementation.

- [ ] **Step 5: Commit the red tests**

```powershell
git add worker/test/index.test.js
git -c user.name=Codex -c user.email=codex@local commit -m "test: define Orvia OTA worker contract"
```

### Task 2: Implement the read-only R2 Worker

**Files:**
- Create: `worker/src/index.js`
- Test: `worker/test/index.test.js`

**Interfaces:**
- Consumes: `Request`, `URL`, `Response`, and `env.OTA_BUCKET.get()`/`head()`.
- Produces: default module Worker export and named `resolveObjectPath(pathname)`.

- [ ] **Step 1: Implement canonical path resolution**

Create `worker/src/index.js` with a lowercase canonical UUID regex and a fixed filename map. The resolver returns `{ key, contentType }` for only `Orvia.ipa` and `manifest.plist`, and returns `null` for every other path. Do not call `decodeURIComponent()` or normalize the path.

```js
const TASK_PATH = new RegExp("^/sign/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(Orvia[.]ipa|manifest[.]plist)$");
const CONTENT_TYPES = { "Orvia.ipa": "application/octet-stream", "manifest.plist": "application/xml" };

export function resolveObjectPath(pathname) {
  const match = TASK_PATH.exec(pathname);
  if (!match) return null;
  const [, taskId, filename] = match;
  return { key: `sign/${taskId}/${filename}`, contentType: CONTENT_TYPES[filename] };
}
```

- [ ] **Step 2: Implement metadata headers and request handling**

Add `notFound()`, `methodNotAllowed()`, and `responseHeaders(object, contentType)`. The headers helper must call `object.writeHttpMetadata(headers)`, then override `Content-Type` and `Cache-Control`, and add `Content-Length`, `ETag`, and `Last-Modified` when available.

The default `fetch()` handler must reject methods before R2 access, reject query strings and unresolved paths with `404`, call `head()` for HEAD and `get()` for GET, return `404` for a missing object, and catch R2 failures as a generic `500` response.

- [ ] **Step 3: Run GREEN and commit**

Run `node --test test/index.test.js` from `worker/`; expected result is all Worker tests passing with no network calls. Commit `worker/src/index.js` as `feat: serve Orvia OTA objects from R2`.

### Task 3: Add Wrangler configuration and local commands

**Files:**
- Create: `worker/package.json`
- Create: `worker/wrangler.jsonc`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `worker/src/index.js` and the existing `orvia-install` bucket.
- Produces: pinned `test`, `dev`, `dry-run`, and `deploy` scripts plus `OTA_BUCKET` and the `beta.ice329.me` Custom Domain.

- [ ] **Step 1: Create `worker/package.json`**

Use no runtime dependency and these exact scripts:

```json
{
  "name": "orvia-ota-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/index.test.js",
    "dev": "npx --yes wrangler@4.125.0 dev",
    "dry-run": "npx --yes wrangler@4.125.0 deploy --dry-run",
    "deploy": "npx --yes wrangler@4.125.0 deploy"
  }
}
```

- [ ] **Step 2: Create `worker/wrangler.jsonc`**

Set `main` to `src/index.js`, compatibility date `2026-08-22`, `workers_dev` false, custom domain route `{ "pattern": "beta.ice329.me", "custom_domain": true }`, R2 binding `{ "binding": "OTA_BUCKET", "bucket_name": "orvia-install" }`, and observability enabled with sampling rate `1`.

- [ ] **Step 3: Extend `.gitignore`**

Append exactly `worker/node_modules/`, `worker/.wrangler/`, and `worker/worker-configuration.d.ts`; preserve the existing Python ignore entries.

- [ ] **Step 4: Validate without deployment and commit**

Run from `worker/`: `npm test` and `npx --yes wrangler@4.125.0 deploy --dry-run`. Expected: tests pass and Wrangler bundles/validates without creating a Worker, route, DNS record, or R2 object. Commit the three config files as `build: configure Orvia OTA Worker`.

### Task 4: Add the Phase 2 operator runbook

**Files:**
- Create: `docs/operations/orvia-ota-phase2-runbook.md`
- Read: `docs/operations/orvia-ota-phase1-runbook.md`, `tools/publish_ota.py`

**Interfaces:**
- Consumes: the Worker scripts, Phase 1 publisher flags, and the exact bucket/domain contract.
- Produces: a checklist separating local verification from live deployment, upload, HTTP, and iPhone acceptance.

- [ ] **Step 1: Document local-only verification**

Document `npm test`, Wrangler `deploy --dry-run`, the existing 38-test Python command, and `py_compile`; state that none performs R2 upload, Worker deployment, DNS change, or iPhone installation.

- [ ] **Step 2: Document separately approved deployment preflight**

Require authenticated Wrangler, the exact existing `orvia-install` bucket, Cloudflare ownership of `ice329.me`, availability of `beta.ice329.me`, and explicit approval for Custom Domain/DNS/certificate mutation. Reject legacy hosts and any bucket other than `orvia-install`.

- [ ] **Step 3: Document deploy/upload/HTTP/iPhone commands**

Use `npx --yes wrangler@4.125.0 deploy`, then the Phase 1 dry-run and approved upload with `--base-url https://beta.ice329.me`, recorded `--task-id`, and 32-hex `--account-id`; check both URLs with `curl.exe -I` for `200`, HTTPS, `application/octet-stream`, and `application/xml`; open `installUrl` in Safari and verify the installed app launches with `com.ice.orvia`.

- [ ] **Step 4: Document task-scoped cleanup and non-goals**

State that only the recorded task prefix may be cleaned after partial upload; p12/profile, browser upload, automatic signing, uppercase Bundle ID migration, and lifecycle cleanup remain later work.

- [ ] **Step 5: Commit the runbook**

```powershell
git add docs/operations/orvia-ota-phase2-runbook.md
git -c user.name=Codex -c user.email=codex@local commit -m "docs: add Orvia OTA phase 2 runbook"
```

### Task 5: Run the complete local verification gate

**Files:**
- Verify: `worker/src/index.js`, `worker/test/index.test.js`, `worker/wrangler.jsonc`, `tools/publish_ota.py`, `tests/test_publish_ota.py`

**Interfaces:**
- Consumes: all Phase 2 implementation and documentation commits.
- Produces: evidence that Worker behavior and the original Phase 1 suite remain green, with no changes to the tracked IPA or signing workflow.

- [ ] **Step 1: Run Worker tests and Wrangler dry-run**

Run from `worker/`:

```powershell
npm test
npx --yes wrangler@4.125.0 deploy --dry-run
```

- [ ] **Step 2: Run the existing Phase 1 gate**

```powershell
python -B -m unittest discover -s tests -v
python -B -m py_compile tools/publish_ota.py tests/test_publish_ota.py
git diff --check
```

Expected: Worker tests pass, Wrangler validates without deployment, Python remains 38/38, compilation succeeds, and no whitespace errors appear.

- [ ] **Step 3: Verify signing-chain immutability and status**

```powershell
git diff 7ba3718 -- .github/workflows/sign.yml Orvia.ipa
git status --short --branch
git log --oneline --max-count=8
```

Expected: no diff for `.github/workflows/sign.yml` or `Orvia.ipa`, and a clean status after planned commits.

- [ ] **Step 4: Record evidence and hand off**

Update `progress.md` with test counts, dry-run result, commit IDs, and any operator prerequisite error. Update `task_plan.md` so completed phases are marked complete and the next action is live operator acceptance, not an unsupported claim of OTA success.
