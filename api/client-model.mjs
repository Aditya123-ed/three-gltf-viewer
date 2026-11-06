// Fixed public model only: never accept an upstream URL or file ID from a visitor.
const FILE_ID = '1O_njLanwnwdgJGxpu1uIpgPFfVvR5I63';
const DOWNLOAD = 'https://drive.usercontent.google.com/download';
const ERROR_MESSAGE = 'The model could not be downloaded from Google Drive. Please try again later or contact the viewer owner.';

async function confirmationToken(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw new Error('Unexpected oversized confirmation page');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const html = Buffer.concat(chunks).toString('utf8');
  const form = html.match(/<form\b[^>]*id=["']download-form["'][^>]*>([\s\S]*?)<\/form>/i);
  if (!form) throw new Error('Drive did not supply a download confirmation form');
  const values = {};
  for (const input of form[1].matchAll(/<input\b[^>]*>/gi)) {
    const name = input[0].match(/\bname=["']([^"']+)["']/i)?.[1];
    const value = input[0].match(/\bvalue=["']([^"']*)["']/i)?.[1];
    if (name) values[name] = value;
  }
  if (values.id !== FILE_ID || values.confirm !== 't' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(values.uuid || '')) {
    throw new Error('Invalid Drive download confirmation');
  }
  return values.uuid;
}

export async function GET(request) {
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(270000)]);
  let reader;
  try {
    const url = new URL(DOWNLOAD);
    url.search = new URLSearchParams({ id: FILE_ID, export: 'download', confirm: 't' });
    // Do not forward visitor cookies, user agents, ranges, or query parameters.
    const options = { signal, redirect: 'error', headers: { Accept: 'application/octet-stream' } };
    let upstream = await fetch(url, options);
    if (!upstream.ok) throw new Error('Drive returned HTTP ' + upstream.status);
    if (upstream.headers.get('content-type')?.includes('text/html')) {
      url.searchParams.set('uuid', await confirmationToken(upstream));
      upstream = await fetch(url, options);
    }
    if (!upstream.ok || !upstream.body) throw new Error('Drive download unavailable');
    reader = upstream.body.getReader();
    const prefix = [];
    let prefixLength = 0;
    while (prefixLength < 12) {
      const part = await reader.read();
      if (part.done) throw new Error('Truncated GLB header');
      prefix.push(part.value);
      prefixLength += part.value.length;
    }
    const first = Buffer.concat(prefix);
    if (first.toString('ascii', 0, 4) !== 'glTF' || first.readUInt32LE(4) !== 2) {
      throw new Error('Drive returned a page instead of a GLB');
    }
    const expected = first.readUInt32LE(8);
    if (expected < 20 || first.length > expected) throw new Error('Invalid GLB length');
    let sent = first.length;
    let initial = true;
    const stream = new ReadableStream({
      async pull(output) {
        try {
          if (initial) {
            initial = false;
            output.enqueue(first);
            return;
          }
          const { done, value } = await reader.read();
          if (done) {
            if (sent !== expected) throw new Error('Incomplete GLB download');
            output.close();
            return;
          }
          sent += value.length;
          if (sent > expected) throw new Error('GLB exceeded declared length');
          output.enqueue(value);
        } catch (error) {
          console.error('Client model stream failed:', error.message);
          controller.abort();
          output.error(error);
        }
      },
      async cancel() {
        controller.abort();
        await reader.cancel().catch(() => {});
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'model/gltf-binary',
        'Content-Length': String(expected),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Model-Validated': 'glb-v2',
      },
    });
  } catch (error) {
    console.error('Client model download failed:', error.message);
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
    return Response.json({ error: ERROR_MESSAGE }, {
      status: 502, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
