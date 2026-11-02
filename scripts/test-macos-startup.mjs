import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const data=await mkdtemp(path.join(os.tmpdir(),'animation-mac-'));
const client=new Client({name:'mac-startup-test',version:'1'});
try {
 await client.connect(new StdioClientTransport({command:'/bin/sh',args:[path.resolve('artifacts/beta/scripts/launch.sh')],cwd:'/tmp',env:{HOME:os.homedir(),PATH:'/usr/bin:/bin',ANIMATION_DATA_DIR:data}}));
 const tools=(await client.listTools()).tools;
 assert(tools.some(t=>t.name==='animation_open_editor'));
 assert(tools.some(t=>t.name==='animation_create'));
 const opened=await client.callTool({name:'animation_open_editor',arguments:{reset:true}});
 assert(!opened.isError,JSON.stringify(opened));
 const created=await client.callTool({name:'animation_create',arguments:{name:'macOS smoke',width:64,height:64,fps:12,duration:1}});
 assert(!created.isError,JSON.stringify(created));
 const resource=await client.readResource({uri:'ui://codex-animation-builder/preview-v5'});
 assert(resource.contents[0].text.includes('<html'));
 console.log(`PASS: minimal macOS PATH, unrelated cwd, ${tools.length} tools, editor, project creation, UI resource`);
} finally {await client.close();await rm(data,{recursive:true,force:true});}
