// CDN URL はこのファイルにだけ書く。Worker 内でも同じ URL を import する。
export const CDN = {
  jsquashWebp: 'https://esm.sh/@jsquash/webp@1.5.0/encode',
  jsquashAvif: 'https://esm.sh/@jsquash/avif@2.1.1/encode',
  fflate: 'https://esm.sh/fflate@0.8.3',
  mediabunny: 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs',
};

/** import() の Promise をキャッシュするローダーを作る。失敗時はキャッシュを捨てて再試行可能にする。 */
function cachedLoader(url) {
  let promise = null;
  return () => {
    if (!promise) {
      promise = import(/* @vite-ignore */ url).catch((err) => {
        promise = null;
        throw err;
      });
    }
    return promise;
  };
}

/** fflate モジュール（Zip, ZipPassThrough など）を読み込む。 */
export const loadFflate = cachedLoader(CDN.fflate);
/** mediabunny モジュールを読み込む。 */
export const loadMediabunny = cachedLoader(CDN.mediabunny);
/** jSquash WebP エンコーダのモジュール（default export が encode）を読み込む。 */
export const loadJsquashWebp = cachedLoader(CDN.jsquashWebp);
/** jSquash AVIF エンコーダのモジュール（default export が encode）を読み込む。 */
export const loadJsquashAvif = cachedLoader(CDN.jsquashAvif);
