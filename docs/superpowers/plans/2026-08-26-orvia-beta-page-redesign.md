# Orvia Beta Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder and polish the Orvia beta signing page so certificate upload is the primary action at the top and release information appears below it, without changing the existing signing contract.

**Architecture:** Keep the Cloudflare Worker-rendered `SIGNING_PAGE` in `worker/src/site.js` as the only production page implementation. Add a presentation-only hierarchy around the existing form, status, install link, and release elements; keep all existing JavaScript selectors, API calls, task polling, and localStorage recovery unchanged.

**Tech Stack:** Cloudflare Worker HTML template, inline CSS, vanilla browser JavaScript, Node built-in test runner, Wrangler 4.125.0.

## Global Constraints

- Keep the existing form field names: `p12`, `mobileprovision`, `password`.
- Keep the existing interfaces: `POST /api/sign`, `GET /api/status/{taskId}`, and `GET /api/release`.
- Keep the existing task polling, refresh recovery, error handling, and install URL behavior.
- Keep the Bundle ID text as `com.ice.Orvia`.
- Only modify `worker/src/site.js` and the focused page assertions in `worker/test/site.test.js`.
- Do not modify GitHub Actions, signing scripts, the Worker signing service, the admin page, or other product pages.
- Do not add external fonts, CDN assets, frameworks, or runtime dependencies.

---

### Task 1: Add regression tests for the new page hierarchy

**Files:**
- Modify: `worker/test/site.test.js`, in `serves the Orvia signing page without exposing worker secrets`
- Test: `worker/test/site.test.js`

**Interfaces:**
- Consumes: the public HTML returned by `worker.fetch(request("/"), baseEnv())`.
- Produces: assertions that protect the upload-first layout and user-facing copy while leaving existing signing API tests unchanged.

- [ ] **Step 1: Write the failing assertions**

Add these assertions after the existing `html` assertions in the page-serving test:

```js
  assert.ok(html.indexOf('id="sign-form"') < html.indexOf('id="release-panel"'));
  assert.match(html, /上传签名材料/);
  assert.match(html, /Orvia 是一款简洁易用的个人记账软件/);
  assert.match(html, /签名过程通常需要约 1 分钟/);
  assert.match(html, /建议在 iPhone Safari 中打开安装链接/);
  assert.match(html, /name="p12"/);
  assert.match(html, /name="mobileprovision"/);
  assert.match(html, /name="password"/);
  assert.match(html, /com\.ice\.Orvia/);
```

The index assertion must use `id="sign-form"` and `id="release-panel"` so it checks document order without depending on CSS class names.

- [ ] **Step 2: Run the focused test to verify it fails**

Run from `C:\Users\花\Documents\Codex\2026-08-22\files-pasted-by-the-user-orvia\work\orvia-sign-test\worker`:

```powershell
node --test test/site.test.js
```

Expected: the existing page test fails because the current release panel precedes the form and the new copy is not present. No signing endpoint test should be changed or required for this red phase.

- [ ] **Step 3: Commit the regression test**

```powershell
git add -- worker/test/site.test.js
git commit -m "test: define Orvia beta upload-first page"
```

The commit must include only `worker/test/site.test.js`; leave existing untracked planning and Wrangler files untouched.

### Task 2: Implement the upload-first visual layout

**Files:**
- Modify: `worker/src/site.js`, the `SIGNING_PAGE` HTML/CSS template only
- Test: `worker/test/site.test.js`

**Interfaces:**
- Consumes: the current `SIGNING_PAGE` template and its existing DOM IDs.
- Produces: a responsive upload-first page that still exposes `sign-form`, `status`, `install`, and all `release-*` IDs used by the existing JavaScript.

- [ ] **Step 1: Replace only the presentation CSS**

Keep the current inline-CSP-compatible style block and replace the compact rules with a mobile-first style system covering these selectors:

```css
:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #eef4ff;
  color: #172033;
}
body {
  min-height: 100vh;
  margin: 0;
  padding: 28px 16px;
  background: radial-gradient(circle at top left, #dbe8ff 0, #eef4ff 42%, #f8fbff 100%);
}
main {
  width: min(720px, 100%);
  margin: 0 auto;
}
.brand-row { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
.brand-mark { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: #3563e9; color: #fff; font-weight: 800; }
.eyebrow { color: #3563e9; font-size: 12px; font-weight: 800; letter-spacing: .14em; }
.bundle-badge { margin-left: auto; padding: 7px 10px; border: 1px solid #cbd8f5; border-radius: 999px; color: #52617a; background: rgba(255,255,255,.7); font-size: 12px; }
.card { margin-top: 16px; padding: 22px; border: 1px solid #d9e2f2; border-radius: 22px; background: rgba(255,255,255,.92); box-shadow: 0 18px 50px rgba(57, 82, 130, .12); }
.field-grid { display: grid; gap: 14px; }
label { display: grid; gap: 8px; color: #34415a; font-weight: 700; }
input[type="file"], input[type="password"] { width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid #cbd6ea; border-radius: 12px; background: #f8fbff; color: #172033; }
button { width: 100%; margin-top: 18px; padding: 13px 18px; border: 0; border-radius: 12px; background: #3563e9; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
button:disabled { cursor: wait; opacity: .62; }
.note, .hint, #release-panel p { color: #66748c; line-height: 1.6; }
#status-card { min-height: 28px; }
#install { display: inline-block; margin-top: 12px; color: #2455d6; font-weight: 800; }
#release-panel { margin-top: 16px; }
@media (min-width: 620px) { .field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .field-grid label:last-child { grid-column: 1 / -1; } }
@media (max-width: 480px) { body { padding: 20px 12px; } .card { padding: 18px; border-radius: 18px; } .bundle-badge { display: none; } }
```

Retain visible focus styles if they already exist or add a `:focus-visible` outline for inputs and the button. Do not add external resources or JavaScript for styling.

- [ ] **Step 2: Rebuild the static section order without changing contracts**

Keep the existing JavaScript block unchanged. Make the static structure follow this order:

```html
<main>
  <div class="brand-row">
    <div class="brand-mark" aria-hidden="true">O</div>
    <div>
      <div class="eyebrow">ORVIA</div>
      <div>记账软件 · OTA 测试安装</div>
    </div>
    <span class="bundle-badge">com.ice.Orvia</span>
  </div>
  <h1>把 Orvia 安装到你的 iPhone</h1>
  <p class="hint">Orvia 是一款简洁易用的个人记账软件，帮助你随时记录收入与支出，清晰管理日常财务。</p>
  <p class="hint">上传的证书只用于当前签名任务，页面不会保存 p12、描述文件或密码。</p>

  <section class="card" id="sign-card" aria-labelledby="sign-title">
    <h2 id="sign-title">上传签名材料</h2>
    <p class="note">请上传与你的设备和 Bundle ID 匹配的 p12 与描述文件。</p>
    <form id="sign-form" enctype="multipart/form-data">
      <div class="field-grid">
        <!-- Keep the existing three labels and inputs exactly, including their names, ids, accept values, and required attributes. -->
      </div>
      <button id="submit" type="submit">开始签名</button>
      <p class="note">签名过程通常需要约 1 分钟，请不要关闭页面。</p>
    </form>
  </section>

  <section class="card" id="status-card" aria-labelledby="status-title">
    <h2 id="status-title">签名进度</h2>
    <div id="status" role="status" aria-live="polite"></div>
    <a id="install" rel="noreferrer">在 iPhone 上安装</a>
    <p class="note">建议在 iPhone Safari 中打开安装链接；其他浏览器可能无法直接唤起 iOS 安装。</p>
  </section>

  <section class="card" id="release-panel" aria-labelledby="release-title">
    <!-- Keep the existing release-version, release-date, release-summary, release-changes,
         and release-history elements and their current loading behavior. -->
  </section>
</main>
```

The comments above are implementation constraints, not literal page content: use the current input and release markup in place of them. Do not add `id` changes to any existing JavaScript-referenced element. Keep the release panel’s dynamic text assignment in the existing script.

- [ ] **Step 3: Run focused tests and syntax checks**

Run:

```powershell
node --test test/site.test.js
node --check src/site.js
```

Expected: both commands pass, and the page test confirms the form occurs before the release panel while the existing secret-exposure assertions still pass.

- [ ] **Step 4: Commit the page implementation**

```powershell
git add -- worker/src/site.js
git commit -m "feat: polish Orvia beta signing page"
```

The commit must not include changes to signing logic or unrelated products.

### Task 3: Run the complete regression suite and Worker dry-run

**Files:**
- Modify: none
- Test: `worker/test/index.test.js`, `worker/test/site.test.js`, `worker/test/signing.test.js`, `worker/test/release.test.js`

**Interfaces:**
- Consumes: the completed page implementation.
- Produces: evidence that the presentation-only change does not alter signing, status, release, or R2 behavior.

- [ ] **Step 1: Run all Worker tests**

From the `worker` directory, run:

```powershell
node --test test/index.test.js test/site.test.js test/signing.test.js test/release.test.js
```

Expected: all tests pass. A failure in signing or release tests is a stop condition; inspect the diff before deploying.

- [ ] **Step 2: Run Wrangler dry-run with the bundled runtime**

Run from the repository root:

```powershell
$orviaRuntime = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime"
$orviaNodeBin = Join-Path $orviaRuntime "dependencies\node\bin"
$env:PATH = "$orviaNodeBin;$env:PATH"
$pnpm = Join-Path $orviaRuntime "dependencies\bin\fallback\pnpm.cmd"
& $pnpm dlx wrangler@4.125.0 deploy --dry-run --config worker/wrangler.jsonc
```

Expected: Wrangler completes the build without changing the Worker name, route, R2 binding, or secrets.

### Task 4: Deploy and verify the public page

**Files:**
- Modify: none beyond the committed files from Tasks 1 and 2
- Test: deployed `https://beta.ice329.me/`

**Interfaces:**
- Consumes: Worker deployment `orvia-ota-worker` and its existing `beta.ice329.me` custom domain.
- Produces: a live page with the upload form above release information and the same signing API behavior.

- [ ] **Step 1: Deploy only the Orvia Worker**

Run from the repository root with the bundled Node runtime:

```powershell
$orviaRuntime = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime"
$orviaNodeBin = Join-Path $orviaRuntime "dependencies\node\bin"
$env:PATH = "$orviaNodeBin;$env:PATH"
$pnpm = Join-Path $orviaRuntime "dependencies\bin\fallback\pnpm.cmd"
& $pnpm dlx wrangler@4.125.0 deploy --config worker/wrangler.jsonc
```

Expected: only `orvia-ota-worker` is deployed. Do not run commands against `license-admin`, the auto-click Worker, or the WeChatBill Worker.

- [ ] **Step 2: Verify HTTP page and release endpoint**

Run:

```powershell
$page = Invoke-WebRequest -Uri "https://beta.ice329.me/" -UseBasicParsing
if ($page.StatusCode -ne 200) { throw "beta page returned $($page.StatusCode)" }
if ($page.Content.IndexOf('id="sign-form"') -ge $page.Content.IndexOf('id="release-panel"')) { throw "sign form is not above release panel" }
if ($page.Content -notmatch '上传签名材料|签名过程通常需要约 1 分钟|com\.ice\.Orvia') { throw "new page copy is missing" }
$release = Invoke-WebRequest -Uri "https://beta.ice329.me/api/release" -UseBasicParsing
if ($release.StatusCode -ne 200) { throw "release endpoint returned $($release.StatusCode)" }
```

Expected: page and release API return HTTP 200; the page contains the new upload-first copy and the uppercase Bundle ID.

- [ ] **Step 3: Perform manual iPhone acceptance**

On an iPhone, open `https://beta.ice329.me/`, confirm the upload controls are at the top, submit the already-working p12/profile/password flow, wait for the approximately-one-minute status transition, and open the resulting installation link. Confirm that the application installs and launches. If using a non-Safari browser, follow the page’s recommendation to open the installation link in iPhone Safari when the browser cannot invoke the iOS install scheme.

- [ ] **Step 4: Push the committed UI changes**

After all automated and manual checks pass:

```powershell
git status --short --branch
git push origin main
```

Do not stage or push the existing unrelated untracked files: `.wrangler/`, `findings.md`, `progress.md`, `task_plan.md`, or the pre-existing release metadata plan.
