async function notify(message, tone) {
  try {
    const { toast } = await import('../ui/components.js');
    toast(message, { tone });
  } catch {
    // UI 未読み込み時は通知なしで続行
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/**
 * テキストをクリップボードへコピーし、トーストで結果を伝える。
 * @param {string} text
 * @param {{successMessage?:string}} [opts]
 * @returns {Promise<boolean>}
 */
export async function copyText(text, { successMessage = 'コピーしました' } = {}) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = fallbackCopy(text);
  }
  await notify(ok ? successMessage : 'コピーできませんでした', ok ? 'success' : 'danger');
  return ok;
}
