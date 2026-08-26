# Orvia Beta 版本信息与更新记录设计

## 目标

在现有 `https://beta.ice329.me/` 页面展示当前可安装的 Orvia 测试版本和更新记录，并在现有 `https://admin.ice329.me/` 管理后台中增加独立的 Orvia 版本维护区域。

版本信息只描述“当前可发布/可安装的测试版本”，不尝试从测试者 iPhone 读取已安装版本。

## 冻结边界

以下内容必须保持不变：

- `com.ice.orvia` Bundle ID。
- p12、mobileprovision、密码上传字段和校验。
- `/api/sign` 签名触发、GitHub Actions dispatch、状态轮询和错误处理。
- GitHub Actions 中现有 zsign 参数。
- `sign/{taskId}/Orvia.ipa`、`manifest.plist`、`icon.png` 路径。
- 现有 R2 OTA 对象的读写方式和安装链接生成逻辑。
- 王者授权后台的现有接口、数据、页面操作和下载更新逻辑。
- WeChatBill 的后台、Worker、API、数据和配置。

本功能只新增版本元数据读写，不修改签名链路。新增的管理代理只在已登录的管理后台中可用，公开 beta 页面不需要令牌。

## 方案

### 1. Orvia Worker 的版本元数据

在 Orvia 独立 Worker 中增加一份 R2 配置对象：

```text
config/release.json
```

文档结构为：

```json
{
  "current": {
    "version": "1.0.0",
    "releasedAt": "2026-08-26",
    "summary": "首次测试版本",
    "changes": ["支持上传证书并生成 iPhone 安装链接"]
  },
  "history": [
    {
      "version": "1.0.0",
      "releasedAt": "2026-08-26",
      "summary": "首次测试版本",
      "changes": ["支持上传证书并生成 iPhone 安装链接"]
    }
  ],
  "updatedAt": "2026-08-26T00:00:00.000Z"
}
```

约束：

- `version` 最长 32 个字符，只允许字母、数字、点、短横线、加号和下划线。
- `releasedAt` 使用 `YYYY-MM-DD`。
- `summary` 最长 120 个字符。
- `changes` 为 1 至 20 条文本，每条最长 240 个字符。
- `history` 最多保留 20 条，最新记录排在最前面。
- 每次保存新版本时，将记录插入 `history` 并同步 `current`。
- 保存相同版本号时替换该版本的现有记录，方便修正文案，不产生重复记录。

### 2. Orvia Worker 接口

新增公开读取接口：

```text
GET https://beta.ice329.me/api/release
```

接口只返回版本元数据，不返回任何证书、密码、任务输入或内部令牌。没有配置对象时返回一个可识别的空状态，不能影响首页签名表单。

新增受保护管理接口：

```text
GET  /internal/admin/release
POST /internal/admin/release
```

继续使用现有 `X-Orvia-Admin-Token` 和 `ORVIA_ADMIN_BRIDGE_TOKEN` 校验。未通过校验时返回 404；请求体不合法时返回 400；R2 读写失败时返回 500。POST 只接受当前版本字段，由 Worker 读取已有文档、替换或插入记录后再写回 R2。

### 3. 现有管理后台中的 Orvia 区域

在现有管理后台登录成功后，新增一个独立的“Orvia 测试版”卡片，包含：

- 当前版本号输入框。
- 发布日期输入框。
- 更新摘要输入框。
- 更新内容多行输入框，每行作为一条更新记录。
- 当前记录预览和最近历史记录。
- “保存 Orvia 更新”按钮。

管理后台 Worker 只新增以下两个已有管理员鉴权保护的代理路径：

```text
GET  /v1/admin/orvia/release
POST /v1/admin/orvia/release
```

代理服务端使用仅存于 Worker Secret 的 `ORVIA_ADMIN_BRIDGE_TOKEN` 请求 Orvia Worker。浏览器继续只提交现有 `ADMIN_TOKEN`，不会接触桥接令牌。代理目标固定为 `https://beta.ice329.me/internal/admin/release`，不允许客户端传入任意目标地址。

现有王者授权路由、WeChatBill 相关逻辑和页面操作不改；只在现有分发器中增加 Orvia 专用路径分支，并在登录后的页面中增加独立卡片。

### 4. beta 页面展示

beta 页面在签名表单上方展示：

- “当前测试版本”及版本号。
- 发布日期。
- 更新摘要和更新内容。
- 最近更新记录。

页面加载后通过同源 `GET /api/release` 获取数据，使用 DOM 文本节点展示，避免把更新内容当作 HTML 执行。接口失败或暂无记录时显示“版本信息暂未发布”，签名表单仍然正常可用。现有签名提交、状态恢复、轮询和安装链接元素保持原逻辑。

## 错误与兼容性

- 版本信息读取失败只影响版本卡片，不阻断签名。
- 保存失败在管理后台显示明确提示，不覆盖页面中已有内容。
- 不公开 R2 的 `config/release.json` 路径，只通过 Worker API 返回。
- 不复用任务对象键名，避免和现有 OTA 文件混淆。
- 新增字段均使用安全长度限制，防止过大的 R2 对象和页面内容。
- 新增管理代理必须继续要求现有 `ADMIN_TOKEN`；Orvia Worker 仍要求桥接令牌。

## 测试与验收

### Orvia Worker

- 公开读取接口在有配置时返回当前版本和历史记录。
- 没有配置或 R2 读取失败时返回安全的空状态/错误，不影响首页响应。
- 未带桥接令牌访问管理接口返回 404。
- 合法 POST 能新增版本、替换同版本记录并限制历史长度。
- 非法版本、日期、摘要和更新内容返回 400。
- 现有签名、状态和 OTA 对象测试全部继续通过。

### 管理后台 Worker

- 未登录访问新 Orvia 代理仍返回现有管理员鉴权结果。
- 登录管理员的 GET/POST 能透传 Orvia 版本信息和状态码。
- 代理目标和令牌只由服务端设置，客户端不能改写。
- 现有王者授权测试和更新发布测试全部继续通过。

### 线上验收

1. 在 Cloudflare 中为现有 `wz-auto-license` 增加匹配的 `ORVIA_ADMIN_BRIDGE_TOKEN` Secret；不修改其它 Secret。
2. 部署 Orvia Worker，并确认 beta 页面、签名表单和现有安装流程可用。
3. 部署现有管理 Worker 的仅 Orvia 增量，并通过 `admin.ice329.me` 保存一条测试版本记录。
4. 刷新 beta 页面，确认版本号和更新记录出现。
5. 再提交一次 p12、mobileprovision 和密码，确认签名、状态轮询和 iPhone 安装链路仍然成功。
6. 检查王者授权和 WeChatBill 页面/API 未发生变化。

## 不做的事情

- 不自动从 IPA 提取版本号并替换发布记录。
- 不把 p12、mobileprovision、密码或 IPA 放入版本配置。
- 不做 p12 自动签名流程重构。
- 不新增匿名上传。
- 不修改 `wzautotool`、WeChatBill Worker、其它 R2/D1、DNS 或非 Orvia Cloudflare 资源。
