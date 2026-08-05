// popup.ts — 界面逻辑：设置持久化、读取 Cookie Token + 加载列表、点击对象触发压测、流式日志。

import { DEFAULT_SETTINGS, STORAGE_KEY } from './lib/config.js';
import type {
  Course,
  GetLastRunResponse,
  GetStateResponse,
  LoadCoursesResponse,
  LogLevel,
  RunPortMessage,
  Settings,
} from './types.js';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少元素 #${id}`);
  return node as T;
}

const els = {
  userName: el<HTMLInputElement>('userName'),
  concurrency: el<HTMLInputElement>('concurrency'),
  repeat: el<HTMLInputElement>('repeat'),
  startBtn: el<HTMLButtonElement>('startBtn'),
  cancelBtn: el<HTMLButtonElement>('cancelBtn'),
  tokenStatus: el<HTMLDivElement>('tokenStatus'),
  courseList: el<HTMLUListElement>('courseList'),
  listCount: el<HTMLSpanElement>('listCount'),
  result: el<HTMLDivElement>('result'),
  log: el<HTMLPreElement>('log'),
  runningTag: el<HTMLSpanElement>('runningTag'),
};

const FIELDS = ['userName', 'concurrency', 'repeat'] as const;
type FieldKey = (typeof FIELDS)[number];

let settings: Settings = { ...DEFAULT_SETTINGS };
let courses: Course[] = [];
let runPort: chrome.runtime.Port | null = null;
let running = false;

// ---- 设置存取 ----
async function loadSettings(): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = (data[STORAGE_KEY] as Partial<Settings> | undefined) || {};
  settings = {
    userName: stored.userName ?? DEFAULT_SETTINGS.userName,
    concurrency: Number(stored.concurrency) || DEFAULT_SETTINGS.concurrency,
    repeat: Number(stored.repeat) || DEFAULT_SETTINGS.repeat,
  };
  for (const f of FIELDS) els[f].value = String(settings[f]);
}

function readForm(): Settings {
  return {
    userName: els.userName.value,
    concurrency: Number(els.concurrency.value) || 1,
    repeat: Number(els.repeat.value) || 1,
  };
}

async function saveSettings(): Promise<void> {
  settings = readForm();
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

FIELDS.forEach((f: FieldKey) =>
  els[f].addEventListener('change', () => {
    void saveSettings();
  })
);

// ---- 日志 / 结果渲染 ----
function appendLog(entry: { ts: string; level: LogLevel; message: string }): void {
  const line = document.createElement('div');
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = `[${entry.ts ?? ''}] `;
  const m = document.createElement('span');
  m.className = `l-${entry.level || 'info'}`;
  m.textContent = entry.message;
  line.append(t, m);
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}
function clearLog(): void {
  els.log.textContent = '';
}
function showResult(kind: 'ok' | 'err', text: string): void {
  els.result.className = `result ${kind}`;
  els.result.textContent = text;
  els.result.classList.remove('hidden');
}
function setStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  els.tokenStatus.textContent = text;
  els.tokenStatus.className = `status ${kind}`;
}
function setRunning(on: boolean): void {
  running = on;
  els.runningTag.classList.toggle('hidden', !on);
  els.cancelBtn.classList.toggle('hidden', !on);
  els.startBtn.disabled = on;
  els.courseList.querySelectorAll('button').forEach((b) => (b.disabled = on));
}

// ---- 列表渲染 ----
function renderCourses(list: Course[]): void {
  courses = list;
  els.courseList.innerHTML = '';
  els.listCount.textContent = list.length ? `（${list.length}）` : '';
  list.forEach((c, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = c.name || `课程 ${c.id}`;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `classId=${c.classId}`;
    const btn = document.createElement('button');
    btn.textContent = '执行';
    btn.addEventListener('click', () => runCourse(i));
    li.append(name, meta, btn);
    els.courseList.appendChild(li);
  });
}

// ---- 开始：读取 Cookie Token + 加载课程列表 ----
els.startBtn.addEventListener('click', async () => {
  await saveSettings();
  setStatus('从 Cookie 读取 Token 并加载列表…');
  els.startBtn.disabled = true;
  try {
    const resp = (await chrome.runtime.sendMessage({
      type: 'loadCourses',
      settings,
    })) as LoadCoursesResponse | undefined;
    if (!resp || !resp.ok) throw new Error(resp?.error || '未知错误');
    const list = resp.courses ?? [];
    setStatus(`Token：${resp.masked}｜课程 ${list.length} 个`, 'ok');
    renderCourses(list);
  } catch (e) {
    setStatus(`失败：${e instanceof Error ? e.message : String(e)}`, 'err');
    renderCourses([]);
  } finally {
    els.startBtn.disabled = false;
  }
});

// ---- 点击某个对象：连接 run 端口，流式接收日志 ----
function ensurePort(): chrome.runtime.Port {
  if (runPort) return runPort;
  const port = chrome.runtime.connect({ name: 'run' });
  runPort = port;
  port.onMessage.addListener((raw) => {
    const m = raw as RunPortMessage;
    if (m.kind === 'log') {
      appendLog(m);
    } else if (m.kind === 'sync') {
      if (m.state.running) {
        setRunning(true);
        clearLog();
        m.state.logs.forEach(appendLog);
      }
    } else if (m.kind === 'done') {
      const s = m.summary;
      showResult(
        s.fail === 0 ? 'ok' : 'err',
        s.fail === 0
          ? `✅ 全部成功：${s.success}/${s.total}`
          : `❌ 失败 ${s.fail}/${s.total}${s.firstError ? '｜' + s.firstError : ''}`
      );
      setRunning(false);
    } else if (m.kind === 'error') {
      showResult('err', `❌ ${m.message}`);
      setRunning(false);
    }
  });
  port.onDisconnect.addListener(() => {
    runPort = null;
  });
  return port;
}

function runCourse(index: number): void {
  if (running) return;
  const course = courses[index];
  if (!course) return;
  clearLog();
  els.result.classList.add('hidden');
  setRunning(true);
  ensurePort().postMessage({ type: 'start', course, settings });
}

els.cancelBtn.addEventListener('click', () => {
  runPort?.postMessage({ type: 'cancel' });
});

// ---- 初始化：加载设置 + 恢复运行状态/上次结果 ----
async function init(): Promise<void> {
  await loadSettings();
  ensurePort(); // 触发 SW 回传 sync 状态
  const st = (await chrome.runtime.sendMessage({ type: 'getState' })) as GetStateResponse | undefined;
  if (st?.ok && st.state?.running) {
    setRunning(true);
    clearLog();
    st.state.logs.forEach(appendLog);
    return;
  }
  const last = (await chrome.runtime.sendMessage({ type: 'getLastRun' })) as GetLastRunResponse | undefined;
  if (last?.ok && last.lastRun) {
    const r = last.lastRun;
    r.logs.forEach(appendLog);
    if (r.summary) {
      showResult(
        r.summary.fail === 0 ? 'ok' : 'err',
        r.summary.fail === 0
          ? `上次：✅ ${r.summary.success}/${r.summary.total}`
          : `上次：❌ 失败 ${r.summary.fail}/${r.summary.total}`
      );
    } else if (r.error) {
      showResult('err', `上次：❌ ${r.error}`);
    }
  }
}
void init();
