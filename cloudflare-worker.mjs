import openNextWorker from "./.open-next/worker.js";

const VERSIONED_BANNER_PREFIX = "/banners/v1/";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const worker = {
  ...openNextWorker,
  async fetch(request, env, ctx) {
    const response = await openNextWorker.fetch(request, env, ctx);
    const pathname = new URL(request.url).pathname;

    if (
      !response.ok ||
      !pathname.startsWith(VERSIONED_BANNER_PREFIX) ||
      !pathname.endsWith(".webp")
    ) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set("Cache-Control", IMMUTABLE_CACHE_CONTROL);
    headers.set("Content-Type", "image/webp");

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  },
};

export default worker;
