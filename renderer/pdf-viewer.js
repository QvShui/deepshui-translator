/**
 * deepshui-translator - PDF 阅读器模块
 * 基于 PDF.js，连续滚动 + 虚拟滚动按需渲染
 */

const PdfViewer = (() => {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs/pdf.worker.min.js';

  // 常量
  const MAX_CONCURRENT = 2;   // 并发渲染上限
  const RENDER_MARGIN = 800;  // 视口上下预渲染余量 (px)
  const RECYCLE_MARGIN = 2400; // 超出此距离回收页面 (px)
  const PAGE_GAP = 16;        // 页间间距 (px)
  const MAX_FIT_SCALE = 1.5;
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 4.0;

  let pdfDoc = null;
  let currentPage = 1;
  let scale = 1.0;
  let fitScale = 1.0;
  let zoomMode = 'fit';
  let fileName = '';
  let isLoading = false;

  // 虚拟滚动状态
  let pageHeights = [];        // 每页 CSS 高度
  let pageOffsets = [];        // 每页 top 偏移
  let totalHeight = 0;
  let spacer = null;           // 撑开滚动条的占位层
  const rendered = new Map();  // pageNum -> wrapper

  // 渲染队列（并发控制）
  let renderQueue = [];
  let activeRenders = 0;
  let scrollRaf = 0;           // 滚动节流

  const viewerEl = document.getElementById('pdf-viewer');
  const zoomLabel = document.getElementById('zoom-label');
  const pageInfo = document.getElementById('page-info');
  const pageInput = document.getElementById('page-input');
  const placeholderEl = document.getElementById('pdf-placeholder');
  const loadingProgress = document.getElementById('loading-progress');
  const placeholderText = document.getElementById('placeholder-text');

  let onTextSelect = null;

  // ── 加载 PDF ─────────────────────────────
  async function loadPdf(data, name) {
    if (isLoading) return;
    isLoading = true;
    try {
      pdfDoc = await pdfjsLib.getDocument({ data }).promise;
      fileName = name;
      document.title = `${name} - deepshui-translator`;

      placeholderEl.classList.remove('hidden');
      loadingProgress.classList.remove('hidden');
      placeholderText.textContent = '正在准备文档...';
      loadingProgress.textContent = '正在计算页面尺寸...';

      // 适应宽度基准（第一页）
      const page1 = await pdfDoc.getPage(1);
      const base = page1.getViewport({ scale: 1 });
      fitScale = Math.min((viewerEl.clientWidth - 32) / base.width, MAX_FIT_SCALE);
      scale = fitScale;
      zoomMode = 'fit';

      // 预计算所有页高度（轻量操作，不渲染）
      await computePageLayout();

      // 重建滚动骨架
      rebuildSpacer();
      rendered.clear();
      viewerEl.innerHTML = '';
      viewerEl.appendChild(spacer);
      currentPage = 1;

      // 渲染视口附近页面，渲染完第一页立刻显示
      placeholderEl.classList.add('hidden');
      loadingProgress.classList.add('hidden');
      updateToolbar();
      await renderVisiblePages(true);
    } catch (e) {
      console.error(e);
      alert('PDF 加载失败: ' + e.message);
    } finally {
      isLoading = false;
    }
  }

  // 预计算所有页面布局（getPage 轻量，不绘制 canvas）
  async function computePageLayout() {
    pageHeights = [];
    pageOffsets = [];
    let offset = 0;
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      if (p % 50 === 0 && loadingProgress) {
        loadingProgress.textContent = `正在计算页面尺寸 ${p} / ${pdfDoc.numPages}...`;
        await new Promise(r => setTimeout(r, 0)); // 让 UI 更新
      }
      const page = await pdfDoc.getPage(p);
      const vp = page.getViewport({ scale });
      const h = vp.height;
      pageHeights.push(h);
      pageOffsets.push(offset);
      offset += h + PAGE_GAP;
    }
    totalHeight = offset;
  }

  function rebuildSpacer() {
    spacer = document.createElement('div');
    spacer.id = 'pdf-spacer';
    spacer.style.position = 'relative';
    spacer.style.height = totalHeight + 'px';
    spacer.style.width = '100%';
  }

  // ── 按需渲染（虚拟滚动核心）──────────────
  async function renderVisiblePages(force) {
    if (!pdfDoc) return;
    const scrollTop = viewerEl.scrollTop;
    const viewBottom = scrollTop + viewerEl.clientHeight;
    const n = pdfDoc.numPages;

    for (let p = 1; p <= n; p++) {
      const top = pageOffsets[p - 1];
      const bottom = top + pageHeights[p - 1];
      const needRender = bottom > scrollTop - RENDER_MARGIN && top < viewBottom + RENDER_MARGIN;
      const farAway = bottom < scrollTop - RECYCLE_MARGIN || top > viewBottom + RECYCLE_MARGIN;

      if (needRender) {
        if (!rendered.has(p)) scheduleRender(p);
      } else if (farAway && rendered.has(p)) {
        disposePage(p);
      }
    }
  }

  function scheduleRender(pageNum) {
    if (rendered.has(pageNum) || renderQueue.includes(pageNum)) return;
    renderQueue.push(pageNum);
    pumpQueue();
  }

  function pumpQueue() {
    while (activeRenders < MAX_CONCURRENT && renderQueue.length) {
      const p = renderQueue.shift();
      activeRenders++;
      renderPage(p)
        .catch(e => console.error(`渲染第${p}页失败:`, e))
        .finally(() => { activeRenders--; pumpQueue(); });
    }
  }

  async function renderPage(pageNum) {
    if (rendered.has(pageNum)) return;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const top = pageOffsets[pageNum - 1];

    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.dataset.page = pageNum;
    wrapper.style.position = 'absolute';
    wrapper.style.top = top + 'px';
    wrapper.style.left = '50%';
    wrapper.style.transform = 'translateX(-50%)';
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    wrapper.appendChild(canvas);

    // 渲染前先挂载（异步期间用户可能已滚走）
    spacer.appendChild(wrapper);
    rendered.set(pageNum, wrapper);

    try {
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await page.render({ canvasContext: ctx, viewport }).promise;

      // 文本层：官方 renderTextLayer（自含 scaleX 行末校正、基线定位、旋转处理）
      const textContent = await page.getTextContent();
      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      // 官方依赖 --scale-factor CSS 变量做 calc() 定位
      textLayer.style.setProperty('--scale-factor', viewport.scale);
      wrapper.appendChild(textLayer);

      try {
        const task = pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport,
          isOffscreenCanvasSupported: !!window.OffscreenCanvas,
        });
        await task.promise;
      } catch (e) {
        console.error('文本层渲染失败:', e);
      }

      // 渲染期间用户滚远了 → 立即回收
      if (isFarFromView(pageNum)) disposePage(pageNum);
    } catch (e) {
      disposePage(pageNum);
      throw e;
    }
  }

  function isFarFromView(pageNum) {
    const scrollTop = viewerEl.scrollTop;
    const viewBottom = scrollTop + viewerEl.clientHeight;
    const top = pageOffsets[pageNum - 1];
    const bottom = top + pageHeights[pageNum - 1];
    return bottom < scrollTop - RECYCLE_MARGIN || top > viewBottom + RECYCLE_MARGIN;
  }

  // 回收页面（释放 canvas 内存）
  function disposePage(pageNum) {
    const wrapper = rendered.get(pageNum);
    if (wrapper) {
      wrapper.remove();
      rendered.delete(pageNum);
    }
  }

  // ── 缩放（fit / manual 双模式）───────────
  function zoomIn() {
    if (!pdfDoc || isLoading) return;
    zoomMode = 'manual';
    scale = Math.min(scale * 1.2, MAX_SCALE);
    reRender();
  }

  function zoomOut() {
    if (!pdfDoc || isLoading) return;
    zoomMode = 'manual';
    scale = Math.max(scale / 1.2, MIN_SCALE);
    reRender();
  }

  // 缩放后重建布局并渲染视口附近页面，保持阅读位置
  async function reRender() {
    const anchorPage = currentPage;
    // 锚点页面在当前视口内的相对位置
    const anchorTop = pageOffsets[anchorPage - 1];
    const anchorOffset = viewerEl.scrollTop - anchorTop;

    await computePageLayout();
    rebuildSpacer();
    rendered.clear();
    viewerEl.innerHTML = '';
    viewerEl.appendChild(spacer);

    // 恢复滚动位置（按锚点页偏移）
    const newTop = pageOffsets[anchorPage - 1] + anchorOffset;
    viewerEl.scrollTop = Math.max(0, newTop);

    updateToolbar();
    renderVisiblePages();
  }

  // 窗口尺寸变化：fit 模式下自适应
  let resizeTimer = null;
  function handleResize() {
    if (!pdfDoc || isLoading || zoomMode !== 'fit') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      const page1 = await pdfDoc.getPage(1);
      const base = page1.getViewport({ scale: 1 });
      const newFit = Math.min((viewerEl.clientWidth - 32) / base.width, MAX_FIT_SCALE);
      if (Math.abs(newFit - scale) > 0.01) {
        scale = newFit;
        reRender();
      }
    }, 200);
  }

  function updateToolbar() {
    if (!pdfDoc) return;
    zoomLabel.textContent = Math.round(scale * 100) + '%';
    pageInfo.textContent = `${currentPage} / ${pdfDoc.numPages}`;
  }

  // ── 跳页 ─────────────────────────────────
  async function gotoPage(n) {
    if (!pdfDoc) return;
    n = Math.max(1, Math.min(n, pdfDoc.numPages));
    currentPage = n;
    if (!rendered.has(n)) {
      // 优先渲染目标页
      await renderPage(n);
    }
    viewerEl.scrollTop = Math.max(0, pageOffsets[n - 1] - 10);
    updateToolbar();
    renderVisiblePages();
  }

  // 二分查找当前页
  function pageAtScrollTop(scrollTop) {
    let lo = 0, hi = pageOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pageOffsets[mid] <= scrollTop + 4) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  // 清洗选中文本：还原断词连字符、换行转空格、压缩空白
  function cleanSelectionText(raw) {
    return raw
      // 断词连字符: "frame-\nwork" → "framework"（PDF 长单词断行）
      .replace(/-\s*\r?\n\s*/g, '')
      // 普通换行 → 空格（PDF 换行是排版行为，不是断句）
      .replace(/\s*\r?\n\s*/g, ' ')
      // 压缩多余空白: 多空格/制表符 → 单空格
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  // ── 事件绑定 ─────────────────────────────
  function init() {
    // 滚轮缩放 (Ctrl+滚轮)
    viewerEl.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn(); else zoomOut();
      }
    }, { passive: false });

    // 滚动：更新页码 + 按需渲染（rAF 节流）
    viewerEl.addEventListener('scroll', () => {
      if (!pdfDoc || isLoading) return;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        currentPage = pageAtScrollTop(viewerEl.scrollTop);
        pageInfo.textContent = `${currentPage} / ${pdfDoc.numPages}`;
        renderVisiblePages();
      });
    });

    // 划词翻译：事件委托到容器
    viewerEl.addEventListener('mouseup', () => {
      if (!pdfDoc) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = cleanSelectionText(sel.toString());
      if (text && onTextSelect) onTextSelect(text);
    });

    // 窗口 resize：fit 模式自适应
    window.addEventListener('resize', handleResize);

    // 文件拖入
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length === 0) return;
      const file = files[0];
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('请拖入 PDF 文件');
        return;
      }
      const buf = await file.arrayBuffer();
      loadPdf(new Uint8Array(buf), file.name);
    });
  }

  // 提取全文（用于 AI 全文问答上下文）
  async function extractFullText() {
    if (!pdfDoc) return '';
    let full = '';
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const tc = await page.getTextContent();
      full += tc.items.map(i => i.str).join('') + '\n';
      // 每 50 页让出一次，避免卡 UI
      if (p % 50 === 0) await new Promise(r => setTimeout(r, 0));
    }
    // 清洗断词连字符: "frame-\nwork" → "framework"
    return full.replace(/-\n/g, '');
  }

  // ── 对外接口 ─────────────────────────────
  return {
    init,
    loadPdf,
    zoomIn,
    zoomOut,
    gotoPage,
    extractFullText,
    get currentPage() { return currentPage; },
    get pageCount() { return pdfDoc ? pdfDoc.numPages : 0; },
    set onTextSelect(fn) { onTextSelect = fn; },
  };
})();
