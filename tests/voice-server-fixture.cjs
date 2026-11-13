const http=require('node:http'),{spawn}=require('node:child_process'),fs=require('node:fs');
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1],port=Number(arg('--port')),mode=arg('--mode')||'server';
if(mode==='failure'){console.error('시작 실패 / '+(process.env.FLOWRIUM_TEST_SECRET||''));process.exit(7);}
if(mode==='never'){setInterval(()=>{},1000);}
else if(mode==='child'){
 const child=spawn(process.execPath,[__filename,'--port',String(port),'--mode','server'],{stdio:['ignore','inherit','inherit']});
 if(arg('--marker'))fs.writeFileSync(arg('--marker'),String(child.pid));
 child.once('exit',code=>process.exit(code||0));setInterval(()=>{},1000);
}else if(mode!=='failure'){
 const server=http.createServer((req,res)=>{
  if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'}).end('{"ready":true}');return;}
  if(req.url==='/inference'){req.resume();req.once('end',()=>res.writeHead(200,{'Content-Type':'application/json'}).end('{"text":"관리 서버 인식 결과"}'));return;}
  if(req.url==='/tts'){req.resume();req.once('end',()=>{const wave=Buffer.alloc(364);wave.write('RIFF');wave.writeUInt32LE(356,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(320,40);res.writeHead(200,{'Content-Type':'audio/wav'}).end(wave);});return;}
  res.writeHead(404).end();
 });
 function listen(){server.listen(port,'127.0.0.1',()=>{console.log('서버 준비 / '+port);if(process.env.FLOWRIUM_TEST_SECRET){const secret=process.env.FLOWRIUM_TEST_SECRET;process.stdout.write(secret.slice(0,5));setTimeout(()=>process.stdout.write(secret.slice(5)+'\n'),30);}if(mode==='exit')setTimeout(()=>process.exit(6),250);});}
 server.on('error',error=>{console.error(error.message);process.exit(8);});
 if(arg('--delay'))setTimeout(listen,Number(arg('--delay')));else listen();
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
}
