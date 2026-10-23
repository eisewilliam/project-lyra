import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

// A served page as the build writes it, cut down to the tags the worker rewrites.
const shell = [
  "<title>Lyra — Keep the song in sight</title>",
  '<meta name="description" content="Home description" />',
  '<meta property="og:url" content="/" />',
  '<meta property="og:title" content="Lyra — Keep the song in sight" />',
  '<meta property="og:description" content="Home description" />',
  '<meta property="og:image" content="/og-image.png" />',
  "</head>",
].join("\n");

const site = (pages = {}) => ({
  ASSETS: {
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/" || pathname === "/index.html") {
        return new Response(shell, { status: 200, headers: { "content-type": "text/html; charset=utf-8", etag: '"abc"', "content-length": "999" } });
      }
      if (pathname in pages) return new Response(pages[pathname], { status: 200 });
      return new Response("missing", { status: 404 });
    },
  },
});

test("gives the home page absolute link-preview addresses for the serving host", async () => {
  const response = await worker.fetch(new Request("https://lyra.example/", { headers: { accept: "text/html" } }), site());
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<meta property="og:image" content="https:\/\/lyra\.example\/og-image\.png"/);
  assert.match(html, /<meta property="og:url" content="https:\/\/lyra\.example\/"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/lyra\.example\/"/);
  assert.match(html, /<title>Lyra — Keep the song in sight<\/title>/);
  assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("content-length"), null);
});

test("gives the downloads page its own preview, even for crawlers that accept anything", async () => {
  const response = await worker.fetch(new Request("https://lyra.example/download/?platform=macos", { headers: { accept: "*/*" } }), site());
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<title>Download Lyra<\/title>/);
  assert.match(html, /<meta property="og:title" content="Download Lyra"/);
  assert.match(html, /<meta property="og:description" content="Free for macOS/);
  assert.match(html, /<meta name="description" content="Free for macOS/);
  assert.match(html, /<meta property="og:url" content="https:\/\/lyra\.example\/download"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/lyra\.example\/download" \/>\n  <\/head>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/lyra\.example\/og-image\.png"/);
});

test("answers a crawler without an accept header with the app shell", async () => {
  const response = await worker.fetch(new Request("https://lyra.example/download"), site());
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Download Lyra<\/title>/);
});

test("does not turn a missing file into the app shell", async () => {
  const response = await worker.fetch(new Request("https://lyra.example/missing.png", { headers: { accept: "*/*" } }), site());
  assert.equal(response.status, 404);
});

test("leaves non-HTML files untouched", async () => {
  const response = await worker.fetch(new Request("https://lyra.example/robots.txt"), site({ "/robots.txt": "User-agent: *" }));
  assert.equal(await response.text(), "User-agent: *");
});
