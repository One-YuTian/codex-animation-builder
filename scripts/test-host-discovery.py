import subprocess,json,select,time,os,pathlib,shutil,tempfile
root=pathlib.Path(__file__).resolve().parent.parent
fixture=root/"artifacts/host-discovery"
fixture.mkdir(parents=True,exist_ok=True)
shutil.copytree(root/"artifacts/beta",fixture/"plugin",dirs_exist_ok=True)
marketplace=fixture/".agents/plugins/marketplace.json"
marketplace.parent.mkdir(parents=True,exist_ok=True)
marketplace.write_text(json.dumps({"name":"animation-diagnostic","plugins":[{"name":"codex-animation-builder","source":{"source":"local","path":"./plugin"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"Productivity"}]}))
codex=os.environ.get("CODEX_BINARY","codex")
p=subprocess.Popen([codex,'app-server','--stdio'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=tempfile.TemporaryFile(mode="w+"),text=True)
def rpc(i,method,params):
 p.stdin.write(json.dumps(dict(id=i,method=method,params=params))+'\n');p.stdin.flush()
 end=time.time()+35
 while time.time()<end:
  if select.select([p.stdout],[],[],1)[0]:
   r=json.loads(p.stdout.readline())
   if r.get('id')==i:return r
 return {'timeout':method}
try:
 initialized=rpc(1,'initialize',{'clientInfo':{'name':'animation-diagnostic','version':'1'},'capabilities':{'experimentalApi':True}})
 assert 'result' in initialized, initialized
 p.stdin.write('{"method":"initialized"}\n');p.stdin.flush()
 result=rpc(2,'plugin/read',{'marketplacePath':str(marketplace),'pluginName':'codex-animation-builder'})
 assert 'result' in result, result
 servers=result['result']['plugin']['mcpServers']
 assert 'animation-builder' in servers, f"Codex ignored plugin MCP configuration: {servers}"
 print('PASS: Codex plugin/read discovers animation-builder from built beta package')

finally:p.terminate()
