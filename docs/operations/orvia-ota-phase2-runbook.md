# Orvia OTA Phase 2：网站签名与 iPhone 验收手册

本手册只覆盖 Orvia 专用链路。当前测试阶段 Bundle ID 必须保持
`com.ice.orvia`，不得切换为 `com.ice.Orvia`。

## 固定范围

只允许使用以下资源：

| 项目 | 固定值 |
| --- | --- |
| Worker | `orvia-ota-worker` |
| R2 | `orvia-beta` |
| 公网域名 | `https://beta.ice329.me` |
| 输入 IPA | `Orvia-unsigned.ipa` |
| Bundle ID | `com.ice.orvia` |

禁止读取、修改、重新部署、绑定或删除以下任何非 Orvia 资源：

- `wzautotool`
- `wz-auto-updates`
- 其他 Worker、R2 bucket、route、DNS、Custom Domain 或 secret

原有正式包 `Orvia.ipa` 不替换、不重签、不修改。网站只接受授权测试者的
p12、mobileprovision 和密码；这些内容不会写入 R2、HTML、API 响应、日志或
GitHub Summary。GitHub 仓库必须保持私有，因为 MVP 的 workflow inputs 可能
出现在 GitHub 的事件元数据中。

## 链路与接口

```text
测试者浏览器
  -> beta.ice329.me/
  -> POST /api/sign（访问令牌 + p12 + mobileprovision + 密码）
  -> 私有 GitHub Actions + 原有 zsign 链路
  -> R2 orvia-beta/sign/{taskId}/
  -> GET /api/status/{taskId}
  -> itms-services 安装链接
```

Worker 页面和 API：

```text
GET  /
POST /api/sign
GET  /api/status/{lowercase-uuid}
GET|HEAD /sign/{taskId}/Orvia.ipa
GET|HEAD /sign/{taskId}/manifest.plist
GET|HEAD /sign/{taskId}/icon.png
```

签名请求返回：

```json
{"taskId":"<lowercase-uuid>","status":"queued"}
```

状态查询返回 queued、complete 或 failed。只有 complete 才会返回
`installUrl`，浏览器也只在 complete 时显示安装按钮。

## 1. 配置 Orvia Worker secrets

下面命令会提示在本地输入值；不要把值写入命令、仓库、聊天或手册。只在
`worker/` 目录、只对 `orvia-ota-worker` 执行：

```powershell
Push-Location worker
pnpm.cmd dlx wrangler@4.125.0 secret put ORVIA_ACCESS_TOKEN
pnpm.cmd dlx wrangler@4.125.0 secret put ORVIA_SIGNING_ENABLED
pnpm.cmd dlx wrangler@4.125.0 secret put GITHUB_TOKEN
pnpm.cmd dlx wrangler@4.125.0 secret put GITHUB_OWNER
pnpm.cmd dlx wrangler@4.125.0 secret put GITHUB_REPO
pnpm.cmd dlx wrangler@4.125.0 secret put GITHUB_WORKFLOW
Pop-Location
```

推荐 `GITHUB_WORKFLOW` 使用 `sign.yml`，`GITHUB_REF` 不配置时默认为
`main`。`ORVIA_ACCESS_TOKEN` 是测试者打开网站时填写的访问令牌；它不是
GitHub token，也不会发送到浏览器脚本之外的页面内容。

`ORVIA_SIGNING_ENABLED` 只接受两个操作值：输入 `true` 开启新签名任务，
输入 `false` 关闭新签名任务。缺省或其他值也会保持关闭。关闭时网站和已有
OTA 链接仍可访问，只是 `/api/sign` 返回 503；开启时仍然需要访问令牌。

在 GitHub 私有仓库的 Settings → Secrets and variables → Actions 中，仅添加：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

这两个值只由 workflow 使用。p12、mobileprovision 和 p12 密码由测试者在
网站提交，不要把它们预先放进 GitHub secrets。

## 2. 本地验证（不产生线上变更）

以下检查不会上传 R2、部署 Worker、修改 DNS/证书，也不会安装 iPhone 应用：

```powershell
$node = 'C:\Users\花\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
Push-Location worker
& $node --test --test-force-exit --test-concurrency=1 test/site.test.js
& $node --test --test-force-exit --test-concurrency=1 test/index.test.js
& $node --test --test-force-exit --test-concurrency=1 test/signing.test.js
Pop-Location

python -B -m unittest discover -s tests -v
python -B -m py_compile tools/publish_ota.py tests/test_publish_ota.py tests/test_workflow_contract.py
python -c "import yaml; from pathlib import Path; yaml.safe_load(Path('.github/workflows/sign.yml').read_text(encoding='utf-8')); print('workflow YAML parsed')"
git diff --check
```

当前环境的 bundled Node v24.19 在 Windows 退出清理阶段偶发 teardown 错误，
因此 Worker 测试按文件串行执行并使用官方 `--test-force-exit`；每个文件都
必须以 0 退出且所有断言通过。这是测试运行器 workaround，不改变 Worker 行为。

仅对 Orvia Worker 做 Wrangler dry-run：

```powershell
Push-Location worker
pnpm.cmd dlx wrangler@4.125.0 deploy --dry-run
Pop-Location
```

## 3. 部署 Orvia Worker

先确认 Wrangler 登录的是正确 Cloudflare 账号：

```powershell
Push-Location worker
pnpm.cmd dlx wrangler@4.125.0 whoami
Pop-Location
```

确认后，只部署 `orvia-ota-worker`：

```powershell
Push-Location worker
pnpm.cmd dlx wrangler@4.125.0 deploy
Pop-Location
```

记录 Worker 版本、域名和时间。不要运行任何针对 `wzautotool`、
`wz-auto-updates` 或其他资源的 Wrangler 命令。

## 4. 浏览器签名测试

1. 在浏览器打开 `https://beta.ice329.me/`。
2. 输入 `ORVIA_ACCESS_TOKEN` 对应的访问令牌。
3. 选择测试者自己的 p12 和匹配的 mobileprovision，填写 p12 密码。
4. 提交后记录页面返回的 lowercase `taskId`，不要记录证书内容或密码。
5. 页面会轮询 `/api/status/{taskId}`；queued 表示等待，complete 表示已发布，
   failed 只显示安全的操作员错误。
6. complete 后点击“在 iPhone 上安装”，或复制该任务的 `installUrl`。

GitHub workflow 会：

- 使用仓库中的 `Orvia-unsigned.ipa`；
- 保持原有 zsign 命令和 `-b com.ice.orvia`；
- 使用 `tools/publish_ota.py` 校验签名包 Bundle ID；
- 上传 `Orvia.ipa`、`manifest.plist`、`icon.png` 和 `result.json` 到同一任务前缀；
- 失败时尽量写入安全的 `error.json`；
- 在 `if: always()` 清理 p12、profile、签名 IPA、icon 和临时构建文件。

## 5. HTTP 验收

对记录的同一个 `taskId` 检查：

```powershell
curl.exe -I https://beta.ice329.me/sign/<taskId>/Orvia.ipa
curl.exe -I https://beta.ice329.me/sign/<taskId>/manifest.plist
curl.exe -I https://beta.ice329.me/sign/<taskId>/icon.png
```

必须全部通过 HTTPS 且返回 `200`。内容类型必须为：

| 路径 | Content-Type |
| --- | --- |
| `Orvia.ipa` | `application/octet-stream` |
| `manifest.plist` | `application/xml` |
| `icon.png` | `image/png` |

下载 manifest 后确认其中的 IPA URL 使用同一 `taskId`、主机为
`beta.ice329.me`，并且包元数据是 `com.ice.orvia`。只检查该任务前缀，不能
遍历或清理其他任务。

## 6. iPhone Safari 验收

HTTP 检查通过后，在目标 iPhone 的 Safari 打开该任务的 `installUrl`：

1. 确认出现 Orvia 安装提示。
2. 完成安装并启动 App。
3. 通过设备或包检查确认 Bundle ID 为 `com.ice.orvia`。
4. 记录 task ID、iOS 版本、HTTP 结果和安装结果。

仅 HTTP 200 不等于真机安装成功。不要在本阶段开始 `com.ice.Orvia` 切换。

## 7. 任务级清理

只有确认任务 ID 和清理原因后，才可在 `orvia-beta` 删除该任务前缀下的对象。
使用同一个 task ID，不要删除整个 bucket：

```powershell
$taskId = '<已确认的 lowercase UUID>'
Push-Location worker
pnpm.cmd dlx wrangler@4.125.0 r2 object delete "orvia-beta/sign/$taskId/Orvia.ipa" --remote
pnpm.cmd dlx wrangler@4.125.0 r2 object delete "orvia-beta/sign/$taskId/manifest.plist" --remote
pnpm.cmd dlx wrangler@4.125.0 r2 object delete "orvia-beta/sign/$taskId/icon.png" --remote
pnpm.cmd dlx wrangler@4.125.0 r2 object delete "orvia-beta/sign/$taskId/result.json" --remote
pnpm.cmd dlx wrangler@4.125.0 r2 object delete "orvia-beta/sign/$taskId/error.json" --remote
Pop-Location
```

## 安全边界

不要把 token、p12、mobileprovision、密码、签名 IPA 或设备标识符提交到仓库
或发送到聊天。不要做匿名上传。不要改动原有签名链路、正式 uppercase IPA、
Bundle ID 或任何非 Orvia Cloudflare 资源。
