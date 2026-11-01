import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {createHash} from "node:crypto";

const archive = path.resolve(process.argv[2] || "bank-roll-cpanel.zip");
const listing = execFileSync("unzip", ["-Z1", archive], {encoding: "utf8"}).trim().split(/\r?\n/).filter(Boolean);
const entries = new Set(listing);
const topLevels = new Set(listing.map((entry) => entry.split("/")[0]).filter(Boolean));
assert.deepEqual([...topLevels], ["public_html"], "archive must have exactly one top-level public_html directory");
assert.ok(entries.has("public_html/.htaccess"), "root .htaccess is required");
for (const required of [
  "index.html",
  "research.html",
  "test-mode.html",
  "player.html",
  "faq.html",
  "docs.html",
  "assets/css/bank-roll.css",
  "assets/css/player.css",
  "src/ui/app.js",
  "src/ui/player-app.js",
  "src/ui/research-app.js",
  "src/ui/version-label.js",
  "src/core/version.js",
  "src/ui/sandbox-app.js",
  "src/ui/documentation-search.js",
  "src/simulation/sandbox-session.js",
  "src/workers/research-worker.js",
]) assert.ok(entries.has(`public_html/${required}`), `missing public runtime file: ${required}`);

for (const entry of listing){
  assert.ok(!/(^|\/)\.git(?:\/|$)/.test(entry), `Git metadata must not be packaged: ${entry}`);
  assert.ok(!/(^|\/)(?:tests|docs|scripts|research-results|server|node_modules)(?:\/|$)/.test(entry), `development/private content must not be packaged: ${entry}`);
  assert.ok(!/(^|\/)(?:\.env[^/]*|[^/]*\.(?:pem|key)|config\.php|[^/]*credentials[^/]*)$/i.test(entry), `private configuration must not be packaged: ${entry}`);
  assert.ok(!/\.(?:zip|tar|gz|tgz)$/i.test(entry), `nested archive must not be packaged: ${entry}`);
}

const readText = (relativePath) => execFileSync("unzip", ["-p", archive, `public_html/${relativePath}`], {encoding: "utf8"});
const htmlPages = ["index.html", "research.html", "test-mode.html", "player.html", "faq.html", "docs.html"];
const version = readText("src/core/version.js").match(/APP_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
assert.ok(version, "single app version source is required");
const buildInfo = JSON.parse(readText("build-info.json"));
assert.equal(buildInfo.version, version);
assert.match(buildInfo.build, /^[a-f0-9]{20}$/);
const cacheKey = `${version}.${buildInfo.build}`;
assert.equal(buildInfo.cacheKey, cacheKey);
assert.ok(readText("src/core/version.js").includes(`APP_BUILD = "${buildInfo.build}"`));
assert.deepEqual(new Set(Object.keys(buildInfo.files)), new Set(listing.filter((entry) => !entry.endsWith("/") && entry !== "public_html/build-info.json").map((entry) => entry.slice("public_html/".length))));
for (const [file, digest] of Object.entries(buildInfo.files)){
  const data = execFileSync("unzip", ["-p", archive, `public_html/${file}`]);
  assert.equal(createHash("sha256").update(data).digest("hex"), digest, `build manifest mismatch: ${file}`);
}
const javascriptFiles = new Set([...entries]
  .filter((entry) => entry.startsWith("public_html/src/") && entry.endsWith(".js"))
  .map((entry) => entry.slice("public_html/".length)));

for (const page of htmlPages){
  const html = readText(page);
  const resourcePaths = [
    ...[...html.matchAll(/<link\b[^>]*href="([^"#]+)"/gi)].map((match) => match[1]),
    ...[...html.matchAll(/<script\b[^>]*src="([^"#]+)"/gi)].map((match) => match[1]),
  ];
  for (const resource of resourcePaths){
    if (/^(?:https?:|data:|\/\/)/i.test(resource)) continue;
    assert.ok(new URL(resource, "https://bank-roll.invalid/").searchParams.get("v") === cacheKey, `${page} asset is not versioned: ${resource}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page), resource.split("?")[0]));
    assert.ok(entries.has(`public_html/${resolved}`), `${page} references missing resource ${resource}`);
  }
}

for (const file of javascriptFiles){
  const source = readText(file);
  for (const match of source.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g)){
    assert.ok(new URL(match[1], "https://bank-roll.invalid/").searchParams.get("v") === cacheKey, `${file} import is not versioned: ${match[1]}`);
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1].split("?")[0]));
    assert.ok(javascriptFiles.has(dependency), `${file} imports missing module ${match[1]}`);
  }
  for (const match of source.matchAll(/new\s+Worker\s*\(\s*new\s+URL\s*\(\s*["']([^"']+)["']/g)){
    assert.ok(new URL(match[1], "https://bank-roll.invalid/").searchParams.get("v") === cacheKey, `${file} worker is not versioned: ${match[1]}`);
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1].split("?")[0]));
    assert.ok(javascriptFiles.has(dependency), `${file} references missing worker ${match[1]}`);
  }
}

const rootHtaccess = readText(".htaccess");
assert.match(rootHtaccess, /RewriteRule \^faq\//);
assert.match(rootHtaccess, /RewriteRule \^docs\//);
assert.match(rootHtaccess, /Content-Security-Policy/);
assert.match(rootHtaccess, /DirectoryIndex player\.html index\.html/);
assert.match(rootHtaccess, /no-cache, must-revalidate/);

const credentialPattern = /brp_[a-f0-9]{64}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/i;
for (const entry of entries){
  if (entry.endsWith("/")) continue;
  const contents = execFileSync("unzip", ["-p", archive, entry], {encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
  assert.ok(!credentialPattern.test(contents), `credential-like content found in ${entry}`);
}

execFileSync("unzip", ["-tq", archive], {stdio: "ignore"});
console.log(`Verified ${entries.size} archive entries, one public_html root, local module dependencies, security policy and ZIP integrity.`);
