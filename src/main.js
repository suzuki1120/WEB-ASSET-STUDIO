import { h, icon } from './lib/dom.js';
import { initTheme, toggleTheme } from './theme.js';
import { probeCapabilities, caps } from './capabilities.js';
import { createRouter } from './router.js';
import { createPercentTool, createVwTool, createRatioTool, createClampTool } from './tools/calculators/calculators.js';

initTheme();

// 幅 <900px のナビで使う短いラベル
const SHORT_TITLES = { percent: '%', vw: 'vw', ratio: '比率', clamp: 'clamp', images: '画像', video: '動画' };

function placeholderTool({ id, title, subtitle, iconName }) {
  return {
    id,
    title,
    subtitle,
    icon: iconName,
    group: 'convert',
    main: h('div', { class: 'notice notice-info', role: 'status' }, icon('info', 16), h('div', null, 'このツールは準備中です。')),
    aside: null,
  };
}

async function loadConvertTool(path, fallback) {
  try {
    const mod = await import(path);
    return mod.createTool({ caps });
  } catch (err) {
    console.warn(`[main] ${path} を読み込めませんでした`, err);
    return placeholderTool(fallback);
  }
}

async function boot() {
  // 画像・動画ツールは別モジュール。無い場合は準備中表示にする
  const [images, video] = await Promise.all([
    loadConvertTool('./tools/images/image-tool.js', { id: 'images', title: '画像変換', subtitle: 'WebP / AVIF / JPEG / PNG への一括変換', iconName: 'image' }),
    loadConvertTool('./tools/video/video-tool.js', { id: 'video', title: '動画変換', subtitle: 'WebM / MP4 への変換', iconName: 'video' }),
  ]);

  const TOOLS = [createPercentTool(), createVwTool(), createRatioTool(), createClampTool(), images, video];

  // ---- サイドバー ----
  const navHosts = { calc: document.getElementById('nav-calc'), convert: document.getElementById('nav-convert') };
  const navItems = new Map();
  TOOLS.forEach((tool, i) => {
    const a = h('a', { class: 'nav-item', href: `#/${tool.id}`, dataset: { tool: tool.id }, title: tool.title },
      icon(tool.icon, 16),
      h('span', { class: 'nav-label' }, tool.title),
      h('span', { class: 'nav-short', 'aria-hidden': 'true' }, SHORT_TITLES[tool.id] ?? tool.title),
    );
    a.setAttribute('aria-label', tool.title);
    a.setAttribute('aria-keyshortcuts', `Control+${i + 1} Meta+${i + 1}`);
    (navHosts[tool.group] || navHosts.convert).appendChild(a);
    navItems.set(tool.id, a);
  });

  // ---- テーマ ----
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  // ---- ルーティング ----
  const appEl = document.querySelector('.app');
  const titleEl = document.getElementById('tool-title');
  const subtitleEl = document.getElementById('tool-subtitle');
  const mainEl = document.getElementById('tool-main');
  const asideEl = document.getElementById('tool-aside');
  const workspace = document.querySelector('.workspace');

  // ---- 設定パネルの開閉トグル（<=899px のみ CSS で表示）----
  const PANEL_KEY = 'was.panel.open';
  const readOpen = () => { try { return localStorage.getItem(PANEL_KEY) === '1'; } catch { return false; } };
  const writeOpen = (v) => { try { localStorage.setItem(PANEL_KEY, v ? '1' : '0'); } catch { /* 保存不可は無視 */ } };
  const panelSummary = h('span', { class: 'panel-toggle-summary' });
  const panelToggle = h('button', { class: 'panel-toggle', type: 'button', 'aria-controls': 'tool-aside' },
    h('span', { class: 'panel-toggle-label' }, '設定'),
    panelSummary,
    icon('chevron-down', 16),
  );
  // 閉じていても現在の設定が分かるよう、ツールが返す要約を表示する
  let currentTool = null;
  const updatePanelSummary = () => { panelSummary.textContent = currentTool?.settingsSummary?.() ?? ''; };
  document.addEventListener('was:settings-change', updatePanelSummary);
  const setPanelOpen = (open) => {
    asideEl.classList.toggle('is-open', open);
    panelToggle.setAttribute('aria-expanded', String(open));
  };
  setPanelOpen(readOpen());
  panelToggle.addEventListener('click', () => {
    const open = !asideEl.classList.contains('is-open');
    setPanelOpen(open);
    writeOpen(open);
  });
  asideEl.before(panelToggle);

  const router = createRouter({
    tools: TOOLS,
    onChange(tool, prev) {
      prev?.deactivate?.();
      currentTool = tool;
      navItems.forEach((a, id) => {
        const active = id === tool.id;
        a.classList.toggle('is-active', active);
        if (active) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      titleEl.textContent = tool.title;
      subtitleEl.textContent = tool.subtitle || '';
      document.title = `${tool.title} | Web Asset Studio`;
      mainEl.replaceChildren(tool.main);
      if (tool.aside) {
        asideEl.replaceChildren(tool.aside);
        appEl.classList.remove('no-aside');
        panelToggle.hidden = false;
      } else {
        asideEl.replaceChildren();
        appEl.classList.add('no-aside');
        panelToggle.hidden = true;
      }
      updatePanelSummary();
      workspace.scrollTop = 0;
      window.scrollTo?.(0, 0);
      tool.activate?.();
    },
  });
  router.start();

  // ---- キーボード: Cmd/Ctrl + 1..6 ----
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= TOOLS.length) {
      e.preventDefault();
      router.navigate(TOOLS[n - 1].id);
    }
  });

  // ---- 機能検出（初回描画をブロックしない） ----
  const capEl = document.getElementById('cap-status');
  const mark = (ok) => (ok ? '✓' : '–');
  Promise.resolve()
    .then(() => probeCapabilities())
    .then(() => {
      if (!capEl) return;
      capEl.textContent = caps.webcodecs
        ? `WebCodecs ✓ · AVIF ${mark(caps.moduleWorker && typeof WebAssembly !== 'undefined')}`
        : `WebCodecs 未対応 · AVIF ${mark(caps.moduleWorker && typeof WebAssembly !== 'undefined')}`;
    })
    .catch(() => { if (capEl) capEl.textContent = '機能の確認に失敗しました'; });
}

boot();
