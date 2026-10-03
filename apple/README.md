# TomeKeep Apple 原生客户端

`apple/` 包含共享 Swift Package，以及 iOS、macOS 两个 SwiftUI App Target。迁移验收完成前，它们使用独立 Bundle ID 和数据目录，不会覆盖 Electron/PWA 数据。

## 当前实现范围

- Electron `db.json` 与封面的只读、幂等迁移（逐记录摘要与封面 SHA-256 报告）
- 本机书库封面/详细视图、8–20 列可调网格、搜索、升降序、完成日期排序、阅读状态和多标签 AND 筛选
- 阅读状态封面徽标、完成日期、当前档案阅读进度，以及 ISBN 语义/复制和出版社推断
- 手工录入书名、作者、出版社和标签；书库 CRUD 与软删除
- ISBN-10/ISBN-13 输入、校验及 ISBN-13 标准化
- iOS 单次原生相机扫码，扫描后自动触发元数据查询
- 客户端直连豆瓣 → OpenLibrary → isbnsearch 的 ISBN 元数据瀑布流，以及豆瓣书名/作者候选关联
- 元数据封面校验并缓存到本机独立目录；同步时上传到 R2，其他设备按 `coverKey` 校验并缓存
- 愿望单 CRUD、优先级、待购买、作者等五种排序及升降序、多标签筛选、详细/封面双视图与原子移入书库
- 多阅读档案、三态阅读进度与完成日期
- 历史价格缓存只读展示
- macOS 新增愿望时并发查询三渠道、Ollama/bigram 匹配、可见网页手工采价、商品页价格识别、登录/验证码自动重试和手工来源标记；结果同步到 iOS 只读展示
- 用户名密码登录、Keychain 会话恢复，以及启动/回到前台/本地修改/手动触发的本地优先同步（书库、愿望单、阅读状态、封面与档案 tombstone）
- 正式认证门禁：未登录时只显示登录/邀请码注册页，不展示任何业务或本机数据；覆盖安装保留的 Keychain 会话会先恢复验证，无效 Token 会清除并回到登录页
- 登录/注册界面从应用 Bundle 加载正式黑金 Logo，并使用精简原生表单；服务地址位于次级“服务设置” Sheet，注册页只收集用户名、密码和邀请码，服务端兼容的显示名称自动取用户名
- 邀请码注册并自动登录
- 书籍和愿望编辑表单采用一致的基本信息/ISBN/可增删标签结构及浮动查询反馈；iOS 两种表单均支持 ISBN 扫码，愿望另有购买计划
- 管理员邀请码查看、创建和未使用邀请码删除
- SwiftData 本地持久化
- SwiftData `1.0.0` 版本化 Schema 与迁移计划入口

仍在后续迁移阶段：iOS 连续实体书扫码的人工验收、macOS 动态网页自动采价的持续站点兼容、登录/验证码窗口的人工真实会话验收，以及正式发布迁移。简体中文/英文静态及运行时文案、格式化测试和 macOS 中英文/深浅色界面巡检已完成。OpenLibrary 已使用当前 Search API；OpenLibrary 与豆瓣实时探测、本地管理员/普通用户登录和会话恢复、本机 `qwen2.5:3b` 匹配均已通过。同步拉取已使用 250 条稳定分页和 inclusive cursor。豆瓣/isbnsearch 可见验证使用持久化网站数据，关闭验证页后会自动重试原请求。

## 在 Xcode 中运行

```bash
cd apple
xcodegen generate
open TomeKeep.xcodeproj
```

- macOS：选择 `TomeKeepMac` Scheme 和 `My Mac`，按 Run。
- iOS：选择 `TomeKeepIOS` Scheme、开发团队和已解锁真机，按 Run。
- 单元测试：在 `apple/packages/TomeKeepKit` 运行 `swift test`；iOS 契约测试可通过 `TomeKeepIOS` Scheme 的 Test 执行。
- 零售商实时探测默认跳过，避免普通测试依赖外部网站；需要人工验收三渠道时，在同一目录运行 `TOMEKEEP_RUN_LIVE_RETAILER_TESTS=1 swift test --filter liveRetailerEndpointsReturnARecognizedOutcome`。该开关仅影响测试，不进入 App 运行时。
- 元数据实时探测默认跳过；需要验证客户端直连 OpenLibrary 与豆瓣标题搜索时，运行 `TOMEKEEP_RUN_LIVE_METADATA_TESTS=1 swift test --filter liveMetadataLookupAndDoubanSearchReturnUsableResults`。该开关仅影响测试。
- 本机认证集成测试同样默认跳过；本地 Pages API 位于 `http://127.0.0.1:8788/api/` 且测试库使用 `admin/admin`、`mushroom/mushroom` fixture 时，可运行 `TOMEKEEP_LOCAL_API_BASE_URL=http://127.0.0.1:8788/api/ swift test --filter localAPIAuthenticatesAdminAndUserAndRestoresSessions`。该开关仅影响测试。
- macOS UI 自动化要求本机启用 Developer Mode；可先用 `DevToolsSecurity -status` 检查。启用属于系统安全设置，应由设备所有者在终端执行 `sudo DevToolsSecurity -enable` 并确认系统授权，再运行 `TomeKeepMac` Scheme 的 Test。当前开发机的签名 UI runner 已通过迁移书库摘要、愿望单封面网格、阅读档案和 ⌘1 导航验证。

## macOS 迁移与功能检查

1. 打开“数据迁移”，选择 Electron 数据目录（包含 `db.json` 和 `covers/`）。
2. 等待“迁移校验通过”，保留报告路径；重复导入应保持数量不变。
3. 在“书库”检查封面、阅读徽标与进度、搜索、完成日期/升降序、状态/标签筛选、ISBN 复制、封面/详细视图和列数调节；重启后显示偏好应保持。
4. 在“愿望单”检查编辑、删除、“移入书库”、详细/封面双视图、8–20 列调节以及作者/优先级等排序；重复 ISBN 不得产生重复藏书。
5. 在“阅读档案”切换档案并更新未读/在读/读完状态。
6. 在“价格记录”确认旧缓存可见且渠道链接可打开。
7. 新增愿望后确认京东/当当/中图网自动并发采价；也可点击“比价”，在内嵌网页进入商品页后保存识别或手填价格。遇到验证时，关闭验证窗口后应自动重试。
8. 在“设置”登录后点击“立即同步”；确认断网失败不影响本机数据，恢复网络后可重试。
9. 新增书籍时可输入 ISBN 并点击“查询资料”，或输入书名/作者后点击“按书名关联豆瓣”；确认候选可选择、结果可编辑，且查询失败不阻止手工保存。
10. 退出并重新打开应用，确认记录仍存在。

两端已共享同一同步实现；在设置中登录同一账户并手动同步后，书库、愿望单、阅读状态、档案删除和封面应最终一致。档案本地变更进入按账户隔离的持久 outbox，断网后可继续重放。

## 双机开发分发与自动重签

完成 iOS 修改和测试后，使用同一签名构建自动覆盖两台已配对 iPhone：

```bash
./scripts/install-device.sh L2BT252BF2
```

首次启用到期前自动重签：

```bash
./scripts/setup-auto-renew.sh L2BT252BF2
```

完整机制、设备清单、调度时间和故障恢复见 [`docs/operations/apple-device-signing.md`](../docs/operations/apple-device-signing.md)。生产同步发布门禁见 [`docs/operations/production-sync-deployment.md`](../docs/operations/production-sync-deployment.md)。
