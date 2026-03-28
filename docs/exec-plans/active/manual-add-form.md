---
title: "Manual Add Form — Cover Capture, Optional Fields, Title Navigation"
status: active
created: 2026-03-25
owner: engineering
---

# 执行计划：手动添加表单增强

## 背景与动机

手动录入图书时体验粗糙：封面只能通过豆瓣自动填充，无法自行拍照或选图；出版社/ISBN 无法填写；
手动添加的书籍点击标题行为与豆瓣来源书籍相同，但实际上无法保证豆瓣链接对应正确书目。

## 方案选型

| 功能 | 选型 | 理由 |
|---|---|---|
| 封面矩形检测 | Canvas Sobel 边缘检测 + 4点手动调节回退 | 无新依赖；纯 JS；可靠 |
| 摄像头拍照 | 连续自动检测矩形；置信度稳定3帧后自动冻结 + 手动拍摄兜底 | 最大自动化；无需用户操作 |
| 图像压缩 | Canvas toDataURL JPEG q=0.85，输出限 600×800 | 无新依赖；文件体积小 |
| 可选字段 | 始终显示出版社和ISBN字段 | 用户明确要求 |
| 标题跳转 | 有豆瓣URL → 豆瓣；无豆瓣URL + 有ISBN → isbnsearch；无ISBN → toast提示 | 更准确的数据来源路由 |

## 约束遵循

- `ARCHITECTURE.md`：CoverCropModal 完全在渲染层，不访问文件系统，通过 `window.covers.saveCoverData` IPC 桥接 ✓
- `dependency-policy.md`：无新 npm 依赖 ✓
- `api-surface.md`：无新 IPC 通道，`window.covers.saveCoverData` 已有文档 ✓

## 文件变更

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/components/CoverCropModal.tsx` | 新增 | 封面裁剪/拍照模态框 |
| `src/pages/Inventory.tsx` | 修改 | ManualAddForm：封面按钮、可选字段、模态框接入、标题跳转、toast |
| `src/pages/Wishlist.tsx` | 修改 | WishlistAddForm：同上；WishlistCard 标题跳转；compact card 跳转 |

## CoverCropModal 状态机

```
file mode:
  [读取 File → dataURL] → [Sobel 边缘检测 → 候选角点]
  → [展示4点调节器 + 源图] → [确认 → 透视变换 → JPEG 压缩 → onConfirm(dataUrl)]

camera mode:
  [getUserMedia → live video] → [rAF 每5帧运行 Sobel 检测]
  → [连续3帧置信度≥0.4: 冻结画面] → [展示4点调节器]
  → [确认 → 透视变换 → JPEG 压缩 → onConfirm(dataUrl)]
  （随时可点"拍摄"手动冻结当前帧）
```

## 透视变换算法

基于4点对应关系计算 3×3 单应矩阵（homography）。
使用双线性插值将源图映射到目标矩形 canvas。
纯 Canvas 2D API，无 WebGL，无第三方库。

## 标题跳转规则

```
Book (Inventory):
  book.doubanUrl 已设置  → window.app.openExternal(book.doubanUrl)
  book.isbn 已设置       → window.app.openExternal(`https://isbnsearch.org/isbn/${book.isbn}`)
  否则                   → 显示 toast "无法跳转：未填写 ISBN"

WishlistItem (Wishlist detail card + compact card):
  item.isbn 已设置       → window.app.openExternal(`https://openlibrary.org/isbn/${item.isbn}`)
  否则                   → 显示 toast "无法跳转：未填写 ISBN"
```

## 任务清单

- [x] 新建 `docs/exec-plans/active/manual-add-form.md`
- [x] 新建 `src/components/CoverCropModal.tsx`
- [x] 修改 `src/pages/Inventory.tsx`
- [x] 修改 `src/pages/Wishlist.tsx`

## 补充行为说明

### `handleRefetchCover` 的 captchaAlreadyAttempted 标志

`handleRefetchCover` 内部使用 `captchaAlreadyAttempted` 布尔标志：若瀑布流（Douban → OpenLibrary → isbnsearch）本身已触发 `resolveCaptcha` 弹窗（返回 `{ error: 'captcha' }` 并调用了 captcha resolver），则后续直接走 isbnsearch captcha popup 的路径会被跳过，避免对同一 ISBN 连续弹出两个验证码弹窗。
