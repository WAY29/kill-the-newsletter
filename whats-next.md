<original_task>
用户最初请求：将 /Users/lang/coding/self/kill-the-newsletter 项目修改为可以部署到 Cloudflare Workers 的项目，目标是尽可能少修改现有源码；要求参考 https://github.com/maillab/cloud-mail，并使用 DeepWiki 询问该项目的 Workers 部署架构；要求多搜索和调研。
</original_task>

<work_completed>
已完成仓库初步梳理。

当前仓库核心文件很少：source/index.mts 是主程序，约 1994 行；source/index.test.mts 是现有邮件发送测试；package.json/tsconfig.json/README.md/configuration/*.mjs 是构建和部署配置。原项目是 Node 常驻进程架构，不是 Worker handler 架构。source/index.mts 通过 util.parseArgs 加载配置，使用 @radically-straightforward/server 做 HTTP server，@radically-straightforward/sqlite 管理本地 SQLite，smtp-server 在 25 端口收 SMTP，mailparser 解析邮件，fs 保存附件到 dataDirectory/files，child_process 启动多个 server/backgroundJob/email 子进程，caddy.start 做反代和静态文件服务。

已确认原项目的关键运行模式：无 --type 参数时会 fork 多个 --type server、--type backgroundJob 和 --type email 子进程；server 负责 HTTP 页面、feed CRUD、Atom feed、WebSub subscribe/unsubscribe；email 负责 SMTP 收件、解析邮件、创建 feedEntries、保存附件；backgroundJob 负责清理无引用附件和过期 feedVisualizations/feedWebSubSubscriptions，以及 WebSub 验证和 dispatch。

已完成 DeepWiki 调研 maillab/cloud-mail。结论：cloud-mail 是原生 Cloudflare Workers 架构，入口集中在 mail-worker/src/index.js，包含 fetch、email、scheduled 三类入口。fetch 负责 /api/* 路由到 Hono，/static/* 和 /attachments/* 从 R2/对象服务返回，其他走 assets binding；email 入口通过 Cloudflare Email Routing 接收邮件，使用 PostalMime 解析，校验收件人，写 D1，附件写 R2/S3 兼容存储，触发转发规则；scheduled 入口做每日维护，例如清理过期记录、重置每日发送计数、完成 pending receive。cloud-mail 使用 D1 作为关系数据库，KV 做缓存/session/配额，R2 做附件和图片，Wrangler 配置包含 d1_databases、kv_namespaces、r2_buckets、assets、triggers.crons 和 vars。最小 incoming-email-to-storage 应用必须有 Worker email handler、D1、R2、PostalMime 和基础 HTTP handler；Hono、Vue 前端、KV、Telegram/Resend/OAuth 等是可选。

已完成 Cloudflare 官方文档调研。重点参考了 Cloudflare Email Routing / Email Workers 的 email handler，ForwardableEmailMessage 有 from、to、raw、headers、rawSize、setReject、forward、reply；Cloudflare Workers D1 API 提供 env.DB.prepare().bind().first/run/all 和 batch/exec；R2 binding 提供 bucket.get/put/delete/list；Cron Triggers 通过 scheduled handler 和 wrangler triggers.crons；Node.js compatibility 不是完整 Node 进程环境，不能提供 SMTP 监听端口、child_process、Caddy 这类常驻服务器能力。因此不能“原样”把当前 source/index.mts 跑到 Workers。

已做关键设计决策：最小侵入方案不是改写 source/index.mts，而是保留现有 Node/Caddy/SMTP 入口，新增一个 Workers 专用入口 source/worker.mts。原因是直接兼容现有入口会牵涉 fs、net/SMTP server、child_process、Caddy、本地 SQLite、文件系统附件和 background job worker 模型，改动面非常大；新增入口可以复用产品行为和数据模型，但运行时改为 fetch/email/scheduled、D1/R2，并且不破坏现有 VPS 部署。

已修改 package.json。新增 scripts：test:worker = tsc &amp;&amp; node --test build/worker.test.mjs；dev:worker = wrangler dev；deploy:worker = wrangler deploy；migrate:worker:local = wrangler d1 migrations apply kill-the-newsletter --local；migrate:worker:remote = wrangler d1 migrations apply kill-the-newsletter --remote。新增 dependency postal-mime，用于 Worker 运行时邮件解析。新增 devDependencies @cloudflare/workers-types 和 wrangler。package.json 当前相关行号：scripts 在 2-11 行，dependencies 在 13-19 行，devDependencies 在 20-34 行。

已新增 source/worker.test.mts。该文件当前是 Worker 入口的红灯测试，导入未来的 ./worker.mjs，测试 parseFeedAddress、sanitizeFilename、textToHTML、renderFeed。测试覆盖：只接受配置 hostname 下的本地收件人；拒绝 bad+tag@example.com 这种生产环境不支持的收件地址；附件文件名中不安全字符替换为连字符；纯文本邮件 fallback HTML 会 escape；Atom feed 会 escape feed title 和 entry title，并输出 R2 附件链接。当前测试文件行号：导入在 1-8 行；parseFeedAddress 测试 10-23 行；sanitizeFilename 测试 25-28 行；textToHTML 测试 30-35 行；renderFeed 测试 37-78 行。

已运行一次红灯验证：npm run test:worker。结果 tsc 失败，错误是 source/worker.test.mts(8,8): Cannot find module './worker.mjs' or its corresponding type declarations。这个失败符合预期，因为 source/worker.mts 尚未创建。

已安装/更新依赖。第一次 npm view 使用默认 ~/.npm 缓存失败，原因是 /Users/lang/.npm/_cacache/tmp 内有 root-owned files，EPERM。随后使用 npm --cache /tmp/kill-the-newsletter-npm-cache 查询包版本，查到 postal-mime 2.7.4、@cloudflare/workers-types 4.20260426.1、wrangler 4.85.0；实际 package-lock 中解析到 @cloudflare/workers-types ^4.20260413.1、wrangler ^4.82.2，是 npm install 当时选择的版本。第一次 npm install --save postal-mime --save-dev wrangler @cloudflare/workers-types 失败，因为现有依赖链触发 native module xxhash-addon 编译失败，node-gyp/make 报 unknown option -o。之后执行 npm --cache /tmp/kill-the-newsletter-npm-cache install --ignore-scripts --save postal-mime --save-dev wrangler @cloudflare/workers-types 成功，新增 node_modules，并更新 package-lock.json/package.json。

已查看 Workers 类型定义。node_modules/@cloudflare/workers-types/index.ts 导出 ExecutionContext、ExportedHandler、R2Bucket、ScheduledController、D1Database、ForwardableEmailMessage 等类型；EmailExportedHandler 形如 (message, env, ctx) =&gt; void | Promise&lt;void&gt;。latest/index.d.ts 显示 D1Database.prepare/query API、D1Meta.last_row_id、R2Bucket.get/put/delete/list 等。PostalMime 类型位于 node_modules/postal-mime/postal-mime.d.ts，默认导出 PostalMime，PostalMime.parse 支持 RawEmail = string | ArrayBuffer | Uint8Array | Blob | Buffer | ReadableStream，Email.attachments 中 content 是 ArrayBuffer | Uint8Array | string，附件字段为 filename、mimeType、content 等。

当前未完成 source/worker.mts、wrangler.jsonc、D1 migration、README 部署说明等落地文件。没有修改 source/index.mts。
</work_completed>

<work_remaining>
下一步建议按以下顺序继续，避免扩大改动面。

第一步：修正 package-lock.json 顶层依赖状态。当前 package.json 已将 postal-mime 放入 dependencies，但 package-lock.json 顶层仍把 postal-mime 记录在 devDependencies，且根 packages[""].dependencies 中未出现 postal-mime。需要用 npm --cache /tmp/kill-the-newsletter-npm-cache install --ignore-scripts 重新生成锁，或最小手工修正 package-lock 后再验证 npm install 行为。优先使用 npm 命令，避免手写锁文件。

第二步：新增 source/worker.mts，让 source/worker.test.mts 通过。建议先只实现被测试的纯函数，再逐步补 handler。必须 export parseFeedAddress、sanitizeFilename、textToHTML、renderFeed。建议同时 export default satisfies ExportedHandler&lt;Env&gt;，Env 至少包含 DB: D1Database、FILES: R2Bucket、HOSTNAME: string、ENVIRONMENT?: "production" | "development"、SYSTEM_ADMINISTRATOR_EMAIL?: string。可以从 @cloudflare/workers-types import type ExportedHandler、ForwardableEmailMessage、ExecutionContext、ScheduledController、D1Database、R2Bucket。

第三步：在 source/worker.mts 实现最小 HTTP fetch 路由。目标不是复刻所有 UI 细节，而是先保证核心功能：GET / 返回创建 feed 表单；POST /feeds 创建 feed；GET /feeds/:feedPublicId 返回设置页；PATCH /feeds/:feedPublicId 更新 title/icon；DELETE /feeds/:feedPublicId 删除 feed；GET /feeds/:feedPublicId.xml 返回 Atom；GET /feeds/:feedPublicId/entries/:feedEntryPublicId.html 返回 HTML 内容；GET /files/:publicId/:name 从 R2 返回附件。可以暂时用原项目相似 HTML 字符串，不要引入 @radically-straightforward/server/html/css/javascript，因为那些现有包面向 Node/server/Caddy，Workers 适配风险高。

第四步：在 source/worker.mts 实现 email handler。使用 PostalMime.parse(message.raw) 解析 Cloudflare Email Routing 的 ForwardableEmailMessage。收件人用 message.to，发件人用 message.from。parseFeedAddress 需按 hostname 校验收件地址，生产环境只接受 /^[A-Za-z0-9]+@hostname$/，development 可按需放宽但不要引入安全隐患。查 D1 feeds 表确认 publicId 存在。附件写入 R2，key 建议 files/{enclosurePublicId}/{sanitizedFilename}，并在 D1 feedEntryEnclosures/feedEntryEnclosureLinks 建元数据。邮件正文优先 email.html；其次 email.text 经 textToHTML；最后 "No content."。创建 feedEntries 后执行 feed size 限制，按原逻辑保留总 title+content 长度约 2 ** 19 的最新条目，删除过旧 entries 和 links。邮件处理成功后用 ctx.waitUntil 或 queued backgroundJobs/scheduled 实现 WebSub dispatch；最小版本可以先 ctx.waitUntil(dispatchWebSub(...))。

第五步：实现 scheduled handler。至少清理孤儿附件、删除旧 feedVisualizations、删除 24 小时以上未验证/过期 feedWebSubSubscriptions，逻辑对应原 source/index.mts 的 backgroundJob 清理。R2 删除需使用 FILES.delete(key)。如果要复刻 WebSub verify/dispatch 的可靠重试，应增加 workerJobs 表或 D1 队列表，再由 scheduled 轮询；最小版本可以先直接 waitUntil 且文档注明可靠性差异。

第六步：新增 D1 migration。建议目录 migrations/，文件名例如 0001_initial.sql。表结构应从 source/index.mts 当前最终 schema 提取：feeds(id integer primary key autoincrement, publicId text not null unique, title text not null, emailIcon text null, icon text null)；feedEntries(id, publicId unique, feed references feeds, createdAt, author, title, content)；feedVisualizations(id, feed references feeds, createdAt)；feedWebSubSubscriptions(id, feed references feeds, createdAt, callback, secret, unique(feed, callback))；feedEntryEnclosures(id, publicId unique, type, length, name)；feedEntryEnclosureLinks(id, feedEntry, feedEntryEnclosure)。D1 SQLite 支持的 STRICT/foreign key 行为需要验证，建议先不使用复杂迁移历史，只建最终 schema 和索引。

第七步：新增 wrangler.jsonc。建议配置：name = "kill-the-newsletter"；main = "build/worker.mjs" 或 source/worker.mts 视 Wrangler TS bundle 支持选择；compatibility_date 用当前日期附近的稳定值，例如 "2026-04-28" 或官方当前建议；assets = { directory: "./static", binding: "ASSETS", run_worker_first: true } 可选，如果 fetch 手动处理 favicon 也可不绑定 assets；d1_databases binding "DB", database_name "kill-the-newsletter", database_id placeholder "replace-with-d1-database-id", migrations_dir "./migrations"；r2_buckets binding "FILES", bucket_name "kill-the-newsletter-files"；triggers.crons 例如 ["*/30 * * * *"] 或 ["0 * * * *"]；vars HOSTNAME = "example.com", ENVIRONMENT = "production"。注意 wrangler config schema 允许 assets.directory、binding、not_found_handling、run_worker_first，d1_databases[].migrations_dir，r2_buckets[].bucket_name，triggers.crons。

第八步：更新 README 或新增 DEPLOYMENT_WORKERS.md。应说明 Workers 版是新增部署入口，原 Node/VPS 部署仍可用；需要先创建 D1 database、R2 bucket、Cloudflare Email Routing catch-all 或自定义地址 route 到 Worker；执行 npm run migrate:worker:remote；执行 npm run deploy:worker；设置 DNS/MX/Email Routing。还要说明限制差异：Workers 不能运行 SMTP server，必须使用 Cloudflare Email Routing；附件从 R2 返回；WebSub dispatch 可靠性取决于最终实现。

第九步：验证。至少运行 npm run test:worker；运行 npx tsc --noEmit 或 npm run test:worker 里的 tsc；运行 npx wrangler deploy --dry-run 或 npx wrangler deploy --dry-run --outdir /tmp/kill-the-newsletter-worker-build（具体参数查当前 wrangler 帮助）；运行 npm test 如果 native module 环境允许。当前本机 npm install 有 native module 编译问题，验证时优先用现有 node_modules 和 --ignore-scripts。若 Wrangler 需要网络或写缓存失败，使用 --cache /tmp 或必要时申请 escalated。
</work_remaining>

<attempted_approaches>
尝试直接理解是否可少改源码运行现有 source/index.mts。结论是不现实。原因：Cloudflare Workers 不提供传统 SMTP 25 端口监听、长期 Node HTTP server、Caddy、child_process 子进程保活、本地 fs SQLite 文件数据库、本地附件目录等能力。nodejs_compat 不能把这种进程型服务变成 Worker 服务。应避免继续尝试把 source/index.mts 原样 bundle 到 Workers。

尝试使用 npm view wrangler/postal-mime/@cloudflare/workers-types/vitest 获取版本，默认 npm 缓存失败：EPERM open /Users/lang/.npm/_cacache/tmp，提示 ~/.npm 有 root-owned files。避免重复使用默认 npm 缓存；继续时用 npm --cache /tmp/kill-the-newsletter-npm-cache。

尝试完整 npm install --save postal-mime --save-dev wrangler @cloudflare/workers-types，失败在 node_modules/xxhash-addon 的 node-gyp rebuild，make 报 multiple "unknown option -o"，退出 code 1。该问题与本地 toolchain/Node 24/native dependency 相关。避免重复普通 install；使用 --ignore-scripts 可完成依赖解析和锁更新，但可能不构建 native 依赖。后续如需完整 npm test，可能仍会遇到 native module 编译问题。

尝试运行 npm run test:worker，得到预期红灯：source/worker.test.mts import ./worker.mjs 失败，因为 source/worker.mts 尚未创建。这个红灯是 TDD 的 Red 阶段，不是异常 blocker。

曾考虑是否使用 Hono 复刻 cloud-mail 的 HTTP routing，但暂未引入。原因：本项目页面和 API 很简单，新增 Hono 会增加依赖和迁移成本；最小 Worker 入口可以用 URL pathname 和正则直接路由。后续如果路由变复杂，可再引入 Hono。

曾考虑是否把现有 @radically-straightforward/html/css/javascript/server 继续用于 Workers。暂未采用。原因：@radically-straightforward/server、sqlite、caddy 明显 Node-only；html/css/javascript 可能可用但会牵涉 CSS/JS build 和 caddy.staticFiles 的现有机制。最小 Workers 版建议先用纯字符串模板，降低兼容风险。
</attempted_approaches>

<critical_context>
用户明确希望“尽可能不修改源码”，并要求“参考 cloud-mail，用 DeepWiki 问，多搜索和调研”。最符合该要求的工程路径是新增 Workers 旁路入口，不改或极少改 source/index.mts。不要大规模重构原文件，除非用户明确同意。

当前工作区位置是 /Users/lang/coding/self/kill-the-newsletter。系统当前日期为 2026-04-28，用户环境 timezone Asia/Shanghai。sandbox_mode 是 workspace-write，允许写当前 repo、/tmp 等。必须使用 apply_patch 进行手工文件编辑。搜索文件优先 rg。用户语言是中文，交付默认中文。

项目 AGENTS.md 指令要求：默认中文；不猜测，先验证；小步、最小改动；新行为/bugfix/parser/business logic 用 TDD；保护用户改动；验证后交付；最终说明变更、影响/风险、验证。当前已经遵循 TDD 加了 Worker 红灯测试。

DeepWiki 调研结论需保留：cloud-mail 的核心不是把传统 SMTP 服务器放进 Workers，而是用 Cloudflare Email Routing 的 email handler；持久化使用 D1/R2/KV；HTTP 走 fetch；维护任务走 scheduled。这个架构对本项目有直接参考价值。

Workers 版必须接受架构差异：不能监听端口 25；不能用 Caddy；不能用本地 SQLite 文件；不能用 fs 保存附件；不能用 child_process 常驻 background workers。对应替代：Email Routing email handler、D1、R2、scheduled/ctx.waitUntil、Wrangler。

需要注意 package-lock 当前状态不一致：package.json dependencies 包含 postal-mime，但 package-lock 顶层 packages[""].dependencies 尚未包含 postal-mime，而 packages[""].devDependencies 包含 postal-mime。这是因为安装后又手动把 postal-mime 从 devDependencies 挪到了 dependencies。继续前应修正。

当前 node_modules 已存在，是通过 npm --cache /tmp/kill-the-newsletter-npm-cache install --ignore-scripts 生成的。build/ 目录存在但未纳入 git（可能被 .gitignore 忽略），不要依赖其内容作为源码。

官方文档/类型定位：@cloudflare/workers-types/index.ts 中 ExecutionContext 在约 469 行，ExportedHandler 在约 523 行，R2Bucket 在约 2365 行，ScheduledController 在约 2530 行，D1Database 在约 11842 行，ForwardableEmailMessage 在约 11913 行，EmailExportedHandler 在约 11988 行。latest/index.d.ts 中 D1Meta.last_row_id 可用于插入后取 id；D1PreparedStatement 支持 first/run/all；R2Bucket.put 可接收 ReadableStream/ArrayBuffer/ArrayBufferView/string/Blob。

建议实现 source/worker.mts 时优先将可测试纯函数与 handler 分离。纯函数：escapeHTML、generatePublicId、parseFeedAddress、sanitizeFilename、textToHTML、renderFeed、maybe parseFormData。D1 封装：getFeed、listEntries、listEnclosuresByEntry、createFeed、deleteFeed、createFeedEntryFromEmail、recordVisualization、cleanupExpiredRows。R2 封装：storeAttachment、serveAttachment、deleteAttachmentKey。这样后续可以继续加单测。

WebSub 行为要谨慎。原项目在 POST /feeds/:id/websub 中仅创建 _backgroundJobs，由 backgroundJob 进程异步 verify；邮件收取时也创建 feedWebSubSubscriptions.dispatch jobs。Workers 无原有 _backgroundJobs helper。最小实现可以用 ctx.waitUntil 直接 verify/dispatch，但这改变重试和可靠性。更完整方案是自建 workerJobs 表并由 scheduled 处理，或使用 Cloudflare Queues（会增加资源和配置）。

安全/行为边界：GET feed XML 原项目有简单 rate limit：一小时内 feedVisualizations 超过 10 次返回 429。应在 Workers 版复刻。POST websub 要校验 hub.mode、hub.topic、hub.callback、hub.secret，拒绝 callback 指向本站/localhost/127.0.0.1，防 SSRF。邮件收取要拒绝无效 mailFrom 和 blogtrottr.com/feedrabbit.com 发件域；在 Workers 里可用 message.from 代替 SMTP session envelope mailFrom。附件文件名要 sanitize，避免路径穿越。
</critical_context>

<current_state>
当前 git status --short：package-lock.json modified；package.json modified；source/worker.test.mts untracked；whats-next.md 是本次新增交接文档。没有提交任何改动。

已保存且较确定的改动：package.json 新增 Worker scripts、postal-mime、@cloudflare/workers-types、wrangler；source/worker.test.mts 新增红灯测试；package-lock.json 已被 npm install --ignore-scripts 修改但需要继续修正 postal-mime 的 dependency/devDependency 位置。

未开始的交付物：source/worker.mts、wrangler.jsonc、migrations/0001_initial.sql、Workers 部署文档、Wrangler dry-run 验证、实际 D1/R2/Email Routing 创建步骤。

当前工作流位置：已经完成调研和 TDD Red 阶段，下一步应进入 Green 阶段，先创建 source/worker.mts 的纯函数让 npm run test:worker 过，再补 Workers handler 和配置。

开放问题：Workers 版是否需要 100% 复刻原 UI 和 WebSub 异步可靠性，还是先完成 MVP 可部署版本。当前默认假设是 MVP：保持核心“邮件转 Atom feed”和附件功能；原 Node 版继续保留作为完整版本；Workers 版逐步补齐 WebSub 和管理 UI 细节。
</current_state>
