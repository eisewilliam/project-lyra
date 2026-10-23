import assert from "node:assert/strict";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:8787").origin;
const request = (path, accept = "*/*") => fetch(new URL(path, origin), {
  headers: { accept },
  signal: AbortSignal.timeout(15_000),
});

for (const path of ["/", "/download?platform=macos", "/download/"]) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path}: page must load`);
  const html = await response.text();
  const canonical = origin + (path === "/" ? "/" : "/download");
  const title = path === "/" ? "Lyra — Keep the song in sight" : "Download Lyra";
  assert.ok(html.includes(`<title>${title}</title>`), `${path}: page title`);
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), `${path}: canonical URL`);
  assert.ok(html.includes(`property="og:image" content="${origin}/og-image.png"`), `${path}: absolute share image`);
  assert.match(html, /<div id="root"><\/div>/, `${path}: React app shell`);
  const script = /<script\b[^>]*\bsrc="([^"]+)"/.exec(html)?.[1];
  assert.ok(script, `${path}: client bundle`);
  const bundle = await request(script);
  assert.equal(bundle.status, 200, `${path}: client bundle loads`);
  assert.match(bundle.headers.get("content-type") ?? "", /javascript/, `${path}: client bundle type`);
  await bundle.arrayBuffer();
}

const image = await request("/og-image.png");
assert.equal(image.status, 200, "share image loads");
assert.match(image.headers.get("content-type") ?? "", /image\/png/, "share image type");
const png = Buffer.from(await image.arrayBuffer());
assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "share image is a PNG");
assert.equal(png.readUInt32BE(16), 1200, "share image width");
assert.equal(png.readUInt32BE(20), 630, "share image height");

for (const path of ["/assets/lyra-deployment-missing.js", "/lyra-deployment-missing.png"]) {
  const response = await request(path);
  assert.equal(response.status, 404, `${path}: missing files must not become app pages`);
  await response.arrayBuffer();
}

console.log(`Verified ${origin}: home, downloads, crawler metadata, client bundles, share image, and missing files.`);
