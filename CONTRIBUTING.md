# Contributing to Open Karaoke

感谢你愿意改进 Open Karaoke。

## 本地开发

环境要求：Node.js `>=22.6.0`。

```bash
npm install
npm run dev
```

提交前请运行：

```bash
npm run typecheck
npm test
npm run build
```

## 代码约定

- 保持核心功能为原生 TypeScript，不引入没有必要的运行时依赖。
- 页面视觉舞台使用 Canvas，交互控件和无障碍文本保留 HTML。
- 歌词解析、文件名识别等纯逻辑优先放在 `src/lib/`，并补充测试。
- 媒体捕获和转码相关代码放在 `src/services/`。
- 不要提交本地音频、封面、歌词素材或构建产物。

## 提交说明

请在 Pull Request 中说明变更内容、测试方式，以及是否影响录制兼容性。涉及视觉变化时，建议附上截图或录制结果。
