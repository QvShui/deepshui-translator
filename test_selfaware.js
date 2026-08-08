/**
 * 模型自我认知测试: 纯文本问模型「你能识别图片吗」
 * 用法: node test_selfaware.js
 */
const https = require('https');
const fs = require('fs');

function loadKeys() {
  const content = fs.readFileSync(__dirname + '/apis.csv', 'utf8');
  const map = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([^,]+),\s*([^,]+)/);
    if (m) map[m[1].trim()] = m[2].trim();
  }
  return map;
}

const PROVIDERS = {
  doubao: { host: 'ark.cn-beijing.volces.com', path: '/api/v3/chat/completions', key: 'doubao_api' },
  kimi:   { host: 'api.moonshot.cn', path: '/v1/chat/completions', key: 'kimi_api' },
  qwen:   { host: 'dashscope.aliyuncs.com', path: '/compatible-mode/v1/chat/completions', key: 'qwen_api' },
};

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

(async () => {
  const keys = loadKeys();
  const tests = [
    ['doubao', 'doubao-seed-1-6-250615', '你现在能识别图片吗？请诚实回答：你是否有视觉能力（能真正看懂图片内容）？'],
    ['kimi', 'kimi-k3', '你现在能识别图片吗？请诚实回答：你是否有视觉能力（能真正看懂图片内容）？'],
    ['qwen', 'qwen3-vl-plus', '你现在能识别图片吗？请诚实回答：你是否有视觉能力（能真正看懂图片内容）？'],
    ['deepseek', 'deepseek-v4-flash', '你现在能识别图片吗？请诚实回答：你是否有视觉能力（能真正看懂图片内容）？'],
  ];
  for (const [provider, model, question] of tests) {
    const cfg = PROVIDERS[provider];
    if (!cfg || !keys[cfg.key]) { console.log(`[${model}] 无key`); continue; }
    const res = await request(cfg.host, cfg.path, keys[cfg.key], {
      model, messages: [{ role: 'user', content: question }], max_tokens: 300,
    });
    console.log(`[${model}]`);
    if (res.status === 200) {
      try {
        const ans = JSON.parse(res.body).choices[0].message.content || '';
        console.log('  自述:', ans.replace(/\n/g, ' ').slice(0, 300));
      } catch (e) { console.log('  解析失败:', res.body.slice(0, 150)); }
    } else {
      console.log('  状态', res.status, ':', res.body.slice(0, 150));
    }
    console.log('');
  }
})();
