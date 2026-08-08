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
  let onPdfLoaded = null;

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

      // 通知外部（拖拽/对话框打开都触发）
      if (onPdfLoaded) onPdfLoaded(fileName);
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

      // 选图模式: 新渲染的页面自动绘制图片热区
      if (imageSelectActive && !isFarFromView(pageNum)) {
        drawImageHotspots(wrapper, pageNum);
      }
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

  // ── 图片区域检测（选图模式用）──────────────────
  // 扫描一页的 operator list，追踪 transform 矩阵栈（save/transform/restore），
  // 对每个 paintImageXObject（args=[name,w,h]，图片自身尺寸）计算其在页面坐标系中的 bbox。
  // 返回 [{x, y, w, h}]，坐标单位为页面点（PDF 坐标，原点左下，y 向上）。
  async function detectPageImages(pageNum) {
    if (!pdfDoc) return [];
    const page = await pdfDoc.getPage(pageNum);
    const opList = await page.getOperatorList();
    const { fnArray, argsArray } = opList;
    const OPS = pdfjsLib.OPS;
    const images = [];

    // CTM 栈（数组表示矩阵 [a,b,c,d,e,f]，即 PDF 的当前变换矩阵）
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];

    // 矩阵乘法: 返回 a·b（PDF 变换为后乘）
    function mul(a, b) {
      return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
      ];
    }

    // 用 CTM 变换一个点 [x,y] → [x',y']
    function apply(m, x, y) {
      return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }

    // 计算矩形的变换后 bbox（4 个角点取 min/max）
    function rectBBox(m, w, h) {
      const pts = [
        apply(m, 0, 0), apply(m, w, 0),
        apply(m, 0, h), apply(m, w, h),
      ];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const args = argsArray[i] || [];
      if (fn === OPS.save) {
        stack.push(ctm);
      } else if (fn === OPS.restore) {
        ctm = stack.pop() || ctm;
      } else if (fn === OPS.transform) {
        ctm = mul(ctm, args);
      } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) {
        // 关键：PDF.js canvas 后端用 ctx.scale(1/width, -1/height) 绘制，
        // 图片实际占单位矩形 (0,0)-(1,1)，再经 CTM 变换到页面坐标。
        // 因此 bbox = CTM 变换单位矩形，与图片像素尺寸无关。
        images.push(rectBBox(ctm, 1, 1));
      }
    }

    // 过滤过小区域（图标/装饰线）并去重重叠
    const filtered = images.filter(b => b.w >= 8 && b.h >= 8);
    // 合并几乎重叠的（同一图片被多次 paint 或相邻碎片）
    const merged = [];
    for (const b of filtered) {
      let hit = null;
      for (const m of merged) {
        const overlapX = Math.min(b.x + b.w, m.x + m.w) - Math.max(b.x, m.x);
        const overlapY = Math.min(b.y + b.h, m.y + m.h) - Math.max(b.y, m.y);
        if (overlapX > Math.min(b.w, m.w) * 0.6 && overlapY > Math.min(b.h, m.h) * 0.6) {
          hit = m;
          break;
        }
      }
      if (hit) {
        // 扩展合并区域
        hit.x = Math.min(hit.x, b.x);
        hit.y = Math.min(hit.y, b.y);
        hit.w = Math.max(hit.x + hit.w, b.x + b.w) - hit.x;
        hit.h = Math.max(hit.y + hit.h, b.y + b.h) - hit.y;
      } else {
        merged.push({ ...b });
      }
    }
    return merged;
  }

  // ── 区域渲染成 PNG ─────────────────────────
  // 渲染页面上指定 bbox（页面点坐标）为 PNG dataURL，
  // 用 viewport transform 平移裁剪区域。scale 控制清晰度（默认 2，即 2x DPR）。
  async function renderRegionToPng(pageNum, bbox, renderScale = 2) {
    if (!pdfDoc) return null;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const outW = Math.max(1, Math.round(bbox.w * renderScale));
    const outH = Math.max(1, Math.round(bbox.h * renderScale));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    // 渲染顺序: ctx.transform(用户T) → ctx.transform(viewportT)，组合 = 用户T ∘ viewportT。
    // viewportT(scale=1) = [1,0,0,-1,0,H]，把页面坐标(y向上)翻转为 canvas 坐标(y向下)。
    // 用户T = [rs,0,0,rs, -bx*rs, (by+bh-H)*rs]：bbox 顶部(y=by+bh)映射到 canvas y=0。
    const transform = [
      renderScale, 0, 0, renderScale,
      -bbox.x * renderScale,
      (bbox.y + bbox.h - viewport.height) * renderScale,
    ];
    await page.render({ canvasContext: ctx, viewport, transform }).promise;
    return canvas.toDataURL('image/png');
  }

  // ── 整页渲染成 PNG（多模态总结用）──────────
  // 把整页渲染为 PNG dataURL，可选标注页码。scale 控制清晰度（默认 1.5）。
  async function renderPageToPng(pageNum, renderScale = 1.5) {
    if (!pdfDoc) return null;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  }

  // ── 选图模式（点击 PDF 中图片上传）──────────
  let imageSelectActive = false;
  let imageSelectCallback = null;

  // 页面坐标(scale=1, y向上) → wrapper CSS 坐标(y向下)
  function pageToCss(bbox, pageHeight1, cssScale) {
    return {
      left: bbox.x * cssScale,
      top: (pageHeight1 - bbox.y - bbox.h) * cssScale,
      width: bbox.w * cssScale,
      height: bbox.h * cssScale,
    };
  }

  // 在指定页面 wrapper 上绘制图片热区
  async function drawImageHotspots(wrapper, pageNum) {
    if (!imageSelectActive) return;
    wrapper.querySelectorAll('.image-hotspot').forEach(el => el.remove());
    let boxes;
    try {
      boxes = await detectPageImages(pageNum);
    } catch (e) {
      console.error('检测图片区域失败:', e);
      return;
    }
    const page = await pdfDoc.getPage(pageNum);
    const pageHeight1 = page.getViewport({ scale: 1 }).height;
    const cssScale = scale;
    for (const bbox of boxes) {
      const pos = pageToCss(bbox, pageHeight1, cssScale);
      const el = document.createElement('div');
      el.className = 'image-hotspot';
      el.style.left = pos.left + 'px';
      el.style.top = pos.top + 'px';
      el.style.width = pos.width + 'px';
      el.style.height = pos.height + 'px';
      el.title = '点击上传此图片';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (imageSelectCallback) imageSelectCallback(pageNum, bbox);
      });
      wrapper.appendChild(el);
    }
  }

  // 进入选图模式: 对已渲染页面绘制热区; 新渲染页面也会自动绘制
  function enterImageSelectMode(callback) {
    imageSelectActive = true;
    imageSelectCallback = callback;
    for (const [pageNum, wrapper] of rendered) {
      if (isFarFromView(pageNum)) continue;
      drawImageHotspots(wrapper, pageNum);
    }
  }

  // 退出选图模式: 移除所有热区
  function exitImageSelectMode() {
    imageSelectActive = false;
    imageSelectCallback = null;
    viewerEl.querySelectorAll('.image-hotspot').forEach(el => el.remove());
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

    // 划词翻译：事件委托到容器（选图模式时禁用，避免与热区点击冲突）
    viewerEl.addEventListener('mouseup', () => {
      if (!pdfDoc || imageSelectActive) return;
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

  // 提取全文（用于 AI 全文问答上下文），onProgress({current,total}) 每 10 页回调
  // 支持页数范围: { start, end }（1-based，含两端）
  async function extractFullText(onProgress, range) {
    if (!pdfDoc) return '';
    const start = (range && range.start) || 1;
    const end = (range && range.end) || pdfDoc.numPages;
    const total = end - start + 1;
    let full = '';
    let count = 0;
    for (let p = start; p <= end; p++) {
      const page = await pdfDoc.getPage(p);
      const tc = await page.getTextContent();
      full += tc.items.map(i => i.str).join('') + '\n';
      count++;
      // 进度回调 + 让出主线程
      if (count % 10 === 0) {
        if (onProgress) onProgress({ current: count, total });
        await new Promise(r => setTimeout(r, 0));
      }
    }
    if (onProgress) onProgress({ current: total, total });
    // 清洗断词连字符: "frame-\nwork" → "framework"
    return full.replace(/-\n/g, '');
  }

  // ── 多页拼网格图（多模态总结用）───────────
  // 把多个页面按 cols 列拼成一张网格 PNG（每格带页码角标），
  // 减少请求中的图片数量。返回 dataURL。
  async function renderPagesToGrid(pageNums, cols = 2, renderScale = 1.2) {
    if (!pdfDoc || pageNums.length === 0) return null;
    const pages = [];
    for (const p of pageNums) {
      pages.push({ page: await pdfDoc.getPage(p), num: p });
    }
    // 以最大页尺寸为格基准（论文页通常同尺寸）
    let cellW = 0, cellH = 0;
    const vps = pages.map(({ page }) => page.getViewport({ scale: renderScale }));
    for (const vp of vps) {
      cellW = Math.max(cellW, vp.width);
      cellH = Math.max(cellH, vp.height);
    }
    cellW = Math.floor(cellW);
    cellH = Math.floor(cellH);
    const rows = Math.ceil(pages.length / cols);
    const gap = 8; // 格间距 px
    const canvas = document.createElement('canvas');
    canvas.width = cellW * cols + gap * (cols + 1);
    canvas.height = cellH * rows + gap * (rows + 1);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < pages.length; i++) {
      const { page, num } = pages[i];
      const vp = vps[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gap + col * (cellW + gap);
      const y = gap + row * (cellH + gap);
      // 白底 + 页面渲染
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, cellW, cellH);
      try {
        // 用户T ∘ viewportT：viewportT 把页面顶部映射到 canvas y=0，
        // 页面底部映射到 y=vp.height。用 translate 让页面顶部落在格子顶部，
        // 再补偿 vp.height 与 cellH 的差使页面底部对齐格子底部。
        const ty = y + (cellH - vp.height);
        await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, x, ty] }).promise;
      } catch (e) { /* 单格失败不影响整体 */ }
      // 页码角标
      ctx.fillStyle = 'rgba(37, 99, 235, 0.9)';
      ctx.fillRect(x, y, 44, 20);
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('p.' + num, x + 22, y + 10);
    }
    return canvas.toDataURL('image/png');
  }

  // ── 对外接口 ─────────────────────────────
  return {
    init,
    loadPdf,
    zoomIn,
    zoomOut,
    gotoPage,
    extractFullText,
    detectPageImages,
    renderRegionToPng,
    renderPageToPng,
    renderPagesToGrid,
    enterImageSelectMode,
    exitImageSelectMode,
    get currentPage() { return currentPage; },
    get pageCount() { return pdfDoc ? pdfDoc.numPages : 0; },
    set onTextSelect(fn) { onTextSelect = fn; },
    set onPdfLoaded(fn) { onPdfLoaded = fn; },
  };
})();
