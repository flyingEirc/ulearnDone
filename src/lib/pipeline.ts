// pipeline.ts — 移植 main.go 的网络流水线到 service worker。
// 与 Go 一致：课程列表 -> 课本(courseId) -> 目录 -> 单元章节 -> 初始化 -> 组装 -> encrypto -> sync。

import { ENDPOINTS } from './config.js';
import { encrypto } from './des.js';
import { fetchInPageContext } from './pageFetch.js';
import type {
  ChapterContentResponse,
  Course,
  CourseListResponse,
  Directory,
  LogFn,
  PageStudyRecordDTO,
  RunOptions,
  RunSummary,
  StudyRecordRequest,
  SyncResult,
  TextbookSection,
  VideoRecord,
  WholePageItem,
} from '../types.js';

type AuthKind = 'www' | 'ua';

// www 系（课程列表/课本）对齐 applyCommonHeaders；ua 系对齐 GetCourseContent 等。
function buildHeaders(auth: string, kind: AuthKind, extra: Record<string, string> = {}): Record<string, string> {
  if (kind === 'www') {
    return {
      Authorization: auth,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json',
      version: '1',
      'Accept-Language': 'en,zh-CN;q=0.9,zh-TW;q=0.8,zh;q=0.7',
      ...extra,
    };
  }
  return {
    AUTHORIZATION: auth,
    'UA-AUTHORIZATION': auth,
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/json',
    'Accept-Language': 'zh',
    ...extra,
  };
}

function pageOriginsFor(kind: AuthKind): string[] {
  return kind === 'www'
    ? ['https://www.ulearning.cn/', 'https://ua.ulearning.cn/']
    : ['https://ua.ulearning.cn/', 'https://www.ulearning.cn/'];
}

async function requestText(
  url: string,
  auth: string,
  kind: AuthKind,
  init: { method?: string; body?: string; extraHeaders?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<{ ok: boolean; status: number; text: string }> {
  const method = init.method || 'GET';
  const headers = buildHeaders(auth, kind, init.extraHeaders);

  // 优先走已打开的站点页（Origin/Cookie 与浏览器一致）。
  // api.ulearning.cn 等对 www/ua 页面常有 CORS 限制 → status=0 Failed to fetch，此时必须回退 SW。
  if (!init.signal?.aborted) {
    const page = await fetchInPageContext(pageOriginsFor(kind), url, {
      method,
      headers,
      body: init.body,
    });
    const pageNetworkFail =
      !page ||
      page.status === 0 ||
      /failed to fetch|networkerror|cors/i.test(page.text || '');
    if (page && !pageNetworkFail) return page;
  }

  // 回退：扩展 SW（CORS 豁免；Origin/Referer 由 rules.json 补齐）
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: init.body,
      credentials: 'include',
      signal: init.signal,
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: e instanceof Error ? e.message : String(e),
    };
  }
}

async function fetchJson<T>(
  url: string,
  auth: string,
  kind: AuthKind,
  signal?: AbortSignal
): Promise<T | null> {
  const { ok, status, text } = await requestText(url, auth, kind, { signal });
  if (!ok) {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(`HTTP ${status} @ ${url}${snippet ? ` — ${snippet}` : ''}`);
  }
  if (!text.trim()) return null;
  return JSON.parse(text) as T;
}

// ---- 各接口，一一对应 main.go 的函数 ----

export async function getCourseList(auth: string, signal?: AbortSignal): Promise<Course[]> {
  const data = await fetchJson<CourseListResponse>(ENDPOINTS.courseList(), auth, 'www', signal);
  const list = data?.courseList ?? [];
  return list.map((c) => ({ id: c.id, classId: c.classId, name: c.name }));
}

async function getCourseId(courseNumId: number, auth: string, signal: AbortSignal): Promise<number> {
  const sections = await fetchJson<TextbookSection[]>(
    ENDPOINTS.textbook(courseNumId),
    auth,
    'www',
    signal
  );
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('课程章节列表为空');
  }
  return sections[0]!.courseId;
}

async function getDirectory(
  courseId: number,
  classId: number,
  auth: string,
  signal: AbortSignal
): Promise<Directory> {
  const dir = await fetchJson<Directory>(
    ENDPOINTS.directory(courseId, classId),
    auth,
    'ua',
    signal
  );
  if (!dir) throw new Error('课程目录获取失败');
  return dir;
}

async function getChapterContent(
  nodeId: number,
  auth: string,
  signal: AbortSignal
): Promise<WholePageItem[]> {
  const resp = await fetchJson<ChapterContentResponse>(
    ENDPOINTS.chapter(nodeId),
    auth,
    'ua',
    signal
  );
  return resp?.wholepageItemDTOList ?? [];
}

async function itemInitialize(itemId: number, auth: string, signal: AbortSignal): Promise<number> {
  const { ok, status, text } = await requestText(ENDPOINTS.initialize(itemId), auth, 'ua', {
    extraHeaders: { Pragma: 'no-cache', 'Cache-Control': 'no-cache' },
    signal,
  });
  if (!ok) throw new Error(`initialize HTTP ${status}`);
  const raw = text.trim().replace(/^"|"$/g, '');
  if (!raw) return 0;
  const ts = Number.parseInt(raw, 10);
  return Number.isNaN(ts) ? 0 : ts;
}

async function watchVideo(
  videoId: number,
  classId: number,
  courseId: number,
  chapterId: number,
  auth: string,
  signal: AbortSignal
): Promise<boolean> {
  const body = JSON.stringify({ classId, courseId, chapterId, videoId });
  try {
    const { ok } = await requestText(ENDPOINTS.watchVideo(), auth, 'ua', {
      method: 'POST',
      body,
      signal,
    });
    return ok;
  } catch {
    return false; // 与 Go 一致：观看上报失败不阻断主流程
  }
}

// POST 加密体到 sync（saveurl）。
async function sync(encryptedPayload: string, auth: string, signal: AbortSignal): Promise<SyncResult> {
  const { ok, status, text: raw } = await requestText(ENDPOINTS.sync(), auth, 'ua', {
    method: 'POST',
    body: encryptedPayload,
    signal,
  });
  const text = raw.trim();
  if (!ok) {
    return { ok: false, code: null, message: `HTTP ${status}: ${text || 'error'}` };
  }
  // Go 语义：响应是纯数字，-1 表示失败，其余成功。
  const code = Number.parseInt(text, 10);
  if (!Number.isNaN(code)) {
    return code === -1
      ? { ok: false, code, message: `sync 返回码 ${code}` }
      : { ok: true, code, message: `sync 返回码 ${code}` };
  }
  // 兼容返回 JSON 的后端
  try {
    const obj = JSON.parse(text) as { code?: number; success?: boolean; message?: string; msg?: string };
    const okFlag = obj.code === 0 || obj.code === 200 || obj.success === true;
    return { ok: !!okFlag, code: obj.code ?? null, message: obj.message || obj.msg || text };
  } catch {
    return { ok: !!text, code: null, message: text || '(空响应)' };
  }
}

// ---- 组装学习记录（对应 printDirectory 内层逻辑） ----

interface ItemContext {
  classId: number;
  courseId: number;
  chapterNodeId: number;
  auth: string;
  userName: string;
  signal: AbortSignal;
  log: LogFn;
}

async function buildAndSyncItem(item: WholePageItem, ctx: ItemContext): Promise<SyncResult> {
  const { classId, courseId, chapterNodeId, auth, userName, signal, log } = ctx;
  const itemId = item.itemid;
  const ts = await itemInitialize(itemId, auth, signal);

  const req: StudyRecordRequest = {
    itemid: itemId,
    autoSave: 1,
    withoutOld: 1,
    complete: 1,
    studyStartTime: ts,
    userName,
    score: 100,
    pageStudyRecordDTOList: [],
  };

  for (const dto of item.wholepageDTOList ?? []) {
    const page: PageStudyRecordDTO = {
      pageid: dto.relationid,
      complete: 1,
      studyTime: 1000,
      score: 100,
      answerTime: 1,
      submitTimes: 0,
      questions: null,
      videos: null,
      speaks: null,
    };
    if (dto.contentType !== 6) {
      req.pageStudyRecordDTOList.push(page);
    } else {
      const videos: VideoRecord[] = [];
      for (const k of dto.coursepageDTOList ?? []) {
        // 与 Go 零值语义一致：缺省 videoLength 视为 0。
        // 视频页里常混有 resourceid=0 的图文块，若按 JS undefined 判断会漏过滤，导致 sync 500。
        const resourceid = k.resourceid ?? 0;
        const videoLength = k.videoLength ?? 0;
        if (resourceid === 0 || videoLength === 0) continue;
        await watchVideo(resourceid, classId, courseId, chapterNodeId, auth, signal);
        videos.push({
          videoid: resourceid,
          current: videoLength,
          status: 1,
          recordTime: videoLength,
          time: videoLength,
          startEndTimeList: [{ startTime: ts + 1, endTime: ts + 3 }],
        });
      }
      page.videos = videos;
      req.pageStudyRecordDTOList.push(page);
    }
  }

  const encrypted = encrypto(JSON.stringify(req));
  const result = await sync(encrypted, auth, signal);
  log(
    `item ${itemId}: ${result.ok ? '成功' : '失败'} — ${result.message}`,
    result.ok ? 'ok' : 'err'
  );
  return result;
}

// 简单并发池
async function runPool<TItem, TResult>(
  tasks: TItem[],
  concurrency: number,
  worker: (task: TItem, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = new Array(tasks.length);
  let cursor = 0;
  const runnerCount = Math.max(1, Math.min(concurrency, tasks.length || 1));
  const runners = Array.from({ length: runnerCount }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= tasks.length) break;
      results[i] = await worker(tasks[i]!, i);
    }
  });
  await Promise.all(runners);
  return results;
}

interface Task {
  item: WholePageItem;
  chapterNodeId: number;
}

// 主入口：对选中的“信息对象”（课程）跑完整流水线，支持并发/循环压测。
export async function runCourse(course: Course, auth: string, opts: RunOptions): Promise<RunSummary> {
  const { log, signal, concurrency = 1, repeat = 1, userName = 'hhh' } = opts;

  log(`解析课程「${course.name}」…`, 'info');
  const courseId = await getCourseId(course.id, auth, signal);
  log(`courseId=${courseId}, classId=${course.classId}`, 'info');

  const directory = await getDirectory(courseId, course.classId, auth, signal);
  // 不以 chapter.hide 一刀切：本课实测章节全是 hide=1，但前几专题 items.hide=0 且可拉取内容。
  // 规则：章节本身未隐藏，或目录里仍有未隐藏学习项 → 视为可用单元。
  const chapters = (directory.chapters ?? []).filter((ch) => {
    if (ch.hide !== 1) return true;
    return (ch.items ?? []).some((it) => it.hide !== 1);
  });
  log(
    `课程「${directory.coursename}」，可用单元 ${chapters.length}/${directory.chapters?.length ?? 0} 个`,
    'info'
  );

  // 收集所有 (章节, item) 任务；若目录声明了 item.hide，则跳过隐藏项
  const tasks: Task[] = [];
  for (const ch of chapters) {
    const visibleIds = new Set(
      (ch.items ?? []).filter((it) => it.hide !== 1).map((it) => it.itemid)
    );
    const items = await getChapterContent(ch.nodeid, auth, signal);
    for (const item of items) {
      if (visibleIds.size > 0 && !visibleIds.has(item.itemid)) continue;
      tasks.push({ item, chapterNodeId: ch.nodeid });
    }
  }
  log(`共 ${tasks.length} 个学习项，并发 ${concurrency}，循环 ${repeat} 次`, 'info');

  const summary: RunSummary = { total: 0, success: 0, fail: 0, firstError: '' };

  for (let round = 1; round <= repeat; round++) {
    if (signal.aborted) throw new Error('已取消');
    if (repeat > 1) log(`—— 第 ${round}/${repeat} 轮 ——`, 'info');
    const results = await runPool<Task, SyncResult>(tasks, concurrency, async (t) => {
      if (signal.aborted) return { ok: false, code: null, message: '已取消' };
      try {
        return await buildAndSyncItem(t.item, {
          classId: course.classId,
          courseId,
          chapterNodeId: t.chapterNodeId,
          auth,
          userName,
          signal,
          log,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log(`item ${t.item.itemid} 异常：${message}`, 'err');
        return { ok: false, code: null, message };
      }
    });
    for (const r of results) {
      summary.total++;
      if (r && r.ok) summary.success++;
      else {
        summary.fail++;
        if (!summary.firstError) summary.firstError = r?.message || '未知错误';
      }
    }
  }

  return summary;
}
