import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',json:'application/json; charset=utf-8'};
createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(!/^\/(index.html|style.css|app.js|articles.json)?$/.test(path))throw new Error();const file=path==='/'?'index.html':path.slice(1);res.setHeader('Content-Type',types[file.split('.').pop()]);res.end(await readFile(new URL(`../docs/${file}`,import.meta.url)));}catch{res.statusCode=404;res.end('Not found');}}).listen(4173,'127.0.0.1',()=>console.log('http://127.0.0.1:4173'));
