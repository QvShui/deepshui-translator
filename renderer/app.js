/**
 * deepshui-translator - 渲染进程主逻辑
 * 划词翻译 + 多引擎设置面板 + 工具栏
 */

(() => {
  'use strict';

  // 引擎凭证字段定义（设置面板动态表单）
  const ENGINE_FIELDS = {
    youdao: [
      { key: 'appKey', label: '应用 ID', type: 'text', placeholder: '应用 ID' },
      { key: 'appSecret', label: '应用密钥', type: 'password', placeholder: '应用密钥' },
    ],
    baidu: [
      { key: 'appid', label: 'appid', type: 'text', placeholder: 'appid' },
      { key: 'secretKey', label: '密钥', type: 'password', placeholder: '密钥' },
    ],
    xunfei: [
      { key: 'appid', label: 'appid', type: 'text', placeholder: 'appid' },
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'API Key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'API Secret' },
    ],
    deepl: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'DeepL API Key (免费版以 :fx 结尾)' },
    ],
    google: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Google Cloud API Key' },
    ],
  };

  const ENGINE_HELP = {
    youdao: '注册: https://ai.youdao.com/',
    baidu: '注册: https://fanyi-api.baidu.com/',
    xunfei: '注册: https://www.xfyun.cn/services/its',
    deepl: '注册: https://www.deepl.com/pro-api (免费版 key 以 :fx 结尾)',
    google: '注册: https://cloud.google.com/translate (启用 Cloud Translation API 并创建 API Key)',
  };

  const ENGINE_LABELS = { youdao: '有道翻译', baidu: '百度翻译', xunfei: '讯飞翻译', deepl: 'DeepL', google: 'Google 翻译' };

  // DOM 引用
  const btnOpen = document.getElementById('btn-open');
  const btnOpenPlaceholder = document.getElementById('btn-open-placeholder');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnGoto = document.getElementById('btn-goto');
  const pageInput = document.getElementById('page-input');
  const btnSettings = document.getElementById('btn-settings');
  const targetLang = document.getElementById('target-lang');
  const engineSelect = document.getElementById('engine-select');

  // 侧边栏
  const translatePlaceholder = document.getElementById('translate-placeholder');
  const translateResult = document.getElementById('translate-result');
  const translateLoading = document.getElementById('translate-loading');
  const translateError = document.getElementById('translate-error');
  const errorText = document.getElementById('error-text');
  const resultSource = document.getElementById('result-source');
  const resultTarget = document.getElementById('result-target');
  const resultEngine = document.getElementById('result-engine');
  const btnCopy = document.getElementById('btn-copy');

  // 设置面板
  const settingsOverlay = document.getElementById('settings-overlay');
  const btnSettingsClose = document.getElementById('btn-settings-close');
  const btnSettingsSave = document.getElementById('btn-settings-save');
  const btnSettingsTest = document.getElementById('btn-settings-test');
  const settingsStatus = document.getElementById('settings-status');
  const setEngine = document.getElementById('set-engine');
  const setLang = document.getElementById('set-lang');
  const engineFields = document.getElementById('engine-fields');
  const engineHelp = document.getElementById('engine-help');

  // ── 状态 ─────────────────────────────────
  let currentConfig = {};
  let translateTimer = null; // 防抖
  const fieldInputs = {};    // engine -> { key: inputEl }

  // ── 设置面板：动态凭证表单 ───────────────
  function renderEngineFields(engine) {
    engineFields.innerHTML = '';
    const fields = ENGINE_FIELDS[engine] || [];
    fieldInputs[engine] = {};

    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'form-row';

      const label = document.createElement('label');
      label.textContent = f.label;

      const input = document.createElement('input');
      input.type = f.type;
      input.placeholder = f.placeholder;
      input.dataset.key = f.key;

      row.appendChild(label);
      row.appendChild(input);
      engineFields.appendChild(row);
      fieldInputs[engine][f.key] = input;
    }

    // 回填已保存的凭证
    const cred = currentConfig[engine] || {};
    for (const [key, input] of Object.entries(fieldInputs[engine])) {
      input.value = cred[key] || '';
    }

    engineHelp.textContent = '获取凭证: ' + (ENGINE_HELP[engine] || '');
  }

  function collectCredentials(engine) {
    const cred = {};
    const inputs = fieldInputs[engine] || {};
    for (const [key, input] of Object.entries(inputs)) {
      cred[key] = input.value.trim();
    }
    return cred;
  }

  // ── 启动初始化 ───────────────────────────
  async function initConfig() {
    const cfg = await window.deepshui.getConfig();
    currentConfig = cfg;
    targetLang.value = cfg.targetLang || 'zh-CN';
    engineSelect.value = cfg.engine || 'youdao';
    setEngine.value = cfg.engine || 'youdao';
    setLang.value = cfg.targetLang || 'zh-CN';
    renderEngineFields(setEngine.value);

    // 检查默认引擎凭证
    const cred = cfg[cfg.engine] || {};
    const def = ENGINE_FIELDS[cfg.engine] || [];
    const missing = def.some(f => !cred[f.key]);
    if (missing) {
      showError(`首次使用：请先在 ⚙️ 设置 中配置 ${ENGINE_LABELS[cfg.engine] || cfg.engine} 的 API 凭证`);
    }
  }

  // ── PDF 打开 ─────────────────────────────
  async function openPdfViaDialog() {
    return window.deepshui.openPdfDialog();
  }

  async function openPdfFile(filePath) {
    const res = await window.deepshui.readFile(filePath);
    if (!res.ok) {
      alert('读取文件失败: ' + res.error);
      return;
    }
    const bytes = Uint8Array.from(atob(res.data), c => c.charCodeAt(0));
    PdfViewer.loadPdf(bytes, res.name);
  }

  // ── 划词翻译 ─────────────────────────────
  function handleTextSelect(text) {
    if (text.length > 5000) text = text.substring(0, 5000);
    showLoading();

    clearTimeout(translateTimer);
    translateTimer = setTimeout(async () => {
      const to = targetLang.value;
      const engine = engineSelect.value;
      const result = await window.deepshui.translate(text, 'auto', to, engine);

      if (result.ok) {
        showResult(text, result.text, result.engine);
      } else {
        showError(result.error);
      }
    }, 300);
  }

  function showLoading() {
    translatePlaceholder.classList.add('hidden');
    translateResult.classList.add('hidden');
    translateError.classList.add('hidden');
    translateLoading.classList.remove('hidden');
  }

  function showResult(source, target, engine) {
    translateLoading.classList.add('hidden');
    translateError.classList.add('hidden');
    resultSource.textContent = source;
    resultTarget.textContent = target;
    resultEngine.textContent = (ENGINE_LABELS[engine] || engine) + (engine !== currentConfig.engine ? '' : '');
    translateResult.classList.remove('hidden');
  }

  function showError(msg) {
    translateLoading.classList.add('hidden');
    translateResult.classList.add('hidden');
    errorText.textContent = msg;
    translateError.classList.remove('hidden');
  }

  // ── 复制 ─────────────────────────────────
  function copyResult() {
    const text = resultTarget.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      btnCopy.textContent = '✓ 已复制';
      setTimeout(() => { btnCopy.textContent = '📋'; }, 1500);
    });
  }

  // ── 设置面板 ─────────────────────────────
  async function openSettings() {
    const config = await window.deepshui.getConfig();
    currentConfig = config;
    setEngine.value = config.engine || 'youdao';
    setLang.value = config.targetLang || 'zh-CN';
    renderEngineFields(setEngine.value);
    settingsStatus.textContent = '';
    settingsStatus.className = '';
    settingsOverlay.classList.remove('hidden');
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
  }

  async function saveSettings() {
    // 收集当前引擎凭证，保留其他引擎已保存的
    const cfg = {
      engine: setEngine.value,
      targetLang: setLang.value,
      youdao: { ...currentConfig.youdao, ...(setEngine.value === 'youdao' ? collectCredentials('youdao') : {}) },
      baidu: { ...currentConfig.baidu, ...(setEngine.value === 'baidu' ? collectCredentials('baidu') : {}) },
      xunfei: { ...currentConfig.xunfei, ...(setEngine.value === 'xunfei' ? collectCredentials('xunfei') : {}) },
      deepl: { ...currentConfig.deepl, ...(setEngine.value === 'deepl' ? collectCredentials('deepl') : {}) },
      google: { ...currentConfig.google, ...(setEngine.value === 'google' ? collectCredentials('google') : {}) },
    };

    // 校验当前引擎凭证
    const def = ENGINE_FIELDS[cfg.engine] || [];
    const cred = cfg[cfg.engine] || {};
    const missing = def.filter(f => !cred[f.key]).map(f => f.label);
    if (missing.length > 0) {
      settingsStatus.textContent = `⚠️ 请填写 ${ENGINE_LABELS[cfg.engine]} 的: ${missing.join('、')}`;
      settingsStatus.className = 'err';
      return;
    }

    await window.deepshui.saveConfig(cfg);
    currentConfig = cfg;
    // 同步侧边栏
    targetLang.value = cfg.targetLang;
    engineSelect.value = cfg.engine;
    settingsStatus.textContent = '✅ 配置已保存（凭证仅存本机用户目录）';
    settingsStatus.className = 'ok';
  }

  async function testConnection() {
    const engine = setEngine.value;
    const cred = collectCredentials(engine);
    const def = ENGINE_FIELDS[engine] || [];
    const missing = def.filter(f => !cred[f.key]).map(f => f.label);
    if (missing.length > 0) {
      settingsStatus.textContent = `⚠️ 请先填写 ${ENGINE_LABELS[engine]} 的: ${missing.join('、')}`;
      settingsStatus.className = 'err';
      return;
    }

    // 临时保存再测试，保证用新凭证
    const cfg = {
      engine: setEngine.value,
      targetLang: setLang.value,
      youdao: { ...currentConfig.youdao },
      baidu: { ...currentConfig.baidu },
      xunfei: { ...currentConfig.xunfei },
      deepl: { ...currentConfig.deepl },
      google: { ...currentConfig.google },
    };
    cfg[engine] = cred;
    await window.deepshui.saveConfig(cfg);

    settingsStatus.textContent = '测试中...';
    settingsStatus.className = '';
    const testText = 'Hello, this is a test for machine translation.';
    const result = await window.deepshui.translate(testText, 'auto', 'zh-CN', engine);
    if (result.ok) {
      settingsStatus.textContent = `✅ ${ENGINE_LABELS[engine]} 连接成功: ${result.text}`;
      settingsStatus.className = 'ok';
    } else {
      settingsStatus.textContent = `❌ ${ENGINE_LABELS[engine]} 连接失败: ${result.error}`;
      settingsStatus.className = 'err';
    }
  }

  // ── 事件绑定 ─────────────────────────────
  btnOpen.addEventListener('click', openPdfViaDialog);
  btnOpenPlaceholder.addEventListener('click', openPdfViaDialog);
  btnZoomIn.addEventListener('click', () => PdfViewer.zoomIn());
  btnZoomOut.addEventListener('click', () => PdfViewer.zoomOut());

  btnGoto.addEventListener('click', () => {
    const n = parseInt(pageInput.value);
    if (!isNaN(n)) PdfViewer.gotoPage(n);
  });

  pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const n = parseInt(pageInput.value);
      if (!isNaN(n)) PdfViewer.gotoPage(n);
    }
  });

  btnSettings.addEventListener('click', openSettings);
  btnSettingsClose.addEventListener('click', closeSettings);
  btnSettingsSave.addEventListener('click', saveSettings);
  btnSettingsTest.addEventListener('click', testConnection);
  btnCopy.addEventListener('click', copyResult);

  // 设置面板切换引擎 → 动态表单
  setEngine.addEventListener('change', () => renderEngineFields(setEngine.value));

  // 侧边栏切换引擎 → 保存默认引擎
  engineSelect.addEventListener('change', async () => {
    const cfg = await window.deepshui.getConfig();
    cfg.engine = engineSelect.value;
    await window.deepshui.saveConfig(cfg);
    currentConfig = cfg;
  });

  // 侧边栏切换目标语言 → 立即保存
  targetLang.addEventListener('change', async () => {
    const cfg = await window.deepshui.getConfig();
    cfg.targetLang = targetLang.value;
    await window.deepshui.saveConfig(cfg);
    currentConfig = cfg;
  });

  // 快捷键 Ctrl+O
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
      e.preventDefault();
      openPdfViaDialog();
    }
  });

  // 主进程菜单触发打开
  window.deepshui.onOpenPdf((filePath) => {
    openPdfFile(filePath);
  });

  // Esc 关闭设置
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) {
      closeSettings();
    }
  });

  // ── 初始化 ───────────────────────────────
  PdfViewer.init();
  PdfViewer.onTextSelect = handleTextSelect;
  initConfig();

})();
