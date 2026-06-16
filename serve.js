/* Zero-dependency static server for local preview. Usage: `node serve.js [port]` */
var http = require("http");
var fs = require("fs");
var path = require("path");

var port = parseInt(process.argv[2], 10) || 8080;
var root = __dirname;
var types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  var filePath = path.join(root, path.normalize(urlPath));
  if (filePath.indexOf(root) !== 0) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, function () {
  console.log("Compound Calculator → http://localhost:" + port);
});
