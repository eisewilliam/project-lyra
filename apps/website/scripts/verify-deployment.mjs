import assert from "node:assert/strict";

// Checks a running deployment the way a crawler sees it: raw HTML, no
// JavaScript. Every page in sitemap.xml must carry its own title, description,
// heading and copy in the HTML itself.

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:8787").origin;
const request = (path, accept = "*/*") => fetch(new URL(path, origin), {
  headers: { accept },
  redirect: "manual",
  signal: AbortSignal.timeout(15_000),
});
const attribute = (html, pattern) => pattern.exec(html)?.[1];

const robots = await (await request("/robots.txt")).text();
assert.match(robots, /^Sitemap: https:\/\/lyra\.eiselabs\.com\/sitemap\.xml$/m, "robots.txt points to the sitemap");

const sitemap = await request("/sitemap.xml");
assert.equal(sitemap.status, 200, "sitemap.xml loads");
const paths = [...(await sitemap.text()).matchAll(/<loc>https:\/\/lyra\.eiselabs\.com(\/[^<]*)<\/loc>/g)].map(match => match[1]);
assert.ok(paths.includes("/") && paths.includes("/download"), "sitemap lists the home and downloads pages");

const titles = new Set();
for (const path of paths) {
  // Crawlers often send */* or no accept header at all.
  const response = await request(path);
  assert.equal(response.status, 200, `${path}: page must load`);
  if (new URL(origin).hostname === "lyra.eiselabs.com") assert.equal(response.headers.get("x-robots-tag"), null, `${path}: indexable`);
  if (new URL(origin).hostname.endsWith(".workers.dev")) assert.equal(response.headers.get("x-robots-tag"), "noindex", `${path}: preview copies are not indexed`);
  const html = await response.text();

  const title = attribute(html, /<title>([^<]+)<\/title>/);
  assert.ok(title && !titles.has(title), `${path}: its own title`);
  titles.add(title);
  assert.ok(attribute(html, /<meta name="description" content="([^"]{50,})"/), `${path}: description`);
  // Every copy of the site points search engines at the production address.
  assert.equal(attribute(html, /<link rel="canonical" href="([^"]+)"/), `https://lyra.eiselabs.com${path}`, `${path}: canonical URL`);
  assert.equal(attribute(html, /<meta property="og:url" content="([^"]+)"/), `https://lyra.eiselabs.com${path}`, `${path}: link-preview URL`);
  assert.match(html, /<meta property="og:image" content="https:\/\/lyra\.eiselabs\.com\/og-image\.png"/, `${path}: absolute share image`);
  const heading = attribute(html, /<h1\b[^>]*>(.*?)<\/h1>/s)?.replace(/<[^>]+>/g, "").trim();
  assert.ok(heading, `${path}: heading in the HTML`);
  assert.match(html, /<main\b[^>]*>[\s\S]*<p\b/, `${path}: copy in the HTML`);
  if (path === "/") assert.match(html, /<script type="application\/ld\+json">[^<]*"SoftwareApplication"/, "home: structured data");

  const script = /<script\b[^>]*\bsrc="([^"]+)"/.exec(html)?.[1];
  assert.ok(script, `${path}: client bundle`);
  const bundle = await request(script);
  assert.equal(bundle.status, 200, `${path}: client bundle loads`);
  assert.match(bundle.headers.get("content-type") ?? "", /javascript/, `${path}: client bundle type`);
  await bundle.arrayBuffer();
}

const slash = await request("/download/?platform=macos");
assert.equal(slash.status, 301, "/download/ redirects");
assert.equal(new URL(slash.headers.get("location") ?? "", origin).pathname, "/download", "/download/ redirects to /download");

const missingPage = await request("/lyra-deployment-missing-page", "text/html");
assert.equal(missingPage.status, 404, "unknown pages answer 404");
// The SPA shell; the not-found page renders in the browser.
assert.match(await missingPage.text(), /<title>Page not found — Lyra<\/title>/, "unknown pages get the SPA shell");

const image = await request("/og-image.png");
assert.equal(image.status, 200, "share image loads");
assert.match(image.headers.get("content-type") ?? "", /image\/png/, "share image type");
const png = Buffer.from(await image.arrayBuffer());
assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "share image is a PNG");
assert.equal(png.readUInt32BE(16), 1200, "share image width");
assert.equal(png.readUInt32BE(20), 630, "share image height");

for (const path of ["/assets/lyra-deployment-missing.js", "/lyra-deployment-missing.png"]) {
  const response = await request(path);
  assert.equal(response.status, 404, `${path}: missing files must not become pages`);
  await response.arrayBuffer();
}

console.log(`Verified ${origin}: ${paths.length} prerendered pages from the sitemap, robots.txt, redirects, the SPA shell for unknown pages, client bundles, share image, and missing files.`);
