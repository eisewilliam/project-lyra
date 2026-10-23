// Serves the built site. Unknown page addresses get the app shell, which
// routes on the client, and every page gets link-preview tags that crawlers
// can read without running JavaScript.

// Titles and descriptions for link previews, by path. Other pages share the
// home page's, which index.html carries.
export const previews = {
  "/download": {
    title: "Download Lyra",
    description: "Free for macOS, Windows and Linux. Lyra works with Spotify, Apple Music, YouTube Music and most other players.",
  },
};

const escapeAttribute = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

// Make the preview tags' addresses absolute for this host, point og:url at
// this page and add its canonical link, and swap in the page's own title and
// description. (index.html cannot carry a relative canonical link: the build
// would try to resolve it as a file.)
export function withPreview(html, url) {
  const { origin } = url;
  const path = url.pathname.replace(/\/index\.html$/, "/").replace(/(.)\/$/, "$1");
  const page = origin + path;
  const canonical = `<link rel="canonical" href="${escapeAttribute(page)}" />`;
  let result = (/<link rel="canonical"/.test(html)
    ? html.replace(/<link rel="canonical"[^>]*>/, canonical)
    : html.replace("</head>", `  ${canonical}\n  </head>`))
    .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${escapeAttribute(page)}"`)
    .replace(/(<meta (?:property|name)="(?:og:image|twitter:image)" content=")\/([^"]*)"/g, `$1${origin}/$2"`);
  const preview = previews[path];
  if (preview) {
    const title = escapeAttribute(preview.title);
    const description = escapeAttribute(preview.description);
    result = result
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${title}"`)
      .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*"/g, `$1${description}"`);
  }
  return result;
}

// Page addresses have no file extension; anything else is a file.
const isPageRequest = (request) => {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  const { pathname } = new URL(request.url);
  if (/\.[a-z0-9]+$/i.test(pathname.split("/").pop() ?? "")) return false;
  // Browsers ask for HTML; link-preview crawlers often send */* or nothing.
  const accept = request.headers.get("accept");
  return !accept || accept.includes("text/html") || accept.includes("*/*");
};

export default {
  async fetch(request, env) {
    let response = await env.ASSETS.fetch(request);

    if (response.status === 404 && isPageRequest(request)) {
      const indexUrl = new URL(request.url);
      indexUrl.pathname = "/index.html";
      indexUrl.search = "";
      response = await env.ASSETS.fetch(new Request(indexUrl, request));
    }

    const isHtml = response.headers.get("content-type")?.includes("text/html");
    if (request.method !== "GET" || response.status !== 200 || !isHtml) return response;
    const headers = new Headers(response.headers);
    // The body changes per host and page, so the original length and tag no longer apply.
    headers.delete("content-length");
    headers.delete("etag");
    return new Response(withPreview(await response.text(), new URL(request.url)), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
