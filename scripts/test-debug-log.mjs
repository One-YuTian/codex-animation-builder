import {mkdtemp, mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
await mkdir('artifacts',{recursive:true});
const dataRoot=await mkdtemp(path.resolve('artifacts/debug-log-test-'));
const client=new Client({name:'debug-log-test',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:['dist/server.js'],env:{...process.env,ANIMATION_DATA_DIR:dataRoot}});
try {
 await client.connect(transport);
 const invoke=async(op,args={})=>{const r=await client.callTool({name:'animation_'+op,arguments:args});assert.equal(r.structuredContent?.debugLogs,undefined);return {...r,structuredContent:r._meta?.appState??r.structuredContent};};
 const opened=await invoke('open_editor',{reset:false});
 const token=opened._meta.runtime.manualToken;
 const created=await invoke('create',{name:'Log fixture',width:16,height:16,fps:2,duration:1});
 const projectId=created.structuredContent.project.id;
 const shot=(await invoke('snapshot',{projectId})).structuredContent;
 await invoke('review',{projectId,snapshotHash:shot.snapshotHash,score:1,notes:'Synthetic blank test fixture only'});
 const result=await invoke('export',{projectId:created.structuredContent.project.id,format:'gif',lossy:73,manualToken:token});
 assert.ok(!result.isError,JSON.stringify(result));
 const id=result.structuredContent.job.id;
 let job; let statusLogs;
 for(let i=0;i<80;i++) {const status=(await invoke('export_status',{jobId:id})).structuredContent; assert.equal(status.runtimeVersion,'0.7.2'); statusLogs=status.debugLogs; job=status.job;if(job.state!=='running')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(job.state,'complete');
 assert.equal(job.lossy,73);
 assert.ok(statusLogs.some(e=>e.event==='WASM 命令' && e.details.engine==='gifsicle' && e.details.args.includes('--lossy=73')));
 assert.ok(statusLogs.some(e=>e.event==='GIF 压缩完成'));
 assert.ok(statusLogs.some(e=>e.details.jobId===id && e.details.engine==='ffmpeg'));
 const current=(await invoke('current')).structuredContent;
 assert.ok(current.debugLogs.some(e=>e.event.includes('WASM 命令')));
 assert.ok(current.debugLogs.some(e=>e.event==='WASM 调用开始' && e.details.engine==='ImageMagick'));
 assert.ok(current.debugLogs.some(e=>e.event==='WASM 调用完成' && e.details.engine==='ImageMagick' && e.details.bytes > 0));
 assert.ok(current.debugLogs.some(e=>e.event==='WASM 调用完成' && e.details.engine==='ffmpeg'));
 assert.ok(current.debugLogs.some(e=>e.event==='WASM 调用完成' && e.details.engine==='gifsicle'));
 assert.ok(current.debugLogs.some(e=>e.event==='GIF 压缩完成' && e.details.beforeBytes > 0 && e.details.afterBytes > 0));
 assert.ok(!current.debugLogs.some(e=>e.event.includes('启用 ImageMagick 后备')));
 assert.ok(current.debugLogs.some(e=>e.event.includes('首次合成')));
 assert.ok(current.debugLogs.some(e=>e.event==='导出 done'));
 assert.ok(!JSON.stringify(current.debugLogs).includes(token));
 const ui=await client.readResource({uri:'ui://codex-animation-builder/preview-v5'});
 assert.ok(ui.contents[0].text.includes('关闭 Log'));
 if (process.argv.includes('--ui')) {
   const {chromium}=await import('playwright');
   const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
   try {
     const page=await browser.newPage({viewport:{width:1280,height:800}});
     await page.goto(opened._meta.runtime.origin);
     await page.getByRole('button',{name:'展开 Log 调试输出'}).click();
     await page.getByText('GIF 压缩完成',{exact:true}).waitFor();
     await page.getByText('服务 0.7.2 · UI 0.7.2',{exact:false}).waitFor();
     await page.screenshot({path:'artifacts/log-panel-043.png'});
     await page.getByRole('button',{name:'关闭 Log',exact:true}).click();
     await page.getByRole('button',{name:'导出',exact:true}).click();
     const lossInput=page.getByLabel('GIF Loss',{exact:true});
     assert.equal(await lossInput.inputValue(),'30');
     await lossInput.fill('0'); await lossInput.press('Tab');
     const responsePromise=page.waitForResponse(r=>r.url().includes('/api/action') && r.request().postDataJSON()?.op==='export');
     await page.getByRole('button',{name:'开始导出',exact:true}).click();
     const exportResponse=await responsePromise;
     assert.equal(exportResponse.request().postDataJSON().args.lossy,0);
     const started=await exportResponse.json();
     const zeroId=started.job.id;
     await page.getByText('导出完成',{exact:true}).waitFor();
     const zeroStatus=(await invoke('export_status',{jobId:zeroId})).structuredContent;
     assert.equal(zeroStatus.job.state,'complete');
     assert.equal(zeroStatus.job.lossy,0);
     const command=zeroStatus.debugLogs.find(e=>e.details.jobId===zeroId && e.event==='WASM 命令' && e.details.engine==='gifsicle');
     assert.ok(command);assert.ok(!command.details.args.some(a=>a.startsWith('--lossy')));
     console.log('PASS: UI default30, manual loss0 export, request/worker/actual Gifsicle command match');
     await page.keyboard.press('Escape');
     await page.getByRole('button',{name:'展开 Log 调试输出'}).click();

     await page.getByRole('button',{name:'关闭 Log',exact:true}).click();
     assert.equal(await page.getByRole('complementary',{name:'Log 调试输出'}).count(),0);
     console.log('PASS: browser panel opens, displays actual WASM/export logs and version, closes');
     const second=(await invoke('create',{name:'Another saved project',width:32,height:32,fps:2,duration:1})).structuredContent.project;
     await invoke('reset',{});
     await page.getByText('等待 MCP 载入画面',{exact:true}).waitFor();
     await page.getByRole('button',{name:'打开历史项目',exact:true}).first().click();
     await page.getByLabel('搜索历史项目').fill('not-found-fixture');
     await page.getByText('没有匹配的项目',{exact:true}).waitFor();
     await page.getByLabel('搜索历史项目').fill('Log fixture');
     const openOld=page.getByRole('button',{name:new RegExp('打开项目 Log fixture')});
     let failOnce=true;
     await page.route('**/api/action',async route=>{
       if(failOnce && route.request().postDataJSON()?.op==='get') {failOnce=false;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'History test retry'})});} else await route.continue();
     });
     await openOld.click();
     await page.getByText('Error: History test retry',{exact:true}).waitFor();
     assert.equal((await invoke('current')).structuredContent.project,null);
     await openOld.click();
     await page.locator('.breadcrumbs strong').filter({hasText:'Log fixture'}).waitFor();
     assert.equal((await invoke('current')).structuredContent.project.id,projectId);
     assert.equal((await invoke('get',{projectId:second.id})).structuredContent.project.name,'Another saved project');
     await page.reload();
     await page.locator('.breadcrumbs strong').filter({hasText:'Log fixture'}).waitFor();
     await page.getByRole('button',{name:'打开历史项目',exact:true}).click();
     await page.getByText('当前项目',{exact:true}).waitFor();
     await page.screenshot({path:'artifacts/history-projects.png',animations:'disabled'});
     console.log('PASS: history empty canvas entry, search, failed open/retry, activation, refresh persistence, other project retained');
     await page.getByRole('button',{name:new RegExp('打开项目 Another saved project')}).click();
     await page.locator('.breadcrumbs strong').filter({hasText:'Another saved project'}).waitFor();
     assert.equal((await invoke('current')).structuredContent.project.reviews.length,0);
     await page.getByRole('button',{name:'导出',exact:true}).click();
     const historyExportPromise=page.waitForResponse(r=>r.url().includes('/api/action') && r.request().postDataJSON()?.op==='export');
     await page.getByRole('button',{name:'开始导出',exact:true}).click();
     const historyExport=await (await historyExportPromise).json();
     assert.ok(historyExport.job,JSON.stringify(historyExport));
     await page.getByText('导出完成',{exact:true}).waitFor();
     const historyStatus=(await invoke('export_status',{jobId:historyExport.job.id})).structuredContent;
     assert.equal(historyStatus.job.state,'complete');
     assert.equal((await invoke('current')).structuredContent.project.reviews.length,0);
     console.log('PASS: actual manual GIF export from unreviewed historical project, no fabricated review');
     for(const [label,format,mime] of [['WebP 动图','webp','image/webp'],['WebM 透明视频','webm','video/webm']]) {
       await page.getByRole('combobox').click();
       await page.getByRole('option',{name:label,exact:true}).click();
       if(format==='webp'){await page.getByLabel('WebP 压缩等级',{exact:true}).fill('6');await page.getByLabel('WebP 压缩等级',{exact:true}).press('Tab');}
       const pendingMedia=page.waitForResponse(r=>r.url().includes('/api/action')&&r.request().postDataJSON()?.op==='export');
       await page.getByRole('button',{name:'开始导出',exact:true}).click();
       const mediaResponse=await pendingMedia;
       if(format==='webp')assert.equal(mediaResponse.request().postDataJSON().args.compressionLevel,6);
       const mediaJob=(await mediaResponse.json()).job;
       assert.ok(mediaJob);
       await page.getByText('导出完成',{exact:true}).waitFor();
       const mediaStatus=(await invoke('export_status',{jobId:mediaJob.id})).structuredContent.job;
       assert.equal(mediaStatus.state,'complete');assert.equal(mediaStatus.mimeType,mime);
       if(format==='webp') {
         await page.waitForFunction(()=>{const img=document.querySelector('.export-preview img');return img?.complete&&img.naturalWidth>0;});
       } else {
         await page.waitForFunction(()=>{const v=document.querySelector('.export-preview video');return v&&v.readyState>=2&&v.currentTime>0.05;});
         const video=await page.locator('.export-preview video').evaluate(v=>({loop:v.loop,muted:v.muted,paused:v.paused,src:v.src}));
         assert.ok(video.loop&&video.muted&&!video.paused);assert.ok(video.src.startsWith('blob:'));
         await page.screenshot({path:'artifacts/export-webm-preview.png',animations:'disabled'});
       }
     }
     console.log('PASS: UI WebP level6 -> WASM export -> image preview; transparent WebM -> WASM export -> autoplay muted loop Blob preview');



   } finally {await browser.close();}
 }
 console.log('PASS: tools, export events, actual WASM arguments, bytes, timings, token redaction, panel bundle');
} finally {await client.close();}

