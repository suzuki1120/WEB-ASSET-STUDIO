const abortError = (msg = 'Cancelled') => new DOMException(msg, 'AbortError');
const CANCEL_GRACE_MS = 300;

/**
 * モジュール Worker のプール。ジョブは jobId で Worker とやり取りする。
 * Worker→メイン: {jobId, type:'done'} で解決、{jobId, type:'error', message} で reject。
 * @param {{url: string|URL, size?: number, type?: WorkerType}} opts
 */
export function createPool({ url, size = 2, type = 'module' }) {
  const slots = []; // { worker, job }
  const queue = [];
  const jobs = new Map();
  let nextId = 1;

  function settle(job, slot, fn) {
    jobs.delete(job.id);
    job.finished = true;
    if (slot) slot.job = null;
    fn();
    pump();
  }

  function onMessage(slot, msg) {
    const job = msg && jobs.get(msg.jobId);
    if (!job) return;
    try {
      job.onMessage?.(msg);
    } catch (err) {
      console.error(err);
    }
    if (msg.type === 'done') settle(job, slot, () => job.resolve(msg));
    else if (msg.type === 'error') {
      const err = job.cancelled ? abortError() : new Error(msg.message || 'Worker error');
      settle(job, slot, () => job.reject(err));
    }
  }

  function onError(slot, ev) {
    ev.preventDefault?.();
    const job = slot.job;
    slots.splice(slots.indexOf(slot), 1);
    slot.worker.terminate();
    if (job) settle(job, null, () => job.reject(new Error(ev.message || 'Worker error')));
    else pump();
  }

  function spawn() {
    const slot = { worker: new Worker(url, { type }), job: null };
    slot.worker.onmessage = (e) => onMessage(slot, e.data);
    slot.worker.onerror = (e) => onError(slot, e);
    slots.push(slot);
    return slot;
  }

  function pump() {
    while (queue.length) {
      const slot = slots.find((s) => !s.job) ?? (slots.length < size ? spawn() : null);
      if (!slot) return;
      const job = queue.shift();
      job.started = true;
      job.slot = slot;
      slot.job = job;
      slot.worker.postMessage({ ...job.payload, jobId: job.id }, job.transfer);
    }
  }

  /**
   * ジョブを投入する。
   * @param {object} payload Worker に渡す値（jobId が付与される）
   * @param {{transfer?: Transferable[], onMessage?: (msg: any) => void}} [opts]
   * @returns {{promise: Promise<any>, cancel: () => void}}
   */
  function run(payload, { transfer = [], onMessage: onMsg } = {}) {
    const job = { id: nextId++, payload, transfer, onMessage: onMsg, started: false, cancelled: false, finished: false, slot: null };
    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    jobs.set(job.id, job);
    queue.push(job);
    pump();

    function cancel() {
      if (job.finished || job.cancelled) return;
      job.cancelled = true;
      if (!job.started) {
        queue.splice(queue.indexOf(job), 1);
        settle(job, null, () => job.reject(abortError()));
      } else {
        job.slot.worker.postMessage({ jobId: job.id, type: 'cancel' });
        // 同期処理（WASM エンコードなど）の最中は cancel を受け取れないため、少し待って Worker ごと終了する
        setTimeout(() => {
          if (job.finished) return;
          const slot = job.slot;
          const i = slots.indexOf(slot);
          if (i >= 0) slots.splice(i, 1);
          slot.worker.terminate();
          settle(job, null, () => job.reject(abortError()));
        }, CANCEL_GRACE_MS);
      }
    }
    return { promise, cancel };
  }

  /** すべての Worker を終了し、未完了のジョブを AbortError で reject する。 */
  function terminate() {
    queue.length = 0;
    for (const slot of slots.splice(0)) slot.worker.terminate();
    for (const job of [...jobs.values()]) {
      jobs.delete(job.id);
      job.finished = true;
      job.reject(abortError('Pool terminated'));
    }
  }

  return { run, terminate };
}
