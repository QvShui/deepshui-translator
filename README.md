# deepshui-translator

**PDF 划词翻译工具** —— 基于 Electron + PDF.js，翻译引擎由用户自备（支持 **有道 / 百度 / 讯飞 / DeepL / Google Cloud**）。

> 轻量、跨平台、开源（MIT）。

## ✨ 功能

- 📂 打开 / 拖拽 PDF 文件
- 📄 PDF.js 高质量渲染（连续滚动、Ctrl+滚轮缩放、页码跳转）
- 🖱️ 划词即译（自动清洗断词连字符与换行符）
- 🌐 多引擎支持：有道 / 百度 / 讯飞 / DeepL / Google Cloud（英⇄中，支持日/韩/法/德）
- 📋 一键复制译文
- ⚙️ 设置面板（各引擎凭证独立管理 + AI 引擎配置）
- 🤖 AI 引擎（DeepSeek）：AI 解释划选段落、AI 问答（不注入划线内容）

## 🚀 快速开始(仅针对Debian用户)

```bash
# 1. 安装依赖
npm install

# 2. 启动
npm start
```

> 需要图形环境（X11 / Wayland / macOS / Windows）。

## 🔑 配置翻译 API

在应用内「⚙️ 设置」面板选择引擎并填写对应凭证，保存即可。

**凭证仅保存在本机用户目录，不会打包进安装包**，且各平台自动使用标准配置目录：

| 平台 | 配置文件位置 |
|---|---|
| Linux | `~/.config/deepshui-translator/config.json` |
| macOS | `~/Library/Application Support/deepshui-translator/config.json` |
| Windows | `%APPDATA%\deepshui-translator\config.json` |

引擎注册入口：

| 引擎 | 注册地址 |
|---|---|
| 有道 | https://ai.youdao.com/ |
| 百度 | https://fanyi-api.baidu.com/ |
| 讯飞 | https://www.xfyun.cn/services/its |
| DeepL | https://www.deepl.com/pro-api （免费 key 以 `:fx` 结尾） |
| Google Cloud | https://cloud.google.com/translate |

## 📦 打包

| 平台 | 命令 | 产物 |
|---|---|---|
| Linux (Debian) | `npm run dist` | `.deb` |
| Linux (通用) | `npm run dist:appimage` | `.AppImage` |
| Windows | `npm run dist:win` | `.exe` (NSIS) |
| macOS | `npm run dist:mac` | `.dmg` |

> - 已发布的安装包见 [`release/`](./release)。

### 安装

安装包托管在 [GitHub Releases](https://github.com/QvShui/deepshui-translator/releases)（不占用仓库体积）：

```bash
wget https://github.com/QvShui/deepshui-translator/releases/download/v1.1.0/deepshui-translator_1.2.0_Debian-Trixie_amd64.deb
sudo dpkg -i deepshui-translator_1.2.0_Debian-Trixie_amd64.deb
```

## 🗂️ 项目结构

```
├── main.js              # Electron 主进程（窗口、菜单、多引擎翻译）
├── preload.js           # IPC 安全桥接
├── renderer/
│   ├── index.html       # 主界面
│   ├── style.css
│   ├── app.js           # 划词翻译、多引擎设置面板
│   ├── pdf-viewer.js    # PDF.js 阅读器（虚拟滚动按需渲染）
│   └── pdfjs/           # PDF.js 本地库
├── assets/              # 应用图标
├── build/               # deb 安装后脚本
└── release/             # 已发布安装包
```

## 📜 开源协议

[MIT License](./LICENSE)

---

**免责声明**：翻译 API 凭证由用户自行提供，本项目不包含任何第三方凭证。
