// Serves the static export and proxies /api to the sandbox API, like Netlify and Caddy do in production.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
const API_PORT = Number(process.env.API_PORT ?? 3000);
// Netlify applies public/_headers in production; apply the "/*" block here so the browser tests run under the same CSP.
const globalHeaders = {};
try {
  let on = false;
  for (const line of fs.readFileSync(path.join(root, "_headers"), "utf8").split("\n")) {
    if (/^\S/.test(line)) on = line.trim() === "/*";
    else if (on && line.includes(":")) globalHeaders[line.slice(0, line.indexOf(":")).trim()] = line.slice(line.indexOf(":") + 1).trim();
  }
} catch {}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".json": "application/json" };

const server = http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) {
      const p = http.request({ host: "127.0.0.1", port: API_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      p.on("error", () => { res.writeHead(502); res.end(); });
      req.pipe(p);
      return;
    }
    let f = path.join(root, decodeURIComponent(url.pathname));
    if (fs.existsSync(f + ".html")) f += ".html";
    else if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { ...globalHeaders, "content-type": types[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  })
  ;
// WebSocket upgrades go to the API too (Caddy does this in production).
server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/api/")) return socket.destroy();
  const up = net.connect(API_PORT, "127.0.0.1", () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
    if (head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});
server.listen(Number(process.env.PORT ?? 4000), "127.0.0.1");
