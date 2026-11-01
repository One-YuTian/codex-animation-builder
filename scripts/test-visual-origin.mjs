import assert from 'node:assert/strict';import {build} from 'esbuild';import {writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';import sharp from 'sharp';import {chromium} from 'playwright';
await mkdir('artifacts/tests',{recursive:true});await build({entryPoints:['server/frame.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'artifacts/tests/visual-center-frame.mjs'});
const {renderFrame}=await import('../artifacts/tests/visual-center-frame.mjs');
const image=await sharp({create:{width:40,height:20,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from('<svg width="40" height="20"><rect x="2" y="2" width="10" height="16" fill="blue"/></svg>')}]).png().toBuffer();
const file=path.resolve('artifacts/tests/visual-center-source.png');await writeFile(file,image);
const layer={id:'l',name:'visual center',assetId:'a',x:60,y:60,width:40,height:20,scaleX:1,scaleY:1,rotation:0,opacity:1,visible:true,locked:false,z:0,semantic:'element',keyframes:[],sequence:[],sequenceStart:0,transformOrigin:'visual-center',pivotX:.175,pivotY:.5};
const project={id:'visual',name:'visual',width:160,height:160,fps:24,duration:3,background:'transparent',revision:0,layers:[layer],assets:[{id:'a',name:'asymmetric',path:file,width:40,height:20}],reviews:[],stage:'compose',frame:0,playing:false};
const bundle=await build({stdin:{contents:"import {SceneRenderer} from './src/renderer';import {setHostFileReader} from './src/files';window.TestRenderer=SceneRenderer;setHostFileReader(async()=>new Blob([new Uint8Array(window.fixture)]));",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
async function center(bytes){const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});let m=0,xs=0,ys=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];m+=a;xs+=(x+.5)*a;ys+=(y+.5)*a;}return [xs/m,ys/m];}
try{const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.evaluate(bytes=>window.fixture=bytes,[...image]);await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(async()=>{window.renderer=new window.TestRenderer(e=>{throw Error(e)});await window.renderer.init(document.getElementById('root'),160,160);});
 for(const [scale,rotation] of [[1,0],[1.5,0],[1.5,90],[.75,180],[1.3,30]]){
  layer.scaleX=layer.scaleY=scale;layer.rotation=rotation;
  const cpu=await center(await renderFrame(project,0));
  const bytes=await page.evaluate(async p=>{await window.renderer.load(p);window.renderer.draw(0,true);return [...await window.renderer.png()];},project);const gpu=await center(Buffer.from(bytes));
  for(const c of [cpu,gpu]){assert.ok(Math.abs(c[0]-67)<1.3,JSON.stringify({scale,rotation,c,cpu,gpu}));assert.ok(Math.abs(c[1]-70)<1.3,JSON.stringify({scale,rotation,c,cpu,gpu}));}
  assert.ok(Math.abs(cpu[0]-gpu[0])<1.3&&Math.abs(cpu[1]-gpu[1])<1.3);
 }
 console.log('PASS: fixed alpha-weighted visual pivot across 5 scale/rotation combinations, CPU and Pixi agree');await page.evaluate(()=>window.renderer.destroy());
}finally{await browser.close();}
