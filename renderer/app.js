/**
 * deepshui-translator - 渲染进程主逻辑
 * 划词翻译 + 设置面板 + 工具栏
 */

(() => {
  'use strict';

  // DOM 引用
  const btnOpen = document.getElementById('btn-open');
  const btnOpenPlaceholder = document.getElementById('btn-open-placeholder');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnGoto = document.getElementById('btn-goto');
  const pageInput = document.getElementById('page-input');
  const btnSettings = document.getElementById('btn-settings');
  const targetLang = document.getElementById('target-lang');

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
  const setAppkey = document.getElementById('set-appkey');
  const setSecret = document.getElementById('set-secret');
  const setApikey = document.getElementById('set-apikey');
  const setLang = document.getElementById('set-lang');

  // ── 状态 ─────────────────────────────────
  let currentConfig = {};
  let translateTimer = null; // 防抖

  // 应用已保存的目标语言到侧边栏，并检查凭证
  async function initConfig() {
    const cfg = await window.deepshui.getConfig();
    currentConfig = cfg;
    if (cfg.targetLang) targetLang.value = cfg.targetLang;
    if (!cfg.appKey || !cfg.appSecret) {
      showError('首次使用：请先在 ⚙️ 设置 中填写有道翻译 API 凭证（应用 ID 和应用秘钥）');
    }
  }

  // ── PDF 打开 ─────────────────────────────
  async function openPdfViaDialog() {
    const result = await window.deepshui.openPdfDialog();
    return result;
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
    if (text.length > 5000) {
      text = text.substring(0, 5000);
    }
    showLoading();

    // 防抖 300ms，避免连续触发
    clearTimeout(translateTimer);
    translateTimer = setTimeout(async () => {
      const to = targetLang.value;
      const result = await window.deepshui.translate(text, 'auto', to);

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
    resultEngine.textContent = engine === 'youdao' ? '有道翻译' : engine;
    translateResult.classList.remove('hidden');
  }

  function showError(msg) {
    translateLoading.classList.add('hidden');
    translateResult.classList.add('hidden');
    errorText.textContent = msg;
    translateError.classList.remove('hidden');
  }

  // 未配置凭证时，错误提示附上「去设置」入口
  initConfig();

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
    setAppkey.value = config.appKey || '';
    setSecret.value = config.appSecret || '';
    setApikey.value = config.apiKey || '';
    setLang.value = config.targetLang || 'zh-CHS';
    settingsStatus.textContent = '';
    settingsStatus.className = '';
    settingsOverlay.classList.remove('hidden');
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
  }

  async function saveSettings() {
    const cfg = {
      appKey: setAppkey.value.trim(),
      appSecret: setSecret.value.trim(),
      apiKey: setApikey.value.trim(),
      targetLang: setLang.value,
    };
    if (!cfg.appKey || !cfg.appSecret) {
      settingsStatus.textContent = '⚠️ 应用 ID 和应用秘钥必填';
      settingsStatus.className = 'err';
      return;
    }
    await window.deepshui.saveConfig(cfg);
    currentConfig = cfg;
    // 同步侧边栏目标语言
    targetLang.value = cfg.targetLang;
    settingsStatus.textContent = '✅ 配置已保存，保存在用户目录（不会打包进应用）';
    settingsStatus.className = 'ok';
  }

  async function testConnection() {
    const cfg = {
      appKey: setAppkey.value.trim(),
      appSecret: setSecret.value.trim(),
      apiKey: setApikey.value.trim(),
      targetLang: setLang.value,
    };
    if (!cfg.appKey || !cfg.appSecret) {
      settingsStatus.textContent = '⚠️ 请先填写应用 ID 和应用秘钥';
      settingsStatus.className = 'err';
      return;
    }
    settingsStatus.textContent = '测试中...';
    settingsStatus.className = '';
    // 临时保存后测试，避免测试用旧配置
    await window.deepshui.saveConfig(cfg);
    const testText = 'Hello, this is a test for machine translation.';
    const result = await window.deepshui.translate(testText, 'auto', 'zh-CHS');
    if (result.ok) {
      settingsStatus.textContent = `✅ 连接成功: ${result.text}`;
      settingsStatus.className = 'ok';
    } else {
      settingsStatus.textContent = `❌ 连接失败: ${result.error}`;
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

})();
