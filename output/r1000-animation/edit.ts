import { Store } from '../../server/core';
import path from 'node:path';
const store = new Store(path.resolve('.animation-data'), async()=>{throw Error('Use MCP snapshot');});
const projectId='f4f4d8a6-17cc-4ace-a514-10f287d0c9a7';
const action=process.argv[2];
const exec=(op:any,args:any)=>store.execute(op,{projectId,...args});
if(action==='compose'){
 await exec('get',{});
 await exec('add_layer',{layer:{name:'主体 · R$1000 / Pix',assetId:'7ec574ce-e25f-4f06-a828-eb7687735717',x:12,y:0,width:728,height:666,z:10,semantic:'foreground'}});
 await exec('add_layer',{layer:{name:'DOBRAR AGORA · 缩放按钮',assetId:'c3fd93bf-0857-4c40-99b8-f77fbb494439',x:149,y:650,width:470,height:117.5,z:20,semantic:'button'}});
 const xs=[40,130,240,360,475,580,670,80,620,310,530,180];
 for(let i=0;i<xs.length;i++){
  const size=35+(i%4)*8;
  await exec('add_layer',{layer:{name:`背后金币 ${i+1}`,assetId:'38ef15fc-d194-457a-87a3-22ada347776a',x:xs[i],y:35+(i*127)%640,width:size,height:size*200/205,z:i%3,semantic:'falling coin'}});
 }
}
if(action==='prepare'){
 const p:any=await exec('get',{});
 const xs=[40,130,240,360,475,580,670,80,620,310,530,180];
 for(const [i,l] of p.project.layers.filter((l:any)=>l.semantic==='falling coin').entries()){
  const t=(i*6%72)/71;
  await exec('update_layer',{layerId:l.id,patch:{x:xs[i]+Math.sin(t*Math.PI*2+i)*9,y:18+t*(745-l.height),rotation:-25+t*140,opacity:t<0.07?t/0.07:t>0.9?(1-t)/0.1:1}});
 }
}
if(action==='animate'){
 const p:any=await exec('get',{});
 const b=p.project.layers.find((l:any)=>l.semantic==='button');
 const keys=[0,12,24,36,48,60,71].map((frame,i)=>{const s=i%2?1.07:1;return {frame,scaleX:s,scaleY:s,x:b.x-b.width*(s-1)/2,y:b.y-b.height*(s-1)/2,easing:'easeInOut'};});
 await exec('keyframes',{layerId:b.id,keyframes:keys});
 const coins=p.project.layers.filter((l:any)=>l.semantic==='falling coin');
 for(const [i,l] of coins.entries()){
  const ks=[];
  for(let frame=0;frame<72;frame++){
   const t=((frame+i*6)%72)/71;
   const xs=[40,130,240,360,475,580,670,80,620,310,530,180];
   ks.push({frame,x:xs[i]+Math.sin(t*Math.PI*2+i)*9,y:18+t*(745-l.height),rotation:-25+t*140,opacity:t<0.07?t/0.07:t>0.9?(1-t)/0.1:1,easing:'linear'});
  }
  await exec('keyframes',{layerId:l.id,keyframes:ks});
 }
}
console.log(JSON.stringify({done:action}));
