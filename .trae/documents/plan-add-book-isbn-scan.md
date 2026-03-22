---
title: "添加图书支持 ISBN 扫描"
owner: "engineering"
status: active
last_reviewed: 2026-03-16
review_cycle_days: 14
linked_specs:
  - "../../docs/product-specs/book-management.md"
---

# Execution Plan: 添加图书支持 ISBN 扫描

## Context
当前「添加图书」仅支持手动输入 ISBN（文本框）。产品规格中已提及“扫码（未来）”，但代码中尚无扫码实现。

本计划目标是在不引入不必要复杂度的前提下，让用户在添加图书时能够通过“扫描条码”快速填充 ISBN，并保证隐私与安全（本地解析，不上传图像/码值）。

## Objective
- 在 Inventory 的 “Add Book” 表单中增加「扫描 ISBN」能力：
  - 通过设备摄像头实时识别条码（优先采用 Chromium 内置 BarcodeDetector，无额外依赖）
  - 将识别到的 EAN-13（978/979 前缀）规范化为 ISBN-13 并自动填入表单
  - 处理权限拒绝/不支持等失败场景，提供明确的 UI 提示与回退路径

## Non-goals
- 不做图书元数据自动抓取（标题/作者/封面等）。
- 不做价格查询真实联机对接。
- 不新增远程服务或环境变量。
- 不在本次计划内改造数据库 schema（仍沿用 `Book.isbn?: string`）。

## Constraints
- 架构边界：UI 不应直接调用持久化实现细节；通过既有 `window.db.*` 接口写入（仅在提交时）。
- 隐私与安全：摄像头流仅用于本地识别；关闭弹窗/识别完成后必须停止媒体流；不得记录或上报条码值。
- 兼容性：BarcodeDetector 可能在部分环境不可用；需提供可用性检测与降级提示。
- 依赖策略：仓库目前缺少 `docs/standards/dependency-policy.md`，本计划优先做到“零新增依赖”；如后续确需引入第三方扫码库，将先补齐依赖策略文档并按其流程执行。
- 测试：仓库当前没有现成测试框架；本计划将优先将 ISBN 规范化/校验逻辑做成纯函数，并在不新增依赖的前提下补充最小可运行的单元测试方案（见 Validation Plan）。

## Scope
### In Scope
- Inventory 添加表单的 ISBN 扫码入口（按钮/快捷操作）。
- 扫码弹窗/面板（预览画面、状态提示、取消/完成）。
- ISBN 码值解析、规范化与校验（支持常见格式：EAN-13，允许包含分隔符/空格）。
- 失败处理（无权限、无摄像头、浏览器不支持、识别不到条码、识别到非 ISBN 条码）。
- 必要的文档更新（产品 spec 中的 “future” 标注调整；安全说明补充）。

### Out of Scope
- Wishlist 的扫码入口（可复用组件，但本次不强制改动 Wishlist UI）。
- 扫描历史、连续扫描、批量导入。
- Torch/对焦等高级相机控制（如未来移动端再评估）。

## Impacted Areas
- modules:
  - `src/pages/Inventory.tsx`（表单与交互）
  - `src/components/*`（新增扫码弹窗组件）
  - `src/*`（新增 ISBN 处理工具函数文件）
- APIs:
  - 不新增 Electron IPC 或 `window.*` 公共接口（全部在 renderer 内完成）
- database:
  - 无 schema 变更
- docs:
  - `docs/product-specs/book-management.md`
  - `docs/security/threat-model.md`（补充摄像头使用说明与风险控制）

## Proposed Approach
### 1) UI 交互
- 在 Inventory “ISBN” 输入框旁增加一个 “Scan” 按钮：
  - 点击后打开一个轻量弹窗（遮罩 + 居中卡片）
  - 弹窗内显示摄像头预览和扫描状态（初始化/请求权限/扫描中/识别成功/错误）
- 识别成功后：
  - 关闭弹窗
  - 将规范化后的 ISBN（优先保存 ISBN-13）写回 `newBook.isbn`
  - 将焦点回到表单（便于继续录入）

### 2) 扫码实现（零依赖）
- 优先使用 `globalThis.BarcodeDetector`：
  - formats 以 `ean_13` 为主（必要时加入 `upc_a` 作为兼容，但仅接受 978/979 的 13 位结果）
  - 使用 `requestAnimationFrame` 或短间隔 `setInterval` 驱动 `detector.detect(video)`
- 媒体流：
  - 使用 `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`
  - 在弹窗关闭或组件卸载时，停止所有 `MediaStreamTrack`
- 降级路径：
  - 若 BarcodeDetector 不可用，提示用户改用“外接扫码枪（键盘输入）/手动输入”
  - 若权限拒绝，提示用户在系统设置中开启摄像头权限

### 3) ISBN 处理（纯函数）
- 新增 `normalizeIsbn(raw)`：
  - 去除非数字/X 字符（允许 ISBN-10 校验位 X）
  - 如果是 13 位数字且以 978/979 开头，按 ISBN-13 校验位验证
  - 如果是 10 位（含可能的 X 结尾），按 ISBN-10 校验位验证
  - 返回规范化结果与失败原因（用于 UI 提示，但不做持久化）
- UI 侧在以下时机调用规范化：
  - 扫码成功回填时（必做）
  - 用户在 ISBN 框粘贴/回车时（可选增强，避免脏数据）

## Task Breakdown
- [ ] 设计并实现可复用的 ISBN 扫码弹窗组件（零依赖）
- [ ] 在 Inventory 添加表单集成“Scan ISBN”入口与回填逻辑
- [ ] 实现 ISBN 规范化与校验工具函数，并接入表单（含错误提示）
- [ ] 补充最小单元测试与手动验证脚本/步骤，确保关键路径可复现
- [ ] 更新相关文档（产品 spec 与安全说明），对齐“已支持扫码”的现实

## Validation Plan
- 单元测试（目标：可在 CI/本地稳定运行）：
  - 覆盖 ISBN-10 与 ISBN-13 的常见样例、错误校验位、包含分隔符的输入
  - 若最终需要引入测试框架，将优先选择与 Vite/TS 生态兼容且依赖最少的方案，并先补齐依赖策略文档
- 手动验证：
  - macOS：首次打开扫码弹窗 -> 正常弹出权限请求 -> 允许后显示预览
  - 识别到 978/979 EAN-13 -> 自动回填 -> 关闭弹窗 -> 继续保存书籍成功
  - 权限拒绝/无摄像头/不支持 BarcodeDetector -> 清晰提示 + 不影响手动保存
- 质量门槛：
  - `pnpm lint`、TypeScript 类型检查通过
  - 开发态 `pnpm dev` 下扫码流程可用

## Rollout Plan
- 作为 MVP 内的 UI 增强功能随版本发布；
- 默认仅在用户显式点击 “Scan” 时触发摄像头权限请求。

## Rollback Plan
- 若扫码在部分环境导致崩溃或严重体验问题，可快速回滚为：
  - 隐藏/移除 “Scan” 按钮
  - 保留 ISBN 手动输入能力不受影响

## Decision Log
- 2026-03-16: 选择优先采用 BarcodeDetector 实现零依赖扫码；不引入元数据抓取

## Status Updates
- 2026-03-16: created
