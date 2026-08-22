# Orvia OTA Phase 1 设计

## 背景与目标

Orvia 当前已经有经过真机验证的 GitHub Actions + Zsign 签名链路。本阶段只解决签名结果的 OTA 分发闭环：

```text
已有 Orvia-signed.ipa
    -> 独立 R2 bucket
    -> 独立 taskId 路径
    -> manifest.plist
    -> itms-services 安装链接
    -> iPhone Safari OTA
```

本阶段不重写签名链路，不让用户上传 IPA，也不把 GitHub Artifact 作为最终用户入口。

## 范围

### 本阶段包含

- 一个本地、可重复执行的 OTA 发布工具：`tools/publish_ota.py`。
- 从 IPA 内部 `Payload/*.app/Info.plist` 读取：
  - `CFBundleIdentifier`；
  - `CFBundleVersion`；
  - `CFBundleShortVersionString`。
- 校验 Bundle ID 必须为当前测试值 `com.ice.orvia`。
- Phase 1 测试期间始终使用小写 `com.ice.orvia`；只有 OTA 闭环在真机上验证成功后，才另行规划切换到正式 Bundle ID `com.ice.Orvia`。
- 为每次发布生成或接受一个 UUID `taskId`。
- 生成并上传两个独立对象：
  - `sign/{taskId}/Orvia.ipa`；
  - `sign/{taskId}/manifest.plist`。
- 使用独立下载域名，例如 `https://orvia-install.ice329.me`，生成 HTTPS IPA URL、manifest URL 和 `itms-services://` 安装链接。
- 上传时明确设置 IPA 与 manifest 的 Content-Type。
- 提供 dry-run 输出、自动化测试和一份不涉及生产写入的验收 runbook。

### 本阶段不包含

- 修改 `.github/workflows/sign.yml`、Zsign 参数、签名 Bundle ID 或 `Orvia.ipa`。
- GitHub API 调度、网站上传证书、P12 密码或 mobileprovision。
- Worker、`/sign` 前端、任务状态 API、Turnstile、IP 限流。
- 生产 DNS/Route/Custom Domain/R2 资源的自动创建或部署。
- 读取、保存、上传或测试真实 P12、mobileprovision、密码和 GitHub token。

## 方案与边界

### 发布工具

发布工具使用 Python 3.10+ 标准库处理 IPA ZIP 和 Apple XML plist，使用精确固定版本 `wrangler@4.125.0` 的 `r2 object put --remote` 命令上传远程 R2 对象。采用标准库的原因是当前仓库没有应用运行时或依赖管理，Phase 1 不需要引入完整 Worker/API 框架。

工具提供一个可测试的纯函数边界：

1. `inspect_ipa(path)`：读取并校验 IPA 元数据；
2. `build_manifest(metadata, ipa_url)`：生成 XML plist 字节；
3. `plan_publish(...)`：计算 task 路径、URL、Content-Type 和安装链接；
4. CLI 接受可选 `--account-id`，执行计划中的两个 `npx --yes wrangler@4.125.0 r2 object put --remote` 远程 R2 上传命令，并输出不含敏感数据的 JSON 结果。

真实上传只在用户明确配置好独立 bucket 和域名后执行；默认测试路径使用 `--dry-run`，不连接 Cloudflare。

执行发布工具前必须已安装 Python 3.10+；执行远程上传前还必须已安装 Node.js、npm 和 npx，并预先完成 Wrangler 身份认证。非 dry-run 上传必须传入严格校验为 32 个十六进制字符的 `--account-id`，工具只将该非敏感值作为 `CLOUDFLARE_ACCOUNT_ID` 传给子进程，不接受 Cloudflare token/password。命令使用 `--yes`，不允许出现安装确认提示。Wrangler 系统要求见 https://developers.cloudflare.com/workers/wrangler/install-and-update/。

CLI 形状如下；dry-run 不要求 `--account-id`，真实上传必须提供同一个已批准的 32-hex account ID：

```text
python tools/publish_ota.py --ipa Orvia-signed.ipa --bucket orvia-install --base-url https://orvia-install.ice329.me --dry-run
python tools/publish_ota.py --ipa Orvia-signed.ipa --bucket orvia-install --base-url https://orvia-install.ice329.me --task-id <taskId> --account-id <32-hex-account-id>
```

### R2 隔离

Phase 1 使用新 bucket `orvia-install`。对象 key 始终包含 taskId，禁止使用根目录的固定 `Orvia.ipa`。下载域名必须是独立域名，例如 `orvia-install.ice329.me`，不能复用当前 `downloads.ice329.me`，也不能创建覆盖 `ice329.me/*` 的通配 Worker Route。

工具拒绝以下不安全的公共基址：

- 非 HTTPS URL；
- `ice329.me` 或 `www.ice329.me`；
- 当前既有下载域名 `downloads.ice329.me`。

### manifest

manifest 使用 Apple OTA 所需的 XML plist 结构：

- asset `kind` 为 `software-package`；
- asset `url` 指向同一个 taskId 的 HTTPS IPA URL；
- metadata `bundle-identifier` 为 `com.ice.orvia`；
- metadata `bundle-version` 优先使用 `CFBundleVersion`，缺失时使用 `CFBundleShortVersionString`；
- metadata `title` 为 `Orvia`；
- metadata `kind` 为 `software`。

XML 文本由标准库序列化，不能通过字符串拼接未转义的 URL 或 plist 值。manifest 上传 Content-Type 为 `application/xml`；IPA 上传 Content-Type 为 `application/octet-stream`。

## 数据流

```text
Orvia-signed.ipa (local only)
        |
        | inspect_ipa
        v
bundle metadata + taskId
        |
        +--> build manifest.plist (temporary local file)
        |
        +--> npx --yes wrangler@4.125.0 r2 object put --remote .../Orvia.ipa
        |
        +--> npx --yes wrangler@4.125.0 r2 object put --remote .../manifest.plist
        v
https://orvia-install.ice329.me/sign/{taskId}/manifest.plist
        |
        v
itms-services://?action=download-manifest&url={encoded manifest URL}
```

临时 manifest 文件在发布完成后删除；远程上传从受控临时工作目录执行，并使用绝对 IPA/manifest 路径。工具不接受证书字段，不写数据库，不把任何 P12/profile/password、token 或 GitHub secret 写入 R2、日志或结果 JSON。

## 输出契约

成功的 dry-run 或上传计划输出 JSON，字段为：

```json
{
  "taskId": "uuid",
  "bundleIdentifier": "com.ice.orvia",
  "bundleVersion": "...",
  "bundleShortVersion": "...",
  "ipaKey": "sign/uuid/Orvia.ipa",
  "manifestKey": "sign/uuid/manifest.plist",
  "ipaUrl": "https://orvia-install.ice329.me/sign/uuid/Orvia.ipa",
  "manifestUrl": "https://orvia-install.ice329.me/sign/uuid/manifest.plist",
  "installUrl": "itms-services://?action=download-manifest&url=..."
}
```

失败只返回面向操作人员的简短错误，不输出 IPA 内容、命令中的 secret 或完整 Cloudflare 日志。

## 错误处理

- 文件不存在、扩展名错误或 ZIP 无法读取：提示 IPA 无效。
- 找不到唯一的 `Payload/*.app/Info.plist`：提示无法读取 App 信息。
- Bundle ID 不是 `com.ice.orvia`：拒绝发布。
- 版本字段同时缺失：拒绝发布。
- 公共基址不是 HTTPS 或命中受保护域名：拒绝发布。
- 任一 R2 上传失败：退出非零，并提示 `R2 上传失败，请检查 wrangler@4.125.0 登录、bucket 和权限`；不把完整命令输出给最终用户。
- manifest 生成成功但第二次上传失败时，工具不自动删除第一份远端对象；runbook 记录 taskId，后续用 R2 生命周期或手工清理处理，避免误删其他任务。

## 测试与验收

自动化测试不连接 Cloudflare，使用测试运行时生成的最小 IPA fixture：

- 读取正确 Bundle ID 和两个版本字段；
- 拒绝错误 Bundle ID；
- 拒绝缺失 Info.plist；
- manifest 包含正确的 URL、Bundle ID、版本和 title，并正确转义 XML；
- 发布计划为 IPA/manifest 使用正确 Content-Type；
- taskId 路径彼此隔离；
- install URL 使用 URL 编码后的 HTTPS manifest URL；
- dry-run 不包含证书、密码或 GitHub 输入字段。

人工 OTA 验收在生产资源配置完成后执行：

1. `curl -I` 检查 IPA 和 manifest 均为 HTTPS 可访问；
2. 检查 IPA Content-Type 为 `application/octet-stream`；
3. 检查 manifest Content-Type 为 `application/xml`；
4. 在 iPhone Safari 打开安装链接；
5. 确认 iOS 显示 Orvia 安装流程并能启动 App；
6. 检查已有 `ice329.me`、`www.ice329.me`、`downloads.ice329.me` 和授权后台仍能访问。

## 后续演进

Phase 2 再把发布逻辑接到 Worker → GitHub Actions → R2 的临时任务链路；证书和密码只在短生命周期运行时传输与删除。Phase 3 再加入 `/sign` 页面和状态轮询。Phase 4 再加入 Turnstile、限流、任务过期和 R2 生命周期清理。

## 设计自检结论

- 不存在待办占位项或开放的接口字段。
- 现有 Zsign workflow、Bundle ID、官网和既有下载域均明确排除在修改范围外。
- Phase 1 只依赖一个本地 signed IPA、独立 R2 bucket 和独立下载域名；后续 Worker/API 不会反向污染本阶段的发布格式。
