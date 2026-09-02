# deepshui-translator

**PDF 划词翻译 + AI 阅读助手** —— 基于 Electron + PDF.js + DeepSeek。

> 轻量、跨平台、开源（MIT）。翻译引擎由用户自备，AI 引擎支持 DeepSeek / 千问 / 豆包 / Kimi。

## ✨ 功能

### 阅读与翻译
- 📂 打开 / 拖拽 PDF（虚拟滚动按需渲染，大 PDF 秒开）
- 📄 PDF.js 高质量渲染（连续滚动、Ctrl+滚轮缩放、页码跳转、高分屏适配）
- 🖱️ 划词即译（自动清洗断词连字符与换行符）
- 🌐 多翻译引擎：有道 / 百度 / 讯飞 / DeepL / Google Cloud（英⇄中，支持日/韩/法/德）
- 🚫 目标语言可选「不翻译」（纯 AI 阅读模式）
- 📋 一键复制译文
- 📜 首次启动显示许可协议（v2.4.1，MIT 中英双语，同意后进入）

### AI 引擎（DeepSeek / 千问 / 豆包 / Kimi）
- 🤖 **AI 解释**：划词自动解释段落（核心意思 / 关键术语 / 背景知识）
- 💬 **AI 问答**：多轮对话，可基于全文（打开 PDF 自动总结，提问自动携带全文）
- 🔢 **总结页数限制**：默认只总结 1-30 页，可在提问框下方修改范围（避免长文档超 token）
- 🖼️ **PDF 选图上传**：点击「选图」后，PDF 中的图片区域会高亮，点击即可截取图片随问题一起发送（多模态模型可解释文献图表）
- 🖼️ **多模态总结**：支持多模态的模型（千问 VL / Kimi / 豆包等）打开 PDF 时直接渲染页面图片总结，能理解图表与公式
- 🔄 **重置对话**：一键清空历史并重新喂入全文总结
- 💾 **会话存盘**（v2.5.0）：AI 问答历史按「文档 + 模型」持久化到本机，重新打开同一篇论文可回到之前的会话，也可在顶部模型下拉切回其它模型的会话
- 🧠 **深度思考**：关闭 / low / high / max 四档推理强度
- 📝 **Markdown + LaTeX 渲染**：标题、列表、粗体、数学公式（KaTeX）
- 🧩 可选「隔离上下文」（AI 解释与 AI 问答隔离为两个会话，解释仅依据当前划选段落）

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
wget https://github.com/QvShui/deepshui-translator/releases/download/v2.0.4/deepshui-translator_2.0.4_Debian-Trixie_amd64.deb
sudo dpkg -i deepshui-translator_2.0.4_Debian-Trixie_amd64.deb
```

> Linux 安装包在 [GitHub Releases](https://github.com/QvShui/deepshui-translator/releases) 下载。macOS/Windows 用户请自行从源码构建（见下）。

## 🗑️ 卸载

卸载时会**自动清除本机配置**（API Key 等）：

| 平台 | 卸载方式 | 配置清理 |
|---|---|---|
| Linux (deb) | `sudo dpkg -r deepshui-translator` | ✅ 自动删除 `~/.config/deepshui-translator`（所有用户） |
| Windows | 控制面板/设置 → 卸载 deepshui-translator | ✅ 自动删除 `%APPDATA%\deepshui-translator` |
| macOS | 运行 dmg 内的「mac-uninstall.command」（或终端执行） | ✅ 删除应用 + `~/Library/Application Support/deepshui-translator` |
| Linux (AppImage) | 直接删除 .AppImage 文件 | ⚠️ 无卸载器，需手动删除 `~/.config/deepshui-translator` |

> macOS 无标准卸载机制（拖入废纸篓不会触发清理），请务必使用卸载脚本。

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
│   ├── license.html     # 首次启动许可协议窗口（v2.4.1）
│   ├── license.js
│   ├── pdf-viewer.js    # PDF.js 阅读器（虚拟滚动按需渲染）
│   ├── pdfjs/           # PDF.js 本地库
│   └── lib/             # marked / KaTeX / DOMPurify（Markdown+公式渲染）
├── assets/              # 应用图标
└── build/               # deb 安装后脚本（sandbox 权限修复）
```

## 📜 开源协议

[MIT License](./LICENSE)

> 自 v2.4.1 起，首次启动会显示许可协议窗口（MIT 中英双语）：勾选「我已阅读并同意以上内容」并点击「接受」后进入主界面；点击「退出」或直接关闭窗口则退出程序。卸载重装后需重新同意。

---

**免责声明**：翻译与 AI API 凭证均由用户自行提供，本项目不包含任何第三方凭证。使用各服务请遵守其使用条款。
