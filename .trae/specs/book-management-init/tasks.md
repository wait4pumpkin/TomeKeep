# Tasks

- [x] Task 1: 初始化 Electron + React 项目
  - [x] SubTask 1.1: 使用 Vite 初始化 React + TypeScript 项目 (pnpm)
  - [x] SubTask 1.2: 集成 Electron 主进程与渲染进程
  - [x] SubTask 1.3: 配置本地数据存储 (Lowdb 或 SQLite)
  - [x] SubTask 1.4: 配置 Electron Builder 以支持 macOS 构建

- [x] Task 2: 文档与项目结构更新
  - [x] SubTask 2.1: 更新 `AGENTS.md` 和 `README.md`
  - [x] SubTask 2.2: 清理 `docs/templates` 并创建 `docs/product-specs/book-management.md`

- [ ] Task 3: 实现核心功能模块
  - [ ] SubTask 3.1: 实现图书库存管理 (Inventory) 界面与逻辑
  - [ ] SubTask 3.2: 实现购书清单 (Wishlist) 界面与逻辑
  - [ ] SubTask 3.3: 实现比价引擎 (Price Comparison Service) - *注：初期可使用模拟数据或简单的 HTTP 请求*

- [ ] Task 4: 构建与验证
  - [ ] SubTask 4.1: 运行并调试 Mac App
  - [ ] SubTask 4.2: 验证数据持久化 (重启应用后数据不丢失)
  - [ ] SubTask 4.3: 验证比价功能

# Task Dependencies
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 3]
