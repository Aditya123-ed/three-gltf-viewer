import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../api/client-model.mjs';

const bytes = Buffer.alloc(32);
bytes.write('glTF'); bytes.writeUInt32LE(2,4); bytes.writeUInt32LE(32,8);
const req = () => new Request('https://viewer.test/models/client.glb');
const originalFetch = globalThis.fetch;
async function mock(fetcher, fn) {
  globalThis.fetch = fetcher;
  try { await fn(); } finally { globalThis.fetch = originalFetch; }
}
test('streams byte-identical GLB without forwarding visitor headers', async () => {
  await mock(async (url, options) => {
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(new URL(url).searchParams.get('id'),'1O_njLanwnwdgJGxpu1uIpgPFfVvR5I63');
    return new Response(bytes);
  }, async () => {
    const response = await GET(req());
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'model/gltf-binary');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  });
});
test('handles Drive warning form then streams verified GLB', async () => {
  let calls = 0;
  await mock(async (url) => {
    if (++calls === 1) return new Response('<form id="download-form"><input name="id" value="1O_njLanwnwdgJGxpu1uIpgPFfVvR5I63"><input value="t" name="confirm"><input name="uuid" value="abc-123"></form>', {headers:{'content-type':'text/html'}});
    assert.equal(new URL(url).searchParams.get('uuid'),'abc-123');
    return new Response(bytes);
  }, async () => {
    const response = await GET(req());
    assert.equal(response.status,200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(calls,2);
  });
});
test('rejects HTML even if labeled binary', async () => {
  await mock(async () => new Response('<!DOCTYPE html><html>not a model</html>'), async () => {
    const response = await GET(req());
    assert.equal(response.status,502);
    assert.equal((await response.json()).error.includes('Google Drive'),true);
  });
});
test('rejects a confirmation for another file', async () => {
  await mock(async () => new Response('<form id="download-form"><input name="id" value="wrong"><input name="uuid" value="abc"><input name="confirm" value="t"></form>',{headers:{'content-type':'text/html'}}),async()=>{
    assert.equal((await GET(req())).status,502);
  });
});
test('rejects a truncated transfer', async () => {
  await mock(async () => new Response(bytes.subarray(0,20)), async () => {
    const response=await GET(req());
    await assert.rejects(response.arrayBuffer(),/Incomplete/);
  });
});
