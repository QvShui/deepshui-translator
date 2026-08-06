# deepshui-translator

**PDF 划词翻译工具** —— 基于 Electron + PDF.js，翻译引擎由用户自备（当前支持**有道翻译 API**）。

> 轻量、跨平台、开源（MIT）。独立于任何闭源产品，代码完全自主。

## ✨ 功能

- 📂 打开 / 拖拽 PDF 文件
- 📄 PDF.js 高质量渲染（连续滚动、Ctrl+滚轮缩放、页码跳转）
- 🖱️ 划词即译（300ms 防抖，自动清洗断词连字符与换行符）
- 🌐 有道翻译 API（英⇄中，支持日/韩/法/德）
- 📋 一键复制译文
- ⚙️ 设置面板（API 凭证可编辑、测试连接）

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动
npm start
```

> 需要图形环境（X11/Wayland）。

## 🔑 配置翻译 API

在应用内「⚙️ 设置」面板填写有道凭证（应用 ID、应用秘钥、API Key），保存即可。

**凭证仅保存在本机用户目录**（`~/.config/deepshui-translator/config.json`，权限 600），**不会打包进安装包**。

在 [有道 AI 开放平台](https://ai.youdao.com/) 注册应用即可获得凭证。

## 📦 打包

```bash
npm run dist        # 生成 .deb
npm run dist:appimage  # 生成 AppImage
```

安装：

```bash
sudo dpkg -i dist/deepshui-translator_1.0.0_amd64.deb
```

## 🗂️ 项目结构

```
├── main.js              # Electron 主进程（窗口、菜单、有道翻译调用）
├── preload.js           # IPC 安全桥接
├── renderer/
│   ├── index.html       # 主界面
│   ├── style.css
│   ├── app.js           # 划词翻译、设置面板逻辑
│   ├── pdf-viewer.js    # PDF.js 阅读器（虚拟滚动按需渲染）
│   └── pdfjs/           # PDF.js 本地库
├── assets/              # 应用图标
└── build/               # 打包脚本
```

## 📜 开源协议

[MIT License](./LICENSE)

---

**免责声明**：翻译 API 凭证由用户自行提供，本项目不包含任何第三方凭证。
