// Local static preview: the exact public/ files deployed by GitHub Pages.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain'};
const server=http.createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method))throw new Error();
    const url=new URL(req.url,'http://localhost');const name=decodeURIComponent(url.pathname);
    if(name.includes('\\')||name.split('/').some(x=>x==='..'||x.startsWith('.')))throw new Error();
    const file=path.resolve(base,name==='/'?'index.html':name.slice(1));
    if(!file.startsWith(base+path.sep)||!(await stat(file)).isFile())throw new Error();
    const type=types[path.extname(file)];if(!type)throw new Error();
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:await readFile(file));
  }catch{res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Static preview: file not found.'}));}
});
const port=Number(process.env.PORT||4174);server.listen(port,'127.0.0.1',()=>console.log(`GitHub Pages demo preview: http://127.0.0.1:${port}`));
process.once('SIGINT',()=>server.close(()=>process.exit(0)));
