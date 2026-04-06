import { createContext, useContext } from 'react'

export type Lang = 'zh' | 'en'

// ---------------------------------------------------------------------------
// Translation dictionary
// ---------------------------------------------------------------------------

const dict = {
  // ── Layout ──────────────────────────────────────────────────────────────
  nav_library:   { zh: '书库',    en: 'Library' },
  nav_wishlist:  { zh: '心愿单',  en: 'Wishlist' },
  logo_night:    { zh: '夜间',    en: 'night' },

  theme_light:   { zh: '浅色 — 点击切换深色', en: 'Light — click for Dark' },
  theme_dark:    { zh: '深色 — 点击切换自动', en: 'Dark — click for Auto' },
  theme_auto:    { zh: '自动 — 点击切换浅色', en: 'Auto — click for Light' },

  user_tooltip:  { zh: '用户：{name}', en: 'User: {name}' },
  user_label:    { zh: '用户',         en: 'User' },

  lang_toggle:   { zh: '切换为英文', en: 'Switch to Chinese' },

  // Douban login
  douban_login:        { zh: '登录豆瓣（用于元数据获取）', en: 'Log in to Douban (for metadata)' },
  douban_logged_in:    { zh: '已登录豆瓣',                  en: 'Logged in to Douban' },
  douban_logging_in:   { zh: '正在打开豆瓣登录…',           en: 'Opening Douban login…' },

  // UserSwitcher
  new_user_placeholder: { zh: '新用户…',    en: 'New user…' },
  add_user:             { zh: '添加用户',   en: 'Add user' },
  rename:               { zh: '重命名',     en: 'Rename' },
  delete_user_title:    { zh: '删除用户 {name}',  en: 'Delete user {name}' },
  delete_user_confirm:  { zh: '删除用户「{name}」及其所有阅读记录？此操作不可撤销。', en: 'Delete user "{name}" and all their reading history? This cannot be undone.' },

  // ── Inventory ───────────────────────────────────────────────────────────
  page_library:    { zh: '我的书库', en: 'My Library' },
  add_book:        { zh: '添加书籍', en: 'Add Book' },
  clipboard:       { zh: '剪贴板',   en: 'Clipboard' },
  scan_single:     { zh: 'ISBN 扫描 - 单次', en: 'ISBN Scan – Single' },
  scan_batch:      { zh: 'ISBN 扫描 - 批量', en: 'ISBN Scan – Batch' },
  phone_scan:      { zh: '手机扫码', en: 'Phone Scan' },
  manual:          { zh: '手动',     en: 'Manual' },

  search_placeholder: { zh: '搜索书名、作者、ISBN…', en: 'Search title, author, ISBN…' },

  filter_all:     { zh: '全部',   en: 'All' },
  filter_unread:  { zh: '未读',   en: 'Unread' },
  filter_reading: { zh: '阅读中', en: 'Reading' },
  filter_read:    { zh: '已读',   en: 'Read' },

  sort_title:       { zh: '书名',    en: 'Title' },
  sort_author:      { zh: '作者',    en: 'Author' },
  sort_added:       { zh: '入库时间', en: 'Added' },
  sort_finished:    { zh: '完成时间', en: 'Finished' },
  sort_priority:    { zh: '优先级',  en: 'Priority' },

  detail_view:      { zh: '详细视图', en: 'Detail view' },
  compact_view:     { zh: '简要视图', en: 'Compact view' },
  compact_columns:  { zh: '每行列数', en: 'Columns per row' },

  progress_read:    { zh: '{read}/{total} 已读', en: '{read}/{total} read' },

  no_tags:      { zh: '无标签', en: 'No tags' },
  clear_filter: { zh: '清除筛选', en: 'Clear filter' },

  status_read_tip:    { zh: '已读 · 点击改为未读',     en: 'Read · click to mark Unread' },
  status_reading_tip: { zh: '阅读中 · 点击改为已读',   en: 'Reading · click to mark Read' },
  status_unread_tip:  { zh: '未读 · 点击改为阅读中',   en: 'Unread · click to mark Reading' },

  view_fullsize:  { zh: '查看大图',       en: 'View full size' },
  choose_cover:   { zh: '从文件选择封面', en: 'Choose cover from file' },
  capture_cover:  { zh: '拍摄封面',       en: 'Capture cover' },
  recognize_text: { zh: '识别文字',       en: 'Recognize text' },
  scan_isbn:      { zh: '扫描 ISBN',      en: 'Scan ISBN' },
  edit:           { zh: '编辑', en: 'Edit' },
  delete:         { zh: '删除', en: 'Delete' },

  field_author:    { zh: '作者',    en: 'Author' },
  field_publisher: { zh: '出版社',  en: 'Publisher' },
  field_detail_url: { zh: '详情链接', en: 'Details URL' },

  cancel:  { zh: '取消', en: 'Cancel' },
  save:    { zh: '保存', en: 'Save' },
  add:     { zh: '添加', en: 'Add' },
  ocr_loading: { zh: '识别中…', en: 'Recognizing…' },
  ocr_done:    { zh: '已识别',  en: 'Recognized' },

  clear_finish_date: { zh: '清除完成时间（下次标记已读时重新记录）', en: 'Clear finish date (will be re-recorded next time marked Read)' },

  section_in_progress: { zh: '未读完', en: 'In Progress' },

  toast_no_isbn: { zh: '无法跳转：未填写 ISBN', en: 'Cannot open: no ISBN' },

  empty_library:     { zh: '书库还是空的，点击 "+" 开始添加吧！', en: 'Your library is empty — click "+" to add a book!' },
  empty_filter:      { zh: '没有符合条件的书籍。', en: 'No books match the current filter.' },

  confirm_delete_book: { zh: '确定要删除这本书吗？', en: 'Delete this book?' },

  isbn_copied_tip:   { zh: '已复制！',           en: 'Copied!' },
  isbn_copy_tip:     { zh: '点击复制 ISBN：{isbn}', en: 'Click to copy ISBN: {isbn}' },
  isbn_copied_badge: { zh: '已复制 ✓',           en: 'Copied ✓' },

  add_tag:      { zh: '添加标签',     en: 'Add tag' },
  tag_label:    { zh: '标签',         en: 'Tags' },
  remove_tag:   { zh: '移除标签 {tag}', en: 'Remove tag {tag}' },
  tag_input_placeholder: { zh: '输入标签…', en: 'Enter tag…' },

  form_title_placeholder:     { zh: '书名 *',  en: 'Title *' },
  form_author_placeholder:    { zh: '作者 *',  en: 'Author *' },
  form_publisher_placeholder: { zh: '出版社',  en: 'Publisher' },

  clip_loading:      { zh: '正在从剪贴板导入…', en: 'Importing from clipboard…' },
  clip_failed:       { zh: '导入失败',          en: 'Import failed' },
  scan_lookup_loading: { zh: '正在查询书籍信息…', en: 'Looking up book info…' },
  scan_not_found:      { zh: '未找到书籍信息，请手动填写。', en: 'No book info found — please fill in manually.' },
  douban_loading:    { zh: '正在从豆瓣获取详情…', en: 'Fetching from Douban…' },
  ocr_cover_loading: { zh: '正在识别封面文字…',  en: 'Recognizing cover text…' },
  filled_douban:     { zh: '已从豆瓣填充元信息', en: 'Filled from Douban' },
  filled_ocr:        { zh: '已从封面识别书名/作者', en: 'Title/author recognized from cover' },

  status_unread:  { zh: '未读', en: 'Unread' },
  status_reading: { zh: '在读', en: 'Reading' },
  status_read:    { zh: '已读', en: 'Read' },

  clip_perm_error:    { zh: '无法读取剪贴板，请检查权限。', en: 'Cannot read clipboard — check permissions.' },
  clip_empty:         { zh: '剪贴板为空。',                en: 'Clipboard is empty.' },
  filled_douban_dot:  { zh: '已从豆瓣填充元信息。',        en: 'Filled from Douban.' },
  filled_isbn_dot:    { zh: '已从 ISBN 填充元信息。',      en: 'Filled from ISBN.' },
  douban_parse_fail:  { zh: '解析豆瓣链接失败，已打开手动录入。', en: 'Failed to parse Douban link — manual entry opened.' },

  // relativeTime
  rt_just_now:  { zh: '刚刚',       en: 'just now' },
  rt_minutes:   { zh: '{n} 分钟前', en: '{n}m ago' },
  rt_hours:     { zh: '{n} 小时前', en: '{n}h ago' },
  rt_days:      { zh: '{n} 天前',   en: '{n}d ago' },
  rt_months:    { zh: '{n} 个月前', en: '{n}mo ago' },
  rt_years:     { zh: '{n} 年前',   en: '{n}y ago' },

  // Month names
  month_1:  { zh: '1月',  en: 'Jan' },
  month_2:  { zh: '2月',  en: 'Feb' },
  month_3:  { zh: '3月',  en: 'Mar' },
  month_4:  { zh: '4月',  en: 'Apr' },
  month_5:  { zh: '5月',  en: 'May' },
  month_6:  { zh: '6月',  en: 'Jun' },
  month_7:  { zh: '7月',  en: 'Jul' },
  month_8:  { zh: '8月',  en: 'Aug' },
  month_9:  { zh: '9月',  en: 'Sep' },
  month_10: { zh: '10月', en: 'Oct' },
  month_11: { zh: '11月', en: 'Nov' },
  month_12: { zh: '12月', en: 'Dec' },

  // ── Wishlist ─────────────────────────────────────────────────────────────
  page_wishlist:        { zh: '心愿单',     en: 'Wishlist' },
  add_to_wishlist:      { zh: '添加到心愿单', en: 'Add to Wishlist' },

  confirm_remove_wishlist: { zh: '确定要从心愿单中移除吗？', en: 'Remove from wishlist?' },

  pending_buy:     { zh: '待买',   en: 'Want to buy' },
  not_pending_buy: { zh: '未标记', en: 'Not marked' },
  move_to_library: { zh: '已购，移入书库', en: 'Purchased — move to library' },
  filter_pending:  { zh: '待买',   en: 'Pending' },

  compare_prices: { zh: '比价', en: 'Compare prices' },
  remove:         { zh: '移除', en: 'Remove' },

  price_fetching: { zh: '采价中…', en: 'Fetching price…' },

  channel_bookschina: { zh: '中图', en: 'BookSchina' },
  channel_jd:         { zh: '京东',   en: 'JD' },
  channel_dangdang:   { zh: '当当',   en: 'Dangdang' },

  channel_unsupported: { zh: '暂不支持', en: 'Not supported' },
  price_not_found:     { zh: '未找到',  en: 'Not found' },
  price_failed:        { zh: '失败',    en: 'Failed' },

  empty_wishlist: { zh: '心愿单还是空的。', en: 'Your wishlist is empty.' },

  douban_parse_fail_manual: { zh: '解析豆瓣链接失败，请手动填写。', en: 'Failed to parse Douban link — please fill in manually.' },

  // ── IsbnScanModal ─────────────────────────────────────────────────────────
  scan_title_batch:  { zh: '连续扫描 ISBN', en: 'Batch Scan ISBN' },
  scan_title_single: { zh: '扫描 ISBN',     en: 'Scan ISBN' },
  scan_done:         { zh: '完成', en: 'Done' },
  scan_close:        { zh: '关闭', en: 'Close' },
  scan_cancel:       { zh: '取消', en: 'Cancel' },
  scan_starting:     { zh: '正在启动摄像头…', en: 'Starting camera…' },
  scan_requires_https:       { zh: '摄像头需要 HTTPS 连接，请通过 https:// 访问应用。', en: 'Camera requires a secure HTTPS connection. Please access the app via https://.' },
  scan_unsupported_camera:   { zh: '当前环境不支持摄像头访问。', en: 'Camera not supported in this environment.' },
  scan_unsupported_barcode:  { zh: '当前环境不支持条码识别（BarcodeDetector）。', en: 'Barcode detection (BarcodeDetector) not supported.' },
  scan_permission_denied:    { zh: '摄像头权限被拒绝，请在系统设置中开启后重试。', en: 'Camera permission denied — enable it in System Settings and try again.' },
  scan_hint_batch:   { zh: '将条形码对准摄像头，识别后自动继续，扫完后点击"完成"', en: 'Point the barcode at the camera; scanning continues automatically — click Done when finished' },
  scan_hint_single:  { zh: '将条形码对准摄像头，自动识别后关闭', en: 'Point the barcode at the camera — closes automatically after detection' },
  scan_count:        { zh: '已扫描 {n} 本', en: 'Scanned {n}' },

  // ── MobileScanPanel ──────────────────────────────────────────────────────
  mobile_title:    { zh: '手机扫码入库', en: 'Scan with Phone' },
  mobile_subtitle: { zh: '扫描下方二维码，用手机摄像头批量录入', en: 'Scan the QR code below to batch-add books with your phone' },
  close:           { zh: '关闭', en: 'Close' },
  service_starting: { zh: '正在启动服务…', en: 'Starting service…' },
  service_failed:  { zh: '启动失败', en: 'Failed to start' },
  retry:           { zh: '重试', en: 'Retry' },
  service_running: { zh: '服务运行中', en: 'Service running' },
  qr_alt:          { zh: '扫码连接', en: 'Scan to connect' },
  qr_loading:      { zh: '生成二维码…', en: 'Generating QR code…' },
  qr_hint:         { zh: '用手机扫描二维码，打开扫码页面\niOS 需信任证书（首次）', en: 'Scan the QR code with your phone to open the scanning page\niOS: trust the certificate on first use' },
  ios_guide_title: { zh: 'iOS 首次使用：如何信任证书？', en: 'iOS First Use: How to trust the certificate?' },
  ios_step_1: { zh: '1. 扫码后 Safari 显示"此连接不是私密的"', en: '1. Safari shows "This Connection Is Not Private" after scanning' },
  ios_step_2: { zh: '2. 点击「显示详细信息」→「访问此网站」', en: '2. Tap "Show Details" → "Visit this website"' },
  ios_step_3: { zh: '3. 输入设备密码确认，允许摄像头权限', en: '3. Enter your passcode to confirm, then allow camera access' },
  ios_step_4: { zh: '后续连接无需重复操作。', en: 'No need to repeat this on future connections.' },
  scanned_section: { zh: '已扫描', en: 'Scanned' },
  scanned_count:   { zh: '{n} 本', en: '{n} books' },
  tap_to_complete: { zh: '点击补全', en: 'Tap to complete' },
  tap_to_complete_title: { zh: '点击补全书目信息', en: 'Click to complete book info' },
  remove_from_library: { zh: '从书库移除', en: 'Remove from library' },
  reprice:   { zh: '重新采价', en: 'Re-fetch price' },
  get_price: { zh: '去采价',   en: 'Fetch price' },

  // Auto-pricing
  auto_pricing:            { zh: '自动采价中…',              en: 'Auto-pricing…' },
  refresh_all:             { zh: '刷新所有渠道价格',           en: 'Refresh all channel prices' },
  refresh_channel:         { zh: '刷新价格',                  en: 'Refresh price' },
  refresh_channel_loading: { zh: '刷新中…',                   en: 'Refreshing…' },
  reprice_all:             { zh: '自动更新所有渠道价格',       en: 'Auto-refresh all channel prices' },
  auto_capture_channel:    { zh: '自动采价',                  en: 'Auto-price' },
  manual_capture_channel:  { zh: '手动采价',                  en: 'Manual price' },
  source_auto_active:      { zh: '当前为自动采集',             en: 'Currently auto-fetched' },
  source_manual_active:    { zh: '当前为手动采集',             en: 'Currently manually set' },
  source_auto_inactive:    { zh: '切换为自动采价',             en: 'Switch to auto-price' },
  source_manual_inactive:  { zh: '切换为手动采价',             en: 'Switch to manual price' },
  price_delisted:     { zh: '已下架',                   en: 'Delisted' },
  manual_source_tip:  { zh: '手动采集 · 点击移除标志',   en: 'Manual capture · click to remove flag' },
  remove_manual_flag: { zh: '移除手动标志',              en: 'Remove manual flag' },
  done:            { zh: '完成', en: 'Done' },
  refetch_cover:         { zh: '重新获取封面', en: 'Re-fetch cover' },
  refetch_cover_loading: { zh: '获取中…',      en: 'Fetching…' },
  refetch_cover_none:    { zh: '未找到封面图', en: 'No cover found' },
  copy_title:            { zh: '复制书名',      en: 'Copy title' },
  copy_title_done:       { zh: '已复制',        en: 'Copied' },
  saving:                { zh: '保存中…',        en: 'Saving…' },

  // ── Admin ────────────────────────────────────────────────────────────────
  nav_admin:              { zh: '管理',              en: 'Admin' },
  page_admin:             { zh: '管理员',             en: 'Admin' },
  admin_invite_section:   { zh: '邀请码',             en: 'Invite Codes' },
  admin_generate_invite:  { zh: '生成邀请码',         en: 'Generate Invite Code' },
  admin_generating:       { zh: '生成中…',            en: 'Generating…' },
  admin_invite_generated: { zh: '邀请码：{code}',    en: 'Invite code: {code}' },
  admin_invite_copy:      { zh: '复制',               en: 'Copy' },
  admin_invite_copied:    { zh: '已复制！',           en: 'Copied!' },
  admin_invite_error:     { zh: '生成失败：{error}', en: 'Failed: {error}' },
  register_success_banner: { zh: '注册成功，请登录', en: 'Registration successful — please log in' },

  // Invite list table
  admin_col_code:       { zh: '邀请码',   en: 'Code' },
  admin_col_created:    { zh: '创建时间', en: 'Created' },
  admin_col_used_by:    { zh: '使用者',   en: 'Used by' },
  admin_col_used_at:    { zh: '使用时间', en: 'Used at' },
  admin_unused:         { zh: '未使用',   en: 'Unused' },
  admin_empty_invites:  { zh: '暂无邀请码', en: 'No invite codes yet' },
  admin_loading:        { zh: '加载中…',   en: 'Loading…' },
  admin_load_error:     { zh: '加载失败：{error}', en: 'Failed to load: {error}' },
  admin_page_prev:      { zh: '上一页', en: 'Previous' },
  admin_page_next:      { zh: '下一页', en: 'Next' },
  admin_page_info:      { zh: '第 {page} / {total} 页', en: 'Page {page} of {total}' },

  // AdminLayout
  admin_logout:         { zh: '退出管理', en: 'Log out' },

  // Invite actions
  admin_invite_share:        { zh: '复制注册链接', en: 'Copy register link' },
  admin_invite_share_copied: { zh: '链接已复制！',  en: 'Link copied!' },
  admin_invite_delete:       { zh: '删除邀请码',   en: 'Delete' },
  admin_invite_deleting:     { zh: '删除中…',      en: 'Deleting…' },
  admin_invite_delete_used:  { zh: '已使用，无法删除', en: 'Cannot delete — already used' },

  // ── Settings / Cloud Sync ─────────────────────────────────────────────────
  settings_title:             { zh: '设置',              en: 'Settings' },
  nav_settings:               { zh: '设置',              en: 'Settings' },
  sync_section_title:         { zh: '云同步',             en: 'Cloud Sync' },
  sync_connected:             { zh: '已连接',             en: 'Connected' },
  sync_last_sync:             { zh: '上次同步',           en: 'Last sync' },
  sync_never:                 { zh: '从未同步',           en: 'Never' },
  sync_pull_now:              { zh: '立即同步',           en: 'Sync now' },
  sync_pulling:               { zh: '同步中…',            en: 'Syncing…' },
  sync_pull_updated:          { zh: '同步完成，数据已更新', en: 'Sync complete — data updated' },
  sync_pull_no_changes:       { zh: '同步完成，无新内容',  en: 'Sync complete — no changes' },
  sync_pull_error:            { zh: '同步失败：{error}',  en: 'Sync failed: {error}' },
  sync_logout:                { zh: '退出登录',           en: 'Log out' },
  sync_login:                 { zh: '登录',               en: 'Log in' },
  sync_logging_in:            { zh: '登录中…',            en: 'Logging in…' },
  sync_login_description:     { zh: '登录后，书库和心愿单数据将自动同步到云端。', en: 'Log in to sync your library and wishlist to the cloud.' },
  sync_username_placeholder:  { zh: '用户名',             en: 'Username' },
  sync_password_placeholder:  { zh: '密码',               en: 'Password' },
  sync_migrate_title:         { zh: '迁移现有数据到云端',  en: 'Migrate existing data to cloud' },
  sync_migrate_description:   { zh: '首次登录后，请将本地书库一次性迁移到云端。迁移不会删除本地数据，可安全重复执行。', en: 'After your first login, migrate your local library to the cloud. Migration is safe to run multiple times.' },
  sync_migrate_start:         { zh: '开始迁移',            en: 'Start migration' },
  sync_migrate_running:       { zh: '迁移中…',             en: 'Migrating…' },
  sync_migrate_done:          { zh: '迁移完成：{books} 本书 · {wishlist} 条心愿 · {covers} 张封面{skipped}', en: 'Done: {books} books · {wishlist} wishlist · {covers} covers{skipped}' },
  sync_migrate_error:         { zh: '迁移失败：{error}',   en: 'Migration failed: {error}' },
  sync_migrate_phase_covers:  { zh: '上传封面 {current}/{total}…', en: 'Uploading covers {current}/{total}…' },
  sync_migrate_phase_books:   { zh: '同步书籍 {current}/{total}…', en: 'Syncing books {current}/{total}…' },
  sync_migrate_phase_wishlist: { zh: '同步心愿单 {current}/{total}…', en: 'Syncing wishlist {current}/{total}…' },
  sync_migrate_phase_states:  { zh: '同步阅读状态 {current}/{total}…', en: 'Syncing reading states {current}/{total}…' },

  // Profiles
  profile_label:              { zh: '画像',               en: 'Profile' },
  profile_switch:             { zh: '切换画像',            en: 'Switch profile' },
  profile_new:                { zh: '新建画像',            en: 'New profile' },
  profile_rename:             { zh: '重命名',              en: 'Rename' },
  profile_delete:             { zh: '删除画像',            en: 'Delete profile' },
  profile_delete_confirm:     { zh: '确认删除画像"{name}"？其阅读记录将一并删除。', en: 'Delete profile "{name}"? Its reading history will also be deleted.' },
  profile_name_placeholder:   { zh: '画像名称（如：爸爸）',  en: 'Profile name (e.g. Dad)' },
  profile_saving:             { zh: '保存中…',             en: 'Saving…' },
  profile_limit_reached:      { zh: '每个账号最多创建 5 个画像', en: 'Each account can have at most 5 profiles' },
} as const

export type DictKey = keyof typeof dict

// ---------------------------------------------------------------------------
// Translate function
// ---------------------------------------------------------------------------

export function translate(lang: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  const entry = dict[key]
  if (!entry) return key
  let str: string = entry[lang]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return str
}

// ---------------------------------------------------------------------------
// Context & hook
// ---------------------------------------------------------------------------

type LangContextValue = {
  lang: Lang
  t: (key: DictKey, vars?: Record<string, string | number>) => string
  setLang: (lang: Lang) => Promise<void>
}

export const LangContext = createContext<LangContextValue>({
  lang: 'zh',
  t: (key, vars) => translate('zh', key, vars),
  setLang: async () => {},
})

export function useLang(): LangContextValue {
  return useContext(LangContext)
}

// ---------------------------------------------------------------------------
// Provider — platform-specific; desktop LangProvider lives in
// @tomekeep/desktop's src/lib/i18n.ts; web PWA has its own provider.
// ---------------------------------------------------------------------------
