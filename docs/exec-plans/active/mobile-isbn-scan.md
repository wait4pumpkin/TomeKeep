---
title: "Mobile ISBN Scan — Companion Server"
status: active
created: 2026-03-23
owner: engineering
---

# 执行计划：手机 ISBN 扫码入库

## 背景与动机

用户有大量书籍需要批量录入。Mac 内置前置摄像头姿势别扭、对焦差；手机摄像头扫码体验更佳。
本方案在 Electron 主进程内启动一个局域网 HTTPS 服务，手机浏览器扫二维码后打开轻量 HTML 扫码页，
通过 POST 将 ISBN 推送至桌面端，桌面端查询元数据后自动入库。

## 方案选型理由

| 选项 | 结论 |
|---|---|
| 局域网 HTTPS 伴侣服务（本方案） | 采用。无需手机 App，复用现有 ISBN 处理逻辑，全程离线 |
| 剪贴板中转 | 大量扫码时效率极低，不适合批量场景 |
| 独立手机 App | 超出当前 MVP 范围，工程量大 |

## 依赖新增

| 包 | 类型 | 理由 |
|---|---|---|
| `qrcode@1.5.4` | 运行时 | 生成二维码图片（`toDataURL`）；MIT；纯 JS；无原生编译 |
| `selfsigned@5.5.0` | 运行时 | 生成自签名 TLS 证书解决 iOS Safari `getUserMedia` 需要 HTTPS 的约束；MIT；纯 JS |
| `@types/qrcode@1.5.6` | devDependency | TypeScript 类型声明 |

内置能力不足原因：Node.js / Electron 无内置 QR 生成；`crypto` 内置模块可生成随机 token 但不能生成 X.509 证书。

## 约束遵循

- `ARCHITECTURE.md`：渲染层不直接访问文件系统；所有操作通过 `window.companion` IPC 桥接 ✓
- `dependency-policy.md`：依赖最小化、MIT 兼容、无原生编译、已记录动机 ✓
- `NFR-DATA-01`：全程局域网，无数据上云 ✓
- `NFR-DATA-02`：仅用户主动触发的扫码动作会与外部 Douban/OpenLibrary API 交互（已有的行为） ✓
- `api-surface.md`：已更新 `window.companion` 及 IPC 通道文档 ✓

## 安全设计

- 每次启动服务生成 16 字节随机 hex token；所有 `/scan` 和 `/events` 请求强制校验 token
- 证书持久化到 `userData/companion-cert.pem`（避免用户每次重启都需重新信任）
- 服务绑定 `0.0.0.0`（局域网可达）但 token 防止局域网内其他设备误触
- 服务关闭时 token 立即失效；面板关闭 / 组件卸载时自动调用 `companion:stop`

## 文件变更

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `electron/companion-server.ts` | 新增 | HTTPS 服务核心，证书管理，SSE，IPC handlers，`/vendor/*` 静态路由 |
| `electron/main.ts` | 修改 | 导入并调用 `setupCompanion()` |
| `electron/preload.ts` | 修改 | 新增 `window.companion` namespace（含 `sendScanAck` with `title?`） |
| `src/vite-env.d.ts` | 修改 | 新增 `companion` 类型声明 |
| `public/mobile-scan.html` | 新增 | 手机端静态扫码页面（无构建依赖）；书名+ISBN 同行显示，图标表达状态 |
| `public/vendor/zxing-library.min.js` | 新增 | `@zxing/library@0.21.3` UMD bundle 本地化，供 iOS Safari 软件解码 fallback |
| `src/components/MobileScanPanel.tsx` | 新增 | 桌面端二维码 + 扫码进度面板；书名+ISBN 同行显示，图标表达状态 |
| `src/pages/Inventory.tsx` | 修改 | 添加"手机扫码入库"菜单项及面板挂载 |
| `docs/generated/api-surface.md` | 修改 | 新增 `window.companion` 及 IPC 通道文档；`sendScanAck` 签名含 `title?` |

## 数据流

```
手机浏览器
  1. GET /  → mobile-scan.html
  2. GET /events?token=T  → SSE 长连接（接收 ack）
  3a. [PATH A] BarcodeDetector.detect(video) → rawValue
  3b. [PATH B] canvas 截帧 → @zxing/library MultiFormatReader.decode() → rawValue
  4. POST /scan?token=T { isbn }
                                    ↓
Electron companion-server.ts
  4. 校验 token
  5. webContents.send('companion:isbn-received', isbn)
                                    ↓
Renderer (MobileScanPanel → onDetected → Inventory.tsx)
  6. searchDouban / lookupIsbn → commitBook()
  7. ipcRenderer.send('companion:scan-ack', { isbn, hasMetadata, title? })
                                    ↓
Electron companion-server.ts
  8. broadcastSse({ type:'ack', isbn, hasMetadata, title? })
                                    ↓
手机浏览器 SSE
  9. 更新扫描列表：书名 + ISBN 同行显示；图标表示状态（✓ 已入库 / ⚠ 无元数据）
```

## iOS 首次使用说明

iOS Safari 的 `getUserMedia` 要求 HTTPS 或 localhost。局域网地址使用自签名证书，首次需要：

1. 扫二维码后 Safari 显示"此连接不是私密的"
2. 点击「显示详细信息」→「访问此网站」→ 输入设备密码确认
3. 允许摄像头权限

证书 3 年有效期，后续连接无需重复操作。

## 兼容性

| 平台 | 最低版本 | 备注 |
|---|---|---|
| iOS Safari | 14.5+ | 软件解码 fallback（`@zxing/library`）；`getUserMedia` 需 HTTPS |
| Android Chrome | 83+ | 原生 `BarcodeDetector` 路径，性能最优 |
| Firefox Android | 任意版本 | 软件解码 fallback 路径 |

### 解码路径选择逻辑

```
if (window.BarcodeDetector)
  → PATH A: 原生 API（Chrome Android 83+，性能最好）
else
  → PATH B: 加载本地预置 @zxing/library@0.21.3 UMD (`/vendor/zxing-library.min.js`，由 companion-server 通过 `/vendor/*` 路由 serve)
             MultiFormatReader，逐帧 canvas 截图解码
             支持 EAN-13 / UPC-A
```

### `BarcodeDetector` 在 Safari 上的现状

根据 caniuse（2026-03）及 MDN 调查确认：
- Safari（桌面 + iOS）所有版本均将 `BarcodeDetector` 标注为 **Disabled by default（实验性，默认关闭）**
- 即使 iOS 系统为最新版，`window.BarcodeDetector` 在 Safari 中仍为 `undefined`
- 这是 WebKit 团队的主动决策，不是 bug
- 唯一绕过方式是用户手动在 Safari 设置中启用实验性功能，不适合普通用户

**结论**：原始方案假设"iOS 17.4+ 支持 BarcodeDetector"有误；正确方案是始终为 Safari 使用软件解码 fallback。

### 软件解码库选型

| 候选 | 结论 |
|---|---|
| `@zxing/library@0.21.3` UMD | **采用**。提供标准 UMD bundle，可直接 `<script src="cdn">` 加载，无需构建工具；纯 JS，MIT 协议；不进入 npm 依赖树，不影响 Electron 包体积 |
| `zxing-wasm@3.0.1` | 放弃。ES module 依赖相对路径 `../share.js`，无法从 CDN 独立引用；WASM 文件需额外配置 `wasmFilePath`，单文件 HTML 中使用复杂 |

**依赖 policy 符合性**：`@zxing/library` UMD bundle 预下载至 `public/vendor/zxing-library.min.js`，由 companion-server 的 `/vendor/*` 路由本地 serve，全程离线，不写入 `package.json`，无需走 npm 依赖 review 流程。

## 任务清单

- [x] 安装依赖 `qrcode`、`selfsigned`、`@types/qrcode`
- [x] 新建 `electron/companion-server.ts`
- [x] 修改 `electron/main.ts`
- [x] 修改 `electron/preload.ts`
- [x] 修改 `src/vite-env.d.ts`
- [x] 新建 `public/mobile-scan.html`
- [x] 新建 `src/components/MobileScanPanel.tsx`
- [x] 修改 `src/pages/Inventory.tsx`
- [x] 更新 `docs/generated/api-surface.md`
- [x] 修复 iOS Safari 兼容性：`public/mobile-scan.html` 加入 `@zxing/library` 软件解码 fallback
- [x] 更新兼容性文档（`BarcodeDetector` Safari 现状调查结论）
- [x] 手动测试：Android Chrome 端到端
- [x] 手动测试：iOS Safari 端到端
- [x] 修复 `companion:scan-ack` IPC handler 未转发 `title` 字段导致手机端无法显示书名的 bug
- [x] 手机端、桌面端扫描列表 UI 简化：移除状态文字，书名与 ISBN 同行显示，图标表达状态
- [x] 手机端删除失败扫描条目：`POST /delete-entry` 路由、`companion:delete-entry` IPC、`onDeleteEntryReceived` preload 方法、手机端删除按钮（含超时回退项）及 `removeItem()` 辅助函数、`delete-ack` SSE 消息处理
- [x] 手机端摄像头暂停/恢复：摄像头区域下方增加切换按钮，暂停时停止 rAF 循环并释放摄像头，恢复时重新启动；页面切回后台时若已手动暂停则不自动恢复
