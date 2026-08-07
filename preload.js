/**
 * deepshui-translator - Preload 脚本
 * 通过 contextBridge 安全暴露 IPC 接口给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deepshui', {
  // 翻译：text -> {ok, text|error, engine}
  translate: (text, from = 'auto', to = 'zh-CN', engine) =>
    ipcRenderer.invoke('translate', { text, from, to, engine }),

  // 打开 PDF 文件对话框
  openPdfDialog: () => ipcRenderer.invoke('open-pdf-dialog'),

  // 读取文件（返回 base64）
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),

  // 获取有道配置
  getConfig: () => ipcRenderer.invoke('get-config'),

  // 保存有道配置
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),

  // AI 引擎
  aiModels: () => ipcRenderer.invoke('ai-models'),
  aiChat: (requestId, messages, kind) => ipcRenderer.invoke('ai-chat', { requestId, messages, kind }),
  aiCancel: (requestId) => ipcRenderer.invoke('ai-cancel', requestId),
  onAiEvent: (callback) => {
    ipcRenderer.on('ai-event', (event, data) => callback(data));
  },

  // 监听：主进程通知打开 PDF
  onOpenPdf: (callback) => {
    ipcRenderer.on('open-pdf', (event, filePath) => callback(filePath));
  },
});
