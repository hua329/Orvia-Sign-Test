# Orvia Beta 页面细节优化设计

日期：2026-08-26

## 目标

在现有上传优先页面的基础上做三项细节优化：

1. 不在测试者页面展示 Bundle ID；
2. 使用 Orvia IPA 中的真实 App 图标；
3. 将较长的历史更新收纳起来，默认显示版本、日期和简短摘要，点击后展开完整日志。

## 范围与约束

- 只修改 `worker/src/site.js`、页面测试和本次页面图标资源。
- Bundle ID `com.ice.Orvia` 继续保留在代码和签名校验中，但不出现在公开页面文案或视觉徽章中。
- 真实图标来源为现有 `Orvia.ipa` 中的 `Payload/Orvia.app/AppIcon60x60@2x.png`，转换为浏览器可显示的标准 PNG 后作为本地页面资源使用。
- 不修改 p12、mobileprovision、password 字段，不修改 `/api/sign`、状态轮询、安装链接或 GitHub Actions。
- 不修改 Cloudflare Worker 的签名服务、R2、管理后台、王者自动点击或 WeChatBill。
- 不添加外部 CDN、字体、前端框架或运行时依赖。

## 页面设计

### 品牌区域

- 用真实 Orvia App 图标替换当前字母 `O` 方块。
- 删除 Bundle ID 徽章和“当前测试 Bundle ID”文本。
- 保留 Orvia 名称、记账软件定位和 OTA 测试安装说明。

### 历史更新区域

- 当前版本区域继续显示完整的当前版本信息和变更列表。
- 每条历史记录默认显示版本、日期和摘要预览。
- 摘要预览限制为最多两行，避免长日志撑满页面。
- 每条历史记录使用原生 `<details>` 展开控件；点击“展开完整更新内容”后显示完整摘要和全部变更列表。
- 使用 `textContent` 写入版本、日期、摘要和变更内容，保持现有安全处理方式。
- 没有历史记录时继续保持现有空状态。

## 实现边界

- 保留现有 `releaseHistory` 容器和 `release-history-item` 类，避免破坏现有脚本和测试。
- 只调整 `renderRelease()` 中历史记录的呈现节点，不改变 `/api/release` 数据结构。
- 图标以 Worker 页面可直接读取的本地数据形式嵌入，避免新增公开文件路由或 R2 对象。
- 页面 CSP 继续使用现有 `style-src 'unsafe-inline'` 和 `connect-src 'self'`，不新增脚本来源。

## 验证方案

### 自动化验证

- 页面源码不包含公开 Bundle ID 展示文本，但仍包含签名表单和 API 路径。
- 页面源码包含真实图标数据引用和历史展开控件逻辑。
- 页面测试确认 `sign-form` 仍位于 `release-panel` 之前。
- 运行全部 Worker 测试、JavaScript 语法检查和 Wrangler dry-run。

### 视觉与线上验证

- 线上页面首屏显示真实 Orvia 图标，不显示 Bundle ID。
- 线上发布信息仍能加载当前版本。
- 历史记录默认只显示摘要预览，展开后能看到完整摘要和全部变更。
- p12、描述文件、密码上传和现有签名流程不重新设计、不更换接口。
