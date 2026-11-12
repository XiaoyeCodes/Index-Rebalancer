import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {loadApplication} from '../application-loader.js';

async function fixture(text = '<main>测试页面</main>', compressed = true) {
  const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,compressed ? gzipSync(text) : new TextEncoder().encode(text));
  const access = {appIv:Buffer.from(iv).toString('base64'),appVersion:createHash('sha256').update(Buffer.from(cipher)).digest('hex')};
  if (compressed) access.appEncoding = 'gzip';
  return {key,cipher,access};
}

test('compressed encrypted publications decode their exact UTF-8 HTML through a versioned cache URL', async () => {
  const f = await fixture(), calls = [];
  const html = await loadApplication(f.access,f.key,async (url,options) => {calls.push([url,options.cache]);return new Response(f.cipher);});
  assert.equal(new TextDecoder().decode(html),'<main>测试页面</main>');
  assert.deepEqual(calls,[['./application.bin?v='+f.access.appVersion,'force-cache']]);
});

test('a new publication uses a different cache entry, while the same publication reuses its URL', async () => {
  const first = await fixture('first'), next = await fixture('next'), urls = [];
  for (const f of [first,first,next]) await loadApplication(f.access,f.key,async url => {urls.push(url);return new Response(f.cipher);});
  assert.equal(urls[0],urls[1]);assert.notEqual(urls[1],urls[2]);
});

test('legacy publications still decode without compression or a persistent cache entry', async () => {
  const f = await fixture('legacy',false);delete f.access.appVersion;
  const html = await loadApplication(f.access,f.key,async (url,options) => {
    assert.equal(url,'./application.bin');assert.equal(options.cache,'no-store');return new Response(f.cipher);
  });
  assert.equal(new TextDecoder().decode(html),'legacy');
});

test('damaged cached ciphertext is fetched afresh once and is never displayed', async () => {
  const f = await fixture('verified'), calls = [];
  const html = await loadApplication(f.access,f.key,async (url,options) => {
    calls.push(options.cache);return new Response(calls.length===1 ? new Uint8Array(40) : f.cipher);
  });
  assert.equal(new TextDecoder().decode(html),'verified');assert.deepEqual(calls,['force-cache','reload']);
});

test('unverifiable content fails closed after a single retry', async () => {
  const f = await fixture(), calls = [];
  await assert.rejects(loadApplication(f.access,f.key,async (url,options) => {calls.push(options.cache);return new Response(new Uint8Array(40));}),{name:'OperationError'});
  assert.deepEqual(calls,['force-cache','reload']);
});

test('HTTP and unsupported encoding errors do not turn into authenticated HTML or retry loops', async () => {
  const f = await fixture();let calls = 0;
  await assert.rejects(loadApplication(f.access,f.key,async () => {calls++;return new Response('',{status:404});}),/页面加载失败/);
  assert.equal(calls,1);
  await assert.rejects(loadApplication({...f.access,appEncoding:'unknown'},f.key,async () => new Response(f.cipher)),/不支持此页面版本/);
});
