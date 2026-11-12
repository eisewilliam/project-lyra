import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

// A prerendered page as TanStack Start writes it, cut down to a few tags.
const page = (title, path) => [
  `<title>${title}</title>`,
  `<link rel="canonical" href="https://lyra.eiselabs.com${path}"/>`,
  "</head>",
  `<body><h1>${title}</h1></body>`,
].join("\n");

const html = { "content-type": "text/html; charset=utf-8", etag: '"abc"', "content-length": "999" };

// The built site: prerendered pages, the SPA shell, and some files.
// Records every path the worker asks the assets for.
const site = (files = {}) => {
  const calls = [];
  const all = {
    "/index.html": page("Home", "/"),
    "/download/index.html": page("Download Lyra", "/download"),
    "/_shell.html": "<title>Page not found — Lyra</title>",
    ...files,
  };
  return {
    calls,
    ASSETS: {
      fetch: async (request) => {
        const { pathname, search } = new URL(request.url);
        calls.push(pathname + search);
        if (!(pathname in all)) return new Response("missing", { status: 404 });
        const headers = pathname.endsWith(".html") ? html : { "content-type": "text/plain" };
        return new Response(request.method === "HEAD" ? null : all[pathname], { status: 200, headers });
      },
    },
  };
};

const get = (url, headers = { accept: "text/html" }, method = "GET") => new Request(url, { headers, method });

test("serves existing static assets directly", async () => {
  const env = site({ "/assets/app.js": "asset" });
  const response = await worker.fetch(get("https://lyra.eiselabs.com/assets/app.js", { accept: "*/*" }), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset");
  assert.deepEqual(env.calls, ["/assets/app.js"]);
});

test("serves each page's prerendered file", async () => {
  const env = site();
  const response = await worker.fetch(get("https://lyra.eiselabs.com/download?platform=macos"), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<h1>Download Lyra<\/h1>/);
  assert.deepEqual(env.calls, ["/download?platform=macos", "/download/index.html"]);
});

test("serves the home page from index.html", async () => {
  const env = site();
  const response = await worker.fetch(get("https://lyra.eiselabs.com/"), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<h1>Home<\/h1>/);
});

test("answers an unknown page with the SPA shell and a 404 status", async () => {
  const env = site();
  const response = await worker.fetch(get("https://lyra.eiselabs.com/flow/step-two?source=share"), env);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Page not found/);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.deepEqual(env.calls, ["/flow/step-two?source=share", "/flow/step-two/index.html", "/_shell.html"]);
});

test("moves a page address with a trailing slash to the one without", async () => {
  const response = await worker.fetch(get("https://lyra.eiselabs.com/download/?platform=linux"), site());
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://lyra.eiselabs.com/download?platform=linux");
});

test("does not turn missing files, API calls or writes into pages", async () => {
  for (const request of [
    get("https://lyra.eiselabs.com/missing.png", { accept: "*/*" }),
    get("https://lyra.eiselabs.com/api/missing", { accept: "application/json" }),
    get("https://lyra.eiselabs.com/flow", { accept: "text/html" }, "POST"),
  ]) {
    const env = site();
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 404);
    assert.equal(env.calls.length, 1);
  }
});

test("serves pages on other hosts as built, with the production canonical link", async () => {
  const response = await worker.fetch(get("https://lyra.example/download?platform=macos", { accept: "*/*" }), site());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), page("Download Lyra", "/download"));
  assert.equal(response.headers.get("etag"), '"abc"');
});

test("answers a crawler without an accept header with the page", async () => {
  const response = await worker.fetch(new Request("https://lyra.eiselabs.com/download"), site());
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Download Lyra<\/title>/);
});

test("answers HEAD for a page without a body", async () => {
  const response = await worker.fetch(get("https://lyra.eiselabs.com/download", { accept: "text/html" }, "HEAD"), site());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("asks search engines not to index copies on other hosts", async () => {
  for (const url of ["https://lyra-website.example.workers.dev/", "https://lyra-website.example.workers.dev/missing", "https://lyra-website.example.workers.dev/download/"]) {
    const response = await worker.fetch(get(url), site());
    assert.equal(response.headers.get("x-robots-tag"), "noindex", url);
  }
  const production = await worker.fetch(get("https://lyra.eiselabs.com/"), site());
  assert.equal(production.headers.get("x-robots-tag"), null);
});

test("leaves non-HTML files untouched", async () => {
  const response = await worker.fetch(new Request("https://lyra.eiselabs.com/robots.txt"), site({ "/robots.txt": "User-agent: *" }));
  assert.equal(await response.text(), "User-agent: *");
});
