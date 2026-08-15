#!/usr/bin/env node
import { createServer } from "http";
import { parse } from "url";
import path from "path";
import { fileURLToPath } from "url";
import next from "next";
import { bootRest, fromRest, walkCalled } from "./lib/phi_rest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOST || "0.0.0.0";
const publicDir = path.join(__dirname, "public");
const rest = bootRest(publicDir, walkCalled(publicDir, publicDir));
const app = next({ dev, hostname, port, dir: __dirname });
const handle = app.getRequestHandler();

await app.prepare();
createServer((req, res) => {
  const parsed = parse(req.url || "/", true);
  const rel = (parsed.pathname || "/").replace(/^\//, "");
  const buf = fromRest(path.join(publicDir, rel));
  if (buf) {
    res.setHeader("X-Phi-Rest", "open");
    res.setHeader("Content-Length", buf.length);
    res.end(buf);
    return;
  }
  res.setHeader("X-Phi-Rest", "disk");
  handle(req, res, parsed);
}).listen(port, hostname, () => {
  console.log(`[agentrider] http://${hostname}:${port} phi-rest=${rest.n}/${rest.bytes}`);
});
