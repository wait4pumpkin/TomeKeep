---
title: "macOS Native Development Delivery"
owner: engineering
status: active
last_reviewed: 2026-10-29
review_cycle_days: 30
---

# Mac 原生版本机更新

按用户要求，每轮 macOS 修改完成并通过相关测试后，自动执行：

```bash
./scripts/install-mac.sh
```

脚本使用独立的 `apple/DerivedData-MacInstall` 构建目录，进行本地 ad-hoc 签名与签名校验。它不会申请证书、上传制品或创建定时任务；如 `/Applications` 写入需授权，应按系统权限流程申请。

现有本地开发包以 `CODE_SIGNING_ALLOWED=NO` 构建（linker ad-hoc 签名，没有 App Sandbox entitlement）。本机安装继续按此基线构建，在暂存包上补全本地 ad-hoc 签名，不新增沙盒 entitlement；仍使用 `~/Library/Application Support/TomeKeepNative`。不能在一次安装步骤中突然启用沙盒，使数据目录重定向并出现空库。正式 Developer ID/App Store 的签名、沙盒及容器迁移应另行评审，不能复用本地调试安装策略。

- 原生预览版：`/Applications/TomeKeep Next.app`，Bundle ID `com.tomekeep.app.nativepreview.macos`。
- 旧 Electron：`/Applications/TomeKeep.app`，Bundle ID `com.tomekeep.app`，不覆盖、不删除。
- 安装前核对源包和目标包 ID，不替换符号链接或其他应用；在同卷临时目录复制并校验新包，再替换目标。
- 已有原生包移动到 `~/Library/Application Support/TomeKeepMacInstall/Backups/<时间戳>-<进程号>/TomeKeep Next.app`。替换失败尝试恢复原包，备份不自动清理；临时目录若失败后仍有内容会保留，避免误删。
- 不更改原生 Bundle ID、SwiftData、封面目录或 Keychain；安装行为不是清库或数据迁移。
- 不强退正在运行的应用。更新后如仍有旧进程，应结束手头操作、退出并从 Applications 重新打开；仅覆盖 app 包不会让内存中的旧代码自动变新。

恢复时先退出原生应用，将当前包保留到另一备份位置，再把指定备份恢复至原生目标路径；核对 Bundle ID 和签名。不要用 Electron 包替换原生包，也不要删除用户数据目录。

本地 ad-hoc 签名不是 Developer ID 公证或正式发行签名。系统若提示钥匙串访问，应由用户按系统提示授权，不删除或重置会话来绕过提示。
