const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

// Only authenticated ciphertext is cached; decrypted HTML stays in memory.
export async function loadApplication(access, key, fetcher = fetch) {
  const version = /^[a-f0-9]{64}$/.test(access.appVersion || '') ? access.appVersion : null;
  const url = './application.bin' + (version ? '?v=' + version : '');
  async function decrypt(cache) {
    const response = await fetcher(url, {cache});
    if (!response.ok) throw Error('页面加载失败，请刷新后重试。');
    return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(access.appIv)}, key, await response.arrayBuffer());
  }
  let plain;
  try { plain = await decrypt(version ? 'force-cache' : 'no-store'); }
  catch (error) {
    if (!version || error.name !== 'OperationError') throw error;
    // Recover once if a cached response is damaged or a deployment changed mid-request.
    plain = await decrypt('reload');
  }
  if (!access.appEncoding) return plain; // Older uncompressed publications remain readable.
  if (access.appEncoding !== 'gzip') throw Error('不支持此页面版本，请刷新后重试。');
  return new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
