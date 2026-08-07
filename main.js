/**
 * deepshui-translator - Electron 主进程
 * 多引擎支持: 有道 / 百度 / 讯飞 / DeepL / Google Cloud (API Key)
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

// ── 用户配置（凭证存用户目录，绝不打进安装包）────────────
// 配置文件: ~/.config/deepshui-translator/config.json (Linux)
// 权限: 600 (仅当前用户可读写)
const DEFAULT_CONFIG = () => ({
  engine: 'youdao',
  targetLang: 'zh-CN',
  youdao: { appKey: '', appSecret: '' },
  baidu: { appid: '', secretKey: '' },
  xunfei: { appid: '', apiKey: '', apiSecret: '' },
  deepl: { apiKey: '' },
  google: { apiKey: '' },
});

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const cfg = JSON.parse(raw);
    // 合并默认值，兼容旧配置
    const def = DEFAULT_CONFIG();
    return {
      ...def,
      ...cfg,
      youdao: { ...def.youdao, ...(cfg.youdao || {}) },
      baidu: { ...def.baidu, ...(cfg.baidu || {}) },
      xunfei: { ...def.xunfei, ...(cfg.xunfei || {}) },
      deepl: { ...def.deepl, ...(cfg.deepl || {}) },
      google: { ...def.google, ...(cfg.google || {}) },
    };
  } catch {
    return DEFAULT_CONFIG();
  }
}

function saveConfig(cfg) {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return loadConfig();
}

// ── 语言代码映射（统一代码 → 各引擎代码）────────────────
// 统一: zh-CN, en, ja, ko, fr, de
const LANG_MAP = {
  youdao: { 'zh-CN': 'zh-CHS', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de' },
  baidu:  { 'zh-CN': 'zh', en: 'en', ja: 'jp', ko: 'kor', fr: 'fra', de: 'de' },
  xunfei: { 'zh-CN': 'cn', en: 'en', ja: 'jp', ko: 'kor', fr: 'fra', de: 'de' },
  deepl:  { 'zh-CN': 'ZH', en: 'EN', ja: 'JA', ko: 'KO', fr: 'FR', de: 'DE' },
  google: { 'zh-CN': 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de' },
};

const ENGINE_NAMES = {
  youdao: '有道翻译', baidu: '百度翻译', xunfei: '讯飞翻译', deepl: 'DeepL', google: 'Google 翻译',
};

function mapLang(engine, lang) {
  if (!lang || lang === 'auto') return lang;
  return (LANG_MAP[engine] && LANG_MAP[engine][lang]) || lang;
}

// ── HTTP 工具 ────────────────────────────────────────────
function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', e => reject(new Error(`网络错误: ${e.message}`)));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('请求超时 (15s)')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── 有道翻译 ─────────────────────────────────────────────
function truncate(q) {
  const len = q.length;
  return len <= 20 ? q : q.substring(0, 10) + len + q.substring(len - 10);
}

async function translateYoudao(text, from, to, cred) {
  const { appKey, appSecret } = cred;
  const salt = String(Date.now());
  const curtime = String(Math.floor(Date.now() / 1000));
  const sign = crypto.createHash('sha256')
    .update(appKey + truncate(text) + salt + curtime + appSecret).digest('hex');

  const params = new URLSearchParams({
    q: text, from: mapLang('youdao', from), to: mapLang('youdao', to),
    appKey, salt, sign, signType: 'v3', curtime,
  });

  const res = await httpRequest({
    hostname: 'openapi.youdao.com', path: '/api?' + params.toString(), method: 'GET',
    headers: { 'User-Agent': 'DeepshuiTranslator/1.0' },
  });
  const parsed = JSON.parse(res.data);
  if (parsed.errorCode === '0') {
    return { ok: true, text: (parsed.translation || []).join('') };
  }
  return { ok: false, error: `有道错误码 ${parsed.errorCode} (${youdaoError(parsed.errorCode)})` };
}

function youdaoError(code) {
  const msgs = {
    '101': '缺少必填参数', '102': '不支持的语言类型', '103': '翻译文本过长',
    '108': 'appKey无效', '111': '开发者账号无效', '113': '查询为空',
    '202': '签名校验失败', '203': 'IP不在访问列表', '205': '请求太频繁',
    '401': '账户已欠费', '411': '访问频率受限',
  };
  return msgs[code] || '未知错误';
}

// ── 百度翻译 ─────────────────────────────────────────────
async function translateBaidu(text, from, to, cred) {
  const { appid, secretKey } = cred;
  const salt = String(Date.now());
  const sign = crypto.createHash('md5')
    .update(appid + text + salt + secretKey).digest('hex');

  const params = new URLSearchParams({
    q: text, from: mapLang('baidu', from), to: mapLang('baidu', to),
    appid, salt, sign,
  });

  const res = await httpRequest({
    hostname: 'api.fanyi.baidu.com', path: '/api/trans/vip/translate?' + params.toString(),
    method: 'GET', headers: { 'User-Agent': 'DeepshuiTranslator/1.0' },
  });
  const parsed = JSON.parse(res.data);
  if (parsed.error_code === '0' || (!parsed.error_code && parsed.trans_result)) {
    return { ok: true, text: (parsed.trans_result || []).map(t => t.dst).join('\n') };
  }
  return { ok: false, error: `百度错误码 ${parsed.error_code} (${parsed.error_msg || '未知错误'})` };
}

// ── 讯飞翻译（WebAPI v2，HMAC 签名）──────────────────────
async function translateXunfei(text, from, to, cred) {
  const { appid, apiKey, apiSecret } = cred;
  const host = 'itrans.xfyun.cn';
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nrequest-line: POST /v2/its HTTP/1.1`;
  const signature = crypto.createHmac('sha256', apiSecret)
    .update(signatureOrigin).digest('base64');
  const authorization = `hmac username="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;

  const body = JSON.stringify({
    common: { app_id: appid },
    business: { from: mapLang('xunfei', from), to: mapLang('xunfei', to), type: 1 },
    data: { text: Buffer.from(text, 'utf8').toString('base64') },
  });

  const res = await httpRequest({
    hostname: host, path: '/v2/its', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Host': host,
      'Date': date,
      'Authorization': authorization,
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  const parsed = JSON.parse(res.data);
  if (parsed.code === 0) {
    const dst = parsed.data?.result?.trans_result?.dst || '';
    return { ok: true, text: dst };
  }
  return { ok: false, error: `讯飞错误码 ${parsed.code} (${parsed.message || '未知错误'})` };
}

// ── DeepL ────────────────────────────────────────────────
async function translateDeepL(text, from, to, cred) {
  const params = new URLSearchParams({ text });
  const t = mapLang('deepl', to);
  if (t) params.set('target_lang', t);
  const s = mapLang('deepl', from);
  if (s && s !== 'auto') params.set('source_lang', s);

  const res = await httpRequest({
    hostname: 'api-free.deepl.com', path: '/v2/translate', method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${cred.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params.toString()),
    },
  }, params.toString());
  const parsed = JSON.parse(res.data);
  if (parsed.translations) {
    return { ok: true, text: parsed.translations.map(t => t.text).join('\n') };
  }
  const msg = parsed.message || `DeepL HTTP ${res.status}`;
  return { ok: false, error: `DeepL 错误: ${msg}` };
}

// ── Google Cloud Translation (API Key) ───────────────────
async function translateGoogle(text, from, to, cred) {
  const body = JSON.stringify({
    q: text, target: mapLang('google', to), format: 'text',
  });
  const s = mapLang('google', from);
  if (s && s !== 'auto') body.q && Object.assign(JSON.parse(body), { source: s });

  const finalBody = JSON.stringify({
    q: text,
    target: mapLang('google', to),
    format: 'text',
    ...(s && s !== 'auto' ? { source: s } : {}),
  });

  const res = await httpRequest({
    hostname: 'translation.googleapis.com',
    path: '/language/translate/v2?key=' + encodeURIComponent(cred.apiKey),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(finalBody) },
  }, finalBody);
  const parsed = JSON.parse(res.data);
  if (parsed.data && parsed.data.translations) {
    return { ok: true, text: parsed.data.translations.map(t => t.translatedText).join('\n') };
  }
  const err = parsed.error?.message || `Google HTTP ${res.status}`;
  return { ok: false, error: `Google 错误: ${err}` };
}

// ── 引擎分发 ─────────────────────────────────────────────
const ENGINES = {
  youdao: { check: c => c.appKey && c.appSecret, translate: translateYoudao },
  baidu: { check: c => c.appid && c.secretKey, translate: translateBaidu },
  xunfei: { check: c => c.appid && c.apiKey && c.apiSecret, translate: translateXunfei },
  deepl: { check: c => c.apiKey, translate: translateDeepL },
  google: { check: c => c.apiKey, translate: translateGoogle },
};

function translateWith(engine, text, from, to, cfg) {
  const def = ENGINES[engine];
  if (!def) return Promise.resolve({ ok: false, error: `未知引擎: ${engine}` });
  const cred = cfg[engine] || {};
  if (!def.check(cred)) {
    return Promise.resolve({ ok: false, error: `未配置${ENGINE_NAMES[engine]}凭证，请到 ⚙️ 设置 中填写` });
  }
  return def.translate(text, from, to, cred);
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
ipcMain.handle('translate', async (event, { text, from, to, engine }) => {
  const cfg = loadConfig();
  const eng = engine || cfg.engine || 'youdao';
  try {
    let result = await translateWith(eng, text, from, to, cfg);
    if (!result.ok) {
      // 重试 1 次
      result = await translateWith(eng, text, from, to, cfg);
    }
    return { ...result, engine: eng };
  } catch (e) {
    return { ok: false, error: e.message, engine: eng };
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
