// background.ts — MV3 service worker（type: module）。
// 承载：token 读取(chrome.cookies)、课程列表拉取、以及对选中对象的完整压测流水线。
// popup 关闭也不中断运行；运行状态缓存在内存，结果持久化到 storage.local。

import { AUTH_COOKIE } from './lib/config.js';
import { getCourseList, runCourse } from './lib/pipeline.js';
import type {
  LastRun,
  LogLevel,
  PopupMessage,
  RunPortRequest,
  RunState,
} from './types.js';

const runState: RunState = {
  running: false,
  courseName: '',
  logs: [],
  summary: null,
  error: '',
};

let activePort: chrome.runtime.Port | null = null;
let controller: AbortController | null = null;

function stamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pushLog(message: string, level: LogLevel = 'info'): void {
  const entry = { ts: stamp(), level, message };
  runState.logs.push(entry);
  if (runState.logs.length > 500) runState.logs.shift();
  if (activePort) {
    try {
      activePort.postMessage({ kind: 'log', ...entry });
    } catch {
      /* port closed */
    }
  }
}

async function persistLastRun(): Promise<void> {
  try {
    const lastRun: LastRun = {
      courseName: runState.courseName,
      logs: runState.logs.slice(-200),
      summary: runState.summary,
      error: runState.error,
      finishedAt: Date.now(),
    };
    await chrome.storage.local.set({ lastRun });
  } catch {
    /* ignore */
  }
}

function cookieNameMatches(cookieName: string, wanted: string): boolean {
  return cookieName.toLowerCase() === wanted.toLowerCase();
}

function normalizeCookieValue(raw: string): string {
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep raw */
  }
  return value.replace(/^"|"$/g, '');
}

/** 固定从 Cookie 读取 AUTHORIZATION / token（域 .ulearning.cn）。 */
async function resolveToken(): Promise<string> {
  const domainRaw = AUTH_COOKIE.domain;
  const domain = domainRaw.replace(/^\./, '');
  const preferUrls = [...AUTH_COOKIE.urls, `https://${domain}/`];

  const seen = new Set<string>();
  const collected: chrome.cookies.Cookie[] = [];
  for (const url of preferUrls) {
    try {
      for (const c of await chrome.cookies.getAll({ url })) {
        const key = `${c.storeId}|${c.domain}|${c.path}|${c.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(c);
      }
    } catch {
      /* ignore */
    }
  }
  for (const d of [domainRaw, domain, 'ulearning.cn', 'www.ulearning.cn']) {
    try {
      for (const c of await chrome.cookies.getAll({ domain: d })) {
        const key = `${c.storeId}|${c.domain}|${c.path}|${c.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(c);
      }
    } catch {
      /* ignore */
    }
  }

  const byName = (name: string) =>
    collected.find((c) => cookieNameMatches(c.name, name) && !!c.value) || null;

  const hit = AUTH_COOKIE.names.map(byName).find(Boolean) || null;

  if (!hit?.value) {
    const names = [...new Set(collected.map((c) => c.name))].slice(0, 20);
    const hint = names.length
      ? `；当前可见 Cookie：${names.join(', ')}`
      : '；当前对这些域名没有任何 Cookie 权限/数据';
    throw new Error(`未找到 Cookie AUTHORIZATION/token（请先登录 www.ulearning.cn）${hint}`);
  }
  return normalizeCookieValue(hit.value);
}

function mask(token: string): string {
  if (!token) return '';
  if (token.length <= 12) return token[0] + '***' + token[token.length - 1];
  return `${token.slice(0, 6)}…${token.slice(-6)} (len ${token.length})`;
}

// ---- 消息处理（sendMessage：一次性请求） ----
chrome.runtime.onMessage.addListener(
  (msg: PopupMessage, _sender, sendResponse: (response: unknown) => void) => {
    void (async () => {
      try {
        if (msg.type === 'readToken') {
          const token = await resolveToken();
          sendResponse({ ok: true, masked: mask(token) });
        } else if (msg.type === 'loadCourses') {
          const token = await resolveToken();
          const courses = await getCourseList(token);
          sendResponse({ ok: true, masked: mask(token), courses });
        } else if (msg.type === 'getState') {
          sendResponse({ ok: true, state: runState });
        } else if (msg.type === 'getLastRun') {
          const { lastRun } = await chrome.storage.local.get('lastRun');
          sendResponse({ ok: true, lastRun: (lastRun as LastRun | undefined) || null });
        } else {
          sendResponse({ ok: false, error: '未知消息类型' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true; // async 响应
  }
);

// ---- 运行端口（port：流式日志） ----
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'run') return;
  activePort = port;

  // 新连接：把当前缓冲同步给它（支持 popup 重开）
  port.postMessage({ kind: 'sync', state: runState });

  port.onMessage.addListener((raw) => {
    const msg = raw as RunPortRequest;
    if (msg.type === 'cancel') {
      controller?.abort();
      return;
    }
    if (msg.type !== 'start') return;
    if (runState.running) {
      port.postMessage({ kind: 'error', message: '已有任务在运行中' });
      return;
    }

    const { course, settings } = msg;
    controller = new AbortController();
    runState.running = true;
    runState.courseName = course.name;
    runState.logs = [];
    runState.summary = null;
    runState.error = '';

    void (async () => {
      try {
        const token = await resolveToken();
        pushLog(`Token 就绪：${mask(token)}`, 'info');
        const summary = await runCourse(course, token, {
          log: pushLog,
          signal: controller!.signal,
          concurrency: Math.max(1, Number(settings.concurrency) || 1),
          repeat: Math.max(1, Number(settings.repeat) || 1),
          userName: settings.userName || 'hhh',
        });
        runState.summary = summary;
        pushLog(
          `完成：总计 ${summary.total}，成功 ${summary.success}，失败 ${summary.fail}`,
          summary.fail === 0 ? 'ok' : 'err'
        );
        activePort?.postMessage({ kind: 'done', summary });
      } catch (e) {
        runState.error = e instanceof Error ? e.message : String(e);
        pushLog(`运行失败：${runState.error}`, 'err');
        activePort?.postMessage({ kind: 'error', message: runState.error });
      } finally {
        runState.running = false;
        controller = null;
        await persistLastRun();
      }
    })();
  });

  port.onDisconnect.addListener(() => {
    if (activePort === port) activePort = null;
    // 注意：不中断运行，任务在 SW 中继续。
  });
});
