import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
// Maximum 256² map editor workload in a private, muted, headless browser.
const directory=process.argv[2], out=process.argv[3], pageName=process.argv[4]||'Hearthold.html';
if(!directory||!out||!['Hearthold.html','GameEngine.html'].includes(pageName)){
 console.error('usage: node tools/profile_browser_map.mjs WEB_DIR OUTPUT.json [Hearthold.html|GameEngine.html]');process.exit(2);
}
const bundleHashes=async()=>Object.fromEntries(await Promise.all(['html','js','wasm','data'].map(async ext=>{const name=pageName.replace(/html$/,ext);return [name,createHash('sha256').update(await fs.readFile(directory+'/'+name)).digest('hex')]})));
const bundle=await bundleHashes();
const profile=await fs.mkdtemp('/tmp/tellin-map-browser-');
const server=spawn('python3',['-m','http.server','0','--bind','127.0.0.1','--directory',directory],{stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'},detached:true});
let serverOutput='';server.stdout.on('data',v=>serverOutput+=v);server.stderr.on('data',v=>serverOutput+=v);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let browser, socket;
const cleanup=()=>{socket?.close();for(const child of [browser,server])if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch{}}};
process.on('SIGTERM',()=>{cleanup();process.exit(143)});
process.on('SIGINT',()=>{cleanup();process.exit(130)});
const watchdog=setTimeout(()=>{cleanup();process.exit(124)},90000);
try {
 for(let i=0;i<100&&!/port (\d+)/.test(serverOutput);i++)await pause(50);
 const port=Number(/port (\d+)/.exec(serverOutput)?.[1]);if(!port)throw Error('server not started '+serverOutput);
 browser=spawn(process.env.CHROMIUM_PATH||'/usr/lib/chromium/chromium',['--headless=new','--use-gl=angle','--use-angle=gl','--no-sandbox','--mute-audio','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=1280,800','about:blank'],{stdio:'ignore',detached:true});
 let cdp;for(let i=0;i<100;i++){try{cdp=(await fs.readFile(profile+'/DevToolsActivePort','utf8')).split('\n');break}catch{await pause(100)}}if(!cdp)throw Error('browser not started');
 const tabs=await fetch('http://127.0.0.1:'+cdp[0]+'/json/list').then(r=>r.json());
 socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
 let id=0;const pending=new Map(),errors=[];
 socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){let p=pending.get(m.id);pending.delete(m.id);if(p){clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result)}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params)};
 const send=(method,params={})=>new Promise((resolve,reject)=>{let n=++id;pending.set(n,{resolve,reject,timer:setTimeout(()=>reject(Error('CDP timeout '+method)),30000)});socket.send(JSON.stringify({id:n,method,params}))});
 const ev=async expression=>{let r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.probe={frames:[],audioGaps:[],audioCosts:[],period:0,longTasks:[]};
  new PerformanceObserver(list=>{for(const e of list.getEntries())probe.longTasks.push(e.duration)}).observe({type:'longtask',buffered:true});
  const raf=window.requestAnimationFrame;window.requestAnimationFrame=function(fn){return raf.call(window,t=>{const start=performance.now();try{return fn(t)}finally{if(probe.frames.length<8192)probe.frames.push(performance.now()-start)}})};
  const proto=window.AudioContext?.prototype;
  if(proto){const create=proto.createScriptProcessor;proto.createScriptProcessor=function(...args){const node=create.apply(this,args);probe.period=node.bufferSize/this.sampleRate*1000;let p=node,d;while(p&&!d){d=Object.getOwnPropertyDescriptor(p,'onaudioprocess');p=Object.getPrototypeOf(p)}if(d?.set){let callback,previous;Object.defineProperty(node,'onaudioprocess',{configurable:true,get(){return callback},set(fn){callback=fn;d.set.call(node,function(e){const start=performance.now();if(previous&&probe.audioGaps.length<8192)probe.audioGaps.push(start-previous);previous=start;try{return fn.call(this,e)}finally{if(probe.audioCosts.length<8192)probe.audioCosts.push(performance.now()-start)}})}})}return node}};
  let module;Object.defineProperty(window,'Module',{configurable:true,get(){return module},set(v){module=v;if(${JSON.stringify(pageName)}==='Hearthold.html'&&v?.arguments&&!v.arguments.includes('--demo'))v.arguments.push('--map-editor')}});
 `});
 await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'+pageName+'?renderer=gl&probe='+Date.now()});
 let ready=false;for(let i=0;i<200;i++){await pause(100);try{ready=await ev('Number(document.body.dataset.frames)>5');if(ready)break}catch{}}
 if(!ready)throw Error('game not ready');
 if(pageName==='GameEngine.html')await ev("Module.ccall('ui_host_command','number',['string','string'],['edit.map',''])");
 const dimensions=await ev('({w:canvas.clientWidth,h:canvas.clientHeight,x:canvas.getBoundingClientRect().x,y:canvas.getBoundingClientRect().y})');
 const click=async(x,y)=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});await pause(100)};
 const right=dimensions.w-284;
 await click(right+236,436); await click(right+130,478); await pause(2500); // 176 -> 256, regenerate/fit.
 const center={x:216+(dimensions.w-516)/2,y:94+(dimensions.h-188)/2};
 const reset=()=>ev('probe.frames=[];probe.audioGaps=[];probe.audioCosts=[];probe.longTasks=[];true');
 await reset();await pause(3000);const still=await ev('({...probe})');
 await reset();for(let i=0;i<48;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',...center,deltaX:0,deltaY:i<24?-100:100});await pause(65)}await pause(500);const wheel=await ev('({...probe})');
 await click(right+72,323); // Fit island.
 for(let i=0;i<9;i++)await click(172,523); // Largest allowed radius12.
 await click(100,222); // Forest brush.
 if(process.env.HEARTHOLD_CPU_PROFILE){await send('Profiler.enable');await send('Profiler.start')}
 await reset();
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...center,button:'left',buttons:1,clickCount:1});
 for(let i=0;i<40;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:center.x+Math.sin(i*.25)*85,y:center.y+Math.cos(i*.25)*55,button:'left',buttons:1});await pause(70)}
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...center,button:'left',buttons:0,clickCount:1});await pause(500);const paint=await ev('({...probe})');
 if(process.env.HEARTHOLD_CPU_PROFILE){const {profile}=await send('Profiler.stop');await fs.writeFile(out.replace(/\.json$/,'.cpuprofile'),JSON.stringify(profile))}
 await reset();await pause(3000);const paintIdle=await ev('({...probe})');
 const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(out.replace(/\.json$/,'.png'),Buffer.from(shot.data,'base64'));
 const state=await ev('({dataset:{...document.body.dataset},status:document.getElementById("status").textContent,renderer:canvas.getContext("webgl2")?.getParameter(canvas.getContext("webgl2").getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL||0)})');
 const stats=a=>{let b=a.slice().sort((x,y)=>x-y);return {count:b.length,mean:b.reduce((a,v)=>a+v,0)/(b.length||1),p95:b[Math.floor((b.length-1)*.95)],max:b.at(-1)}};
 const summary=p=>({frames:stats(p.frames),audioGaps:stats(p.audioGaps),audioCosts:stats(p.audioCosts),audioPeriod:p.period,longTasks:p.longTasks.length,lateAudio:p.audioGaps.filter(g=>g>p.period*1.5).length});
 if(JSON.stringify(bundle)!==JSON.stringify(await bundleHashes()))throw Error('Served bundle changed during profiling');
 const result={bundle,workload:{mapSize:256,brushRadius:12,wheelInputs:48,dragInputs:40},dimensions,state,errors,still:summary(still),wheel:summary(wheel),paint:summary(paint),paintIdle:summary(paintIdle),raw:{still,wheel,paint,paintIdle}};await fs.writeFile(out,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,raw:undefined},null,2));
 await send('Page.close').catch(()=>{});
} finally {
 clearTimeout(watchdog);cleanup();
 await Promise.all([browser,server].map(child=>!child||child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>{const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}resolve()},2000);child.once('exit',()=>{clearTimeout(timer);resolve()})})));
 await fs.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
