/**
 * 多模态自动识别测试脚本
 * 方法: 随机颜色多图验证 —— 生成 3 张不同颜色的纯色图, 分别问颜色, 比对回答
 * 用法: node test_multimodal.js
 * 判定: SUPPORTED(全对) / NOT_SUPPORTED(全错或否认) / AMBIGUOUS(部分对) / API_REJECTED(400) / NO_ACCESS(404)
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');

// ── 读取 apis.csv 的 key ──
function loadKeys() {
  const content = fs.readFileSync(__dirname + '/apis.csv', 'utf8');
  const map = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([^,]+),\s*([^,]+)/);
    if (m) map[m[1].trim()] = m[2].trim();
  }
  return map;
}

// ── 最小纯色 PNG 生成 (8x8, zlib + CRC32) ──
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
function chunk(type, data) {
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
  ihdr[8] = 8; ihdr[9] = 2; // 8bit, truecolor
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter none
    for (let x = 0; x < W; x++) {
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

// ── 色板: 名称 → RGB ──
const PALETTE = [
  ['红', 220, 30, 30], ['蓝', 20, 60, 220], ['绿', 20, 170, 40],
  ['黄', 230, 200, 20], ['紫', 150, 30, 200], ['青', 20, 180, 180],
];

// ── 请求 ──
function request(host, path, key, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return new Promise((resolve) => {
    const req = https.request({ hostname: host, path, method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.write(body); req.end();
  });
}

// 每个 provider 的端点
const PROVIDERS = {
  deepseek: { host: 'api.deepseek.com', path: '/chat/completions', key: 'deepseek_api' },
  kimi:     { host: 'api.moonshot.cn', path: '/v1/chat/completions', key: 'kimi_api' },
  doubao:   { host: 'ark.cn-beijing.volces.com', path: '/api/v3/chat/completions', key: 'doubao_api' },
  qwen:     { host: 'dashscope.aliyuncs.com', path: '/compatible-mode/v1/chat/completions', key: 'qwen_api' },
};

// 被测模型
const MODELS = [
  ['deepseek', 'deepseek-v4-flash'],
  ['kimi', 'kimi-k3'],
  ['kimi', 'kimi-k2.6'],
  ['doubao', 'doubao-seed-1-6-250615'],
  ['qwen', 'qwen3-vl-plus'],
  ['qwen', 'qwen-vl-max'],
  ['qwen', 'qwen3.5-omni-flash'],
  ['qwen', 'qwen3.7-max'],  // 文本模型对照
];

// ── 回答解析: 提取颜色名或 RGB ──
const COLOR_NAMES = { '红': '红', '赤': '红', '蓝': '蓝', '绿': '绿', '黄': '黄', '紫': '紫', '青': '青', '黑': '黑', '白': '白', '粉': '粉', '橙': '橙', '棕': '棕', '灰': '灰', 'cyan': '青', 'purple': '紫', 'yellow': '黄', 'green': '绿', 'blue': '蓝', 'red': '红', 'orange': '橙', 'pink': '粉', 'black': '黑', 'white': '白', 'grey': '灰', 'gray': '灰' };
function parseColor(ans) {
  if (!ans) return null;
  const lower = ans.toLowerCase();
  // RGB 数值
  const rgb = lower.match(/rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/) || lower.match(/#([0-9a-f]{6})/);
  if (rgb) {
    if (rgb[1] && rgb[2] && rgb[3]) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
    if (rgb[1]) return { hex: rgb[1] };
  }
  // 颜色名
  for (const [name, cn] of Object.entries(COLOR_NAMES)) {
    if (lower.includes(name)) return { name: cn };
  }
  return null;
}
function matchColor(parsed, target) {
  if (!parsed) return false;
  if (parsed.name) return parsed.name === target.name;
  if (parsed.r !== undefined) {
    return Math.abs(parsed.r - target.r) < 60 && Math.abs(parsed.g - target.g) < 60 && Math.abs(parsed.b - target.b) < 60;
  }
  return false;
}
// 否认模式
const DENY_PATTERNS = ['无法查看', '看不到', '无法识别图片', '不能查看', '无法直接查看', "can't see", 'cannot see', '无法处理图片', '没有图片', '无法看到'];

async function testModel(provider, model, keys) {
  const cfg = PROVIDERS[provider];
  if (!keys[cfg.key]) return { model, result: 'NO_KEY' };
  const results = [];
  // 固定红绿蓝三色测试（按用户要求，不随机）
  const picked = [PALETTE[0], PALETTE[1], PALETTE[2]];
  for (const [name, r, g, b] of picked) {
    const b64 = solidPng(r, g, b);
    const res = await request(cfg.host, cfg.path, keys[cfg.key], {
      model,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '这张图片的主色是什么？只回答颜色名' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ]}],
      max_tokens: 400,
    });
    if (res.status === 200) {
      let ans = '';
      try { ans = JSON.parse(res.body).choices[0].message.content || ''; } catch (e) {}
      const deny = DENY_PATTERNS.some(p => ans.includes(p));
      const parsed = parseColor(ans);
      const hit = matchColor(parsed, { name, r, g, b });
      results.push({ color: name, hit, deny, ans: ans.replace(/\n/g, ' ').slice(0, 60) });
    } else if (res.status === 400) {
      return { model, result: 'API_REJECTED', detail: res.body.slice(0, 120) };
    } else {
      return { model, result: 'NO_ACCESS', detail: res.body.slice(0, 120) };
    }
    await new Promise(r => setTimeout(r, 200));
  }
  const hits = results.filter(x => x.hit).length;
  const denies = results.filter(x => x.deny).length;
  const result = hits === 3 ? 'SUPPORTED' : (denies >= 2 || hits === 0 ? 'NOT_SUPPORTED' : 'AMBIGUOUS');
  return { model, result, results };
}

(async () => {
  const keys = loadKeys();
  console.log('=== 多模态自动识别测试 (随机3色验证) ===\n');
  const table = [];
  for (const [provider, model] of MODELS) {
    const t = await testModel(provider, model, keys);
    table.push(t);
    console.log(`[${t.model}]`);
    if (t.result === 'SUPPORTED' || t.result === 'NOT_SUPPORTED' || t.result === 'AMBIGUOUS') {
      t.results.forEach(x => console.log(`   期望${x.color} | ${x.hit ? '✅命中' : (x.deny ? '❌否认' : '❌未命中')} | 回答: ${x.ans}`));
    } else if (t.result === 'API_REJECTED') {
      console.log(`   API 拒绝(400): ${t.detail}`);
    } else if (t.result === 'NO_ACCESS') {
      console.log(`   无权限/404: ${t.detail}`);
    } else {
      console.log('   无 key');
    }
    console.log(`   → 结论: ${t.result}\n`);
  }

  console.log('=== 汇总表 ===');
  console.log('模型'.padEnd(30) + '结论');
  table.forEach(t => console.log(t.model.padEnd(30) + t.result));
})();
