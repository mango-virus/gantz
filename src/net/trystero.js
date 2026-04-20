const CDN_URLS = [
  'https://esm.run/trystero@0.23',
  'https://cdn.jsdelivr.net/npm/trystero@0.23/+esm',
  'https://esm.sh/trystero@0.23',
];

let cached = null;

export async function loadTrystero() {
  if (cached) return cached;
  let lastErr;
  for (const url of CDN_URLS) {
    try {
      const mod = await import(url);
      if (mod && typeof mod.joinRoom === 'function') {
        cached = mod;
        console.log('[net] trystero loaded from', url);
        return mod;
      }
      lastErr = new Error(`bad module at ${url}`);
    } catch (err) {
      console.warn('[net] cdn failed:', url, err.message);
      lastErr = err;
    }
  }
  throw lastErr || new Error('could not load trystero');
}
