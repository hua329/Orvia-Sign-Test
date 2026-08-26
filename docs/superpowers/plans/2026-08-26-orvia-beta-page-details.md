# Orvia Beta Page Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Hide the Bundle ID from the public beta page, replace the placeholder brand mark with the real Orvia app icon, and make long historical release notes expandable.

**Architecture:** Keep the existing Cloudflare Worker page in \`worker/src/site.js\`. Add the converted icon as a local data-URI module imported by that page, remove only public Bundle ID presentation, and change only the client-side rendering of release history from always-expanded blocks to preview plus native disclosure content. The signing form, API calls, task polling, localStorage recovery, and release API contract remain unchanged.

**Tech Stack:** Cloudflare Workers, inline HTML/CSS, vanilla browser JavaScript, a generated standard PNG data URI, Node built-in test runner, Wrangler 4.125.0.

## Global Constraints

- Keep the Bundle ID \`com.ice.Orvia\` in code and signing validation, but do not expose that value in public page HTML.
- Use the actual \`Payload/Orvia.app/AppIcon60x60@2x.png\` from \`Orvia.ipa\` as the icon source.
- Keep the existing form field names: \`p12\`, \`mobileprovision\`, and \`password\`.
- Keep \`POST /api/sign\`, \`GET /api/status/{taskId}\`, and \`GET /api/release\` unchanged.
- Keep existing signing, polling, refresh recovery, error handling, and install-link behavior unchanged.
- Do not modify GitHub Actions, signing scripts, R2, admin UI, the auto-click product, or WeChatBill.
- Do not add external fonts, CDN assets, frameworks, or runtime dependencies.

---

### Task 1: Add regression tests for public visibility and history disclosure

**Files:**
- Modify: \`worker/test/site.test.js\`, in \`serves the Orvia signing page without exposing worker secrets\`
- Test: \`worker/test/site.test.js\`

**Interfaces:**
- Consumes: the HTML returned by \`worker.fetch(request("/"), baseEnv())\`.
- Produces: checks that prevent the public Bundle ID from returning, require a real embedded icon, and require the long-history disclosure markup.

- [ ] **Step 1: Write the failing assertions**

Add the following assertions to the page-serving test after the existing release element checks:

\`\`\`js
  assert.doesNotMatch(html, /com\\.ice\\.Orvia/);
  assert.match(html, /class="brand-mark"/);
  assert.match(html, /src="data:image\\/png;base64,[A-Za-z0-9+/=]+"/);
  assert.match(html, /document\\.createElement\\("details"\\)/);
  assert.match(html, /展开完整更新内容/);
  assert.match(html, /release-history-preview/);
\`\`\`

Keep the existing assertion for \`com.ice.Orvia\` out of this public-page test; that value belongs to signing and profile validation tests, not the public UI.

- [ ] **Step 2: Run the focused test to verify the expected red failure**

From \`C:\\Users\\花\\Documents\\Codex\\2026-08-22\\files-pasted-by-the-user-orvia\\work\\orvia-sign-test\\worker\`, run:

\`\`\`powershell
$orviaRuntime = Join-Path $env:USERPROFILE ".cache\\codex-runtimes\\codex-primary-runtime"
$orviaNodeBin = Join-Path $orviaRuntime "dependencies\\node\\bin"
$env:PATH = "$orviaNodeBin;$env:PATH"
node --test test/site.test.js
\`\`\`

Expected: the page test fails because the current public page still contains \`com.ice.Orvia\`, has no \`data:image/png\` icon, and renders history without \`details\`. Existing signing/status tests should remain green.

- [ ] **Step 3: Commit the failing test**

\`\`\`powershell
git add -- worker/test/site.test.js
git commit -m "test: define Orvia beta icon and history disclosure"
\`\`\`

Stage only \`worker/test/site.test.js\`; do not stage existing unrelated untracked files.

### Task 2: Add the real Orvia icon as a local page asset

**Files:**
- Create: \`worker/src/orvia-icon.js\`
- Input: \`Orvia.ipa\`, specifically \`Payload/Orvia.app/AppIcon60x60@2x.png\`
- Test: \`worker/test/site.test.js\`

**Interfaces:**
- Consumes: the Apple-optimized CgBI PNG in the existing IPA.
- Produces: \`ORVIA_ICON_DATA_URI\`, a browser-compatible string beginning with \`data:image/png;base64,\`.

- [ ] **Step 1: Extract the IPA icon to a temporary directory**

Use a unique temporary directory and do not alter the repository IPA files:

\`\`\`powershell
$iconDir = Join-Path ([IO.Path]::GetTempPath()) ("orvia-icon-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $iconDir | Out-Null
tar -xf Orvia.ipa -C $iconDir Payload/Orvia.app/AppIcon60x60@2x.png
\`\`\`

- [ ] **Step 2: Convert the CgBI PNG to a normal PNG**

Use the installed Python 3 runtime and Pillow for the conversion. If Pillow cannot decode the CgBI marker directly, normalize the extracted file first by parsing its \`IHDR\`, concatenating its \`IDAT\` chunks, inflating the Apple raw-deflate stream with \`wbits=-15\`, reversing each scanline filter, swapping BGRA channel order to RGBA, and writing a standard PNG with Pillow. The resulting image must be written to the temporary directory only and must open as an RGBA image with nonzero width and height.

\`\`\`powershell
$iconPath = Join-Path $iconDir 'Payload\Orvia.app\AppIcon60x60@2x.png'
$standardIconPath = Join-Path $iconDir 'orvia-icon.png'
python -c "from PIL import Image; p=r'$iconPath'; out=r'$standardIconPath'; Image.open(p).convert('RGBA').save(out, 'PNG')"
\`\`\`

The two paths in the command are the concrete paths produced in Step 1; do not write the converted asset into the repository during this conversion step.

- [ ] **Step 3: Generate the local data-URI module**

Base64-encode the verified standard PNG and create \`worker/src/orvia-icon.js\` with one exported data URI constant. Generate the source text from the verified PNG bytes so the module contains the complete base64 value.

\`\`\`js
export const ORVIA_ICON_DATA_URI = "data:image/png;base64," + "the generated base64 value from orvia-icon.png";
\`\`\`

The quoted text in the example describes the generated value and must not remain in the committed file. The generated module must contain no file-system access, no network access, and no user data. Verify the base64 decodes to a PNG signature (\`89 50 4e 47 0d 0a 1a 0a\`) before staging it.

- [ ] **Step 4: Commit the icon module**

\`\`\`powershell
git add -- worker/src/orvia-icon.js
git commit -m "feat: embed Orvia app icon in beta page"
\`\`\`

### Task 3: Hide the Bundle ID and make historical logs expandable

**Files:**
- Modify: \`worker/src/site.js\`, only page presentation and release-history rendering
- Test: \`worker/test/site.test.js\`

**Interfaces:**
- Consumes: \`ORVIA_ICON_DATA_URI\` from \`worker/src/orvia-icon.js\` and the existing release document shape.
- Produces: a public page with no Bundle ID value, a real Orvia image, preview-only history entries, and safe full details on expansion.

- [ ] **Step 1: Import and render the real icon**

Add this import as the first line of \`worker/src/site.js\`:

\`\`\`js
import { ORVIA_ICON_DATA_URI } from "./orvia-icon.js";
\`\`\`

Replace the current letter mark with:

\`\`\`html
<img class="brand-mark" src="\${ORVIA_ICON_DATA_URI}" alt="Orvia 图标">
\`\`\`

Update \`.brand-mark\` CSS to use \`object-fit: cover\`, keep the existing 46px square size and rounded corners, and remove the \`.bundle-badge\` CSS and markup. Remove the \`com.ice.Orvia\` value from all public page text while leaving every signing/profile validation occurrence outside \`site.js\` untouched.

- [ ] **Step 2: Add preview and disclosure styles**

Add these presentation rules without external resources:

\`\`\`css
.release-history-item { margin-top: 14px; color: #697890; font-size: 13px; line-height: 1.55; }
.release-history-item strong { color: #34415a; }
.release-history-preview { display: -webkit-box; margin: 5px 0 0; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.release-history-item details { margin-top: 7px; }
.release-history-item details summary { color: #285bdc; cursor: pointer; font-weight: 700; }
.release-history-full { margin: 7px 0 0; }
.release-history-item details ul { margin: 5px 0 0; padding-left: 20px; }
\`\`\`

Keep the current page’s release panel, current version rendering, and empty-state styles intact.

- [ ] **Step 3: Change only the history DOM construction**

Inside the existing \`renderRelease()\` history loop, keep the outer \`release-history-item\` and version/date heading, then render the summary preview and full content as follows:

\`\`\`js
        const item = document.createElement("div");
        item.className = "release-history-item";
        const heading = document.createElement("strong");
        heading.textContent = "v" + entry.version + " · " + entry.releasedAt;
        item.appendChild(heading);

        const preview = document.createElement("p");
        preview.className = "release-history-preview";
        preview.textContent = entry.summary;
        item.appendChild(preview);

        const details = document.createElement("details");
        const disclosure = document.createElement("summary");
        disclosure.textContent = "展开完整更新内容";
        details.appendChild(disclosure);
        const fullSummary = document.createElement("p");
        fullSummary.className = "release-history-full";
        fullSummary.textContent = entry.summary;
        details.appendChild(fullSummary);
        const changes = document.createElement("ul");
        appendChanges(changes, entry.changes);
        details.appendChild(changes);
        item.appendChild(details);
        releaseHistory.appendChild(item);
\`\`\`

Do not replace \`textContent\` with \`innerHTML\`, do not change the release endpoint, and do not alter the current-version change list.

- [ ] **Step 4: Run the focused green checks**

Run:

\`\`\`powershell
$orviaRuntime = Join-Path $env:USERPROFILE ".cache\\codex-runtimes\\codex-primary-runtime"
$orviaNodeBin = Join-Path $orviaRuntime "dependencies\\node\\bin"
$env:PATH = "$orviaNodeBin;$env:PATH"
node --test test/site.test.js
node --check src/site.js
\`\`\`

Expected: the page test passes, the public HTML has no \`com.ice.Orvia\`, and the existing script/API assertions remain present.

- [ ] **Step 5: Commit the page behavior**

\`\`\`powershell
git add -- worker/src/site.js
git commit -m "feat: hide bundle id and collapse release history"
\`\`\`

### Task 4: Run regression checks and deploy the Orvia Worker

**Files:**
- Modify: none beyond Tasks 1–3
- Test: \`worker/test/index.test.js\`, \`worker/test/site.test.js\`, \`worker/test/signing.test.js\`, \`worker/test/release.test.js\`, and \`https://beta.ice329.me/\`

**Interfaces:**
- Consumes: the unchanged signing and release API implementations.
- Produces: a deployed \`orvia-ota-worker\` with the updated public page.

- [ ] **Step 1: Run the complete Worker suite**

\`\`\`powershell
$orviaRuntime = Join-Path $env:USERPROFILE ".cache\\codex-runtimes\\codex-primary-runtime"
$orviaNodeBin = Join-Path $orviaRuntime "dependencies\\node\\bin"
$env:PATH = "$orviaNodeBin;$env:PATH"
node --test test/index.test.js test/site.test.js test/signing.test.js test/release.test.js
node --check src/site.js
\`\`\`

Expected: 55 existing tests plus the updated page assertions pass with zero failures.

- [ ] **Step 2: Run Wrangler dry-run**

From the repository root:

\`\`\`powershell
$orviaRuntime = Join-Path $env:USERPROFILE ".cache\\codex-runtimes\\codex-primary-runtime"
$orviaNodeBin = Join-Path $orviaRuntime "dependencies\\node\\bin"
$env:PATH = "$orviaNodeBin;$env:PATH"
$pnpm = Join-Path $orviaRuntime "dependencies\\bin\\fallback\\pnpm.cmd"
& $pnpm dlx wrangler@4.125.0 deploy --dry-run --config worker/wrangler.jsonc
\`\`\`

Expected: dry-run succeeds and reports only the existing \`orvia-beta\` R2 binding.

- [ ] **Step 3: Deploy only \`orvia-ota-worker\`**

\`\`\`powershell
& $pnpm dlx wrangler@4.125.0 deploy --config worker/wrangler.jsonc
\`\`\`

Expected: the existing \`beta.ice329.me\` custom domain is updated; no other Worker is targeted.

- [ ] **Step 4: Verify the live page and release API**

\`\`\`powershell
$page = Invoke-WebRequest -Uri "https://beta.ice329.me/" -UseBasicParsing
$release = Invoke-WebRequest -Uri "https://beta.ice329.me/api/release" -UseBasicParsing
$formIndex = $page.Content.IndexOf('id="sign-form"')
$releaseIndex = $page.Content.IndexOf('id="release-panel"')
if ($page.StatusCode -ne 200 -or $release.StatusCode -ne 200) { throw "live Orvia endpoints did not return HTTP 200" }
if ($page.Content -match 'com\\.ice\\.Orvia') { throw "Bundle ID leaked into public page" }
if ($formIndex -lt 0 -or $formIndex -ge $releaseIndex) { throw "signing form is not above release panel" }
if ($page.Content -notmatch 'data:image/png;base64,[A-Za-z0-9+/=]+' -or $page.Content -notmatch '展开完整更新内容') { throw "icon or history disclosure is missing" }
\`\`\`

Expected: both endpoints return HTTP 200; the public page has no Bundle ID, has the embedded icon and disclosure copy, and keeps the upload form above release information.

- [ ] **Step 5: Push the committed changes**

\`\`\`powershell
git status --short --branch
git push origin main
\`\`\`

Do not stage or push \`.wrangler/\`, \`findings.md\`, \`progress.md\`, \`task_plan.md\`, or the pre-existing release metadata plan.
