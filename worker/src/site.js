const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; connect-src 'self'; form-action 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
};

export const SIGNING_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orvia OTA · 测试安装</title>
  <style>
    :root {
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #eef4ff;
      color: #172033;
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      padding: 28px 16px 48px;
      background: radial-gradient(circle at top left, #dbe8ff 0, #eef4ff 42%, #f8fbff 100%);
    }
    main { width: min(720px, 100%); margin: 0 auto; }
    .intro { padding: 4px 4px 8px; }
    .brand-row { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
    .brand-mark { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 15px; background: linear-gradient(135deg, #4778f4, #2852d5); color: #fff; font-size: 24px; font-weight: 800; box-shadow: 0 10px 22px rgba(53, 99, 233, .24); }
    .eyebrow { color: #3563e9; font-size: 12px; font-weight: 800; letter-spacing: .14em; }
    .product-label { margin-top: 3px; color: #52617a; font-size: 13px; }
    .bundle-badge { margin-left: auto; padding: 7px 10px; border: 1px solid #cbd8f5; border-radius: 999px; color: #52617a; background: rgba(255, 255, 255, .72); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    h1 { margin: 0 0 10px; color: #14213d; font-size: clamp(30px, 6vw, 42px); letter-spacing: -.04em; line-height: 1.12; }
    h2 { margin: 0; color: #14213d; font-size: 20px; letter-spacing: -.02em; }
    .hint { max-width: 620px; margin: 0 0 9px; color: #5f6f88; line-height: 1.7; }
    .intro-note { margin-top: 16px; color: #52617a; font-size: 13px; }
    .intro-note strong { color: #3563e9; }
    .card { margin-top: 16px; padding: 22px; border: 1px solid #d9e2f2; border-radius: 22px; background: rgba(255, 255, 255, .94); box-shadow: 0 18px 50px rgba(57, 82, 130, .12); }
    .section-heading { display: flex; align-items: flex-start; gap: 10px; }
    .section-kicker { flex: 0 0 auto; margin-top: 2px; padding: 4px 7px; border-radius: 7px; color: #2455d6; background: #e8efff; font-size: 10px; font-weight: 800; letter-spacing: .08em; }
    .note { margin: 9px 0 0; color: #697890; font-size: 13px; line-height: 1.6; }
    #sign-form { display: grid; gap: 16px; margin-top: 20px; }
    .field-grid { display: grid; gap: 14px; }
    label { display: grid; gap: 8px; color: #34415a; font-size: 14px; font-weight: 700; }
    input[type="file"], input[type="password"] { width: 100%; padding: 12px; border: 1px solid #cbd6ea; border-radius: 12px; background: #f8fbff; color: #172033; font: inherit; }
    input[type="file"]::file-selector-button { margin-right: 8px; padding: 7px 9px; border: 0; border-radius: 8px; background: #e4ecff; color: #2852d5; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    input:focus-visible, button:focus-visible { outline: 3px solid rgba(53, 99, 233, .28); outline-offset: 2px; }
    button { width: 100%; margin-top: 2px; padding: 13px 18px; border: 0; border-radius: 12px; background: linear-gradient(135deg, #4778f4, #2852d5); color: #fff; font: inherit; font-weight: 800; cursor: pointer; box-shadow: 0 10px 20px rgba(53, 99, 233, .2); }
    button:disabled { cursor: wait; opacity: .62; box-shadow: none; }
    #status-card { min-height: 136px; }
    #status { min-height: 1.5em; margin-top: 14px; color: #34415a; line-height: 1.6; }
    #install { display: none; margin-top: 12px; color: #167044; font-weight: 800; }
    #release-panel { margin-top: 16px; }
    #release-panel h2 { font-size: 19px; }
    #release-panel p { margin: 7px 0 0; color: #697890; line-height: 1.6; }
    #release-version { color: #285bdc; }
    #release-changes { margin: 12px 0 0; padding-left: 20px; color: #34415a; line-height: 1.7; }
    #release-history { margin-top: 16px; padding-top: 14px; border-top: 1px solid #e5eaf1; }
    #release-history-title { color: #52617a; font-size: 13px; font-weight: 800; }
    .release-history-item { margin-top: 12px; color: #697890; font-size: 13px; line-height: 1.55; }
    .release-history-item strong { color: #34415a; }
    .release-history-item ul { margin: 4px 0 0; padding-left: 20px; }
    @media (min-width: 620px) {
      .field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .field-grid label:last-child { grid-column: 1 / -1; }
    }
    @media (max-width: 480px) {
      body { padding: 20px 12px 36px; }
      .card { padding: 18px; border-radius: 18px; }
      .bundle-badge { display: none; }
      .section-heading { display: block; }
      .section-kicker { display: inline-block; margin-bottom: 8px; }
    }
  </style>
</head>
<body>
  <main>
    <header class="intro">
      <div class="brand-row">
        <div class="brand-mark" aria-hidden="true">O</div>
        <div>
          <div class="eyebrow">ORVIA</div>
          <div class="product-label">记账软件 · OTA 测试安装</div>
        </div>
        <span class="bundle-badge">com.ice.Orvia</span>
      </div>
      <h1>把 Orvia 安装到你的 iPhone</h1>
      <p class="hint">Orvia 是一款简洁易用的个人记账软件，帮助你随时记录收入与支出，清晰管理日常财务。</p>
      <p class="hint">上传证书后，系统会自动完成签名并生成安装链接。证书只用于当前任务，页面不会保存 p12、描述文件或密码。</p>
      <p class="intro-note">当前测试 Bundle ID：<strong>com.ice.Orvia</strong> · 签名过程通常需要约 1 分钟</p>
    </header>
    <section class="card" id="sign-card" aria-labelledby="sign-title">
      <div class="section-heading">
        <span class="section-kicker">STEP 1</span>
        <h2 id="sign-title">上传签名材料</h2>
      </div>
      <p class="note">请上传与你的设备和 Bundle ID 匹配的 p12 证书与 mobileprovision 描述文件。</p>
      <form id="sign-form" enctype="multipart/form-data">
        <div class="field-grid">
          <label>p12 证书<input name="p12" type="file" accept=".p12,application/x-pkcs12" required></label>
          <label>mobileprovision 描述文件<input name="mobileprovision" type="file" accept=".mobileprovision,application/octet-stream" required></label>
          <label>p12 密码<input name="password" type="password" autocomplete="off" required></label>
        </div>
        <button id="submit" type="submit">开始签名</button>
        <p class="note">签名过程通常需要约 1 分钟，请不要关闭页面。</p>
      </form>
    </section>
    <section class="card" id="status-card" aria-labelledby="status-title">
      <div class="section-heading">
        <span class="section-kicker">STEP 2</span>
        <h2 id="status-title">签名进度与安装</h2>
      </div>
      <div id="status" role="status" aria-live="polite"></div>
      <a id="install" rel="noreferrer">在 iPhone 上安装</a>
      <p class="note">建议在 iPhone Safari 中打开安装链接；其他浏览器可能无法直接唤起 iOS 安装。</p>
    </section>
    <section class="card" id="release-panel" aria-labelledby="release-title">
      <div class="section-heading">
        <span class="section-kicker">INFO</span>
        <h2 id="release-title">当前测试版本：<span id="release-version">版本信息暂未发布</span></h2>
      </div>
      <p id="release-date"></p>
      <p id="release-summary">发布信息加载中…</p>
      <ul id="release-changes"></ul>
      <div id="release-history" hidden>
        <div id="release-history-title">最近更新记录</div>
      </div>
    </section>
  </main>
  <script>
    const form = document.getElementById("sign-form");
    const submit = document.getElementById("submit");
    const status = document.getElementById("status");
    const install = document.getElementById("install");
    const releaseVersion = document.getElementById("release-version");
    const releaseDate = document.getElementById("release-date");
    const releaseSummary = document.getElementById("release-summary");
    const releaseChanges = document.getElementById("release-changes");
    const releaseHistory = document.getElementById("release-history");
    const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const showError = (message) => { status.textContent = message; submit.disabled = false; };
    const clearRelease = () => {
      releaseVersion.textContent = "版本信息暂未发布";
      releaseDate.textContent = "";
      releaseSummary.textContent = "当前还没有发布版本记录。";
      releaseChanges.replaceChildren();
      releaseHistory.replaceChildren();
      releaseHistory.hidden = true;
    };
    const appendChanges = (parent, changes) => {
      for (const change of Array.isArray(changes) ? changes : []) {
        const item = document.createElement("li");
        item.textContent = change;
        parent.appendChild(item);
      }
    };
    const renderRelease = (releaseDocument) => {
      if (!releaseDocument || releaseDocument.available !== true || !releaseDocument.current) {
        clearRelease();
        return;
      }
      const current = releaseDocument.current;
      releaseVersion.textContent = "v" + current.version;
      releaseDate.textContent = "发布日期：" + current.releasedAt;
      releaseSummary.textContent = current.summary;
      releaseChanges.replaceChildren();
      appendChanges(releaseChanges, current.changes);

      releaseHistory.replaceChildren();
      const historyTitle = document.createElement("div");
      historyTitle.id = "release-history-title";
      historyTitle.textContent = "最近更新记录";
      releaseHistory.appendChild(historyTitle);
      for (const entry of Array.isArray(releaseDocument.history) ? releaseDocument.history : []) {
        const item = document.createElement("div");
        item.className = "release-history-item";
        const heading = document.createElement("strong");
        heading.textContent = "v" + entry.version + " · " + entry.releasedAt;
        item.appendChild(heading);
        const summary = document.createElement("div");
        summary.textContent = entry.summary;
        item.appendChild(summary);
        const changes = document.createElement("ul");
        appendChanges(changes, entry.changes);
        item.appendChild(changes);
        releaseHistory.appendChild(item);
      }
      releaseHistory.hidden = false;
    };
    const loadRelease = async () => {
      try {
        const response = await fetch("/api/release", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("release metadata unavailable");
        renderRelease(await response.json());
      } catch {
        clearRelease();
      }
    };
    const clearSavedTask = () => {
      try {
        localStorage.removeItem("orvia-ota:last-task-id");
      } catch {}
    };

    async function poll(taskId) {
      for (;;) {
        await sleep(2000);
        try {
          const response = await fetch("/api/status/" + encodeURIComponent(taskId), { headers: { Accept: "application/json" } });
          const result = await response.json();
          if (!response.ok) throw new Error("状态查询失败");
          if (result.status === "complete" && typeof result.installUrl === "string") {
            status.textContent = "签名完成，可以安装。";
            install.href = result.installUrl;
            install.style.display = "inline-block";
            submit.disabled = false;
            return;
          }
          if (result.status === "failed") {
            clearSavedTask();
            throw new Error(result.message || "签名失败");
          }
          status.textContent = "正在签名，请稍候…";
        } catch (error) {
          showError(error instanceof Error ? error.message : "签名失败");
          return;
        }
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      install.style.display = "none";
      status.textContent = "正在提交签名任务…";
      const data = new FormData(form);
      try {
        const response = await fetch("/api/sign", {
          method: "POST",
          body: data,
        });
        const result = await response.json();
        if (!response.ok || result.status !== "queued" || !TASK_ID_PATTERN.test(result.taskId)) {
          throw new Error(result.error || "无法提交签名任务");
        }
        try {
          localStorage.setItem("orvia-ota:last-task-id", result.taskId);
        } catch {}
        status.textContent = "任务已排队，正在等待签名…";
        await poll(result.taskId);
      } catch (error) {
        showError(error instanceof Error ? error.message : "无法提交签名任务");
      }
    });

    const savedTaskId = (() => {
      try {
        return localStorage.getItem("orvia-ota:last-task-id");
      } catch {
        return null;
      }
    })();
    if (savedTaskId && TASK_ID_PATTERN.test(savedTaskId)) {
      submit.disabled = true;
      status.textContent = "正在恢复任务状态…";
      poll(savedTaskId);
    } else if (savedTaskId) {
      clearSavedTask();
    }
    loadRelease();
  </script>
</body>
</html>`;

export function signingPageResponse(includeBody = true) {
  return new Response(includeBody ? SIGNING_PAGE : null, { status: 200, headers: PAGE_HEADERS });
}
