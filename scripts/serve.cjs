const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
http.createServer((req,res) => {
  let name;
  try {name = decodeURIComponent(new URL(req.url,'http://localhost').pathname)} catch {res.writeHead(400).end();return}
  // Mirror the GitHub Pages project path for checking relative links locally.
  name = name.replace(/^\/mipt-interactive-materials(?=\/|$)/,'');
  let file = path.resolve(root,'.'+(name||'/'));
  if (!file.startsWith(root+path.sep) && file!==root) {res.writeHead(403).end();return}
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!req.url.split('?')[0].endsWith('/')) {res.writeHead(301,{Location:req.url.split('?')[0]+'/'}).end();return}
    file=path.join(file,'index.html');
  }
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404).end('Not found');return}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(data);
  });
}).listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:4173/mipt-interactive-materials/'));
