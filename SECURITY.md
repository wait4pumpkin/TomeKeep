# Security Policy / 安全政策

## 支持的版本 / Supported Versions

我们对最新发布的版本提供安全修复支持。

We provide security fixes for the latest released version.

| Version | Supported |
|---|---|
| Latest `main` | Yes |
| Older tags | No |

---

## 报告安全漏洞 / Reporting a Vulnerability

**请不要通过公开 GitHub Issue 报告安全漏洞。**

**Please do not report security vulnerabilities through public GitHub Issues.**

如果你发现了安全漏洞，请通过以下方式私下联系我们：

If you discover a security vulnerability, please disclose it privately:

1. 使用 GitHub 的 [Private Security Advisory](https://github.com/wait4pumpkin/TomeKeep/security/advisories/new) 功能提交报告。
   Use GitHub's [Private Security Advisory](https://github.com/wait4pumpkin/TomeKeep/security/advisories/new) to submit a report.

2. 或者通过 GitHub 私信联系仓库维护者。
   Or contact the repository maintainer via GitHub direct message.

我们承诺在 **7 个工作日内**回复，并在确认漏洞后尽快发布修复。

We commit to responding within **7 business days** and releasing a fix as soon as possible after confirming the vulnerability.

---

## 安全设计说明 / Security Design Notes

了解 TomeKeep 的安全边界有助于提交高质量的漏洞报告：

Understanding TomeKeep's security boundaries helps with quality reports:

### 桌面端 / Desktop (Electron)

- **IPC 隔离**：renderer 进程只能通过 `contextBridge` 暴露的 `window.*` preload API 与主进程通信，`nodeIntegration` 已禁用。
- **协议限制**：`app://` 协议仅用于加载本地封面图片，不允许任意文件读取。
- **外部链接**：`window.app.openExternal()` 使用系统浏览器打开 URL，且对 URL scheme 有校验。

- **IPC isolation**: The renderer process communicates with the main process only through `contextBridge`-exposed `window.*` preload APIs; `nodeIntegration` is disabled.
- **Protocol restriction**: The `app://` protocol only serves local cover images; arbitrary file reads are not permitted.
- **External links**: `window.app.openExternal()` opens URLs in the system browser and validates URL schemes.

### Web 端 / Web (Cloudflare Pages)

- **认证**：所有 `/api/*` 路由（`/api/auth/login` 和 `/api/auth/register` 除外）需要有效的 JWT（`Authorization: Bearer` 或 httpOnly cookie `tk`）。
- **管理员引导**：`POST /api/auth/admin-setup` 一次性端点，在任何管理员账号存在后永久禁用，防止越权创建管理员。
- **邀请码机制**：注册需要有效的一次性邀请码，防止未授权用户注册。
- **资源隔离**：R2 封面访问通过 `owner_id` 校验，用户只能访问自己的资源。
- **速率限制**：登录和注册接口有基于内存的滑动窗口限速（冷启动后重置）。

- **Authentication**: All `/api/*` routes (except login/register) require a valid JWT via `Authorization: Bearer` header or httpOnly `tk` cookie.
- **Admin bootstrap**: `POST /api/auth/admin-setup` is a one-time endpoint permanently disabled once any admin account exists.
- **Invite-only registration**: Registration requires a valid single-use invite code.
- **Resource isolation**: R2 cover access is validated against `owner_id`; users can only access their own resources.
- **Rate limiting**: Login and register endpoints have in-memory sliding window rate limiting (resets on Worker cold start).

### 伴侣服务器 / Companion Server (LAN)

- 监听本地局域网，使用自签名 TLS 证书加密传输。
- 每次会话生成随机 `token`（16 字节十六进制），通过 QR 码分发给手机端，调用 `stop()` 后失效。

- Listens on the local LAN, encrypted with a self-signed TLS certificate.
- A random `token` (16-byte hex) is generated per session, distributed to the phone via QR code, and invalidated on `stop()`.

---

## 超出范围的问题 / Out of Scope

以下问题不在我们的漏洞奖励范围内：

The following are not considered in-scope vulnerabilities:

- 未签名的 macOS 应用（这是已知的设计决策）/ Unsigned macOS app (known design decision)
- 速率限制在 Worker 冷启动后重置 / Rate limit reset on Worker cold start
- 本地 db.json 文件的物理访问 / Physical access to the local db.json file
- 依赖库中的漏洞（请直接向上游报告）/ Vulnerabilities in upstream dependencies (please report upstream)
