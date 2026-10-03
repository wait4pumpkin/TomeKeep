---
title: "Apple Device Development Signing"
owner: engineering
status: active
last_reviewed: 2026-10-03
review_cycle_days: 30
---

# Apple 真机开发签名与双机分发

TomeKeep 原生 iOS 预览版使用 Xcode 管理的 Personal Team 描述文件。免费描述文件有效期有限，因此开发分发同时包含“当前源码双机安装”和“到期前自动重签”两条路径。

## 已配对设备

| 设备 | Xcode UDID | CoreDevice ID |
|---|---|---|
| iPhone 16 Pro | `00008140-001874A2213B801C` | `C7485A18-8877-5509-A276-B9FB780E53C3` |
| iPhone 13 Pro | `00008110-000174383692801E` | `FAF955F1-E802-52F6-9CCF-481BF776E6DC` |

设备 ID 集中维护在 `scripts/signing-profile-utils.sh`，构建脚本不得再复制另一份清单。

## 修改后的双机分发

完成一轮 iOS 修改和测试后运行：

```bash
./scripts/install-device.sh L2BT252BF2
```

脚本会：

1. 让 Xcode 为两台设备刷新注册和同一个 TomeKeep 描述文件。
2. 生成一份签名的 `TomeKeep Next.app`。
3. 通过 USB 或已配对的局域网调试连接覆盖安装到两台 iPhone。
4. 若已启用自动重签，同步更新 launchd 使用的私有源码快照。

覆盖安装保持原 Bundle ID，不会删除应用沙箱、SwiftData 或 Keychain。任一设备锁定或离线时，该设备安装会失败并明确返回非零状态；另一台设备仍会继续尝试。

没有使用“每次保存文件立即安装”的文件监听器。它会频繁终止手机上的应用，也可能分发尚未通过编译的中间状态。这里的自动同步边界是：一次经过确认的部署命令自动覆盖两台设备。

## 自动重签

一次性安装 launchd 任务：

```bash
./scripts/setup-auto-renew.sh L2BT252BF2
```

安装器会把轻量源码副本放到 `~/Library/Application Support/TomeKeepRenew`，避免后台任务受 `~/Documents` 文件访问权限限制。任务在 09:20、13:20、19:20、22:20 以及登录加载时检查一次：

- 描述文件剩余超过 48 小时：不构建、不覆盖安装。
- 进入最后 48 小时：为两台设备刷新注册、重建签名并覆盖安装。
- 新描述文件不足 24 小时：拒绝安装并恢复被暂存的旧描述文件。
- 设备锁定或离线：记录失败，下一时段再次尝试。

日志位于 `/tmp/tomekeep-renew.log`。检查任务：

```bash
launchctl print gui/$(id -u)/com.tomekeep.renew
tail -n 100 /tmp/tomekeep-renew.log
```

手工触发一次检查：

```bash
launchctl kickstart -k gui/$(id -u)/com.tomekeep.renew
```

重新登录 Xcode Accounts 后，可提前强制验证一次真正的描述文件刷新：

```bash
./scripts/install-device.sh L2BT252BF2 --refresh
```

## 当前签名状态（2026-10-03）

- Xcode Accounts 重新登录后，`--refresh` 已真实生成 UUID `d2b350bb-e3f7-46e7-a5f5-a94d616f50ba` 的双设备描述文件，有效至 2026-10-10 18:38（Asia/Shanghai）。
- 同一构建已覆盖安装到 iPhone 16 Pro 与 iPhone 13 Pro；数据容器 UUID 分别仍为 `EE67CFEA-4F00-432C-BE41-FA83CC1907EF` 与 `C9BFA6C7-1FFD-4787-AD09-CF4B29FB73E3`，本机数据未被清空。
- launchd 已安装，续签源快照已随本次部署刷新；到期前 48 小时会自动重签并在设备可达时再次覆盖安装。

## 能力边界

- Mac 必须开机并登录，Xcode 账户与开发证书必须有效。
- 两台手机必须保持开发者模式、与 Mac 配对，并能通过 USB 或同一局域网调试连接。
- iOS 在锁屏状态可能拒绝设备准备或安装；多时段重试用于降低这一限制的影响。
- 自动重签只保证预览包持续可启动，不替代生产服务端、云端备份或 App Store/TestFlight 发布。
