/**
 * deepshui-translator - Electron 主进程
 * 多引擎支持: 有道 / 百度 / 讯飞 / DeepL / Google Cloud (API Key)
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');

// 配置文件: ~/.config/deepshui-translator/config.json (Linux)
const DEFAULT_CONFIG = () => ({
  engine: 'youdao',
  targetLang: 'zh-CN',
  youdao: { appKey: '', appSecret: '' },
  baidu: { appid: '', secretKey: '', service: '' },  // service: ''=通用文本; 领域代码见 translateBaidu
  xunfei: { appid: '', apiKey: '', apiSecret: '' },
  deepl: { apiKey: '' },
  google: { apiKey: '' },
  ai: {
    provider: 'deepseek',
    providerKeys: { deepseek: '', qwen: '', doubao: '', kimi: '' },
    modelByProvider: { deepseek: '', qwen: '', doubao: '', kimi: '' },  // 每提供商记忆各自模型（v2.3.2）
    model: '',
    deepThink: 'off',   // off | low | high | max（默认关闭）
    showExplain: false,
    showAsk: false,
    isolateContext: true,  // 隔离解释与问答上下文（默认开启）
    multimodalEnabled: true,  // 多模态总开关（关闭后不允许上传图片，总结走文本提取）
    webSearchEnabled: false,  // 联网搜索-Beta 开关（v2.4.0，仅千问生效，默认关闭）
    webSearchMap: {},  // 探测到的联网模型表: { [provider]: { modelId: true } }
    summaryStart: 1,   // AI 总结起始页（默认 1）
    summaryEnd: 16,    // AI 总结结束页（默认 16）
  },
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
      ai: (() => {
        const oldAi = cfg.ai || {};
        const merged = { ...def.ai, ...oldAi };
        // 兼容旧配置: thinkingEnabled + reasoningEffort → deepThink
        if (merged.deepThink === undefined && oldAi.thinkingEnabled !== undefined) {
          merged.deepThink = oldAi.thinkingEnabled ? (oldAi.reasoningEffort || 'high') : 'off';
        }
        // 兼容旧配置: apiKey → providerKeys.deepseek
        if (!merged.providerKeys) merged.providerKeys = { ...def.ai.providerKeys };
        if (oldAi.apiKey && !merged.providerKeys.deepseek) {
          merged.providerKeys.deepseek = oldAi.apiKey;
        }
        // 兼容旧配置: 无 modelByProvider 时，把现有 model 归到当前 provider 槽位
        if (!merged.modelByProvider) {
          merged.modelByProvider = { ...def.ai.modelByProvider };
          if (merged.model) merged.modelByProvider[merged.provider] = merged.model;
        }
        return merged;
      })(),
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

// ── 模型列表磁盘缓存（v2.3.1）──────────────────────────────
// 策略: 每个提供商已拉取（含探测）过的模型存到磁盘，切换提供商直接读缓存，
//       只有用户主动点「刷新」才重新拉取更新。
// 文件: userData/models-cache.json，形如 { [provider]: { savedAt, models: [{id,multimodal,retiring}] } }
function getModelsCachePath() {
  return path.join(app.getPath('userData'), 'models-cache.json');
}
function loadModelsCache() {
  try {
    const j = JSON.parse(fs.readFileSync(getModelsCachePath(), 'utf8'));
    return (j && typeof j === 'object') ? j : {};
  } catch { return {}; }
}
function saveModelsCache(provider, models) {
  try {
    const cache = loadModelsCache();
    cache[provider] = { savedAt: new Date().toISOString(), models };
    fs.mkdirSync(path.dirname(getModelsCachePath()), { recursive: true });
    fs.writeFileSync(getModelsCachePath(), JSON.stringify(cache, null, 2), { mode: 0o600 });
  } catch { /* 缓存写失败不影响主流程 */ }
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

  // POST（GET 超长文本会触发 URL 长度限制）
  const res = await httpRequest({
    hostname: 'openapi.youdao.com', path: '/api', method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params.toString()),
      'User-Agent': 'DeepshuiTranslator/1.0',
    },
  }, params.toString());
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
// 翻译服务（v2.4.0）: cred.service 为空=通用文本(/api/trans/vip/translate);
// 有值=领域文本(/api/trans/vip/fieldtranslate，签名含 domain)，失败自动回落通用
async function translateBaidu(text, from, to, cred) {
  const { service } = cred;
  if (service) {
    const errMsg = await translateBaiduField(text, from, to, cred);
    if (!errMsg) return { ok: true, text: translateBaiduField._last };
    // 领域失败 → 回落通用文本
    const fallback = await translateBaiduGeneral(text, from, to, cred);
    if (fallback.ok) return fallback;
    return { ok: false, error: `${errMsg}；回落通用也失败: ${fallback.error}` };
  }
  return translateBaiduGeneral(text, from, to, cred);
}

// 领域文本翻译：成功返回 null 并置 _last 译文；失败返回错误信息
async function translateBaiduField(text, from, to, cred) {
  const { appid, secretKey, service } = cred;
  const salt = String(Date.now());
  const sign = crypto.createHash('md5')
    .update(appid + text + salt + service + secretKey).digest('hex');
  const params = new URLSearchParams({
    q: text, from: mapLang('baidu', from), to: mapLang('baidu', to),
    appid, salt, sign, domain: service,
  });
  try {
    const res = await httpRequest({
      hostname: 'fanyi-api.baidu.com', path: '/api/trans/vip/fieldtranslate', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params.toString()),
        'User-Agent': 'DeepshuiTranslator/1.0',
      },
    }, params.toString());
    const parsed = JSON.parse(res.data);
    if (parsed.error_code === '0' || (!parsed.error_code && parsed.trans_result)) {
      translateBaiduField._last = (parsed.trans_result || []).map(t => t.dst).join('\n');
      return null;
    }
    return `百度领域错误码 ${parsed.error_code} (${parsed.error_msg || '未知错误'})`;
  } catch (e) {
    return `百度领域翻译网络错误: ${e.message}`;
  }
}

// 通用文本翻译
async function translateBaiduGeneral(text, from, to, cred) {
  const { appid, secretKey } = cred;
  const salt = String(Date.now());
  const sign = crypto.createHash('md5')
    .update(appid + text + salt + secretKey).digest('hex');

  const params = new URLSearchParams({
    q: text, from: mapLang('baidu', from), to: mapLang('baidu', to),
    appid, salt, sign,
  });

  // POST（GET 超长文本会触发 URL 长度限制）
  const res = await httpRequest({
    hostname: 'api.fanyi.baidu.com', path: '/api/trans/vip/translate', method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params.toString()),
      'User-Agent': 'DeepshuiTranslator/1.0',
    },
  }, params.toString());
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

// ── AI 提供商（DeepSeek / 千问 / 豆包 / Kimi）────────────
const AI_PROVIDERS = {
  deepseek: { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', chatPath: '/chat/completions', modelsPath: '/models' },
  qwen:     { id: 'qwen', label: '千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', chatPath: '/chat/completions', modelsPath: '/models' },
  doubao:   { id: 'doubao', label: '豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', chatPath: '/chat/completions', modelsPath: '/models' },
  kimi:     { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', chatPath: '/chat/completions', modelsPath: '/models' },
};

function getAiProvider(name) {
  return AI_PROVIDERS[name] || AI_PROVIDERS.deepseek;
}

function providerEndpoints(provider) {
  const u = new URL(provider.baseUrl);
  const base = u.pathname.replace(/\/$/, '');
  return {
    hostname: u.hostname,
    chatPath: base + provider.chatPath,
    modelsPath: base + provider.modelsPath,
  };
}

// 拉取可用模型列表（返回带 status 的模型数组，豆包用于过滤停服模型）
function fetchAiModels(provider, apiKey) {
  const ep = providerEndpoints(provider);
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: ep.hostname, path: ep.modelsPath, method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'DeepshuiTranslator/2.1' },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        // 非 200：透出真实错误（此前空响应体会被报成“解析失败”，误导排查）
        if (res.statusCode !== 200) {
          let msg = `HTTP ${res.statusCode}`;
          try {
            const j = JSON.parse(data);
            if (j.error?.message) msg += `: ${j.error.message}`;
            else if (j.message) msg += `: ${j.message}`;
          } catch { /* 空响应体等 */ }
          resolve({ ok: false, error: msg });
          return;
        }
        try {
          const j = JSON.parse(data);
          if (j.data && Array.isArray(j.data)) {
            // out 字段: 豆包特有的输出模态（过滤视频/图像/3D 模型用）
            resolve({ ok: true, models: j.data.map(m => ({ id: m.id, status: m.status, out: m.modalities?.output_modalities })) });
          } else {
            resolve({ ok: false, error: j.error?.message || '模型列表响应异常' });
          }
        } catch (e) { reject(new Error('模型列表解析失败')); }
      });
    });
    req.on('error', e => reject(new Error(`网络错误: ${e.message}`)));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时 (10s)')); });
  });
}

// ── 多模态自动检测 ────────────────────────────────────────
// 最小纯色 PNG 生成（128x128，Node zlib + CRC32）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function solidPng(r, g, b) {
  const W = 128, H = 128;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]).toString('base64');
}

// 单次探测：kind='chat'   文本探测（验证模型已开通、真正可对话）
//           kind='mm'     图像探测（验证多模态）
//           kind='search' 联网探测（验证支持联网搜索，按提供商分派探测方式）
// chat: 200/429 通过（429 说明模型存在仅被限流）；mm: 只认 200（保守）
// search: qwen 用 enable_search 顶层参数（200 即支持——网关对个别模型静默忽略，UI 提示误标）；
//         kimi 用内置 $web_search 工具；豆包/DeepSeek 用通用 function 工具，均须模型实际返回 tool_calls
function probeModel(provider, apiKey, model, kind, pngB64) {
  const ep = providerEndpoints(provider);
  let body;
  if (kind === 'mm') {
    body = JSON.stringify({ model, messages: [{ role: 'user', content: [{ type: 'text', text: '描述这张图片' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${pngB64}` } }] }], max_tokens: 1 });
  } else if (kind === 'search') {
    if (provider.id === 'qwen') {
      body = JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], enable_search: true, max_tokens: 1 });
    } else if (provider.id === 'kimi') {
      body = JSON.stringify({ model, messages: [{ role: 'user', content: '请联网搜索今天的重要新闻' }], tools: [{ type: 'builtin_function', function: { name: '$web_search' } }], max_tokens: 100 });
    } else {
      body = JSON.stringify({ model, messages: [{ role: 'user', content: '请联网搜索今天的重要新闻' }], tools: [{ type: 'function', function: { name: 'web_search', description: '搜索互联网获取实时信息', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }], max_tokens: 100 });
    }
  } else {
    body = JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 });
  }
  return new Promise((resolve) => {
    const req = https.request({ hostname: ep.hostname, path: ep.chatPath, method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let ok = res.statusCode === 200;
        if (kind === 'chat') ok = ok || res.statusCode === 429;
        if (kind === 'search' && provider.id !== 'qwen') {
          // 非 qwen: 须模型实际返回工具调用才算支持
          try { ok = ok && !!(JSON.parse(data).choices?.[0]?.message?.tool_calls || []).length; } catch { ok = false; }
        }
        resolve(ok);
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(15000, () => { req.destroy(); resolve(false); });
    req.write(body); req.end();
  });
}

// 并发批量探测，onProgress(done, total) 回调；kind: 'chat' | 'mm' | 'search'
async function probeModelsBatch(provider, apiKey, modelIds, kind, onProgress, concurrency = 8) {
  const png = kind === 'mm' ? solidPng(200, 30, 30) : null;
  const results = [];
  let idx = 0, done = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= modelIds.length) break;
      const id = modelIds[i];
      const ok = await probeModel(provider, apiKey, id, kind, png);
      results.push({ id, ok });
      done++;
      if (onProgress) onProgress(done, modelIds.length);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, modelIds.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}

// 流式对话：通过 onEvent 回调推送事件
// onEvent: {type:'thinking',text} | {type:'content',text} | {type:'think-done',seconds}
//          | {type:'done',usage} | {type:'error',message}
// deepThink: 'off' | 'low' | 'high' | 'max'
function aiChatStream({ provider, apiKey, model, messages, deepThink, webSearch, signal, onEvent }) {
  const ep = providerEndpoints(provider);
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(deepThink && deepThink !== 'off'
      ? { thinking: { type: 'enabled' }, reasoning_effort: deepThink }
      : { thinking: { type: 'disabled' } }),
    // 千问联网搜索（v2.4.0-Beta）
    ...(webSearch ? { enable_search: true } : {}),
  });

  const startTime = Date.now();
  let thinkingActive = false;
  // 终态事件(done/end/error)只发一次——此前 done 后还会发 end，渲染层重复 finalize，
  // 且取消后迟到的 end 会竞态打断新轮次
  let terminated = false;
  const terminate = (evt) => {
    if (terminated) return;
    terminated = true;
    onEvent(evt);
  };

  const req = https.request({
    hostname: ep.hostname, path: ep.chatPath, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'DeepshuiTranslator/1.2',
    },
    signal,
  }, res => {
    // 非 200 响应：读取错误正文并作为 error 事件上报（此前会被当 SSE 解析而静默吞掉）
    if (res.statusCode !== 200) {
      let errBuf = '';
      res.setEncoding('utf8');
      res.on('data', c => errBuf += c);
      res.on('end', () => {
        let msg = `HTTP ${res.statusCode}`;
        try {
          const j = JSON.parse(errBuf);
          if (j.error?.message) msg += `: ${j.error.message}`;
          else if (j.message) msg += `: ${j.message}`;
        } catch {
          if (errBuf.trim()) msg += `: ${errBuf.slice(0, 300)}`;
        }
        terminate({ type: 'error', message: msg });
      });
      return;
    }
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', chunk => {
      if (terminated) return;
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          terminate({ type: 'done' });
          break;
        }
        try {
          const j = JSON.parse(payload);
          // 流式响应中也可能嵌入错误对象（此前被静默忽略）
          if (j.error) {
            terminate({ type: 'error', message: j.error.message || 'API 返回错误' });
            break;
          }
          const delta = j.choices?.[0]?.delta || {};
          if (delta.reasoning_content) {
            if (!thinkingActive) {
              thinkingActive = true;
              onEvent({ type: 'think-start' });
            }
            onEvent({ type: 'thinking', text: delta.reasoning_content });
          }
          if (delta.content) {
            if (thinkingActive) {
              thinkingActive = false;
              onEvent({ type: 'think-done', seconds: ((Date.now() - startTime) / 1000).toFixed(1) });
            }
            onEvent({ type: 'content', text: delta.content });
          }
          if (j.usage) onEvent({ type: 'usage', usage: j.usage });
        } catch (e) { /* 忽略无法解析的块 */ }
      }
    });
    res.on('end', () => {
      if (terminated) return;
      if (thinkingActive) {
        thinkingActive = false;
        onEvent({ type: 'think-done', seconds: ((Date.now() - startTime) / 1000).toFixed(1) });
      }
      terminate({ type: 'end' });
    });
  });

  req.on('error', e => {
    if (e.name === 'AbortError') {
      terminate({ type: 'error', message: '已取消' });
    } else {
      terminate({ type: 'error', message: `网络错误: ${e.message}` });
    }
  });
  // socket 空闲计时（有数据流动自动重置）：大图总结服务端处理较慢，放宽到 180s
  req.setTimeout(180000, () => { req.destroy(new Error('请求超时 (180s)')); });
  req.write(body);
  req.end();
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
    const result = await translateWith(eng, text, from, to, cfg);
    // 业务错误（凭证缺失/错误码）不重试，直接返回
    if (!result.ok) return { ...result, engine: eng };
    return { ...result, engine: eng };
  } catch (e) {
    // 网络异常/超时：重试 1 次
    try {
      const retry = await translateWith(eng, text, from, to, cfg);
      return { ...retry, engine: eng };
    } catch (e2) {
      return { ok: false, error: e2.message, engine: eng };
    }
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

// ── AI 引擎 IPC ──────────────────────────────────────────
// 进行中的流式请求表: requestId -> AbortController
const aiAborters = new Map();

// 读取磁盘上某提供商上次拉取的模型缓存（纯读盘，不联网）
ipcMain.handle('ai-models-cache', async (event, { provider } = {}) => {
  const cfg = loadConfig();
  const prov = provider || cfg.ai.provider || 'deepseek';
  const entry = loadModelsCache()[prov];
  if (!entry || !Array.isArray(entry.models) || entry.models.length === 0) {
    return { ok: true, cached: false, models: [] };
  }
  return { ok: true, cached: true, savedAt: entry.savedAt, models: entry.models };
});

// 拉取 AI 提供商可用模型列表 + 自动多模态检测
// key 优先用渲染层传入的，其次配置的 providerKeys
ipcMain.handle('ai-models', async (event, { provider, apiKey } = {}) => {
  const cfg = loadConfig();
  const prov = provider || cfg.ai.provider || 'deepseek';
  const key = apiKey || cfg.ai.providerKeys?.[prov] || cfg.ai.apiKey;
  if (!key) return { ok: false, error: '未配置 API Key，请到 设置 → AI 引擎 填写' };
  try {
    const providerCfg = getAiProvider(prov);
    const list = await fetchAiModels(providerCfg, key);
    if (!list.ok) return list;

    // 过滤停服模型（Shutdown 实测全灭直接排除；Retiring 实测可能仍可用，保留并交给探测兜底）
    let candidates = list.models.filter(m => m.status !== 'Shutdown');
    // 记录 Retiring 模型，渲染层标注 ⚠️Retiring
    const retiringSet = new Set(candidates.filter(m => m.status === 'Retiring').map(m => m.id));
    // 过滤非对话模型（豆包/千问的列表会混入视频/图像/3D/向量/语音模型）：
    // 1) output_modalities 存在且不含 text → 非对话
    // 2) 名称含已知非对话类型 → 非对话
    const NON_CHAT_PATTERN = /seedance|seedream|embedding|hyper3d|hitem3d|seed3d|3d-gen|rerank|(^|[-_])(image|tts|asr|audio|ocr)([-_.]|$)/i;
    candidates = candidates.filter(m => {
      if (Array.isArray(m.out) && m.out.length && !m.out.includes('text')) return false;
      if (NON_CHAT_PATTERN.test(m.id)) return false;
      return true;
    });
    const ids = candidates.map(m => m.id);

    const sender = event.sender;
    // 阶段1: 文本探测——列表含未开通/无权限模型（实测: 豆包 23 个候选仅 1 个已开通，
    // 千问也有大量未开通返回 400/403），只保留真正能对话的
    const chatResults = await probeModelsBatch(providerCfg, key, ids, 'chat', (done, total) => {
      if (!sender.isDestroyed()) sender.send('ai-models-progress', { phase: 'chat', done, total });
    });
    const chatOkIds = chatResults.filter(r => r.ok).map(r => r.id);
    if (chatOkIds.length === 0) {
      return { ok: false, error: '没有可对话的模型（模型可能未在控制台开通，或 API Key 无权限）' };
    }
    // 阶段2: 图像探测——在可对话模型中标注多模态
    const mmResults = await probeModelsBatch(providerCfg, key, chatOkIds, 'mm', (done, total) => {
      if (!sender.isDestroyed()) sender.send('ai-models-progress', { phase: 'multimodal', done, total });
    });
    // 阶段3: 联网探测——在可对话模型中标注联网搜索能力（v2.4.0；qwen 用 enable_search，
    // 其他家用工具调用探测；开关仅对 qwen 开放，探测结果先全部保存）
    const wsResults = await probeModelsBatch(providerCfg, key, chatOkIds, 'search', (done, total) => {
      if (!sender.isDestroyed()) sender.send('ai-models-progress', { phase: 'search', done, total });
    });
    const wsOkIds = new Set(wsResults.filter(r => r.ok).map(r => r.id));
    // 按字典序返回（不区分大小写）
    const models = mmResults
      .map(r => ({ id: r.id, multimodal: r.ok, webSearch: wsOkIds.has(r.id), retiring: retiringSet.has(r.id) }))
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { sensitivity: 'base' }));
    // 探测成功即写入磁盘缓存，下次切换提供商直接读缓存（v2.3.1）
    saveModelsCache(prov, models);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 发起流式 AI 对话（解释/问答通用），事件通过 webContents.send('ai-event') 推送
ipcMain.handle('ai-chat', async (event, { requestId, messages, kind }) => {
  const cfg = loadConfig();
  const ai = cfg.ai;
  const prov = ai.provider || 'deepseek';
  const apiKey = ai.providerKeys?.[prov] || ai.apiKey;
  if (!apiKey) return { ok: false, error: '未配置 API Key，请到 设置 → AI 引擎 填写' };
  if (!ai.model) return { ok: false, error: '未选择模型，请到 设置 → AI 引擎 拉取并选择模型' };

  const sender = event.sender;
  const ac = new AbortController();
  aiAborters.set(requestId, ac);

  const emit = (evt) => {
    if (!sender.isDestroyed()) sender.send('ai-event', { requestId, kind, ...evt });
  };

  aiChatStream({
    provider: getAiProvider(prov),
    apiKey,
    model: ai.model,
    messages,
    deepThink: ai.deepThink || 'high',
    // 联网搜索（v2.4.0-Beta）: 仅 qwen + 开关开启 + 探测支持联网的模型，请求加 enable_search
    webSearch: prov === 'qwen' && ai.webSearchEnabled === true && !!(ai.webSearchMap || {})[prov]?.[ai.model],
    signal: ac.signal,
    onEvent: emit,
  });

  // 请求结束时清理
  const cleanup = () => aiAborters.delete(requestId);
  ac.signal.addEventListener('abort', cleanup, { once: true });
  setTimeout(cleanup, 90000); // 兜底清理

  return { ok: true, requestId };
});

// 取消进行中的 AI 请求
ipcMain.handle('ai-cancel', async (event, requestId) => {
  const ac = aiAborters.get(requestId);
  if (ac) ac.abort();
  return true;
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
