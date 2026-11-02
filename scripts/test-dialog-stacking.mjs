import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
await mkdir('artifacts',{recursive:true});
const root=await mkdtemp(path.resolve('artifacts/dialog-stacking-'));
const client=new Client({name:'dialog-stacking-test',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:['artifacts/beta/run.mjs'],env:{...process.env,ANIMATION_DATA_DIR:root},stderr:'pipe'});
let browser;
try {
 await client.connect(transport);
 const invoke=async(op,args={})=>{
  const r=await client.callTool({name:'animation_'+op,arguments:args});
  if(r.isError)throw Error(r.content[0].text);
  return {state:r._meta?.appState??r.structuredContent,runtime:r._meta?.runtime};
 };
 const {state:{project}}=await invoke('create',{width:640,height:300,fps:12,duration:2,name:'Dialog stacking fixture'});
 const file=path.join(root,'button.png');
 await sharp({create:{width:100,height:40,channels:4,background:'#ffc533'}}).png().toFile(file);
 const imported=await invoke('import_image',{projectId:project.id,path:file,name:'Button'});
 await invoke('batch_layers',{projectId:project.id,add:[{name:'Button',assetId:imported.state.asset.id,x:20,y:200,width:100,height:40,keyframes:[{frame:0,scaleX:1},{frame:11,scaleX:1.04},{frame:23,scaleX:1}]}]});
 const opened=await invoke('open_editor',{projectId:project.id});
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1000,height:640},deviceScaleFactor:1});
 await page.goto(opened.runtime.origin);
 await page.locator('.key').first().waitFor();
 await page.getByRole('button',{name:'导出',exact:true}).click();
 const dialog=page.locator('.editor-dialog').last();await dialog.waitFor();
 await page.waitForTimeout(400);
 // Place one marker underneath the dialog to exercise the screenshot's overlap.
 // The actual app styles, portal and keyframe component remain in use.
 await page.evaluate(()=>{
  const d=document.querySelector('.editor-dialog').getBoundingClientRect();
  const k=document.querySelector('.key');const b=k.getBoundingClientRect();
  k.style.left=`${k.offsetLeft+d.x+d.width/2-(b.x+b.width/2)}px`;
  k.style.top=`${k.offsetTop+d.y+d.height-25-(b.y+b.height/2)}px`;
 });
 const raw=async()=>sharp(await dialog.screenshot({animations:'disabled'})).raw().toBuffer();
 const compare=async()=>{
  await page.locator('.key').evaluateAll(els=>els.forEach(e=>e.style.visibility='visible'));
  const visible=await raw();
  await page.locator('.key').evaluateAll(els=>els.forEach(e=>e.style.visibility='hidden'));
  const hidden=await raw();
  return visible.equals(hidden);
 };
 await page.locator('.timeline').evaluate(el=>el.style.isolation='auto');
 assert.equal(await compare(),false,'baseline must reproduce keyframe bleed over dialog');
 await page.locator('.timeline').evaluate(el=>el.style.removeProperty('isolation'));
 assert.equal(await compare(),true,'dialog pixels must be unchanged by underlying keyframes');
 await page.locator('.key').evaluateAll(els=>els.forEach(e=>e.style.removeProperty('visibility')));
 await page.screenshot({path:path.join(root,'fixed.png')});
 console.log('PASS: reproduced keyframe bleed without isolation; fixed dialog fully covers markers. Screenshot: '+path.join(root,'fixed.png'));
} finally {await browser?.close();await client.close();}
