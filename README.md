# deepshui-translator

**PDF 划词翻译 + AI 阅读助手** —— 基于 Electron + PDF.js + DeepSeek。

> 轻量、跨平台、开源（MIT）。翻译引擎由用户自备，AI 引擎基于 DeepSeek。

## ✨ 功能

### 阅读与翻译
- 📂 打开 / 拖拽 PDF（虚拟滚动按需渲染，大 PDF 秒开）
- 📄 PDF.js 高质量渲染（连续滚动、Ctrl+滚轮缩放、页码跳转、高分屏适配）
- 🖱️ 划词即译（自动清洗断词连字符与换行符）
- 🌐 多翻译引擎：有道 / 百度 / 讯飞 / DeepL / Google Cloud（英⇄中，支持日/韩/法/德）
- 🚫 目标语言可选「不翻译」（纯 AI 阅读模式）
- 📋 一键复制译文

### AI 引擎（DeepSeek）
- 🤖 **AI 解释**：划词自动解释段落（核心意思 / 关键术语 / 背景知识）
- 💬 **AI 问答**：多轮对话，可基于全文（打开 PDF 自动总结，提问自动携带全文）
- 🔄 **重置对话**：一键清空历史并重新喂入全文总结
- 🧠 **深度思考**：关闭 / low / high / max 四档推理强度
- 📝 **Markdown + LaTeX 渲染**：标题、列表、粗体、数学公式（KaTeX）
- 🧩 可选「隔离解释与问答上下文」

## 🚀 快速开始

```bash
npm install
npm start
```

> 需要图形环境（X11 / Wayland / macOS / Windows）。

## 🔑 配置

应用内「⚙️ 设置」分两个独立模块，**互不影响**：

### 翻译引擎（5 选 1）

| 引擎 | 凭证 | 注册地址 |
|---|---|---|
| 有道 | 应用 ID + 应用密钥 | https://ai.youdao.com/ |
| 百度 | appid + 密钥 | https://fanyi-api.baidu.com/ |
| 讯飞 | appid + API Key + API Secret | https://www.xfyun.cn/services/its |
| DeepL | API Key（免费版以 `:fx` 结尾） | https://www.deepl.com/pro-api |
| Google Cloud | API Key | https://cloud.google.com/translate |

### AI 引擎（DeepSeek）

1. 设置 → AI 引擎 → 填入 [API Key](https://platform.deepseek.com/api_keys)
2. 点 🔄 拉取可用模型 → 选择（`deepseek-v4-flash` / `deepseek-v4-pro`）
3. 配置深度思考档位与显示开关

**凭证仅保存在本机用户目录，不会打包进安装包**：

| 平台 | 配置文件位置 |
|---|---|
| Linux | `~/.config/deepshui-translator/config.json` |
| macOS | `~/Library/Application Support/deepshui-translator/config.json` |
| Windows | `%APPDATA%\deepshui-translator\config.json` |

## 📦 安装

从 [GitHub Releases](https://github.com/QvShui/deepshui-translator/releases) 下载：

```bash
wget https://github.com/QvShui/deepshui-translator/releases/download/v2.0.3/deepshui-translator_2.0.3_Debian-Trixie_amd64.deb
sudo dpkg -i deepshui-translator_2.0.3_Debian-Trixie_amd64.deb
```

> Linux 安装包在 [GitHub Releases](https://github.com/QvShui/deepshui-translator/releases) 下载。macOS/Windows 用户请自行从源码构建（见下）。

## 🛠️ 从源码构建

| 平台 | 命令 | 产物 |
|---|---|---|
| Linux (Debian) | `npm run dist` | `.deb` |
| Linux (通用) | `npm run dist:appimage` | `.AppImage` |
| Windows | `npm run dist:win` | `.exe` (NSIS) |
| macOS | `npm run dist:mac` | `.dmg` |

> macOS 的 `.dmg` 只能在 macOS 上构建（Apple 限制）；Windows 的 `.exe` 需在 Windows 上构建。

### 国内网络加速

```bash
npm config set registry https://registry.npmmirror.com
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist
```

## 🗂️ 项目结构

```
├── main.js              # Electron 主进程（窗口、菜单、多引擎翻译、AI 流式）
├── preload.js           # IPC 安全桥接
├── renderer/
│   ├── index.html       # 主界面
│   ├── style.css
│   ├── app.js           # 划词翻译、AI 解释/问答、设置面板
│   ├── pdf-viewer.js    # PDF.js 阅读器（虚拟滚动按需渲染）
│   ├── pdfjs/           # PDF.js 本地库
│   └── lib/             # marked / KaTeX / DOMPurify（Markdown+公式渲染）
├── assets/              # 应用图标
└── build/               # deb 安装后脚本（sandbox 权限修复）
```

## 📜 开源协议

[MIT License](./LICENSE)

---

**免责声明**：翻译与 AI API 凭证均由用户自行提供，本项目不包含任何第三方凭证。使用各服务请遵守其使用条款。
