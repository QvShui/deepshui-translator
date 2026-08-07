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

  // AI 状态
  let aiExplainRunning = false;  // 解释请求进行中
  let aiAskRunning = false;      // 问答请求进行中
  let askHistory = [];           // 问答多轮历史（不包含划线内容）
  let currentSelection = '';     // 当前划线文本
  let aiExplainTimer = null;     // 解释防抖
  let fullText = '';             // 当前 PDF 全文（AI 问答上下文）
  let pdfOpenCounter = 0;        // 防止并发总结
  let aiExplainShares = false;   // 解释是否并入问答上下文
  let explainPendingText = '';   // 当前解释对应的段落（并入历史用）
  let askCurrentAnswer = '';     // 本轮问答累积的回答（避免历史重复累积）

  // 确认框 DOM
  const confirmOverlay = document.getElementById('confirm-overlay');
  const btnConfirmCancel = document.getElementById('confirm-cancel');
  const btnConfirmDiscard = document.getElementById('confirm-discard');
  const btnConfirmSave = document.getElementById('confirm-save');

  // AI DOM
  const aiExplain = document.getElementById('ai-explain');
  const aiExplainStatus = document.getElementById('ai-explain-status');
  const aiExplainContent = document.getElementById('ai-explain-content');
  const aiAsk = document.getElementById('ai-ask');
  const aiAskStatus = document.getElementById('ai-ask-status');
  const aiAskContent = document.getElementById('ai-ask-content');
  const aiAskBox = document.getElementById('ai-ask-box');
  const aiAskSend = document.getElementById('ai-ask-send');
  const aiAskClear = document.getElementById('ai-ask-clear');
  const aiAskReset = document.getElementById('ai-ask-reset');
  const fulltextProgress = document.getElementById('fulltext-progress');
  const fulltextProgressBar = document.getElementById('fulltext-progress-bar');
  const fulltextProgressText = document.getElementById('fulltext-progress-text');

  // 设置面板 AI DOM
  const setAiProvider = document.getElementById('set-ai-provider');
  const setAiKey = document.getElementById('set-ai-key');
  const setAiModel = document.getElementById('set-ai-model');
  const btnAiRefresh = document.getElementById('btn-ai-refresh');
  const setAiDeepThink = document.getElementById('set-ai-deepthink');
  const setAiExplain = document.getElementById('set-ai-explain');
  const setAiAsk = document.getElementById('set-ai-ask');
  const setAiIsolate = document.getElementById('set-ai-isolate');
  const aiSettingsStatus = document.getElementById('ai-settings-status');
  const btnAiTest = document.getElementById('btn-ai-test');
  const btnSettingsSaveAi = document.getElementById('btn-settings-save-ai');

  // 设置 tabs
  const settingsTabs = document.querySelectorAll('.settings-tab');
  const engineTab = document.getElementById('engine-tab');
  const aiTab = document.getElementById('ai-tab');

  // ── AI 事件监听（主进程流式推送）─────────
  window.deepshui.onAiEvent(({ requestId, kind, type, text, seconds, usage, message }) => {
    if (kind === 'explain') handleExplainEvent(type, text, seconds, usage, message);
    else if (kind === 'ask') handleAskEvent(type, text, seconds, usage, message);
    else if (kind === 'test') handleTestEvent(type, text, message);
  });

  // AI 测试事件（独立于解释区）
  let testAnswer = '';
  function handleTestEvent(type, text, message) {
    switch (type) {
      case 'content':
        testAnswer += text;
        break;
      case 'done':
      case 'end':
        aiSettingsStatus.textContent = `✅ 连接成功: ${testAnswer || '正常'}`;
        aiSettingsStatus.className = 'ok';
        testAnswer = '';
        break;
      case 'error':
        aiSettingsStatus.textContent = `❌ 连接失败: ${message}`;
        aiSettingsStatus.className = 'err';
        testAnswer = '';
        break;
    }
  }

  // ── AI 解释 ───────────────────────────────
  function handleExplainEvent(type, text, seconds, usage, message) {
    switch (type) {
      case 'think-start':
        aiExplainStatus.textContent = '正在思考...';
        aiExplainStatus.className = 'ai-status thinking';
        break;
      case 'think-done':
        aiExplainStatus.textContent = `已思考（用时 ${seconds}s）`;
        aiExplainStatus.className = 'ai-status';
        break;
      case 'content':
        aiExplainContent.textContent += text;
        break;
      case 'done':
      case 'end':
        if (aiExplainStatus.textContent === '正在思考...') {
          aiExplainStatus.textContent = '已思考';
        }
        aiExplainRunning = false;
        aiExplainStatus.className = 'ai-status';
        // 不隔离模式：解释结果并入问答历史（上下文连续）
        if (aiExplainShares && explainPendingText) {
          askHistory.push({ role: 'user', content: '（划词解释）' + explainPendingText });
          askHistory.push({ role: 'assistant', content: aiExplainContent.textContent });
          aiExplainShares = false;
          explainPendingText = '';
        }
        break;
      case 'error':
        aiExplainRunning = false;
        aiExplainStatus.textContent = '';
        aiExplainStatus.className = 'ai-status';
        aiExplainContent.textContent = '⚠️ ' + message;
        break;
    }
  }

  // 发起 AI 解释（默认隔离；关闭隔离时并入问答上下文）
  async function startExplain(text) {
    if (aiExplainRunning) return;
    aiExplainRunning = true;
    explainPendingText = text;
    aiExplainContent.textContent = '';
    aiExplainStatus.textContent = '';
    aiExplainStatus.className = 'ai-status';
    aiExplain.classList.remove('hidden');

    const ai = currentConfig.ai || {};
    let messages;
    if (ai.isolateContext === false) {
      // 不隔离：解释放到问答上下文中运行（全文 + 问答历史 + 划线段落）
      aiExplainShares = true;
      messages = [];
      if (fullText) {
        messages.push({ role: 'system', content: '以下是用户打开的 PDF 全文，回答问题时请基于这篇文章：\n\n' + fullText });
      }
      messages.push({ role: 'system', content: '你是一个乐于助人的 AI 助手，请用中文回答。' });
      messages.push(...askHistory);
      messages.push({ role: 'user', content: '请用中文解释下面这段论文文本，包括核心意思、关键术语的含义、必要的背景知识：\n\n' + text });
    } else {
      // 隔离（默认）：独立会话，只带划线段落
      messages = [
        { role: 'system', content: '你是一个学术论文阅读助手。用户会划选一段论文文本，请用中文解释这段内容，包括：核心意思、关键术语的含义、必要的背景知识。回答要简洁清晰。' },
        { role: 'user', content: text },
      ];
    }
    await window.deepshui.aiChat('explain', messages, 'explain');
  }

  // 打断 AI 解释（划线变化时调用）
  function cancelExplain() {
    if (aiExplainRunning) {
      window.deepshui.aiCancel('explain');
      aiExplainRunning = false;
      aiExplainStatus.textContent = '';
      aiExplainStatus.className = 'ai-status';
    }
  }

  // AI 问答
  function handleAskEvent(type, text, seconds, usage, message) {
    switch (type) {
      case 'think-start':
        aiAskStatus.textContent = '正在思考...';
        aiAskStatus.className = 'ai-status thinking';
        break;
      case 'think-done':
        aiAskStatus.textContent = `已思考（用时 ${seconds}s）`;
        aiAskStatus.className = 'ai-status';
        break;
      case 'content':
        aiAskContent.textContent += text;
        askCurrentAnswer += text;
        break;
      case 'done':
      case 'end':
        if (aiAskStatus.textContent === '正在思考...') {
          aiAskStatus.textContent = '已思考';
        }
        aiAskRunning = false;
        aiAskStatus.className = 'ai-status';
        aiAskSend.disabled = false;
        aiAskBox.disabled = false;
        // 只保存本轮回答到历史（修复历史重复累积）
        askHistory.push({ role: 'assistant', content: askCurrentAnswer });
        askCurrentAnswer = '';
        break;
      case 'error':
        aiAskRunning = false;
        aiAskStatus.textContent = '';
        aiAskStatus.className = 'ai-status';
        aiAskSend.disabled = false;
        aiAskBox.disabled = false;
        if (message !== '已取消') {
          aiAskContent.textContent += '\n⚠️ ' + message;
        }
        break;
    }
  }

  async function sendAsk(predefinedText, isInitial) {
    const q = (predefinedText !== undefined ? predefinedText : aiAskBox.value.trim());
    if (!q || aiAskRunning) return;
    aiAskRunning = true;
    aiAskSend.disabled = true;
    aiAskBox.disabled = true;

    // 追加用户问题（初始总结消息也算历史第一条）
    askHistory.push({ role: 'user', content: q });
    askCurrentAnswer = '';
    aiAskContent.textContent += isInitial
      ? '\n\n**AI 总结**: '
      : `\n\n**你**: ${q}\n\n**AI**: `;
    aiAskBox.value = '';
    aiAskStatus.textContent = '';

    // 消息结构（全文固定在最前，前缀稳定 → 命中 prompt 缓存）:
    // [system: 全文] [system: 助手设定] [user: 总结指令/提问] [assistant: 回答] ...
    const messages = [];
    if (fullText) {
      messages.push({ role: 'system', content: '以下是用户打开的 PDF 全文，回答问题时请基于这篇文章：\n\n' + fullText });
    }
    messages.push({ role: 'system', content: '你是一个乐于助人的 AI 助手，请用中文回答用户的问题。' });
    messages.push(...askHistory);

    await window.deepshui.aiChat('ask', messages, 'ask');
  }

  // 打断问答（新提问时替换旧回答）
  function cancelAsk() {
    if (aiAskRunning) {
      window.deepshui.aiCancel('ask');
      aiAskRunning = false;
      aiAskStatus.textContent = '';
      aiAskStatus.className = 'ai-status';
      aiAskSend.disabled = false;
      aiAskBox.disabled = false;
    }
  }

  // ── AI 设置面板 ───────────────────────────
  function applyAiVisibility() {
    const ai = currentConfig.ai || {};
    if (ai.showExplain) aiExplain.classList.remove('hidden');
    else { aiExplain.classList.add('hidden'); cancelExplain(); }
    if (ai.showAsk) aiAsk.classList.remove('hidden');
    else { aiAsk.classList.add('hidden'); cancelAsk(); }
  }

  // 回填 AI 设置表单
  function fillAiForm(ai) {
    setAiProvider.value = ai.provider || 'deepseek';
    setAiKey.value = ai.apiKey || '';
    setAiDeepThink.value = ai.deepThink || 'off';
    setAiExplain.value = ai.showExplain === false ? 'off' : 'on';
    setAiAsk.value = ai.showAsk === false ? 'off' : 'on';
    setAiIsolate.value = ai.isolateContext === false ? 'off' : 'on';
    // 模型下拉：有已保存模型则选中，否则空提示
    if (ai.model) {
      if (![...setAiModel.options].some(o => o.value === ai.model)) {
        const opt = document.createElement('option');
        opt.value = ai.model;
        opt.textContent = ai.model;
        setAiModel.appendChild(opt);
      }
      setAiModel.value = ai.model;
      setAiModel.disabled = false;
    } else {
      setAiModel.innerHTML = '<option value="">先输入 API Key 再点击刷新</option>';
      setAiModel.disabled = true;
    }
  }

  async function refreshAiModels() {
    const key = setAiKey.value.trim();
    if (!key) {
      aiSettingsStatus.textContent = '⚠️ 请先输入 API Key';
      aiSettingsStatus.className = 'err';
      return;
    }
    btnAiRefresh.disabled = true;
    aiSettingsStatus.textContent = '拉取模型列表...';
    aiSettingsStatus.className = '';
    const res = await window.deepshui.aiModels(setAiProvider.value, key);
    btnAiRefresh.disabled = false;
    if (res.ok && res.models && res.models.length) {
      setAiModel.innerHTML = '';
      for (const m of res.models) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        setAiModel.appendChild(opt);
      }
      setAiModel.disabled = false;
      aiSettingsStatus.textContent = `✅ 发现 ${res.models.length} 个模型，请选择`;
      aiSettingsStatus.className = 'ok';
    } else {
      setAiModel.innerHTML = '<option value="">拉取失败</option>';
      setAiModel.disabled = true;
      aiSettingsStatus.textContent = `❌ ${res.error || '拉取失败'}`;
      aiSettingsStatus.className = 'err';
    }
  }

  async function testAi() {
    const cfg = {
      ...currentConfig,
      ai: {
        ...currentConfig.ai,
        apiKey: setAiKey.value.trim(),
        model: setAiModel.value || '',
      },
    };
    if (!cfg.ai.apiKey) {
      aiSettingsStatus.textContent = '⚠️ 请先填写 API Key';
      aiSettingsStatus.className = 'err';
      return;
    }
    if (!cfg.ai.model) {
      aiSettingsStatus.textContent = '⚠️ 请先拉取并选择模型';
      aiSettingsStatus.className = 'err';
      return;
    }
    await window.deepshui.saveConfig(cfg);
    currentConfig = cfg;
    aiSettingsStatus.textContent = '测试中（需几秒）...';
    aiSettingsStatus.className = '';
    const res = await window.deepshui.aiChat('test', [
      { role: 'system', content: '你是一个乐于助人的 AI 助手。' },
      { role: 'user', content: '回复两个字：正常' },
    ], 'test');
    if (!res.ok) {
      aiSettingsStatus.textContent = `❌ ${res.error}`;
      aiSettingsStatus.className = 'err';
    } else {
      aiSettingsStatus.textContent = '测试中（需几秒）...';
      aiSettingsStatus.className = '';
    }
  }

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
    updateTranslatePlaceholder(targetLang.value);
    engineSelect.value = cfg.engine || 'youdao';
    setEngine.value = cfg.engine || 'youdao';
    setLang.value = cfg.targetLang || 'zh-CN';
    renderEngineFields(setEngine.value);

    // AI 配置回填
    fillAiForm(cfg.ai || {});
    applyAiVisibility();

    // 检查默认引擎凭证
    const cred = cfg[cfg.engine] || {};
    const def = ENGINE_FIELDS[cfg.engine] || [];
    const missing = def.some(f => !cred[f.key]);
    if (missing) {
      showError(`首次使用：请先在 ⚙️ 设置 中配置 翻译引擎 API 凭证`);
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
    await PdfViewer.loadPdf(bytes, res.name);
    // handlePdfOpened 由 PdfViewer.onPdfLoaded 统一触发（含拖拽路径）
  }

  // PDF 打开后：提取全文（带进度）→ 重置问答历史 → 自动总结（若 AI 可用）
  async function handlePdfOpened() {
    const myTurn = ++pdfOpenCounter;
    // 显示提取进度
    fulltextProgress.classList.remove('hidden');
    fulltextProgressBar.style.width = '0%';
    fulltextProgressText.textContent = '正在提取全文 0%';

    setTimeout(async () => {
      const text = await PdfViewer.extractFullText(({ current, total }) => {
        if (myTurn !== pdfOpenCounter) return;
        const pct = Math.round(current / total * 100);
        fulltextProgressBar.style.width = pct + '%';
        fulltextProgressText.textContent = `正在提取全文 ${current}/${total} (${pct}%)`;
      });
      if (myTurn !== pdfOpenCounter) return; // 已打开新 PDF，丢弃
      fullText = text;
      fulltextProgress.classList.add('hidden');

      // 重置问答历史（新文档新会话）
      askHistory = [];
      askCurrentAnswer = '';
      aiAskContent.textContent = '';
      aiAskStatus.textContent = '';

      if (!fullText.trim()) {
        aiAskContent.textContent = '⚠️ 该 PDF 无可提取文本（可能是扫描版），全文问答不可用';
        return;
      }

      // 自动总结（AI 已配置 + 问答显示开启）——全文只放 system，避免双重注入
      const ai = currentConfig.ai || {};
      if (ai.apiKey && ai.model && ai.showAsk) {
        aiAsk.classList.remove('hidden');
        sendAsk('请阅读并理解上面的文章，然后用中文总结这篇文章的核心内容，之后我会继续向你提问。', true);
      }
    }, 100);
  }

  // ── 划词翻译 + AI 解释联动 ───────────────
  function handleTextSelect(text) {
    if (text.length > 5000) text = text.substring(0, 5000);
    currentSelection = text;

    // 划线变化 → 立即打断旧解释
    if (aiExplainRunning) {
      cancelExplain();
    }

    // 目标语言为「不翻译」时跳过翻译流程
    const to = targetLang.value;
    if (to === 'none') {
      translatePlaceholder.classList.remove('hidden');
      translateResult.classList.add('hidden');
      translateLoading.classList.add('hidden');
      translateError.classList.add('hidden');
      updateTranslatePlaceholder('none');
    } else {
      showLoading();
      clearTimeout(translateTimer);
      translateTimer = setTimeout(async () => {
        const engine = engineSelect.value;
        const result = await window.deepshui.translate(text, 'auto', to, engine);

        if (result.ok) {
          showResult(text, result.text, result.engine);
        } else {
          showError(result.error);
        }
      }, 300);
    }

    // AI 解释（若开启且已配置 key）
    const ai = currentConfig.ai || {};
    if (ai.showExplain && ai.apiKey) {
      // 小防抖，避免连续划词频繁请求
      clearTimeout(aiExplainTimer);
      aiExplainTimer = setTimeout(() => {
        startExplain(text);
      }, 400);
    }
  }

  // 占位提示文案：随目标语言模式变化
  function updateTranslatePlaceholder(mode) {
    const p = translatePlaceholder.querySelector('p');
    if (p) {
      p.textContent = mode === 'none'
        ? '不翻译模式：划词仅进行 AI 解释（如已开启）'
        : '在 PDF 中选中文本，翻译结果会显示在这里';
    }
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

    // AI 字段回填
    fillAiForm(config.ai || {});

    settingsStatus.textContent = '';
    settingsStatus.className = '';
    aiSettingsStatus.textContent = '';
    aiSettingsStatus.className = '';
    settingsOverlay.classList.remove('hidden');
  }

  async function saveSettings() {
    // 翻译引擎保存：只更新翻译引擎相关字段，AI 配置原样保留（两者完全独立）
    const cfg = {
      ...currentConfig,   // 保留 AI 及其它所有字段
      engine: setEngine.value,
      targetLang: setLang.value,
      youdao: { ...currentConfig.youdao, ...(setEngine.value === 'youdao' ? collectCredentials('youdao') : {}) },
      baidu: { ...currentConfig.baidu, ...(setEngine.value === 'baidu' ? collectCredentials('baidu') : {}) },
      xunfei: { ...currentConfig.xunfei, ...(setEngine.value === 'xunfei' ? collectCredentials('xunfei') : {}) },
      deepl: { ...currentConfig.deepl, ...(setEngine.value === 'deepl' ? collectCredentials('deepl') : {}) },
      google: { ...currentConfig.google, ...(setEngine.value === 'google' ? collectCredentials('google') : {}) },
    };

    // 仅当「翻译引擎」tab 激活时才校验翻译引擎凭证；AI tab 保存不受翻译引擎凭证限制
    const engineTabActive = !engineTab.classList.contains('hidden');
    if (engineTabActive) {
      const def = ENGINE_FIELDS[cfg.engine] || [];
      const cred = cfg[cfg.engine] || {};
      const missing = def.filter(f => !cred[f.key]).map(f => f.label);
      if (missing.length > 0) {
        settingsStatus.textContent = `⚠️ 请填写 ${ENGINE_LABELS[cfg.engine]} 的: ${missing.join('、')}`;
        settingsStatus.className = 'err';
        return;
      }
    }

    await window.deepshui.saveConfig(cfg);
    currentConfig = cfg;
    // 同步侧边栏
    targetLang.value = cfg.targetLang;
    engineSelect.value = cfg.engine;
    settingsStatus.textContent = '✅ 配置已保存';
    settingsStatus.className = 'ok';
    applyAiVisibility();
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

    // 临时保存再测试，保证用新凭证（保留 AI 等其它配置）
    const cfg = {
      ...currentConfig,
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

  // 自动保存 AI 设置（表单改动即生效，无需手动保存）
  async function autoSaveAi() {
    const cfg = {
      ...currentConfig,
      ai: {
        provider: setAiProvider.value,
        apiKey: setAiKey.value.trim(),
        model: setAiModel.value || '',
        deepThink: setAiDeepThink.value,
        showExplain: setAiExplain.value === 'on',
        showAsk: setAiAsk.value === 'on',
        isolateContext: setAiIsolate.value !== 'off',
      },
    };
    await window.deepshui.saveConfig(cfg);
    currentConfig = cfg;
    applyAiVisibility();
  }

  // 保存全部设置（翻译引擎 + AI，用于「保存并退出」）
  async function fullSave() {
    const cfg = {
      ...currentConfig,
      engine: setEngine.value,
      targetLang: setLang.value,
      youdao: { ...currentConfig.youdao, ...(setEngine.value === 'youdao' ? collectCredentials('youdao') : {}) },
      baidu: { ...currentConfig.baidu, ...(setEngine.value === 'baidu' ? collectCredentials('baidu') : {}) },
      xunfei: { ...currentConfig.xunfei, ...(setEngine.value === 'xunfei' ? collectCredentials('xunfei') : {}) },
      deepl: { ...currentConfig.deepl, ...(setEngine.value === 'deepl' ? collectCredentials('deepl') : {}) },
      google: { ...currentConfig.google, ...(setEngine.value === 'google' ? collectCredentials('google') : {}) },
      ai: {
        provider: setAiProvider.value,
        apiKey: setAiKey.value.trim(),
        model: setAiModel.value || '',
        deepThink: setAiDeepThink.value,
        showExplain: setAiExplain.value === 'on',
        showAsk: setAiAsk.value === 'on',
        isolateContext: setAiIsolate.value !== 'off',
      },
    };
    await window.deepshui.saveConfig(cfg);
    currentConfig = cfg;
    targetLang.value = cfg.targetLang;
    engineSelect.value = cfg.engine;
    applyAiVisibility();
  }

  // 检测是否有未保存的更改（翻译引擎表单 + AI 表单 vs 已保存配置）
  function hasUnsavedChanges() {
    const ai = currentConfig.ai || {};
    // AI 表单（自动保存，通常无差异，但 key 未失焦时可能未保存）
    const aiChanged =
      setAiProvider.value !== (ai.provider || 'deepseek') ||
      setAiKey.value.trim() !== (ai.apiKey || '') ||
      setAiModel.value !== (ai.model || '') ||
      setAiDeepThink.value !== (ai.deepThink || 'off') ||
      (setAiExplain.value === 'on') !== (ai.showExplain !== false) ||
      (setAiAsk.value === 'on') !== (ai.showAsk !== false) ||
      (setAiIsolate.value !== 'off') !== (ai.isolateContext !== false);
    // 翻译引擎表单（手动保存）
    const engineChanged =
      setEngine.value !== (currentConfig.engine || 'youdao') ||
      setLang.value !== (currentConfig.targetLang || 'zh-CN');
    // 引擎凭证字段
    let credChanged = false;
    const fields = ENGINE_FIELDS[setEngine.value] || [];
    const savedCred = currentConfig[setEngine.value] || {};
    for (const f of fields) {
      const input = fieldInputs[setEngine.value]?.[f.key];
      if (input && input.value.trim() !== (savedCred[f.key] || '')) {
        credChanged = true;
        break;
      }
    }
    return aiChanged || engineChanged || credChanged;
  }

  // 关闭设置：有未保存更改时弹三选项确认
  function closeSettings() {
    if (hasUnsavedChanges()) {
      confirmOverlay.classList.remove('hidden');
      return;
    }
    settingsOverlay.classList.add('hidden');
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

  // 未保存确认框
  btnConfirmCancel.addEventListener('click', () => confirmOverlay.classList.add('hidden'));
  btnConfirmDiscard.addEventListener('click', () => {
    confirmOverlay.classList.add('hidden');
    settingsOverlay.classList.add('hidden');
  });
  btnConfirmSave.addEventListener('click', async () => {
    confirmOverlay.classList.add('hidden');
    await fullSave();
    settingsOverlay.classList.add('hidden');
  });

  // 设置面板 tabs 切换
  settingsTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      settingsTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      engineTab.classList.toggle('hidden', target !== 'engine-tab');
      aiTab.classList.toggle('hidden', target !== 'ai-tab');
    });
  });

  // AI 设置：刷新模型列表 / 测试 / AI 保存按钮
  btnAiRefresh.addEventListener('click', refreshAiModels);
  btnAiTest.addEventListener('click', testAi);
  btnSettingsSaveAi.addEventListener('click', async () => {
    await autoSaveAi();
    aiSettingsStatus.textContent = '✅ AI 配置已保存';
    aiSettingsStatus.className = 'ok';
  });

  // AI 表单改动即自动保存（深度思考/显示开关/模型/Key/提供商）
  [setAiProvider, setAiDeepThink, setAiExplain, setAiAsk].forEach(el => {
    el.addEventListener('change', autoSaveAi);
  });
  setAiModel.addEventListener('change', autoSaveAi);
  setAiKey.addEventListener('change', autoSaveAi); // 失焦时保存

  // AI 问答发送 / 清屏
  aiAskSend.addEventListener('click', () => sendAsk());
  aiAskBox.addEventListener('keydown', (e) => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAsk();
    }
  });

  // 输入框随内容自动增高（上限 120px）
  aiAskBox.addEventListener('input', () => {
    aiAskBox.style.height = 'auto';
    aiAskBox.style.height = Math.min(aiAskBox.scrollHeight, 120) + 'px';
  });

  // 清屏：仅清空显示内容，上下文（askHistory）保留
  aiAskClear.addEventListener('click', () => {
    aiAskContent.textContent = '';
    aiAskStatus.textContent = '';
    aiAskStatus.className = 'ai-status';
    // 重置输入框高度（BUG-14）
    aiAskBox.style.height = 'auto';
  });

  // 重置对话：清空历史并重新喂入全文让 AI 总结（应对历史无限增长）
  aiAskReset.addEventListener('click', async () => {
    cancelAsk();
    askHistory = [];
    askCurrentAnswer = '';
    aiAskContent.textContent = '';
    aiAskStatus.textContent = '';
    aiAskStatus.className = 'ai-status';
    aiAskBox.style.height = 'auto';
    aiAskBox.disabled = false;
    aiAskSend.disabled = false;

    const ai = currentConfig.ai || {};
    if (fullText && ai.apiKey && ai.model) {
      aiAskContent.textContent = '已重置对话，正在重新喂入全文...';
      // 重新喂全文：全文通过 system 注入（sendAsk 自动带上），只需发总结指令
      sendAsk('请阅读并理解上面的文章，然后用中文总结这篇文章的核心内容，之后我会继续向你提问。', true);
    } else if (fullText) {
      aiAskContent.textContent = '已重置对话。配置 AI 引擎后提问会自动带上全文。';
    } else {
      aiAskContent.textContent = '已重置对话。打开 PDF 后可进行全文问答。';
    }
  });

  // 设置面板切换引擎 → 动态表单
  setEngine.addEventListener('change', () => renderEngineFields(setEngine.value));

  // 侧边栏切换引擎 → 保存默认引擎
  engineSelect.addEventListener('change', async () => {
    const cfg = await window.deepshui.getConfig();
    cfg.engine = engineSelect.value;
    await window.deepshui.saveConfig(cfg);
    currentConfig = cfg;
  });

  // 侧边栏切换目标语言 → 立即保存 + 更新占位提示
  targetLang.addEventListener('change', async () => {
    updateTranslatePlaceholder(targetLang.value);
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
  PdfViewer.onPdfLoaded = handlePdfOpened;
  initConfig();

})();
