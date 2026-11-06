import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=process.argv[2], out=process.argv[3], pageName=process.argv[4]||'Hearthold.html';
if(!directory||!out||!['Hearthold.html','GameEngine.html','Hearthold-residents-profile.html'].includes(pageName)){
 console.error('usage: node tools/profile_browser_gameplay.mjs WEB_DIR OUTPUT.json [Hearthold.html|GameEngine.html|Hearthold-residents-profile.html]');process.exit(2);
}
const residentProfile=pageName==='Hearthold-residents-profile.html', workers=Number(process.env.HEARTHOLD_PROFILE_WORKERS||100);
const mining=residentProfile&&process.env.HEARTHOLD_PROFILE_MINING==='1';
const woodcutting=residentProfile&&process.env.HEARTHOLD_PROFILE_WOODCUTTING==='1';
if(residentProfile&&(!Number.isInteger(workers)||workers<5||workers>1000))throw Error('HEARTHOLD_PROFILE_WORKERS must be 5..1000');
const bundleHashes=async()=>Object.fromEntries(await Promise.all(['html','js','wasm','data'].map(async ext=>{const name=pageName.replace(/html$/,ext);return [name,createHash('sha256').update(await fs.readFile(directory+'/'+name)).digest('hex')]})));
const bundle=await bundleHashes();
const profile=await fs.mkdtemp(join(tmpdir(),'tellin-gameplay-browser-'));
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
  let module;Object.defineProperty(window,'Module',{configurable:true,get(){return module},set(v){module=v;if(${JSON.stringify(pageName)}==='Hearthold.html'&&v?.arguments&&!v.arguments.includes('--demo'))v.arguments.push('--demo','--days','0');if(${residentProfile}&&v?.arguments&&!v.arguments.includes('--workers'))v.arguments.push('--workers',${JSON.stringify(String(workers))});if(${woodcutting}&&v?.arguments)v.arguments.push('--woodcutting');if(${mining}&&v?.arguments)v.arguments.push('--mining')}});
 `});
 await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'+pageName+'?renderer=gl&probe='+Date.now()});
 let ready=false;for(let i=0;i<200;i++){await pause(100);try{ready=await ev('Number(document.body.dataset.frames)>5');if(ready)break}catch{}}
 if(!ready)throw Error('game not ready');
 if(woodcutting||mining){
  const resource=mining?'stone':'wood', source=mining?'rock':'tree'; const workCount=s=>mining?s.mining:s.felling;
  const command=(id,arg='')=>ev(`Module.ccall('ui_host_command','number',['string','string'],${JSON.stringify([id,arg])})`);
  const state=async()=>{
   if(!await command('profile.state','/tmp/harvesting.json'))throw Error('Cannot read harvesting workload');
   return ev("JSON.parse(Module.FS.readFile('/tmp/harvesting.json',{encoding:'utf8'}))");
  };
  const frames=()=>ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  const step=async seconds=>{await command('profile.step',String(seconds));await frames();return state()};
  const trace=[],shots={};
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});const path=out.replace(/\.json$/,`-${name}.png`);await fs.writeFile(path,Buffer.from(r.data,'base64'));shots[name]=path;trace.push({stage:name,...await state()})};
  const baseline=await state();await shot('idle');
  let s=baseline;
  for(let i=0;i<200&&!(workCount(s)===1&&!s.worker.moving);i++)s=await step(.1);
  if(workCount(s)!==1||s.worker.moving)throw Error('Idle resident never approached a '+source+': '+JSON.stringify(s));
  await shot('at-'+source);
  const started=s.worker.until-6;
  s=await step(Math.max(.1,started+.3-s.clock));await shot(mining?'pickaxe-windup':'axe-windup');
  s=await step(.2);await shot(mining?'pickaxe-strike':'axe-strike');
  for(let i=0;i<80&&s.collecting!==1;i++)s=await step(.1);
  if(s.collecting!==1||s.carrying!==3||s[resource]!==baseline[resource])throw Error('Harvest must finish before hauling or depositing: '+JSON.stringify(s));
  await shot(mining?'rock-broken':'tree-fall-start');s=await step(.3);await shot(mining?'collecting-stone':'tree-falling');
  for(let i=0;i<20&&s.hauling!==1;i++)s=await step(.1);
  if(s.hauling!==1||s.carrying!==3||s[resource]!==baseline[resource])throw Error('Resident did not carry the harvested '+resource+': '+JSON.stringify(s));
  s=await step(.2);await shot('carrying');
  for(let i=0;i<300&&s[resource]===baseline[resource];i++)s=await step(.1);
  if(s[resource]!==baseline[resource]+3||s.carrying!==0)throw Error('Cargo was not deposited on arrival: '+JSON.stringify(s));
  await shot('stored');
  if(errors.length||await ev('Boolean(document.body.dataset.error)'))throw Error('Browser runtime error: '+JSON.stringify(errors));
  if(JSON.stringify(bundle)!==JSON.stringify(await bundleHashes()))throw Error('Served bundle changed during verification');
  const result={bundle,baseline,trace,shots,errors};await fs.writeFile(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  await send('Page.close').catch(()=>{});
 }else{
 if(pageName==='GameEngine.html')await ev("Module.ccall('ui_host_command','number',['string','string'],['play',''])");
 const dimensions=await ev('({w:canvas.clientWidth,h:canvas.clientHeight,x:canvas.getBoundingClientRect().x,y:canvas.getBoundingClientRect().y})');
 const center={x:dimensions.x+dimensions.w/2,y:dimensions.y+dimensions.h/2};
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...center,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...center,button:'left',buttons:0,clickCount:1});
 if(residentProfile)await ev("Module.ccall('ui_host_command','number',['string','string'],['profile.selection','none'])");
 const reset=()=>ev('probe.frames=[];probe.audioGaps=[];probe.audioCosts=[];probe.longTasks=[];true');
 await reset();await pause(4000);const still=await ev('({...probe})');
 await reset();for(let i=0;i<30;i++){await send('Input.dispatchMouseEvent',{type:'mouseWheel',...center,deltaX:0,deltaY:i%20<10?100:-100});await pause(80)}await pause(1000);const wheel=await ev('({...probe})');
 const state=await ev('({dataset:{...document.body.dataset},status:document.getElementById("status").textContent,renderer:canvas.getContext("webgl2")?.getParameter(canvas.getContext("webgl2").getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL||0)})');
 const stats=a=>{let b=a.slice().sort((x,y)=>x-y);return {count:b.length,mean:b.reduce((a,v)=>a+v,0)/(b.length||1),p95:b[Math.floor((b.length-1)*.95)],max:b.at(-1)}};
 const summary=p=>({frames:stats(p.frames),audioGaps:stats(p.audioGaps),audioCosts:stats(p.audioCosts),audioPeriod:p.period,longTasks:p.longTasks.length,lateAudio:p.audioGaps.filter(g=>g>p.period*1.5).length});
 let workload, audioPolicy;
 if(residentProfile){
  const command=(id,arg='')=>ev(`Module.ccall('ui_host_command','number',['string','string'],${JSON.stringify([id,arg])})`);
  const readState=async()=>{
   if(!await command('profile.state','/tmp/residents-profile.json'))throw Error('Cannot read resident workload');
   return ev("JSON.parse(Module.FS.readFile('/tmp/residents-profile.json',{encoding:'utf8'}))");
  };
  workload=await readState();
  if(workload.residents!==workers||workload.assigned!==workers)throw Error('Resident workload is not fully assigned: '+JSON.stringify(workload));
  await command('profile.reset-effects');await command('profile.speak');await pause(100);
  const unselected=await readState();
  if(unselected.speech!==2||unselected.nearbySpeech!==2||unselected.selectedSpeech!==0)throw Error('Nearby residents must share two voice channels: '+JSON.stringify(unselected));
  await command('profile.reset-effects');await command('profile.selection','first');await command('profile.speak');await pause(100);
  const selected=await readState();
  if(selected.speech!==3||selected.selectedSpeech!==1||selected.nearbySpeech!==2)throw Error('One selected and two nearby residents must speak together: '+JSON.stringify(selected));
  await command('profile.reset-effects');await command('profile.selection','all');await command('profile.speak');await pause(100);
  const allSelected=await readState();
  if(allSelected.speech!==1||allSelected.selectedSpeech!==1||allSelected.nearbySpeech!==0)throw Error('Selected residents must share one reserved voice channel: '+JSON.stringify(allSelected));
  await command('profile.selection','none');await pause(100);
  const deselected=await readState();
  if(deselected.selectedSpeech!==0||deselected.speech>2)throw Error('Deselected voices did not move to the nearby budget: '+JSON.stringify(deselected));
  await command('profile.reset-effects');await command('profile.effects');
  const burst=await readState();
  if(burst.effects!==1||burst.accepted!==1||burst.dropped!==99)throw Error('Effect burst was not coalesced: '+JSON.stringify(burst));
  await pause(1800);const drained=await readState();
  if(drained.effects!==0||drained.speech!==0||drained.accepted!==1)throw Error('Audio backlog replayed');
  audioPolicy={unselected,selected,allSelected,deselected,burst,drained};
 }
 if(JSON.stringify(bundle)!==JSON.stringify(await bundleHashes()))throw Error('Served bundle changed during profiling');
 const result={bundle,dimensions,state,errors,workload,audioPolicy,still:summary(still),wheel:summary(wheel),raw:{still,wheel}};await fs.writeFile(out,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,raw:undefined},null,2));
 const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(out.replace(/\.json$/,'.png'),Buffer.from(shot.data,'base64'));
 await send('Page.close').catch(()=>{});
 }
} finally {
 clearTimeout(watchdog);cleanup();
 await Promise.all([browser,server].map(child=>!child||child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>{const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}resolve()},2000);child.once('exit',()=>{clearTimeout(timer);resolve()})})));
 await fs.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
