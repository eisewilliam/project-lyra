// Serves the built site. TanStack Start prerenders every page to
// <path>/index.html with its own title, description, canonical link and
// content, so crawlers read pages without running JavaScript. Unknown page
// addresses get the SPA shell (_shell.html) with a 404 status, and the
// not-found page renders in the browser.

// Other hosts (workers.dev, branch previews, local runs) serve copies of the
// site, which search engines are asked not to index. Their pages keep the
// production canonical link.
const productionHost = "lyra.eiselabs.com";

// Page addresses have no file extension; anything else is a file.
const isPageRequest = (request) => {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  const { pathname } = new URL(request.url);
  if (/\.[a-z0-9]+$/i.test(pathname.split("/").pop() ?? "")) return false;
  // Browsers ask for HTML; link-preview crawlers often send */* or nothing.
  const accept = request.headers.get("accept");
  return !accept || accept.includes("text/html") || accept.includes("*/*");
};

const fetchFile = (env, request, pathname) => {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  return env.ASSETS.fetch(new Request(url, request));
};

const pageFile = (pathname) => (pathname === "/" ? "/index.html" : `${pathname}/index.html`);

async function serve(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404 || !isPageRequest(request)) return response;

  const url = new URL(request.url);
  // One address per page: /download/ moves to /download.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return Response.redirect(url.toString(), 301);
  }

  const page = await fetchFile(env, request, pageFile(url.pathname));
  if (page.status !== 404) return page;

  const shell = await fetchFile(env, request, "/_shell.html");
  if (shell.status !== 200) return response;
  return new Response(shell.body, { status: 404, headers: shell.headers });
}

export default {
  async fetch(request, env) {
    const response = await serve(request, env);
    if (new URL(request.url).hostname === productionHost) return response;
    const headers = new Headers(response.headers);
    headers.set("x-robots-tag", "noindex");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
