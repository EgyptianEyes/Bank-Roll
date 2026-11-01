import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.env.BANKROLL_BROWSER_ROOT || ".");
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json"};
createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = pathname === "/" ? "home.html" : ["faq", "docs"].includes(pathname.slice(1)) ? `${pathname.slice(1)}.html` : pathname.slice(1);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)){
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    response.writeHead(200, {"Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache, must-revalidate"});
    response.end(content);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") console.error(error);
    response.writeHead(404).end("Not found");
  }
}).listen(4178, "127.0.0.1");
