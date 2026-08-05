// config.ts — 端点与默认配置，全部对齐 main.go。
// 如域名有变，改这里即可（同时更新 public/manifest.json 的 host_permissions 与 public/rules.json）。

import type { Settings } from '../types.js';

export const HOSTS = {
  api100: 'https://courseapi.ulearning.cn', // 课程列表 / 课本 / watchVideo
  api101: 'https://api.ulearning.cn', // directory / chapter / initialize / sync
} as const;

export const ENDPOINTS = {
  // GET 课程列表
  courseList: (): string =>
    `${HOSTS.api100}/courses/students?keyword=&publishStatus=1&type=1&pn=1&ps=15&lang=zh`,
  // GET 课本（拿 courseId）
  textbook: (courseNumId: number): string =>
    `${HOSTS.api100}/textbook/student/${courseNumId}/list?lang=zh`,
  // GET 课程目录
  directory: (courseId: number, classId: number): string =>
    `${HOSTS.api101}/course/stu/${courseId}/directory?classId=${classId}`,
  // GET 单元章节内容
  chapter: (nodeId: number): string => `${HOSTS.api101}/wholepage/chapter/stu/${nodeId}`,
  // GET 学习初始化（返回时间戳）
  initialize: (itemId: number): string => `${HOSTS.api101}/studyrecord/initialize/${itemId}`,
  // POST 观看视频行为上报
  watchVideo: (): string => `${HOSTS.api100}/behavior/watchVideo`,
  // POST 学习记录同步（DES 加密体）—— 这就是 saveurl
  sync: (): string => `${HOSTS.api101}/yws/api/personal/sync?courseType=4&platform=PC`,
} as const;

/** Token 固定从浏览器 Cookie 读取（与站点一致） */
export const AUTH_COOKIE = {
  domain: '.ulearning.cn',
  names: ['AUTHORIZATION', 'token', 'TOKEN'] as const,
  urls: [
    'https://www.ulearning.cn/',
    'https://ua.ulearning.cn/',
    'https://ulearning.cn/',
  ] as const,
} as const;

// 默认设置（可在 popup 中修改，持久化在 chrome.storage.local）
export const DEFAULT_SETTINGS: Settings = {
  userName: 'hhh',
  concurrency: 1, // 并发数（压测维度）
  repeat: 1, // 每个对象重复次数（压测维度）
};

export const STORAGE_KEY = 'ulearn_stress_settings';
