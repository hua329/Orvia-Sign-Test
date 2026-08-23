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
  <title>Orvia OTA 签名测试</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f7fb; color: #182230; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
    main { width: min(100%, 560px); background: #fff; border: 1px solid #dfe6ef; border-radius: 18px; padding: 28px; box-shadow: 0 16px 50px rgba(25, 48, 80, .09); }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .hint { margin: 0 0 24px; color: #627086; line-height: 1.6; }
    form { display: grid; gap: 16px; }
    label { display: grid; gap: 7px; font-weight: 600; }
    input { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1px solid #cbd5e1; border-radius: 9px; font: inherit; background: #fff; }
    button { border: 0; border-radius: 9px; padding: 12px 16px; color: #fff; background: #1f6feb; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { cursor: wait; opacity: .65; }
    #status { min-height: 1.5em; margin-top: 20px; color: #334155; line-height: 1.5; }
    #install { display: none; margin-top: 12px; color: #126b3a; font-weight: 700; }
    small { color: #758399; font-weight: 400; }
  </style>
</head>
<body>
  <main>
    <h1>Orvia OTA 签名测试</h1>
    <p class="hint">后台开启签名后，上传测试证书和描述文件，系统会自动签名并生成 iPhone 安装链接。证书只用于当前任务。</p>
    <form id="sign-form" enctype="multipart/form-data">
      <label>p12 证书<input name="p12" type="file" accept=".p12,application/x-pkcs12" required></label>
      <label>mobileprovision 描述文件<input name="mobileprovision" type="file" accept=".mobileprovision,application/octet-stream" required></label>
      <label>p12 密码<input name="password" type="password" autocomplete="off" required></label>
      <button id="submit" type="submit">开始签名</button>
    </form>
    <div id="status" role="status" aria-live="polite"></div>
    <a id="install" rel="noreferrer">在 iPhone 上安装</a>
  </main>
  <script>
    const form = document.getElementById("sign-form");
    const submit = document.getElementById("submit");
    const status = document.getElementById("status");
    const install = document.getElementById("install");
    const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const showError = (message) => { status.textContent = message; submit.disabled = false; };
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
  </script>
</body>
</html>`;

export function signingPageResponse(includeBody = true) {
  return new Response(includeBody ? SIGNING_PAGE : null, { status: 200, headers: PAGE_HEADERS });
}
