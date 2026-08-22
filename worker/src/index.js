const TASK_PATH = new RegExp("^/sign/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(Orvia[.]ipa|manifest[.]plist)$");
const CONTENT_TYPES = { "Orvia.ipa": "application/octet-stream", "manifest.plist": "application/xml" };

export function resolveObjectPath(pathname) {
  const match = TASK_PATH.exec(pathname);
  if (!match) return null;
  const [, taskId, filename] = match;
  return { key: `sign/${taskId}/${filename}`, contentType: CONTENT_TYPES[filename] };
}

function notFound() {
  return new Response("Not Found", { status: 404 });
}

function methodNotAllowed() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD" },
  });
}

function responseHeaders(object, contentType) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (object.size !== undefined && object.size !== null) {
    headers.set("Content-Length", String(object.size));
  }
  if (object.httpEtag !== undefined && object.httpEtag !== null) {
    headers.set("ETag", object.httpEtag);
  }
  if (object.uploaded !== undefined && object.uploaded !== null) {
    headers.set("Last-Modified", object.uploaded.toUTCString());
  }
  return headers;
}

const worker = {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed();
    }

    const url = new URL(request.url);
    if (url.search) return notFound();

    const objectPath = resolveObjectPath(url.pathname);
    if (!objectPath) return notFound();

    let object;
    try {
      object = request.method === "HEAD"
        ? await env.OTA_BUCKET.head(objectPath.key)
        : await env.OTA_BUCKET.get(objectPath.key);
    } catch {
      return new Response("Internal Server Error", { status: 500 });
    }

    if (!object) return notFound();

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers: responseHeaders(object, objectPath.contentType),
    });
  },
};

export default worker;
