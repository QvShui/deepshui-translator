/**
 * deepshui-translator - Electron 主进程
 * beta-0.2: 仅支持有道翻译 API
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

// ── 用户配置（凭证存用户目录，绝不打进安装包）────────────
// 配置文件: ~/.config/deepshui-translator/config.json (Linux)
// 权限: 600 (仅当前用户可读写)
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const cfg = JSON.parse(raw);
    return {
      appKey: cfg.appKey || '',
      appSecret: cfg.appSecret || '',
      apiKey: cfg.apiKey || '',
      targetLang: cfg.targetLang || 'zh-CHS',
    };
  } catch {
    return { appKey: '', appSecret: '', apiKey: '', targetLang: 'zh-CHS' };
  }
}

function saveConfig(cfg) {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  // 权限 600：仅当前用户可读写
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return loadConfig();
}

// 当前生效的有道配置（每次翻译时实时读取，改动立即生效）
function getYoudaoConfig() {
  return loadConfig();
}

// ── 有道翻译 API ─────────────────────────────────────────
function truncate(q) {
  const len = q.length;
  return len <= 20 ? q : q.substring(0, 10) + len + q.substring(len - 10);
}

function youdaoTranslate(text, from = 'auto', to = 'zh-CHS') {
  const youdao = getYoudaoConfig();
  if (!youdao.appKey || !youdao.appSecret) {
    return Promise.resolve({ ok: false, error: '未配置有道 API 凭证，请到 ⚙️ 设置 中填写' });
  }

  return new Promise((resolve, reject) => {
    const salt = String(Date.now());
    const curtime = String(Math.floor(Date.now() / 1000));
    const signStr = youdao.appKey + truncate(text) + salt + curtime + youdao.appSecret;
    const sign = crypto.createHash('sha256').update(signStr).digest('hex');

    const params = new URLSearchParams({
      q: text,
      from,
      to,
      appKey: youdao.appKey,
      salt,
      sign,
      signType: 'v3',
      curtime,
    });

    const req = https.get({
      hostname: 'openapi.youdao.com',
      path: '/api?' + params.toString(),
      headers: { 'User-Agent': 'DeepshuiTranslator/1.0' },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errorCode === '0') {
            resolve({ ok: true, text: (parsed.translation || []).join(''), engine: 'youdao' });
          } else {
            resolve({ ok: false, error: `有道错误码: ${parsed.errorCode} (${errorMessage(parsed.errorCode)})` });
          }
        } catch (e) {
          reject(new Error('有道响应解析失败'));
        }
      });
    });

    req.on('error', e => reject(new Error(`网络错误: ${e.message}`)));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('翻译请求超时 (15s)'));
    });
  });
}

function errorMessage(code) {
  const msgs = {
    '101': '缺少必填参数', '102': '不支持的语言类型', '103': '翻译文本过长',
    '104': '不支持的API类型', '106': '不支持的响应格式', '108': 'appKey无效',
    '110': '无可用实例', '111': '开发者账号无效', '113': '查询为空',
    '202': '签名校验失败', '203': '访问IP地址不在可访问IP列表', '205': '请求太频繁',
    '301': '辞典查询失败', '302': '翻译查询失败', '303': '服务异常',
    '401': '账户已欠费', '411': '访问频率受限',
  };
  return msgs[code] || '未知错误';
}

// ── 窗口管理 ─────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'deepshui-translator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── 菜单 ─────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开 PDF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openPdfDialog(),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openPdfDialog() {
  dialog.showOpenDialog(mainWindow, {
    title: '打开 PDF 文件',
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    properties: ['openFile'],
  }).then(result => {
    if (!result.canceled && result.filePaths.length > 0) {
      mainWindow.webContents.send('open-pdf', result.filePaths[0]);
    }
  });
}

// ── IPC 处理 ─────────────────────────────────────────────
ipcMain.handle('translate', async (event, { text, from, to }) => {
  try {
    // 重试 1 次
    let result = await youdaoTranslate(text, from, to);
    if (!result.ok) {
      result = await youdaoTranslate(text, from, to);
    }
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('open-pdf-dialog', async () => {
  openPdfDialog();
  return true;
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    return { ok: true, data: data.toString('base64'), name: path.basename(filePath) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-config', async () => {
  return loadConfig();
});

ipcMain.handle('save-config', async (event, cfg) => {
  return saveConfig(cfg);
});

// ── 启动 ─────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
