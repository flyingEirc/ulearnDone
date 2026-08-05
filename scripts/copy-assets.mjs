// 把静态资源（manifest / popup.html / popup.css / rules.json / icons）拷到 dist。
// tsc 只负责把 src/*.ts 编译成 dist/*.js；静态文件由这里同步。
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
console.log('assets copied: public/ -> dist/');
