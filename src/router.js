/**
 * ハッシュルーター。#/<id> でツールを切り替える。
 * onChange(tool, previousTool) は現在のツールが変わるたびに呼ばれる。
 */
export function createRouter({ tools, onChange }) {
  const first = tools[0];
  let current = null;

  const find = (id) => tools.find((t) => t.id === id) || null;
  const parse = () => {
    const m = /^#\/([\w-]+)/.exec(window.location.hash);
    return m ? find(m[1]) : null;
  };

  function apply(tool) {
    if (!tool || tool === current) return;
    const prev = current;
    current = tool;
    onChange?.(tool, prev);
  }

  function navigate(id) {
    const tool = find(id) || first;
    if (window.location.hash !== `#/${tool.id}`) window.location.hash = `#/${tool.id}`;
    else apply(tool);
  }

  window.addEventListener('hashchange', () => {
    const tool = parse();
    if (tool) apply(tool);
    else navigate(first.id);
  });

  return {
    start() {
      const tool = parse();
      if (tool) apply(tool);
      else {
        window.history.replaceState(null, '', `#/${first.id}`);
        apply(first);
      }
    },
    navigate,
    current: () => current,
  };
}
