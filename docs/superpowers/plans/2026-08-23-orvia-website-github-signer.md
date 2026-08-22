
# Orvia Website + GitHub Actions Signer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Add an authenticated Orvia signing page at https://beta.ice329.me that dispatches the existing GitHub Actions + zsign chain and returns a task-scoped OTA install URL.

**Architecture:** Extend only orvia-ota-worker so it serves a small same-origin form, validates p12/profile/password uploads, dispatches the existing private GitHub workflow, and polls task result objects in orvia-beta. The workflow signs the repository's Orvia-unsigned.ipa with the existing zsign command, uploads signed OTA objects, and cleans all credentials in an always-run step.

**Tech Stack:** Cloudflare Worker JavaScript, R2 binding, GitHub Actions REST workflow_dispatch, existing zsign C++ build, Python tools/publish_ota.py, Node built-in tests, Python unittest.

## Global Constraints

- Bundle ID remains exactly com.ice.orvia.
- Only orvia-ota-worker, orvia-beta, beta.ice329.me, and this repository's Orvia workflow/supporting code may change.
- Never read, update, delete, redeploy, or add bindings to wzautotool, wz-auto-updates, or any other existing Cloudflare resource.
- The formal uppercase Orvia.ipa is not replaced or modified.
- The supplied lowercase Orvia-unsigned.ipa is the operator-controlled signing input.
- p12, mobileprovision, and password never enter R2, HTML, JSON responses, logs, or workflow summaries.
- No anonymous public signing upload; /api/sign requires the Orvia access token.
- Keep the zsign command and -b com.ice.orvia argument unchanged.
- Keep the GitHub repository private because MVP workflow inputs may be retained in event metadata.
- No Phase 3 Bundle ID migration to com.ice.Orvia.

---

## Task 1: Pass the Cloudflare API token to the existing publisher

**Files:**
- Modify: tools/publish_ota.py, the WRANGLER_ENVIRONMENT_KEYS tuple
- Test: tests/test_publish_ota.py, the existing environment allowlist test

**Interfaces:**
- Consumes: existing publish_ota.py main() and build_upload_commands().
- Produces: _wrangler_environment() passes CLOUDFLARE_API_TOKEN to the pinned Wrangler subprocess while preserving the existing allowlist.

- [ ] **Step 1: Write the failing test**

Extend test_cli_upload_passes_only_allowlisted_environment so it sets CLOUDFLARE_API_TOKEN and AWS_SECRET_ACCESS_KEY, then asserts the captured subprocess environment contains the Cloudflare token and excludes the AWS sentinel.

~~~python
with patch.dict(
    os.environ,
    {"CLOUDFLARE_API_TOKEN": "cf-token", "AWS_SECRET_ACCESS_KEY": "must-not-pass"},
    clear=False,
):
    result = main(upload_args)
assert captured_env["CLOUDFLARE_API_TOKEN"] == "cf-token"
assert "AWS_SECRET_ACCESS_KEY" not in captured_env
~~~

- [ ] **Step 2: Run the test and verify the expected failure**

~~~
python -B -m unittest tests.test_publish_ota.PublishOtaTests.test_cli_upload_passes_only_allowlisted_environment
~~~

Expected: failure because the current environment allowlist does not include CLOUDFLARE_API_TOKEN.

- [ ] **Step 3: Implement the minimal change**

Add only CLOUDFLARE_API_TOKEN to WRANGLER_ENVIRONMENT_KEYS. Do not pass p12 password or profile values through this helper.

- [ ] **Step 4: Verify**

~~~
python -B -m unittest tests.test_publish_ota.PublishOtaTests.test_cli_upload_passes_only_allowlisted_environment
python -B -m unittest discover -s tests -v
python -B -m py_compile tools/publish_ota.py tests/test_publish_ota.py
git diff --check
~~~

Expected: focused test passes and the full suite reports 39 tests and OK.

- [ ] **Step 5: Commit**

~~~
git add tools/publish_ota.py tests/test_publish_ota.py
git commit -m "fix: pass cloudflare token to ota publisher"
~~~

## Task 2: Add Worker signing and status helper contracts

**Files:**
- Create: worker/src/signing.js
- Test: worker/test/signing.test.js

**Interfaces:**
- Consumes: env values ORVIA_ACCESS_TOKEN, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_WORKFLOW, and optional GITHUB_REF.
- Produces: parseSigningForm(request, env) returning Promise<{ok:true,p12Base64:string,profileBase64:string,p12Password:string}|{ok:false,response:Response}>, dispatchSigningWorkflow(env, payload, fetchImpl) returning Promise<void>, taskResultKey(taskId), and taskErrorKey(taskId).

- [ ] **Step 1: Write failing tests**

Create Node built-in tests for authentication, multipart conversion, exact GitHub input names, and task-key validation.

~~~js
test("rejects missing access token before reading form data", async () => {
  const result = await parseSigningForm(requestWithoutToken, env);
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
});

test("encodes p12 and profile and preserves password", async () => {
  const result = await parseSigningForm(validMultipartRequest, env);
  assert.equal(result.ok, true);
  assert.equal(result.p12Base64, expectedP12Base64);
  assert.equal(result.profileBase64, expectedProfileBase64);
  assert.equal(result.p12Password, "test-password");
});

test("dispatches the fixed workflow with the task id", async () => {
  const calls = [];
  await dispatchSigningWorkflow(env, payload, async (...args) => {
    calls.push(args);
    return new Response(null, { status: 204 });
  });
  assert.equal(JSON.parse(calls[0][1].body).inputs.task_id, TASK_ID);
  assert.equal(calls[0][1].headers.Authorization, "Bearer github-token");
});

test("rejects malformed task ids and creates bounded result keys", () => {
  assert.throws(() => taskResultKey("not-a-uuid"));
  assert.equal(taskResultKey(TASK_ID), "sign/" + TASK_ID + "/result.json");
  assert.equal(taskErrorKey(TASK_ID), "sign/" + TASK_ID + "/error.json");
});
~~~

Assert that only task_id, p12_base64, profile_base64, and p12_password appear in the dispatch inputs, and that password text is absent from errors and responses.

- [ ] **Step 2: Run the tests and verify the expected failure**

~~~
$node = 'C:\Users\花\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
Push-Location worker
& $node --test --test-concurrency=1 test/signing.test.js
Pop-Location
~~~

Expected: failure because worker/src/signing.js does not exist.

- [ ] **Step 3: Implement the helpers**

Implement these exact rules:

1. Require X-Orvia-Access-Token and compare it with env.ORVIA_ACCESS_TOKEN using a length-independent byte comparison. Return a generic 401 response.
2. Parse request.formData() only after authentication. Accept exactly p12, mobileprovision, and password; reject missing or empty values and bounded oversized files.
3. Convert the two File values to base64 with arrayBuffer() and btoa(), without writing them to R2 or logging them.
4. Generate task IDs in the route handler with crypto.randomUUID().
5. Dispatch POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches with GitHub JSON headers, Bearer env.GITHUB_TOKEN, ref env.GITHUB_REF or main, and the four exact inputs. The route uses env.GITHUB_FETCH only in tests and global fetch in production.
6. Treat only HTTP 204 as success; return a generic 502 without forwarding GitHub response text.
7. Validate task IDs with the lowercase UUID pattern already used by the OTA routes.

- [ ] **Step 4: Verify focused and existing Worker tests**

~~~
Push-Location worker
& $node --test --test-concurrency=1 test/signing.test.js test/index.test.js
Pop-Location
~~~

- [ ] **Step 5: Commit**

~~~
git add worker/src/signing.js worker/test/signing.test.js
git commit -m "feat: add authenticated github signing helpers"
~~~

## Task 3: Add the Worker routes, status polling, and signing page

**Files:**
- Create: worker/src/site.js
- Modify: worker/src/index.js
- Modify: worker/test/index.test.js
- Create: worker/test/site.test.js

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: GET /, POST /api/sign, GET /api/status/{taskId}, and task-scoped icon.png, result.json, and error.json support.

- [ ] **Step 1: Write failing route and page tests**

Add tests for the static page, authenticated multipart dispatch, no-token rejection, status results, missing/error results, and exact task-scoped R2 access.

~~~js
test("serves the signing page without exposing secrets", async () => {
  const response = await worker.fetch(request("/"), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Orvia OTA/);
  assert.doesNotMatch(html, /GITHUB_TOKEN|p12_password/);
});

test("queues an authenticated multipart signing request", async () => {
  const response = await worker.fetch(validSignRequest(), { ...env, GITHUB_FETCH: fakeGithub });
  assert.equal(response.status, 202);
  assert.match((await response.json()).taskId, /^[0-9a-f-]{36}$/);
  assert.equal(fakeGithubBody.inputs.profile_base64, expectedProfileBase64);
});

test("rejects signing without the access token and does not call GitHub", async () => {
  const response = await worker.fetch(request("/api/sign", { method: "POST", body }), env);
  assert.equal(response.status, 401);
  assert.equal(githubCalls, 0);
});

test("returns complete status only from task-scoped result JSON", async () => {
  const response = await worker.fetch(request("/api/status/" + TASK_ID), envWithResult);
  assert.deepEqual(await response.json(), {
    taskId: TASK_ID,
    status: "complete",
    installUrl,
  });
});
~~~

Also cover invalid IDs, query strings, unsupported methods, missing objects, safe error objects, oversized fields, icon content type, and result/error keys that do not touch unrelated R2 keys.

- [ ] **Step 2: Run the tests and verify the expected failure**

~~~
Push-Location worker
& $node --test --test-concurrency=1 test/index.test.js test/site.test.js test/signing.test.js
Pop-Location
~~~

Expected: new route/page tests fail because the current Worker has no site, API, status, icon, or result routes.

- [ ] **Step 3: Implement the minimal Worker and page**

Implement site.js as static same-origin HTML with p12, mobileprovision, password, and access-token fields. The browser script submits FormData to /api/sign, polls /api/status/{taskId} every two seconds, and shows the install link only for complete status. Never echo password or file contents.

In index.js:

1. Preserve raw dot-segment checks, exact lowercase UUID checks, GET/HEAD behavior, and immutable caching for IPA/manifest.
2. Route GET / without query strings to site.js.
3. Route POST /api/sign to parseSigningForm, crypto.randomUUID(), dispatchSigningWorkflow, and a 202 queued JSON response.
4. Route GET /api/status/{taskId} to read result.json first and error.json second from OTA_BUCKET, returning only safe queued/complete/failed JSON.
5. Add icon.png, result.json, and error.json only under a validated task prefix; all Worker paths remain read-only.
6. Use no-store for HTML/API responses and keep immutable caching for IPA/manifest/icon.

- [ ] **Step 4: Verify all Worker tests**

~~~
Push-Location worker
& $node --test --test-concurrency=1 test/index.test.js test/site.test.js test/signing.test.js
Pop-Location
~~~

- [ ] **Step 5: Commit**

~~~
git add worker/src/index.js worker/src/site.js worker/test/index.test.js worker/test/site.test.js
git commit -m "feat: add authenticated orvia signing page"
~~~

## Task 4: Connect the GitHub workflow to Orvia OTA publishing

**Files:**
- Create: Orvia-unsigned.ipa by copying C:\Users\花\Desktop\Orvia-unsigned.ipa; do not modify Orvia.ipa.
- Modify: .github/workflows/sign.yml
- Test: tests/test_workflow_contract.py

**Interfaces:**
- Consumes: Worker dispatch inputs and GitHub repository secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
- Produces: signed task objects under sign/{taskId}/ and a result JSON containing the install URL.

- [ ] **Step 1: Write failing workflow contract tests**

Create static Python tests reading the workflow text and asserting:

~~~python
workflow = Path(".github/workflows/sign.yml").read_text()
assert "Orvia-unsigned.ipa" in workflow
assert "-b com.ice.orvia" in workflow
assert "--bucket orvia-beta" in workflow
assert "https://beta.ice329.me" in workflow
assert "CLOUDFLARE_API_TOKEN" in workflow
assert "if: always()" in workflow
assert "rm -f cert.p12 profile.mobileprovision" in workflow
assert "image/png" in workflow
assert "result.json" in workflow
~~~

Do not assert or modify any wz resource name.

- [ ] **Step 2: Run the tests and verify the expected failure**

~~~
python -B -m unittest tests.test_workflow_contract -v
~~~

Expected: failure because the current workflow signs Orvia.ipa and only uploads a GitHub artifact.

- [ ] **Step 3: Implement the workflow handoff**

Keep the existing zsign build and command unchanged except for the input file and task ID. Add required workflow_dispatch input task_id and use inputs.task_id. Run:

~~~bash
python tools/publish_ota.py \
  --ipa Orvia-signed.ipa \
  --bucket orvia-beta \
  --base-url https://beta.ice329.me \
  --task-id "$TASK_ID" \
  --account-id "$CLOUDFLARE_ACCOUNT_ID" > publish-result.json
~~~

Use the repository secret CLOUDFLARE_API_TOKEN in the job environment. Extract Payload/*.app/AppIcon60x60@2x.png to icon.png. Upload it with pinned npx --yes wrangler@4.125.0 to orvia-beta/sign/$TASK_ID/icon.png with image/png, and upload publish-result.json as result.json with application/json. Add the install URL to GITHUB_STEP_SUMMARY only after parsing non-secret publisher output. Add always-run cleanup for credentials, IPA files, extracted icon, result, and zsign build directories.

- [ ] **Step 4: Verify workflow/static and existing tests**

~~~
python -B -m unittest tests.test_workflow_contract -v
python -B -m unittest discover -s tests -v
python -B -m py_compile tools/publish_ota.py tests/test_publish_ota.py tests/test_workflow_contract.py
git diff --check
~~~

- [ ] **Step 5: Commit**

~~~
git add Orvia-unsigned.ipa .github/workflows/sign.yml tests/test_workflow_contract.py
git commit -m "feat: publish signed ota from github action"
~~~

## Task 5: Document Orvia secrets, browser flow, and acceptance

**Files:**
- Modify: docs/operations/orvia-ota-phase2-runbook.md
- Modify: tests/test_workflow_contract.py

**Interfaces:**
- Consumes: Tasks 1-4 Worker API, workflow inputs, Orvia secrets, and task object contract.
- Produces: operator instructions for setting only Orvia secrets, using the website, polling status, and performing separate HTTP/iPhone gates.

- [ ] **Step 1: Add failing runbook assertions**

Add static checks:

~~~python
runbook = Path("docs/operations/orvia-ota-phase2-runbook.md").read_text()
assert "orvia-beta" in runbook
assert "beta.ice329.me" in runbook
assert "ORVIA_ACCESS_TOKEN" in runbook
assert "GITHUB_TOKEN" in runbook
assert "wzautotool" in runbook
assert "com.ice.orvia" in runbook
~~~

- [ ] **Step 2: Run the test and verify the expected failure**

~~~
python -B -m unittest tests.test_workflow_contract -v
~~~

Expected: failure because the current runbook documents CLI-only publishing and no website status flow.

- [ ] **Step 3: Update the runbook**

Document only Orvia Worker secret commands, without values:

~~~powershell
Push-Location worker
pnpm.cmd dlx wrangler@4.125.0 secret put ORVIA_ACCESS_TOKEN
pnpm.cmd dlx wrangler@4.125.0 secret put GITHUB_TOKEN
pnpm.cmd dlx wrangler@4.125.0 secret put GITHUB_OWNER
pnpm.cmd dlx wrangler@4.125.0 secret put GITHUB_REPO
pnpm.cmd dlx wrangler@4.125.0 secret put GITHUB_WORKFLOW
Pop-Location
~~~

Document GitHub repository secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, browser submission, queued/complete/failed status, task cleanup, HTTP checks, iPhone acceptance, and the prohibition on wzautotool, wz-auto-updates, other buckets, Workers, routes, and DNS.

- [ ] **Step 4: Run complete local verification**

~~~
$node = 'C:\Users\花\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
Push-Location worker
& $node --test --test-concurrency=1 test/index.test.js test/signing.test.js test/site.test.js
Pop-Location
python -B -m unittest discover -s tests -v
python -B -m py_compile tools/publish_ota.py tests/test_publish_ota.py tests/test_workflow_contract.py
git diff --check
~~~

Expected: all Worker and Python tests pass; no live CF mutation is part of this local verification.

- [ ] **Step 5: Commit**

~~~
git add docs/operations/orvia-ota-phase2-runbook.md tests/test_workflow_contract.py
git commit -m "docs: document orvia website signing acceptance"
~~~

## Task 6: Orvia-only live acceptance

**Files:**
- No source changes expected.
- Evidence: GitHub workflow run, task result, R2 object list for one task, HTTP headers, and iPhone installation record.

**Interfaces:**
- Consumes: one approved test p12/profile/password and committed Orvia-unsigned.ipa.
- Produces: signed com.ice.orvia install result and acceptance report.

- [ ] **Step 1: Configure only Orvia secrets**

Set the five Worker secrets from Task 5 and the two GitHub repository secrets. Do not list or edit any non-Orvia Worker, R2 bucket, route, DNS record, or secret.

- [ ] **Step 2: Trigger the website signing request**

Open https://beta.ice329.me/, enter the Orvia access token, select p12 and mobileprovision, enter the password, submit, and record the lowercase task ID. Do not paste certificate or password data into logs or chat.

- [ ] **Step 3: Verify task completion and objects**

Poll until status is complete. Verify Bundle ID com.ice.orvia, matching task-scoped IPA/manifest keys, and an itms-services URL. Confirm only that task prefix contains Orvia.ipa, manifest.plist, icon.png, and result.json.

- [ ] **Step 4: Verify HTTP and manifest**

Use curl.exe -I on IPA and manifest URLs. Require HTTPS, 200, application/octet-stream for IPA, and application/xml for manifest. Download the manifest and verify its IPA URL, com.ice.orvia, and signed version metadata.

- [ ] **Step 5: Verify iPhone OTA**

Open the exact installUrl in iPhone Safari, accept installation, launch Orvia, and verify installed Bundle ID com.ice.orvia. Record iOS version, task ID, HTTP results, and installation result. Do not begin uppercase migration.

- [ ] **Step 6: Record redacted evidence only if requested**

Do not commit p12, profiles, passwords, signed IPAs, or device identifiers. Store only redacted task ID, version, URLs, and pass/fail status if the user requests an acceptance report.
