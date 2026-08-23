# Orvia OTA Refresh Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the already-published Orvia OTA task after refresh and make future completed tasks return a valid install link.

**Architecture:** Keep task state in the existing `orvia-beta` R2 result object and keep only the latest task UUID in browser `localStorage`. The Worker will validate the task ID and install URL exactly as before, while accepting legacy result objects that predate the explicit status field; the publisher will emit the explicit status for new tasks.

**Tech Stack:** Cloudflare Worker JavaScript, Cloudflare R2 binding, browser `localStorage`, Node.js built-in test runner, Python `unittest`, Wrangler deployment.

## Global Constraints

- Keep Bundle ID exactly `com.ice.orvia`.
- Do not change the existing zsign command or signing inputs.
- Do not store p12, mobileprovision, or password in browser storage, R2, or logs.
- Touch only `orvia-ota-worker`, `orvia-beta`, `beta.ice329.me`, and this repository.
- Do not touch `wzautotool`, `wz-auto-updates`, WeChatBill, or any other Cloudflare resource.

### Task 1: Publisher result contract

**Files:**
- Modify: `tools/publish_ota.py` in `serialize_result`
- Test: `tests/test_publish_ota.py`

**Interfaces:**
- Produces result JSON with the existing fields plus `status: "complete"`.
- Keeps `taskId`, `installUrl`, object keys, and Bundle ID unchanged.

- [ ] **Step 1: Write the failing test**

  Extend the existing exact-output contract test so its expected JSON includes
  `"status": "complete"` and assert the serialized result contains that exact
  field.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run:

  ```powershell
  python -B -m unittest tests.test_publish_ota.PublishOtaTests.test_serialize_result_has_exact_output_contract -v
  ```

  Expected: failure because the current serialized result has no `status` key.

- [ ] **Step 3: Implement the minimal publisher change**

  Add one entry to the `result` dictionary in `serialize_result`:

  ```python
  "status": "complete",
  ```

- [ ] **Step 4: Run the focused test and verify it passes**

  Run the same focused command and expect PASS.

### Task 2: Worker status compatibility

**Files:**
- Modify: `worker/src/index.js` in `safeCompleteStatus`
- Test: `worker/test/site.test.js`

**Interfaces:**
- `GET /api/status/{taskId}` returns `complete` for a validated legacy result
  with no `status` field.
- An explicit status other than `complete` is not accepted as complete.

- [ ] **Step 1: Write the failing tests**

  Add two status fixtures beside the existing status tests in
  `worker/test/site.test.js`:

  ```js
  test("treats a validated legacy result without status as complete", async () => {
    const bucket = new MemoryBucket({
      [`sign/${TASK_ID}/result.json`]: jsonObject({
        taskId: TASK_ID,
        installUrl: validInstallUrl(TASK_ID),
      }),
    });
    const response = await worker.fetch(request(`/api/status/${TASK_ID}`), baseEnv(bucket));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
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
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("queued");
  });
  ```

  Reuse the existing `MemoryBucket`, `jsonObject`, `request`, `baseEnv`, and
  `TASK_ID` helpers in `worker/test/site.test.js` rather than adding a second
  Worker harness. Define this helper next to the existing test helpers:

  ```js
  function validInstallUrl(taskId) {
    return `itms-services://?action=download-manifest&url=https%3A%2F%2Fbeta.ice329.me%2Fsign%2F${taskId}%2Fmanifest.plist`;
  }
  ```

- [ ] **Step 2: Run the focused Worker tests and verify the legacy test fails**

  Run:

  ```powershell
  node --test test/site.test.js
  ```

  Expected: the legacy result test fails because `safeCompleteStatus` currently
  requires `value.status === "complete"`.

- [ ] **Step 3: Implement the compatibility rule**

  Change `safeCompleteStatus` to reject only an explicit non-`complete` status:

  ```js
  if (value.status !== undefined && value.status !== "complete") return null;
  ```

  Keep the existing task ID and install URL validation before returning the
  reduced public response.

- [ ] **Step 4: Run the focused Worker tests and verify they pass**

  Run the same command and expect PASS.

### Task 3: Browser refresh recovery

**Files:**
- Modify: `worker/src/site.js` in the inline page script
- Test: `worker/test/site.test.js`

**Interfaces:**
- On queued submission, save only the lowercase UUID under a fixed Orvia-only
  storage key such as `orvia-ota:last-task-id`.
- On page load, restore that UUID and resume the existing `poll(taskId)` loop.
- On complete, keep the saved UUID and show the install link.
- On failed or malformed status, remove the saved UUID and re-enable upload.

- [ ] **Step 1: Write the failing site test**

  Extend the current site source assertions to require these exact behaviors:

  ```js
  expect(SIGNING_PAGE).toContain('localStorage.setItem("orvia-ota:last-task-id", result.taskId)');
  expect(SIGNING_PAGE).toContain('localStorage.getItem("orvia-ota:last-task-id")');
  expect(SIGNING_PAGE).toContain('localStorage.removeItem("orvia-ota:last-task-id")');
  expect(SIGNING_PAGE).toContain('poll(savedTaskId)');
  expect(SIGNING_PAGE).not.toContain('localStorage.setItem("p12"');
  expect(SIGNING_PAGE).not.toContain('localStorage.setItem("password"');
  ```

- [ ] **Step 2: Run the focused site test and verify it fails**

  Run:

  ```powershell
  node --test test/site.test.js
  ```

  Expected: failure because the current page script has no localStorage
  persistence or restore path.

- [ ] **Step 3: Implement minimal page persistence**

  Add a constant for the storage key, save `result.taskId` immediately after a
  successful `/api/sign` response, and add a `restoreTask()` function that:

  1. reads the saved UUID;
  2. validates it against the existing lowercase UUID shape;
  3. disables the submit button and calls `poll(savedTaskId)`;
  4. removes malformed saved values.

  Call `restoreTask()` once after the existing function declarations. Update
  `showError` and the failed branch in `poll` to remove only the task UUID.

- [ ] **Step 4: Run the focused site test and verify it passes**

  Run the same focused command and expect PASS.

### Task 4: Full verification and deployment

**Files:**
- No additional production files.
- Review: `worker/src/index.js`, `worker/src/site.js`, `tools/publish_ota.py`

- [ ] **Step 1: Run all Worker tests**

  ```powershell
  node --test test/index.test.js test/site.test.js test/signing.test.js
  ```

  Expected: all existing Worker tests plus the new status and site tests pass.

- [ ] **Step 2: Run all Python tests and static checks**

  ```powershell
  python -B -m unittest discover -s tests -v
  python -B -m py_compile tools/publish_ota.py tests/test_publish_ota.py tests/test_workflow_contract.py
  git diff --check
  ```

- [ ] **Step 3: Deploy only the Orvia Worker**

  From `worker/`, deploy with the existing Wrangler configuration for
  `orvia-ota-worker`. Do not run any command targeting another Worker, bucket,
  route, or DNS record.

- [ ] **Step 4: Verify the recovered task over HTTPS**

  Query the recovered task's `/api/status/{taskId}` endpoint and require HTTP
  200 with `status: "complete"` and an `itms-services` install URL. Verify the
  manifest and IPA URLs remain under `beta.ice329.me/sign/{taskId}/`.

- [ ] **Step 5: Verify browser refresh behavior**

  Open `https://beta.ice329.me/`, confirm the page restores the saved task,
  and confirm it displays the installation link without another certificate
  upload. Do not perform an iPhone installation claim until the link is visible.

- [ ] **Step 6: Commit and push the implementation**

  Commit only the intended Worker, publisher, and test changes. Leave the
  existing untracked planning files `findings.md`, `progress.md`, and
  `task_plan.md` out of the commit, then push `main`.
