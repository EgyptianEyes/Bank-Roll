import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const html = await readFile(path.join(root, "index.html"), "utf8");
const researchHtml = await readFile(path.join(root, "research.html"), "utf8");

test("static entry page uses external local assets and resolves every module import", async () => {
  assert.doesNotMatch(html, /<style\b|<script\s*>/i);
  const stylesheet = html.match(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/i)?.[1];
  const script = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/i)?.[1];
  assert.equal(stylesheet, "assets/css/bank-roll.css");
  assert.equal(script, "src/ui/app.js");

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
  assert.ok(visited.has("src/storage/research-client.js"));
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