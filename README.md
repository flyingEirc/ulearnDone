# uLearn 压测插件（Chrome MV3 · TypeScript）

把 `main.go` 的自动学习记录流水线移植为 Chrome 扩展（Manifest V3）。**全项目 TypeScript**，仅用官方 `tsc` 编译，无 wxt / plasmo / 任何打包器或框架。用于对**你自己的内网学习平台**做压测 / 回归。

---

## 一、技术方案

### 工程结构

```
src/                TypeScript 源码（编译进 dist/）
  types.ts          全项目共享类型：领域模型 / 后端响应 / 上报体 / 消息契约
  background.ts     service worker：token 读取、拉列表、跑流水线
  popup.ts          界面逻辑
  lib/
    des.ts          DES-ECB + PKCS7 + Base64（Web Crypto 不支持 DES）
    config.ts       端点与默认配置
    pipeline.ts     移植 main.go 全链路
public/             静态资源，构建时原样拷进 dist/
  manifest.json  popup.html  popup.css  rules.json  icons/
scripts/copy-assets.mjs   拷贝 public/ -> dist/
test/des.test.mjs   DES 回归测试（针对编译产物 dist/lib/des.js）
tsconfig.json  package.json
dist/               ← 构建输出，Chrome 加载的就是这个目录
```

- 编译目标 `ES2022` + `module: ES2022`，直接产出**浏览器原生 ES Module**（service worker `type:module`、popup `<script type="module">`）。
- `strict: true` 全量类型检查；`@types/chrome` 提供扩展 API 类型。
- 源码内 import 一律带 `.js` 后缀（`moduleResolution: bundler`，`./lib/config.js` 映射到 `.ts`），编译后浏览器可直接解析。

### 三步流程（对应你的需求）

1. **取 Token**：`background.ts` 固定用 `chrome.cookies` 从 `.ulearning.cn` 读取 `AUTHORIZATION` / `token`，
   写入 `AUTHORIZATION` / `UA-AUTHORIZATION` / `Authorization` 请求头（需先登录 www.ulearning.cn）。
2. **拉信息对象列表**：带 token 请求课程列表，渲染成可点击列表（名称 + classId）。
3. **点击对象执行**：service worker 按 `main.go` 顺序调用 **url（取内容）** 与 **saveurl（sync 保存）**，
   异步等结果 —— sync 返回非 `-1` 显示**成功**，返回 `-1` 或异常显示**失败 + message**。

### 关键实现点

- **DES 加密**：Web Crypto 不支持 DES，`lib/des.ts` 手写 DES-ECB + PKCS7，key=`12345678`，Base64 输出。
  已用 Go `crypto/des` 参考向量**逐字节校验**（含空串、单块、多块、UTF-8），见 `test/des.test.mjs`。
- **禁止请求头**：`fetch` 不能设置 `Origin`/`Referer`/`Host`/`User-Agent`/`Sec-*`。其中 `main.go` 明确设置的
  `Origin`/`Referer` 由 `public/rules.json`（declarativeNetRequest）按路径补齐；其余由浏览器自动填充。
  规则使用 `||api.ulearning.cn/`（避免误匹配 `courseapi…`），并用 `excludedInitiatorDomains` 排除站点自身请求，避免污染页面 CORS。
- **端点与 Origin 映射**（同 `main.go`）：

  | 接口 | 方法 | 地址 | Origin/Referer |
  |---|---|---|---|
  | 课程列表 | GET | `courseapi.ulearning.cn/courses/students…` | `www.ulearning.cn` |
  | 课本（拿 courseId） | GET | `courseapi.ulearning.cn/textbook/student/{id}/list` | `www.ulearning.cn` |
  | 观看视频上报 | POST | `courseapi.ulearning.cn/behavior/watchVideo` | `ua.ulearning.cn` |
  | 课程目录 | GET | `api.ulearning.cn/course/stu/{courseId}/directory` | `ua.ulearning.cn` |
  | 单元章节 | GET | `api.ulearning.cn/wholepage/chapter/stu/{nodeId}` | `ua.ulearning.cn` |
  | 学习初始化 | GET | `api.ulearning.cn/studyrecord/initialize/{itemId}` | `ua.ulearning.cn` |
  | 学习记录同步 (saveurl) | POST | `api.ulearning.cn/yws/api/personal/sync…` | `ua.ulearning.cn` |

- **压测维度**：设置里可配 **并发数**（同一课程内学习项并发）与 **循环次数**（整课重复），默认 1/1，
  即退化为“点一次跑一遍”。
- **不中断**：流水线跑在 service worker，popup 关了任务继续；状态存内存、结果持久化到 `storage.local`，重开 popup 可恢复视图 / 看上次结果。

---

## 二、构建 / 开发

```bash
cd extension
npm install          # 安装 typescript + @types/chrome（devDependencies）
npm run build        # clean + tsc + 拷贝静态资源 -> dist/
npm run watch        # 开发：tsc 监听重编译（改静态资源需再跑一次 build 拷贝）
npm test             # build 后跑 DES 回归测试
npx tsc --noEmit     # 仅类型检查
```

产物在 `extension/dist/`，即 Chrome 加载的目录。

---

## 三、测试计划 / 验收标准

| # | 项 | 方法 | 通过标准 | 状态 |
|---|---|---|---|---|
| 1 | 类型检查 | `tsc --noEmit`（strict） | 0 error | ✅ 已通过 |
| 2 | 编译 | `npm run build` | 无错误，产出 dist/ | ✅ 已通过 |
| 3 | DES 正确性 | `npm test` | 5/5 与 Go 参考向量逐字节一致 | ✅ 已通过 |
| 4 | 加载扩展 | Chrome 载入 `extension/dist` | 无报错，出现图标与 popup | 手测 |
| 5 | 取 Token | 设置 cookie 域/名后点“开始” | 状态栏显示脱敏 Token | 手测 |
| 6 | 列表渲染 | 同上 | 正确显示课程 name / classId | 手测 |
| 7 | 端到端成功 | 点某对象“执行” | 日志按 initialize→组装→sync 顺序；sync≠-1 → 顶部绿色“成功” | 手测 |
| 8 | 失败反馈 | 用无效 Token / 断网 | 顶部红色显示失败 + message | 手测 |
| 9 | 健壮性 | 运行中关闭再打开 popup | 恢复运行视图；结束后能看到结果 | 手测 |

> 4–9 需连内网后端（`192.168.2.x`），本机环境无法自动化，故给出手测步骤；1–3 已自动化验证。

---

## 四、安装与使用

1. `cd extension && npm install && npm run build`。
2. Chrome 打开 `chrome://extensions`，开启 **开发者模式**。
3. **加载已解压的扩展程序** → 选择 `extension/dist`。
4. 若后端是自签名 HTTPS，先在浏览器访问一次各 `https://192.168.2.x` 并信任证书，否则 `fetch` 会因证书失败。
5. 点扩展图标 → 打开设置：
   - Token 固定从 Cookie 读取（`.ulearning.cn` 的 `AUTHORIZATION` / `token`）；需已登录并保持课程列表页标签打开；
   - 可设用户名 / 并发数 / 循环次数。
6. 点 **开始** → 读取 Cookie Token 并加载信息对象列表 → 点某对象 **执行** → 看日志与成功/失败结果。

---

## 五、与 main.go 的对应关系

| main.go | 扩展 |
|---|---|
| `GetCourseInfo` | `pipeline.getCourseList` |
| `GetCourseID`（课本→courseId） | `pipeline.getCourseId` |
| `GetCourseContent`（目录） | `pipeline.getDirectory` |
| `GetChapterContent` | `pipeline.getChapterContent` |
| `Iteminitialize` | `pipeline.itemInitialize` |
| `watchVedio` | `pipeline.watchVideo` |
| `encrypto` / `pkcs7Pad` | `lib/des.ts` |
| `autosave`（sync） | `pipeline.sync` |
| `printDirectory` 组装逻辑 | `pipeline.buildAndSyncItem` |

Go struct 的 JSON tag 与 `src/types.ts` 的接口严格对齐（`itemid` / `pageStudyRecordDTOList` / `videos.startEndTimeList` 等）。

---

## 六、故障排查

- **课程列表为空 / 401**：Token 失效或未登录；先打开 www.ulearning.cn 登录后再点「开始」。
- **`net::ERR_CERT_*`**：先在浏览器信任内网自签名证书（见安装第 4 步）。
- **改内网 IP**：同时改 `src/lib/config.ts`、`public/manifest.json` 的 `host_permissions`、`public/rules.json`，然后 `npm run build`。
- **后端不校验 Origin/Referer**：`public/rules.json` 可留空 `[]`，不影响主流程。
- **改了代码没生效**：记得 `npm run build` 后在扩展页点“重新加载”。

---

> 用途限定：仅用于**你自己拥有 / 获授权的内网环境**压测与回归。
