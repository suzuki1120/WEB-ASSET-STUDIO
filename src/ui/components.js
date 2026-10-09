import { h, icon, uid } from '../lib/dom.js';

/*
 * 共通 UI 部品。コールバックに渡す値:
 *   numberInput.onInput(number|null, event)   textInput.onInput(string, event)
 *   rangeField.onInput(number, event)         select.onChange(string, event)
 *   segmented.onChange(string)                switchField / checkbox .onChange(boolean, event)
 */

const toneIcon = { success: 'check', warning: 'alert', danger: 'alert', info: 'info', neutral: 'info' };

export function button({ label, icon: iconName, variant = 'secondary', size = 'md', onClick, disabled = false, type = 'button', title } = {}) {
  const el = h(
    'button',
    { class: ['btn', `btn-${variant}`, `btn-${size}`], type, disabled, title: title || null, onClick },
    iconName ? icon(iconName, size === 'sm' ? 14 : 16) : null,
    label != null && label !== '' ? h('span', { class: 'btn-label' }, label) : null,
  );
  return el;
}

function findControl(node) {
  if (!node) return null;
  if (node.matches?.('input, select, textarea, button')) return node;
  return node.querySelector?.('input, select, textarea') || null;
}

export function field({ label, hint, control, inline = false } = {}) {
  const node = control?.el || control;
  const target = findControl(control?.input || node);
  const labelEl = h('label', { class: 'field-label' }, label);
  let hintEl = null;
  if (hint) hintEl = h('p', { class: 'field-hint', id: uid('hint') }, hint);

  if (target) {
    if (!target.id) target.id = uid('ctl');
    labelEl.htmlFor = target.id;
    if (hintEl) target.setAttribute('aria-describedby', hintEl.id);
  } else {
    // input を持たない部品 (segmented 等) は role=group で名前を関連付ける
    const lid = uid('lbl');
    labelEl.id = lid;
    labelEl.removeAttribute('for');
    node?.setAttribute?.('role', node.getAttribute('role') || 'group');
    node?.setAttribute?.('aria-labelledby', lid);
    if (hintEl) node?.setAttribute?.('aria-describedby', hintEl.id);
  }

  if (inline) {
    return h('div', { class: 'field field-inline' }, h('div', { class: 'field-text' }, labelEl, hintEl), node);
  }
  return h('div', { class: 'field' }, labelEl, node, hintEl);
}

export function numberInput({ value, min, max, step = 'any', placeholder, unit, onInput } = {}) {
  const input = h('input', {
    class: 'input',
    type: 'number',
    inputmode: 'decimal',
    min: min ?? null,
    max: max ?? null,
    step,
    placeholder: placeholder ?? null,
    autocomplete: 'off',
  });
  if (value != null && value !== '') input.value = String(value);
  input.addEventListener('input', (e) => {
    const n = input.value === '' ? null : Number(input.value);
    onInput?.(Number.isFinite(n) ? n : null, e);
  });
  const el = h('div', { class: ['input-wrap', unit ? 'has-unit' : ''] }, input, unit ? h('span', { class: 'input-unit' }, unit) : null);
  return { el, input };
}

export function textInput({ value, placeholder, onInput, mono = false } = {}) {
  const input = h('input', { class: ['input', mono ? 'is-mono' : ''], type: 'text', placeholder: placeholder ?? null, autocomplete: 'off', spellcheck: 'false' });
  if (value != null) input.value = String(value);
  input.addEventListener('input', (e) => onInput?.(input.value, e));
  const el = h('div', { class: 'input-wrap' }, input);
  return { el, input };
}

export function rangeField({ label, min = 0, max = 100, step = 1, value = 0, format = (v) => String(v), onInput } = {}) {
  const input = h('input', { class: 'range', type: 'range', min, max, step });
  input.value = String(value);
  const out = h('span', { class: 'range-value', 'aria-hidden': 'true' }, format(Number(value)));
  input.id = uid('rng');
  input.addEventListener('input', (e) => {
    const v = Number(input.value);
    out.textContent = format(v);
    onInput?.(v, e);
  });
  const el = h('div', { class: 'field' },
    h('label', { class: 'field-label', for: input.id }, label),
    h('div', { class: 'range-row' }, input, out),
  );
  return {
    el,
    input,
    setValue(v) { input.value = String(v); out.textContent = format(Number(input.value)); },
    setDisabled(b) { input.disabled = !!b; },
  };
}

export function switchField({ label, hint, checked = false, onChange } = {}) {
  const input = h('input', { class: 'switch', type: 'checkbox', role: 'switch', checked: !!checked });
  input.addEventListener('change', (e) => onChange?.(input.checked, e));
  const el = h('label', { class: 'switch-row' },
    h('span', { class: 'field-text' },
      h('span', { class: 'field-label' }, label),
      hint ? h('span', { class: 'field-hint' }, hint) : null,
    ),
    input,
  );
  return { el, input };
}

export function select({ options = [], value, onChange } = {}) {
  const input = h('select');
  const el = h('div', { class: 'select' }, input, icon('chevron-down', 14));
  function setOptions(opts, keep = true) {
    const prev = keep ? input.value : null;
    input.textContent = '';
    for (const o of opts) {
      const opt = h('option', { value: o.value, disabled: !!o.disabled }, o.hint ? `${o.label}（${o.hint}）` : o.label);
      input.appendChild(opt);
    }
    const want = prev != null && opts.some((o) => String(o.value) === prev && !o.disabled) ? prev : value;
    if (want != null && opts.some((o) => String(o.value) === String(want))) input.value = String(want);
  }
  setOptions(options, false);
  input.addEventListener('change', (e) => onChange?.(input.value, e));
  return { el, input, setOptions: (opts) => setOptions(opts, true) };
}

export function segmented({ options = [], value, onChange } = {}) {
  const el = h('div', { class: 'segmented', role: 'group' });
  let current = value ?? options[0]?.value;
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', dataset: { value: o.value }, 'aria-pressed': String(o.value === current) }, o.label);
    b.addEventListener('click', () => {
      if (current === o.value) return;
      setValue(o.value);
      onChange?.(o.value);
    });
    el.appendChild(b);
    return b;
  });
  function setValue(v) {
    current = v;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(v))));
  }
  return { el, setValue, get value() { return current; } };
}

export function checkbox({ label, checked = false, onChange } = {}) {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  input.addEventListener('change', (e) => onChange?.(input.checked, e));
  const el = h('label', { class: 'checkbox' },
    input,
    h('span', { class: 'checkbox-box', 'aria-hidden': 'true' }, icon('check', 12)),
    label ? h('span', { class: 'checkbox-label' }, label) : null,
  );
  return { el, input };
}

export function badge(text, tone = 'neutral') {
  return h('span', { class: ['badge', `badge-${tone}`] }, text);
}

export function progressBar(value = 0) {
  const bar = h('div', { class: 'progress-bar' });
  const el = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
  const set = (v) => {
    const c = Math.max(0, Math.min(1, Number(v) || 0));
    bar.style.transform = `scaleX(${c})`;
    el.setAttribute('aria-valuenow', String(Math.round(c * 100)));
  };
  set(value);
  return { el, set };
}

function toastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = h('div', { id: 'toast-root', 'aria-live': 'polite' });
    document.body.appendChild(root);
  }
  return root;
}

export function toast(message, { tone = 'info', duration = 3000 } = {}) {
  const root = toastRoot();
  const el = h('div', { class: ['toast', `toast-${tone}`], role: tone === 'danger' ? 'alert' : 'status' },
    icon(toneIcon[tone] || 'info', 16),
    h('span', null, message),
  );
  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected || el.classList.contains('is-leaving')) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener('click', dismiss);
  root.appendChild(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}

export function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
  return new Promise((resolve) => {
    if (typeof HTMLDialogElement === 'undefined') {
      resolve(window.confirm(`${title}\n${message || ''}`));
      return;
    }
    const dlg = h('dialog', { class: 'confirm', 'aria-labelledby': 'confirm-title' },
      h('h2', { class: 'confirm-title', id: 'confirm-title' }, title),
      message ? h('p', { class: 'confirm-message' }, message) : null,
      h('div', { class: 'confirm-actions' },
        button({ label: cancelLabel, variant: 'ghost', onClick: () => dlg.close('cancel') }),
        button({ label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => dlg.close('ok') }),
      ),
    );
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/**
 * 汎用のモーダル。閉じると要素ごと破棄し、onClose を呼ぶ。
 * @returns {{ dlg: HTMLDialogElement, close: () => void }}
 */
export function modal({ title, children, footer, className, onClose } = {}) {
  const titleId = uid('modal');
  const dlg = h('dialog', { class: ['modal', className], 'aria-labelledby': titleId });
  const closeBtn = button({ icon: 'x', variant: 'ghost', size: 'sm', title: '閉じる', onClick: () => dlg.close() });
  closeBtn.setAttribute('aria-label', '閉じる');
  dlg.append(
    h('header', { class: 'modal-head' }, h('h2', { class: 'modal-title', id: titleId }, title), closeBtn),
    h('div', { class: 'modal-body' }, children),
    footer ? h('footer', { class: 'modal-foot' }, footer) : null,
  );
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.appendChild(dlg);
  dlg.showModal();
  return { dlg, close: () => dlg.close() };
}

/** 折りたたみセクション。summary を渡すと見出しの右に現在値の要約を出す（閉じていても設定が分かる）。 */
export function section({ title, open = true, summary, children } = {}) {
  return h('details', { class: 'panel-section', open: !!open },
    h('summary', null,
      h('span', { class: 'panel-section-title' }, title),
      h('span', { class: 'panel-section-summary' }, summary ?? ''),
      icon('chevron-down', 14),
    ),
    h('div', { class: 'panel-section-body' }, children),
  );
}

/** section() の見出しの要約を書き換える。 */
export function setSectionSummary(sectionEl, text) {
  const el = sectionEl?.querySelector(':scope > summary > .panel-section-summary');
  if (el) {
    el.textContent = text ?? '';
    el.title = text ?? '';
  }
}

/**
 * 値を選ぶ小さなボタン列（よく使う画面幅など）。押すと onPick(value) を呼ぶ。
 * @param {{values: Array<number|string>, label?: string, format?: (v:any)=>string, onPick: (v:any)=>void}} opts
 */
export function chips({ values = [], label, format = (v) => String(v), onPick } = {}) {
  const el = h('div', { class: 'chips', role: 'group', 'aria-label': label ?? null },
    values.map((v) => h('button', { type: 'button', class: 'chip', onClick: () => onPick?.(v) }, format(v))),
  );
  return { el };
}

/** 数値入力に値を入れ、input イベントを発火させて onInput を通す。 */
export function setInputValue(input, value) {
  input.value = value == null ? '' : String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function notice(message, tone = 'info') {
  return h('div', { class: ['notice', `notice-${tone}`], role: tone === 'danger' ? 'alert' : 'status' },
    icon(toneIcon[tone] || 'info', 16),
    h('div', null, message),
  );
}
