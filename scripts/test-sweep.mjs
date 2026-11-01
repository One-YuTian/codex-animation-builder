import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {chromium} from 'playwright';
await mkdir('artifacts/tests',{recursive:true});
await build({entryPoints:['server/frame.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'artifacts/tests/effect-frame.mjs'});
const {renderFrame}=await import('../artifacts/tests/effect-frame.mjs');
const rgba=Buffer.alloc(32*32*4);
for(let y=8;y<24;y++)for(let x=8;x<24;x++)if(!(x>=14&&x<18&&y>=14&&y<18))rgba[(y*32+x)*4+3]=255;
const image=await sharp(rgba,{raw:{width:32,height:32,channels:4}}).png().toBuffer();
const file=path.resolve('artifacts/tests/sweep-mask.png');await writeFile(file,image);
const layer={id:'layer',name:'mask fixture',assetId:'asset',x:16,y:16,width:32,height:32,scaleX:1,scaleY:1,rotation:0,opacity:1,visible:true,locked:false,z:0,semantic:'element',keyframes:[],sequence:[],sequenceStart:0,effect:{type:'sweep',color:'#ffffff',width:0.4,angle:0,opacity:1,startFrame:0,endFrame:4,direction:'forward'}};
const project={id:'test',name:'sweep',width:64,height:64,fps:5,duration:1,background:'transparent',revision:0,layers:[layer],assets:[{id:'asset',name:'mask',path:file,width:32,height:32}],reviews:[],stage:'animate',frame:0,playing:false};
const raw=async bytes=>sharp(bytes).ensureAlpha().raw().toBuffer();
const cpu=await raw(await renderFrame(project,2));
const bundle=await build({stdin:{contents:"import {SceneRenderer} from './src/renderer';import {setHostFileReader} from './src/files';window.TestRenderer=SceneRenderer;setHostFileReader(async()=>new Blob([new Uint8Array(window.fixture)]));",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage();
 await page.setContent('<div id="root"></div>');
 await page.evaluate(bytes=>window.fixture=bytes,[...image]);
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const bytes=await page.evaluate(async p=>{window.renderer=new window.TestRenderer(e=>{throw Error(e)});await window.renderer.init(document.getElementById('root'),64,64);await window.renderer.load(p);window.renderer.draw(2,true);return [...await window.renderer.png()];},project);
 const gpu=await raw(Buffer.from(bytes));
 const at=(b,x,y)=>[...b.subarray((y*64+x)*4,(y*64+x)*4+4)];
 for(const b of [cpu,gpu]) {assert.equal(at(b,32,32)[3],0,'hole must remain transparent');assert.equal(at(b,21,21)[3],0,'outside silhouette must remain transparent');assert.ok(at(b,32,26)[0]>200,'black target must receive alpha-masked white sweep');assert.ok(at(b,24,26)[0]<10,'outside band must stay black');}
 for(const [x,y] of [[32,26],[29,26],[24,26],[32,32]]) {const a=at(cpu,x,y),b=at(gpu,x,y);for(let i=0;i<4;i++)assert.ok(Math.abs(a[i]-b[i])<12,`${x},${y}: CPU ${a} GPU ${b}`);}
 const start=await page.evaluate(async()=>{window.renderer.draw(0,true);return [...await window.renderer.png()];});
 assert.ok(at(await raw(Buffer.from(start)),32,26)[0]<10,'start frame has no highlight');
 await writeFile('artifacts/sweep-preview.png',Buffer.from(bytes));
 console.log('PASS: real Pixi alpha mask on black target, transparent holes, moving gradient, CPU/GPU pixel agreement');
 await page.evaluate(()=>window.renderer.destroy());
}finally{await browser.close();}

