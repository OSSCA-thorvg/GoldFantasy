// Headless Character Studio verification. Always muted; owned browser/server close in finally.
// Usage: node tools/verify_character_studio.mjs [web-directory] [output-directory]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const root = path.resolve(process.argv[2] || 'artifacts/web-witheditor');
const output = path.resolve(process.argv[3] || 'artifacts/character-validation');
const fixture=fs.readFileSync('docs/character-system/references/pool/derived/control-study.character','utf8');
fs.mkdirSync(output,{recursive:true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthold-character-browser-'));
const log = fs.openSync(path.join(output,'browser-process.log'), 'w');
const server = http.createServer((request,response) => {
  const name = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const target = path.resolve(root, '.' + name);
  if (!target.startsWith(root + '/') || !fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404); response.end(); return; }
  const ext = path.extname(target);
  response.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.data':'application/octet-stream'})[ext] || 'application/octet-stream');
  if (target.endsWith('Hearthold.html')) {
    response.end(fs.readFileSync(target,'utf8')
      .replace("arguments: ['--renderer'", "arguments: ['--character-studio', '--character-file', '/character-validation.character', '--renderer'")
      .replace('const FS = Module.FS;',`const FS = Module.FS; FS.writeFile('/character-validation.character',${JSON.stringify(fixture)});`));
  } else fs.createReadStream(target).pipe(response);
});
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(fn, label, ms=45000) {
  const end=Date.now()+ms;
  while(Date.now()<end) { let value; try {value=await fn();} catch{} if(value)return value; await pause(100); }
  throw new Error('Timeout: '+label);
}
class CDP {
  constructor(ws) { this.ws=ws; this.id=0; this.pending=new Map(); this.events=[]; ws.addEventListener('message',event=>{ const value=JSON.parse(event.data); if(value.id) { const pending=this.pending.get(value.id); if(!pending)return; this.pending.delete(value.id); clearTimeout(pending.timer); if(value.error)pending.reject(new Error(JSON.stringify(value.error))); else pending.resolve(value.result); } else this.events.push(value); }); ws.addEventListener('close',()=>{for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('CDP closed'));}this.pending.clear();}); }
  static async connect(url) {const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});return new CDP(ws);}
  send(method,params={}) {const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout '+method));},60000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expression) {const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
}
let browser, browserCDP;
const stopBrowser=()=>{if(browserCDP)browserCDP.send('Browser.close').catch(()=>{});else if(browser&&browser.exitCode===null)browser.kill('SIGTERM');};
process.once('SIGTERM',stopBrowser);process.once('SIGINT',stopBrowser);
const results=[];
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=spawn(process.env.CHROMIUM || '/usr/bin/chromium',['--headless','--mute-audio','--no-sandbox','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-allow-origins=*',`--user-data-dir=${profile}`,'--enable-gpu','--use-angle=vulkan','--enable-features=Vulkan,VulkanFromANGLE','--disable-vulkan-surface','--enable-unsafe-webgpu','--window-size=1280,800','about:blank'],{stdio:['ignore',log,log],env:{...process.env,ORCA_BACKGROUND_LAUNCH:'1'}});
  console.log(JSON.stringify({ownedBrowser:browser.pid,ownedServer:process.pid,profile,port:server.address().port}));
  const active=await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')) && fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8'),'devtools');
  const [port,browserPath]=active.trim().split('\n');
  browserCDP=await CDP.connect(`ws://127.0.0.1:${port}${browserPath}`);
  for (const renderer of ['gl','wgpu']) {
    const target=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`,{method:'PUT'}).then(r=>r.json());
    const tab=await CDP.connect(target.webSocketDebuggerUrl);
    await tab.send('Page.enable'); await tab.send('Runtime.enable');
    await tab.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await tab.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/Hearthold.html?renderer=${renderer}`});
    await until(()=>tab.eval("document.body.dataset.ready==='true' && Number(document.body.dataset.frames)>12"),'studio '+renderer,60000);
    const hashes={};
    async function capture(name) {
      const png = renderer==='wgpu' ? (await tab.eval("document.getElementById('canvas').toDataURL('image/png')")).split(',')[1] : (await tab.send('Page.captureScreenshot',{format:'png'})).data;
      const file=path.join(output,`${renderer}-${name}.png`);
      fs.writeFileSync(file,Buffer.from(png,'base64'));
      hashes[name]=await tab.eval(`(async()=>{
        const bitmap=new Image();bitmap.src='data:image/png;base64,${png}';await bitmap.decode();
        const result={};
        // The head crop includes the full edited jaw (ending near y=397),
        // while the copied costume collar starts at y=403 in this fixture.
        for(const [key,x,y,w,h] of [['portrait',192,166,300,403],['head',192,166,300,235],['upperHead',192,166,300,199],['fringe',310,260,65,70],['body',508,166,396,403],['legs',655,480,95,75]]){
          const image=document.createElement('canvas');image.width=w;image.height=h;
          const c=image.getContext('2d');c.drawImage(bitmap,-x,-y);
          const pixels=c.getImageData(0,0,w,h).data;
          // Only the copied white legs are compared: the completed back hair
          // is allowed to change the background visible between them.
          const sample=key==='legs'?Uint8Array.from({length:w*h},(_,i)=>pixels[i*4]>245&&pixels[i*4+1]>245&&pixels[i*4+2]>245?1:0):pixels;
          if(key==='legs'&&sample.reduce((sum,value)=>sum+value,0)<30)throw new Error('Copied leg mask is empty');
          const digest=await crypto.subtle.digest('SHA-256',sample);
          result[key]=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
        }
        return result;
      })()`);
      return file;
    }
    async function click(x,y) {
      const before=await tab.eval('Number(document.body.dataset.frames)');
      await tab.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
      await tab.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
      await until(()=>tab.eval(`Number(document.body.dataset.frames)>${before+1}`),'control paint '+renderer);
    }
    async function changed(name,previous,region='head') {
      const file=await capture(name);
      if(hashes[name][region]===hashes[previous][region])await until(async()=>{await capture(name);return hashes[name][region]!==hashes[previous][region];},region+' presentation '+name+' '+renderer,10000);
      return file;
    }
    async function savedState(expected={}) {
      // WebGPU presentation/frame counters can advance before the UI's save
      // callback runs. Wait for the requested state in the actual saved file.
      return until(async()=>{
        await click(958,679);
        const source=await tab.eval("Module.FS.readFile('/character-validation.character',{encoding:'utf8'})");
        const state=Object.fromEntries(source.trim().split('\n').map(line=>{const [key,...values]=line.split(' ');return [key,values.map(Number)];}));
        return (expected.hair===undefined||state.assets[1]===expected.hair)&&(expected.outfit===undefined||state.assets[3]===expected.outfit)?state:false;
      },'saved selection '+renderer,10000);
    }
    const screenshots=[await capture('initial')];
    await pause(1300);
    screenshots.push(await capture('static'));
    await click(1230,315); // Species metadata has no visual effect.
    screenshots.push(await capture('species'));
    await click(80,196); // Upper skull: target selection and interpolation.
    await click(1230,315);
    await click(1230,315);
    await click(1190,371);
    await click(1190,415);
    await click(1190,459);
    screenshots.push(await changed('fit','species'));
    await click(1230,186); // Jaw region.
    // A pronounced source profile makes the interpolation measurable even
    // after symmetrization makes the first two original jaw widths similar.
    for(let step=0;step<23;++step)await click(1230,315); // Dot construction 4.
    await click(1180,371);
    screenshots.push(await changed('jaw','fit'));
    await click(80,272); // Original library / whole hairstyle, preserving skull.
    await click(1230,315);
    screenshots.push(await changed('hair','jaw'));
    await click(80,196);
    // From Jaw, advance Face style then Ears.
    await click(1230,186);await click(1230,186);
    await click(1230,250);
    await click(1180,307);await click(1120,351);await click(1160,395);
    screenshots.push(await changed('ears','hair'));
    await click(80,272);
    const cycleHeads=new Set(),cycleIds=new Set();let cycleFeet=true,wholeStyles=true,previousHead=hashes.ears.head;
    for(let step=0;step<19;++step) {
      await click(1230,315);
      const name='cycle-'+String(step).padStart(2,'0');
      const file=await capture(name);
      if(hashes[name].head===previousHead)await until(async()=>{await capture(name);return hashes[name].head!==previousHead;},'hairstyle readback '+renderer,10000);
      screenshots.push(file);previousHead=hashes[name].head;
      cycleHeads.add(hashes[name].head);cycleFeet &&=hashes[name].legs===hashes.hair.legs;
      const selected=await savedState({hair:[2,3,4,5,6,7,8,9,11,12,13,14,15,16,17,18,19,0,1][step]});cycleIds.add(selected.assets[1]);wholeStyles &&=selected['hair-parts'].every(value=>value===255);
      if(step%5===4)console.log(renderer+': '+(step+1)+' hairstyles verified');
    }
    await click(80,234); // Default dots -> open eyes.
    screenshots.push(await capture('dots'));
    await click(1230,250);
    screenshots.push(await changed('open','dots'));
    await click(1150,435);
    screenshots.push(await changed('eye-size','open'));
    await click(1230,186);await click(1230,186); // Outlines.
    await click(1230,250);
    screenshots.push(await changed('outline','eye-size'));
    await click(1230,186); // Independent eyebrows.
    await click(1230,250);
    await click(1170,371);await click(1160,503);
    screenshots.push(await changed('brows','outline'));
    await click(80,310);
    screenshots.push(await capture('outfit-before'));
    await click(1230,186);
    screenshots.push(await changed('outfit-after','outfit-before','body'));
    const outfitState=await savedState({hair:1,outfit:1});
    const selectedOutfits=new Set([outfitState.assets[3]]);
    for(const outfit of [2,3,4,5,6,7,8,9,11,12,13,0,1]) {
      await click(1230,186);
      const selected=await savedState({hair:1,outfit});selectedOutfits.add(selected.assets[3]);
    }
    await click(80,158); // Character / Reference look: flat-lid elf, then Original.
    await click(1230,443);await click(1230,507);
    screenshots.push(await changed('reference-flat','outfit-after'));
    await click(1230,443);await click(1230,507);
    screenshots.push(await changed('reference-restored','reference-flat'));
    const restored=await savedState({hair:0,outfit:1});
    await until(()=>tab.eval('Number(document.body.dataset.frames)>=60'),'sustained frames '+renderer,60000);
    const state=await tab.eval("({dataset:{...document.body.dataset},status:document.getElementById('status').textContent})");
    const errors=tab.events.filter(e=>e.method==='Runtime.exceptionThrown' || e.method==='Runtime.consoleAPICalled' && e.params.type==='error');
    if(state.dataset.error || errors.length)throw new Error(JSON.stringify({renderer,state,errors}));
    const checks={allOriginalHairstyles:cycleHeads.size===19&&cycleIds.size===19,allHairstylesKeepFeet:cycleFeet,static:hashes.initial.portrait===hashes.static.portrait,
      species:hashes.initial.portrait===hashes.species.portrait,
      hairKeepsBody:hashes.initial.legs===hashes.hair.legs,
      earsKeepHair:hashes.hair.fringe===hashes.ears.fringe,
      earsKeepBody:hashes.hair.legs===hashes.ears.legs,
      craniumChangesHead:hashes.species.head!==hashes.fit.head,
      jawChangesHead:hashes.fit.head!==hashes.jaw.head,
      hairstyleChangesHead:hashes.jaw.head!==hashes.hair.head,
      earControlsChangeHead:hashes.hair.head!==hashes.ears.head,
      dotOpenSwitch:hashes.dots.head!==hashes.open.head,
      eyeSize:hashes.open.head!==hashes['eye-size'].head,
      eyeOutline:hashes['eye-size'].head!==hashes.outline.head,
      eyebrowControls:hashes.outline.head!==hashes.brows.head,
      outfitHead:hashes['outfit-before'].head===hashes['outfit-after'].head,
      outfitBody:hashes['outfit-before'].body!==hashes['outfit-after'].body,
      tousledRemoved:!cycleIds.has(10),wholeStylesOnly:wholeStyles,
      referenceRestoresHead:hashes.initial.upperHead===hashes['reference-restored'].upperHead&&restored.face[0]===.5&&restored.jaw.every(value=>value===1)&&restored.cranium.slice(1).every((value,i)=>value===[1,1,0,1][i]),
      referenceRestoresDots:restored['eye-system'][0]===0&&restored['eye-system'][2]===0&&restored['eye-system'][4]===0,
      referenceKeepsOutfit:restored.assets[3]===outfitState.assets[3],
      thirteenOutfits:selectedOutfits.size===13,smallShoulderCapeRemoved:!selectedOutfits.has(10)};
    if(!Object.values(checks).every(Boolean))throw new Error(JSON.stringify({renderer,checks,uniqueHeadPixels:cycleHeads.size,selectedOriginalIds:[...cycleIds]}));
    results.push({renderer,state,screenshots,errors,checks,selectedOriginalIds:[...cycleIds],selectedOutfitIds:[...selectedOutfits],restoredReference:restored});
    console.log(renderer+': '+Object.keys(checks).length+' checks passed');
    tab.ws.close(); await browserCDP.send('Target.closeTarget',{targetId:target.id});
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  if(browserCDP) {try {await Promise.race([browserCDP.send('Browser.close'),pause(2000)]);}catch{} browserCDP.ws.close();}
  if(browser && browser.exitCode===null) {await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),pause(3000)]); if(browser.exitCode===null) {browser.kill('SIGTERM'); await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),pause(3000)]);} }
  await new Promise(resolve=>server.close(resolve));
  fs.closeSync(log); fs.rmSync(profile,{recursive:true,force:true});
  console.log('Owned test browser and server stopped.');
}
