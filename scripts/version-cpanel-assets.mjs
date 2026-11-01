import {readdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {APP_VERSION} from "../src/core/version.js";

const LOCAL_ASSET = /(["'])((?:\.{1,2}\/|assets\/|src\/)[^"'?#]+\.(?:m?js|css))(?:\?[^"']*)?\1/g;

async function* walk(directory){
  for (const entry of (await readdir(directory, {withFileTypes: true})).sort((left, right) => left.name.localeCompare(right.name))){
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else yield fullPath;
  }
}

export async function versionAssets(directory){
  const files = [];
  const hash = createHash("sha256");
  for await (const file of walk(directory)){
    files.push(file);
    hash.update(path.relative(directory, file)).update("\0").update(await readFile(file)).update("\0");
  }
  const build = hash.digest("hex").slice(0, 20);
  const cacheKey = `${APP_VERSION}.${build}`;
  await writeFile(path.join(directory, "src/core/version.js"), `export const APP_VERSION = ${JSON.stringify(APP_VERSION)};\nexport const APP_BUILD = ${JSON.stringify(build)};\n`);
  let updatedFiles = 0;
  const fileHashes = {};
  for (const file of files){
    if (/\.(?:html|m?js|css)$/.test(file)){
      const source = await readFile(file, "utf8");
      const versioned = source.replace(LOCAL_ASSET, (_match, quote, resource) => `${quote}${resource}?v=${encodeURIComponent(cacheKey)}${quote}`);
      if (versioned !== source){
        await writeFile(file, versioned);
        updatedFiles++;
      }
    }
    fileHashes[path.relative(directory, file)] = createHash("sha256").update(await readFile(file)).digest("hex");
  }
  await writeFile(path.join(directory, "build-info.json"), JSON.stringify({version: APP_VERSION, build, cacheKey, algorithm: "sha256", files: fileHashes}, null, 2) + "\n");
  return {version: APP_VERSION, build, updatedFiles};
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname){
  const directory = process.argv[2];
  if (!directory) throw new Error("Pass the staged public_html directory.");
  const result = await versionAssets(directory);
  console.log(`Versioned ${result.updatedFiles} package files with ${result.version}.`);
}