import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const html = await readFile(path.join(root, "index.html"), "utf8");
const researchHtml = await readFile(path.join(root, "research.html"), "utf8");
const testModeHtml = await readFile(path.join(root, "test-mode.html"), "utf8");
const faqHtml = await readFile(path.join(root, "faq.html"), "utf8");
const docsHtml = await readFile(path.join(root, "docs.html"), "utf8");

test("static entry page uses external local assets and resolves every module import", async () => {
  assert.doesNotMatch(html, /<style\b|<script\s*>/i);
  const stylesheet = html.match(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/i)?.[1];
  const script = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/i)?.[1];
  assert.equal(stylesheet, "assets/css/bank-roll.css");
  assert.equal(script, "src/ui/app.js");
  const testModeScript = testModeHtml.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/i)?.[1];
  assert.equal(testModeScript, "src/ui/sandbox-app.js");

  const visited = new Set();
  async function visit(relativePath){
    if (visited.has(relativePath)) return;
    visited.add(relativePath);
    const source = await readFile(path.join(root, relativePath), "utf8");
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)){
      const importedPath = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), match[1]));
      await readFile(path.join(root, importedPath), "utf8");
      await visit(importedPath);
    }
  }
  await readFile(path.join(root, stylesheet), "utf8");
  await visit(script);
  await visit(testModeScript);
  assert.ok(visited.has("src/storage/research-client.js"));
  assert.ok(visited.has("src/simulation/sandbox-session.js"));
});

test("every app DOM lookup resolves to one unique element in the preserved markup", async () => {
  const app = await readFile(path.join(root, "src/ui/app.js"), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML ids must be unique");
  const available = new Set(ids);
  const lookups = [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(lookups.filter((id) => !available.has(id)))], []);
});

test("live simulation exposes legacy cold-street and BRI Autonomous as separate modes", () => {
  const modeSelect = html.match(/<select id="simulationMode">([\s\S]*?)<\/select>/)?.[1];
  assert.ok(modeSelect);
  assert.match(modeSelect, /<option value="cold-street" selected(?:="selected")?>|<option value="cold-street">/);
  assert.match(modeSelect, /<option value="bri-autonomous">/);
});

test("table identity is visible and table switching requires an explicit confirmation dialog", () => {
  assert.match(html, /id="researchTableName"/);
  assert.match(html, /<button[^>]*id="btnSwitchResearchTable"[^>]*>Switch Table<\/button>/);
  assert.match(html, /<dialog[^>]*id="tableSwitchDialog"/);
  assert.match(html, /<button[^>]*id="btnConfirmTableSwitch"[^>]*>Confirm switch<\/button>/);
  assert.match(html, /Previous table observations, predictions and research are retained/);
  assert.match(html, /Each run creates a separate session under this table/);
});

test("simulation settings cannot silently define a replacement table profile", async () => {
  assert.doesNotMatch(html, /id="briTableName"|id="briSharedCohort"/);
  const app = await readFile(path.join(root, "src/ui/app.js"), "utf8");
  assert.doesNotMatch(app, /BRI_TABLE_KEY/);
  assert.match(app, /tableProfiles\.ensureActive\(\)/);
});

test("homepage links to the public research page without requesting a missing legacy script", () => {
  assert.match(html, /href="research\.html"/);
  assert.doesNotMatch(html, /<script\s+src="script\.js"/i);
  assert.match(html, /<script\s+type="module"\s+src="src\/ui\/app\.js"/i);
});

test("public research page explains the math, methodology, provenance and limitations", () => {
  assert.match(researchHtml, /<title>Research and Method \| Bank-Roll<\/title>/);
  assert.match(researchHtml, /3 \/ 37/);
  assert.match(researchHtml, /12p − 1/);
  assert.match(researchHtml, /Brier score/);
  assert.match(researchHtml, /synthetic/);
  assert.match(researchHtml, /observed-origin submissions by default/);
  assert.match(researchHtml, /No strategy, progression or model guarantees profit/);
});

test("Test Mode is prominent, temporary and distinct from live observation", () => {
  assert.match(html, /href="test-mode\.html"/);
  assert.match(testModeHtml, /TEST MODE/);
  assert.match(testModeHtml, /Not real-table research/);
  assert.match(testModeHtml, /Expires 24 hours after creation/);
  assert.match(testModeHtml, /End Test &amp; Discard Results/);
  assert.match(testModeHtml, /type="module" src="src\/ui\/sandbox-app\.js"/);
});

test("Test Mode page loads the real BRI engine but cannot access persistence APIs", async () => {
  const app = await readFile(path.join(root, "src/ui/sandbox-app.js"), "utf8");
  const session = await readFile(path.join(root, "src/simulation/sandbox-session.js"), "utf8");
  assert.match(app, /TestModeSession/);
  assert.match(session, /BriCoordinator/);
  assert.match(session, /sourceType = "test"/);
  assert.doesNotMatch(app, /ResearchClient|localStorage|sessionStorage|indexedDB|fetch\(/);
  assert.doesNotMatch(session, /ResearchClient|localStorage|sessionStorage|indexedDB|fetch\(/);
});

test("every Test Mode DOM binding resolves to a unique element", async () => {
  const app = await readFile(path.join(root, "src/ui/sandbox-app.js"), "utf8");
  const ids = [...testModeHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Test Mode HTML ids must be unique");
  const available = new Set(ids);
  const lookups = [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(lookups.filter((id) => !available.has(id)))], []);
});

test("FAQ and technical documentation cover the required public knowledge areas", () => {
  for (const phrase of ["What is Bank-Roll?", "What is Bank-Roll Intelligence?", "What is the gambler's fallacy?", "Can I upload historical results?", "What remains unproven?"]){
    assert.ok(faqHtml.includes(phrase), `FAQ is missing: ${phrase}`);
  }
  assert.ok([...faqHtml.matchAll(/<details data-searchable>/g)].length >= 30, "FAQ should contain substantive searchable answers rather than placeholder entries");
  for (const phrase of ["Getting Started", "Human Observation", "Test Mode", "Research Laboratory", "BRI Architecture", "Randomness Integrity", "Statistical Methodology", "Data Integrity", "Collective Intelligence", "Living Website", "Developers", "Research Reproducibility"]){
    assert.ok(docsHtml.includes(phrase), `Technical documentation is missing: ${phrase}`);
  }
  assert.match(faqHtml, /data-document-search/);
  assert.match(docsHtml, /data-document-search/);
  assert.doesNotMatch(faqHtml + docsHtml, /TODO|TBD|lorem ipsum/i);
});

test("knowledge search filters authored DOM text without network or HTML execution", async () => {
  const search = await readFile(path.join(root, "src/ui/documentation-search.js"), "utf8");
  assert.match(search, /textContent\.toLocaleLowerCase\(\)\.includes\(query\)/);
  assert.match(search, /knowledge-sidebar a, \.knowledge-index a/);
  assert.match(search, /data-document-empty/);
  assert.doesNotMatch(search, /fetch\(|innerHTML|eval\(|new Function/);
  const router = await readFile(path.join(root, "tests/php/router.php"), "utf8");
  assert.match(router, /'\/faq' => 'faq\.html'/);
  assert.match(router, /'\/docs' => 'docs\.html'/);
});