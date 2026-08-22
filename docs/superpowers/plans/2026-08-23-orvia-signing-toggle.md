# Orvia Signing Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-closed Orvia Worker switch that enables or disables new signing requests without changing OTA downloads.

**Architecture:** The existing Worker checks `ORVIA_SIGNING_ENABLED` before parsing a signing form. The value is exact case-insensitive `true`; all other values return a safe 503. Existing access-token validation, GitHub dispatch, R2 status reads, and OTA object serving remain unchanged.

**Tech Stack:** Cloudflare Worker JavaScript, Node built-in tests, Wrangler Worker secrets.

## Global Constraints

- Bundle ID remains exactly `com.ice.orvia`.
- Only `orvia-ota-worker` and its existing `beta.ice329.me` host may change.
- Do not add KV, D1, another Worker, another R2 bucket, DNS, or routes.
- Do not modify `wzautotool`, `wz-auto-updates`, or any other Cloudflare resource.
- Keep the existing access-token requirement when signing is enabled.

---

### Task 1: Add the signing gate and tests

**Files:**
- Modify: `worker/test/site.test.js`
- Modify: `worker/src/index.js`

**Interfaces:**
- Consumes: `env.ORVIA_SIGNING_ENABLED`.
- Produces: `POST /api/sign` returns `503 {"error":"Signing temporarily disabled"}` unless the value is case-insensitive `true`.

- [ ] **Step 1: Write failing tests**

Add tests that set `ORVIA_SIGNING_ENABLED` to `false` and omit it. Assert status 503, the exact generic JSON body, and zero GitHub calls. Set the shared valid test environment to `ORVIA_SIGNING_ENABLED: "true"` so existing signing tests continue to exercise the enabled path.

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
& 'C:\Users\花\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-force-exit --test-concurrency=1 test/site.test.js
```

Expected: the new disabled-gate assertions fail because `/api/sign` currently proceeds to token/form handling.

- [ ] **Step 3: Implement the minimal gate**

Before calling `parseSigningForm` in `signResponse`, add a local boolean check equivalent to:

```js
const enabled = typeof env.ORVIA_SIGNING_ENABLED === "string"
  && env.ORVIA_SIGNING_ENABLED.trim().toLowerCase() === "true";
if (!enabled) return jsonResponse({ error: "Signing temporarily disabled" }, 503);
```

- [ ] **Step 4: Run focused and existing Worker tests**

```powershell
& 'C:\Users\花\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-force-exit --test-concurrency=1 test/site.test.js
& 'C:\Users\花\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-force-exit --test-concurrency=1 test/index.test.js
& 'C:\Users\花\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-force-exit --test-concurrency=1 test/signing.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add worker/src/index.js worker/test/site.test.js
git commit -m "feat: add orvia signing enable switch"
```

### Task 2: Document operator switching and deploy Orvia Worker

**Files:**
- Modify: `docs/operations/orvia-ota-phase2-runbook.md`
- Modify: `tests/test_workflow_contract.py`

Add the exact Orvia-only commands:

```powershell
Push-Location worker
pnpm.cmd dlx wrangler@4.125.0 secret put ORVIA_SIGNING_ENABLED
Pop-Location
```

Document `true` as enabled and `false` as disabled, then run the full local gates,
Wrangler dry-run, and deploy only `orvia-ota-worker`.
