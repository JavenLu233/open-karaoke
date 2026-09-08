# Open Karaoke

Open Karaoke 是一个基于 Vite + TypeScript 的本地卡拉 OK 视频制作工具。用户可以载入音频、封面和 LRC 歌词，实时预览唱片旋转、歌名、歌手名与歌词同步效果，并优先导出 MP4；浏览器不支持原生 MP4 时自动使用 ffmpeg.wasm 转码，同时保留 WebM 兜底下载。仓库内置公版 `Auld Lang Syne` 素材作为演示。

## 功能

- 音频播放、暂停、进度拖动
- LRC 歌词解析、滚动与高亮同步
- 黑胶唱片旋转动画，页面预览与录制共用 Canvas 渲染
- 从文件名或 LRC `ti/ar` 元数据识别歌名与歌手名，并支持手动修改
- 支持保存、恢复和删除本地素材组历史记录
- 歌词时间偏移调试，可保存到 `localStorage`
- 24 FPS Canvas 录制，优先生成 MP4，必要时使用 ffmpeg.wasm 转码

## 开发

```bash
npm install
npm run dev
```

打开终端提示的 `http://localhost:5173` 地址。录制功能依赖 `canvas.captureStream()`、`HTMLMediaElement.captureStream()` 和 `MediaRecorder`，建议使用最新版 Chrome 或 Edge。首次走 WebM 转 MP4 时，会在浏览器内加载 FFmpeg WebAssembly 核心并进行本地转码。

### 歌名与歌手名识别

默认识别策略如下：

1. 优先读取 LRC 中的 `[ti:歌名]` 和 `[ar:歌手名]`。
2. 没有 LRC 元数据时，按 `歌手 - 歌名.mp3` 解析文件名。
3. 如果文件名只有一个主体，作为歌名；`伴奏`、`纯音乐`、`instrumental` 等后缀会被移除。
4. 识别结果可以在页面的“歌曲信息”区域手动修改，修改后的值优先使用。

### 素材历史记录

浏览器出于安全原因不会允许网页永久保存并直接读取本地文件路径。项目使用 `localStorage` 保存历史列表信息，并使用 IndexedDB 保存用户授权后的 File System Access API 文件句柄。点击“选择并记忆素材”一次后，就可以把音频、封面和 LRC 保存为一个素材组，之后从历史记录恢复；如果文件被移动、删除或权限被撤回，需要重新选择文件。

## GitHub Pages

`main` 分支的每次推送都会触发 GitHub Actions 构建并发布到 GitHub Pages：

<https://javenlu233.github.io/open-karaoke/>

录制功能仍需要在支持 `captureStream()` 的 Chrome / Edge 中使用；GitHub Pages 已满足 HTTPS 要求。

## 校验

```bash
npm run typecheck
npm test
npm run build
```

## 项目状态

当前版本仍是纯客户端工具：素材只在浏览器本地处理，不会上传到服务器。关闭或刷新页面后，选择的本地素材不会被保存。

## 目录结构

```text
src/
├─ app.ts                    # 页面状态与事件编排
├─ main.ts                   # 应用入口
├─ styles.css                # 页面样式
├─ types.ts                  # 共享类型
├─ lib/
│  ├─ lrc.ts                 # LRC 解析与当前行查找
│  ├─ track-info.ts          # 歌名与歌手名识别
│  └─ time.ts                # 时间格式化
├─ services/
│  ├─ asset-history.ts       # 素材组历史记录与本地文件句柄
│  ├─ media-recorder.ts      # Canvas 视频流与音频流合并录制
│  └─ mp4-converter.ts       # WebM 回退转 MP4
└─ ui/
   └─ lyrics-view.ts         # 歌词列表渲染与滚动
```
