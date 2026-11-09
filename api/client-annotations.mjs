const MAX_BYTES = 64 * 1024 * 1024;
const NO_CACHE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request) {
  const shareLink = process.env.CLIENT_ANNOTATIONS_DRIVE_URL;
  if (!shareLink) {
    return new Response(null, { status: 404, headers: NO_CACHE });
  }

  try {
    // Only the viewer owner's configured Drive file is fetched. Visitor input is ignored.
    const share = new URL(shareLink);
    const id = share.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]+)(?:\/view)?\/?$/)?.[1];
    if (share.origin !== 'https://drive.google.com' || !id) {
      throw new Error('Invalid Google Drive share link');
    }

    const url = new URL('https://drive.usercontent.google.com/download');
    url.search = new URLSearchParams({ id, export: 'download', confirm: 't' });
    const resourceKey = share.searchParams.get('resourcekey');
    if (resourceKey) url.searchParams.set('resourcekey', resourceKey);

    const upstream = await fetch(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    });
    const type = upstream.headers.get('content-type')?.split(';')[0].trim();
    if (!upstream.ok || !upstream.body ||
        !['application/json', 'application/octet-stream', 'text/plain'].includes(type) ||
        Number(upstream.headers.get('content-length')) > MAX_BYTES) {
      await upstream.body?.cancel();
      throw new Error('Drive did not return a downloadable annotation file within the size limit');
    }

    let size = 0;
    const stream = upstream.body.pipeThrough(new TransformStream({
      transform(chunk, output) {
        size += chunk.byteLength;
        if (size > MAX_BYTES) throw new Error('Annotation file exceeded the size limit');
        output.enqueue(chunk);
      },
    }));
    return new Response(stream, {
      headers: { ...NO_CACHE, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    console.error('Shared annotations unavailable:', error.message);
    return Response.json({ error: 'Shared annotations are unavailable.' }, {
      status: 502, headers: NO_CACHE,
    });
  }
}
