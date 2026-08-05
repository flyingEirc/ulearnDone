# uLearn 压测插件

Chrome MV3 扩展，用于学习记录压测 / 同步。

## 构建 / 开发

```bash
pnpm install
pnpm build        # 产出 dist/
pnpm watch        # tsc 监听重编译（改 public/ 后需再跑一次 build）
pnpm typecheck
pnpm test
```

Chrome 加载的目录是 `dist/`。

## 安装与使用

1. `pnpm install && pnpm build`
2. Chrome 打开 `chrome://extensions`，开启 **开发者模式**
3. **加载已解压的扩展程序** → 选择本仓库的 `dist/`
4. 在浏览器登录 [www.ulearning.cn](https://www.ulearning.cn)，并打开课程列表页
5. 点扩展图标，按需设置用户名 / 并发数 / 循环次数
6. 点 **开始** → 从 Cookie 读取 Token 并加载课程列表 → 点某课程 **执行** → 查看日志与结果

改代码后重新 `pnpm build`，再到扩展页点「重新加载」。
