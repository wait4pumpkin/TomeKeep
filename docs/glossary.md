# Glossary / 术语表

## Core Terms / 核心术语

- **Book（书目）**: 书库中的一本书，包含 ISBN、作者、出版社、封面等元数据，以及关联的阅读状态。桌面端存储在 `db.json` 的 `books[]` 数组，云端存储在 D1 `books` 表。
- **WishlistItem（愿望清单条目）**: 想要购买但尚未入库的书，带有优先级（high / medium / low）和 `pendingBuy` 标记。可一键原子操作移入书库。
- **ReadingState（阅读状态）**: 一个 `(user, book, profile)` 三元组，记录阅读进度（unread / reading / read）和完成时间。每个 Profile 对同一本书可以有独立的阅读状态。
- **UserProfile（用户档案）**: 账号下的阅读成员，一个账号最多 5 个 Profile，各自独立管理阅读状态（用于家庭共享场景）。
- **PriceCache（价格缓存）**: 某本书在京东 / 当当 / 中国图书网上的价格查询结果缓存，含抓取时间和过期时间。桌面端写入，云端只读。
- **CoverKey（封面键）**: R2 中封面图片的对象路径，格式为 `covers/<owner_id>/<uuid>.webp`。桌面端本地封面用 `app://covers/<id>.jpg` 表示。
- **SyncCursor（同步游标）**: 记录上次成功同步时各表的最新 `updated_at` 时间戳，用于增量拉取（`?since=<ISO>`），避免全量同步。
- **CompanionServer（伴侣服务器）**: 桌面端内置的局域网 HTTPS 服务器，手机通过扫描 QR 码连接后可使用摄像头扫描书籍条码，扫描结果通过 SSE 实时推送给桌面端。
- **InviteCode（邀请码）**: 一次性注册邀请码，由管理员生成。Web 端注册必须提供有效邀请码，防止未授权注册。
- **AdminSetup（管理员引导）**: 通过 `POST /api/auth/admin-setup` + `ADMIN_SETUP_TOKEN` 创建第一个管理员账号的一次性流程，任何管理员存在后永久禁用该端点。

## Engineering Terms / 工程术语

- **ADR（架构决策记录）**: Architecture Decision Record，记录重要架构决策的文档。
- **Execution Plan（执行计划）**: 非平凡功能开发前制定的结构化实施方案，追踪进度和约束。
- **Generated Docs（生成文档）**: 从代码或配置自动或手动维护派生的文档，位于 `docs/generated/`。
- **IPC（进程间通信）**: Electron 中 renderer 进程（浏览器端）与 main 进程（Node.js 端）之间的通信机制，TomeKeep 通过 `contextBridge` + `ipcMain/ipcRenderer` 实现。
- **LWW（最后写入胜出）**: Last Write Wins，TomeKeep 云同步的冲突解决策略，以 `updated_at` 时间戳最新的记录为准。
- **Soft Delete（软删除）**: 不物理删除数据库记录，而是设置 `deleted_at` 字段，使删除操作可通过增量同步传播到其他客户端。
- **Preload Bridge（预加载桥接）**: Electron `preload.ts` 通过 `contextBridge.exposeInMainWorld` 在 renderer 的 `window` 对象上暴露受限 API，是 IPC 的唯一合法入口。

## Product Terms / 产品术语

- **Library（书库 / 藏书）**: 用户已拥有的书籍集合，对应桌面端 `db.json/books[]` 和云端 `books` 表。
- **Wishlist（愿望清单）**: 用户想要购买的书籍列表，支持优先级排序和价格比价。
- **Price Comparison（价格比较）**: 自动从京东、当当、中国图书网三个渠道抓取书籍当前售价，辅助购买决策。
- **Metadata（元数据）**: 书籍的基本信息（标题、作者、出版社、ISBN、封面 URL 等），由桌面端从豆瓣、OpenLibrary、isbnsearch 自动抓取。
- **Cloud Sync（云同步）**: 桌面端数据与 Cloudflare D1 云端数据库之间的双向增量同步，基于 LWW 策略。
- **Migration（数据迁移）**: 将本地存储的书库数据一次性上传到云端的操作，包括封面图片上传到 R2。
