// 画像変換用の module worker。
import { processJob } from './image-process.js';

const controllers = new Map(); // jobId -> AbortController

self.onmessage = async (event) => {
  const { jobId, type, ...payload } = event.data;
  if (type === 'cancel') {
    controllers.get(jobId)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(jobId, controller);
  let settled = false;
  const post = (msg) => {
    if (msg.type === 'done' || msg.type === 'error') settled = true;
    self.postMessage({ jobId, ...msg });
  };
  try {
    await processJob(payload, post, controller.signal);
  } catch (err) {
    post({ type: 'error', message: err?.message || '変換に失敗しました' });
  } finally {
    // 中止時は 'cancelled' の後にプールへ終了を知らせる（プールは done / error で解決する）
    if (!settled) post({ type: 'error', message: 'cancelled' });
    controllers.delete(jobId);
  }
};
