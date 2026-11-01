import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {versionAssets} from "../../scripts/version-cpanel-assets.mjs";

test("same-version source changes invalidate root, transitive and worker assets with a unique build", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bank-roll-build-"));
  async function build(name, moduleText){
    const directory = path.join(root, name);
    await mkdir(path.join(directory, "src/core"), {recursive: true});
    await writeFile(path.join(directory, "src/core/version.js"), 'export const APP_VERSION = "1.1.0-next";\nexport const APP_BUILD = "source";\n');
    await writeFile(path.join(directory, "index.html"), '<script type="module" src="src/app.js"></script>');
    await writeFile(path.join(directory, "src/app.js"), 'import {value} from "./value.js";\nimport "./value.js";\nimport("./value.js");\nnew Worker(new URL("./worker.js", import.meta.url), {type:"module"});');
    await writeFile(path.join(directory, "src/value.js"), moduleText);
    await writeFile(path.join(directory, "src/worker.js"), 'import {value} from "./value.js";');
    const result = await versionAssets(directory);
    return {directory, result};
  }
  try {
    const first = await build("first", "export const value = 1;");
    const same = await build("same", "export const value = 1;");
    const changed = await build("changed", "export const value = 2;");
    assert.equal(first.result.build, same.result.build);
    assert.notEqual(first.result.build, changed.result.build);
    const manifest = JSON.parse(await readFile(path.join(changed.directory, "build-info.json"), "utf8"));
    for (const file of ["index.html", "src/app.js", "src/worker.js"]){
      assert.ok((await readFile(path.join(changed.directory, file), "utf8")).includes(`?v=${manifest.cacheKey}`));
    }
    const app = await readFile(path.join(changed.directory, "src/app.js"), "utf8");
    assert.ok(app.includes(`import "./value.js?v=${manifest.cacheKey}"`));
    assert.ok(app.includes(`import("./value.js?v=${manifest.cacheKey}")`));
    assert.ok((await readFile(path.join(changed.directory, "src/core/version.js"), "utf8")).includes(changed.result.build));
    assert.equal(Object.keys(manifest.files).length, 5);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
