const urlOwner = new Map(); // url -> ownerId
const ownerUrls = new Map(); // ownerId -> Set<url>

/** Blob から Object URL を作り、ownerId に紐づけて登録する。 */
export function createUrl(blob, ownerId) {
  const url = URL.createObjectURL(blob);
  urlOwner.set(url, ownerId);
  if (!ownerUrls.has(ownerId)) ownerUrls.set(ownerId, new Set());
  ownerUrls.get(ownerId).add(url);
  return url;
}

/** URL を 1 件解放する。 */
export function revokeUrl(url) {
  if (!url) return;
  const owner = urlOwner.get(url);
  urlOwner.delete(url);
  if (owner !== undefined) {
    const set = ownerUrls.get(owner);
    set?.delete(url);
    if (set && set.size === 0) ownerUrls.delete(owner);
  }
  URL.revokeObjectURL(url);
}

/** ownerId に紐づく URL をすべて解放する。 */
export function revokeOwner(ownerId) {
  const set = ownerUrls.get(ownerId);
  if (!set) return;
  for (const url of [...set]) revokeUrl(url);
  ownerUrls.delete(ownerId);
}

/** 登録済みの URL をすべて解放する。 */
export function revokeAll() {
  for (const url of [...urlOwner.keys()]) revokeUrl(url);
  ownerUrls.clear();
}
