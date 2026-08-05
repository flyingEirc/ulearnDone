// types.ts — 全项目共享类型：领域模型、后端响应、上报体、消息契约。

export interface Course {
  id: number;
  classId: number;
  name: string;
}

export interface Settings {
  userName: string;
  concurrency: number;
  repeat: number;
}

export type LogLevel = 'info' | 'ok' | 'err';
export type LogFn = (message: string, level?: LogLevel) => void;

export interface LogEntry {
  ts: string;
  level: LogLevel;
  message: string;
}

export interface RunSummary {
  total: number;
  success: number;
  fail: number;
  firstError: string;
}

export interface RunOptions {
  log: LogFn;
  signal: AbortSignal;
  concurrency?: number;
  repeat?: number;
  userName?: string;
}

export interface SyncResult {
  ok: boolean;
  code: number | null;
  message: string;
}

// ---- 后端响应结构 ----
export interface CourseListResponse {
  courseList?: Course[];
}
export interface TextbookSection {
  courseId: number;
}
export interface CoursePageDTO {
  resourceid: number;
  videoLength: number;
}
export interface WholePageDTO {
  contentType: number;
  status: number;
  relationid: number;
  coursepageDTOList?: CoursePageDTO[];
}
export interface WholePageItem {
  itemid: number;
  wholepageDTOList?: WholePageDTO[];
}
export interface ChapterContentResponse {
  wholepageItemDTOList?: WholePageItem[];
}
export interface DirectoryItem {
  itemid: number;
  hide: number;
}
export interface DirectoryChapter {
  nodetitle: string;
  nodeid: number;
  hide: number;
  items?: DirectoryItem[];
}
export interface Directory {
  coursename: string;
  chapters?: DirectoryChapter[];
}

// ---- 组装的上报体（对齐 main.go 的 struct / JSON tag） ----
export interface VideoStartEnd {
  startTime: number;
  endTime: number;
}
export interface VideoRecord {
  videoid: number;
  current: number;
  status: number;
  recordTime: number;
  time: number;
  startEndTimeList: VideoStartEnd[];
}
export interface PageStudyRecordDTO {
  pageid: number;
  complete: number;
  studyTime: number;
  score: number;
  answerTime: number;
  submitTimes: number;
  questions: null;
  videos: VideoRecord[] | null;
  speaks: null;
}
export interface StudyRecordRequest {
  itemid: number;
  autoSave: number;
  withoutOld: number;
  complete: number;
  studyStartTime: number;
  userName: string;
  score: number;
  pageStudyRecordDTOList: PageStudyRecordDTO[];
}

// ---- 运行时状态与持久化 ----
export interface RunState {
  running: boolean;
  courseName: string;
  logs: LogEntry[];
  summary: RunSummary | null;
  error: string;
}
export interface LastRun {
  courseName: string;
  logs: LogEntry[];
  summary: RunSummary | null;
  error: string;
  finishedAt: number;
}

// ---- 消息契约：popup -> background（sendMessage） ----
export type PopupMessage =
  | { type: 'readToken'; settings: Settings }
  | { type: 'loadCourses'; settings: Settings }
  | { type: 'getState' }
  | { type: 'getLastRun' };

export interface ReadTokenResponse {
  ok: boolean;
  error?: string;
  masked?: string;
}
export interface LoadCoursesResponse {
  ok: boolean;
  error?: string;
  masked?: string;
  courses?: Course[];
}
export interface GetStateResponse {
  ok: boolean;
  state?: RunState;
}
export interface GetLastRunResponse {
  ok: boolean;
  lastRun?: LastRun | null;
}

// ---- 消息契约：run 端口（流式） ----
export type RunPortRequest =
  | { type: 'start'; course: Course; settings: Settings }
  | { type: 'cancel' };

export type RunPortMessage =
  | { kind: 'sync'; state: RunState }
  | ({ kind: 'log' } & LogEntry)
  | { kind: 'done'; summary: RunSummary }
  | { kind: 'error'; message: string };
