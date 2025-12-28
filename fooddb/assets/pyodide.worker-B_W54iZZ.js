(function(){"use strict";console.log("Worker: Starting...");let c=null,d=null;async function h(a="/python/"){try{console.log(`Worker: Starting with baseUrl=${a}`),console.log("Worker: Loading Pyodide...");const r="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs",{loadPyodide:g}=await import(r),o=await g({indexURL:"https://cdn.jsdelivr.net/pyodide/v0.26.2/full/"});console.log("Worker: Mounting Persistent Storage..."),o.FS.mkdir("./userdata"),o.FS.mount(o.FS.filesystems.IDBFS,{root:"."},"./userdata"),await new Promise(t=>o.FS.syncfs(!0,t)),self.trigger_sync=async()=>(console.log("Worker: Syncing to IndexedDB..."),new Promise(t=>{o.FS.syncfs(!1,s=>{s?console.error("Sync Error:",s):(console.log("Worker: Sync Complete"),self.debug_fs("/")),t()})})),self.debug_fs=(t="/")=>{console.log(`--- FS TREE for ${t} ---`);function s(e,f){try{const u=o.FS.readdir(e);for(const l of u){if(l==="."||l==="..")continue;const y=e==="/"?`/${l}`:`${e}/${l}`,m=o.FS.isDir(o.FS.stat(y).mode);console.log(`${"  ".repeat(f)}${m?"📁":"📄"} ${l} (${y})`),m&&!["/lib","/proc","/sys","/dev"].includes(y)&&s(y,f+1)}}catch(u){console.warn(`Error reading ${e}: ${u}`)}}s(t,0),console.log("-------------------------")},self.debug_fs("/"),await o.loadPackage("ssl"),console.log("Worker: Installing Packages (pandas, scipy, fastapi)..."),await o.loadPackage(["numpy","pandas","scipy","micropip"]);const n=o.pyimport("micropip");await n.install("typing-extensions"),await n.install(["fastapi","httpx","python-multipart"]),await o.runPythonAsync(`
      import os
      def save_file(path, content):
          directory = os.path.dirname(path)
          if directory:
              os.makedirs(directory, exist_ok=True)
          with open(path, "w", encoding="utf-8") as f:
              f.write(content)
    `);const i=o.globals.get("save_file");console.log("Worker: Fetching & Writing Files...");const p=["server.py","utils.py","data/caffeine.csv","data/edibility.csv","data/rare.csv","data/foods.csv","data/foods_amino.csv","data/foods_carb.csv","data/foods_extra.csv","data/foods_fatty_acid.csv","data/foods_fiber.csv","data/foods_organic_acid.csv","data/isoflavones.csv","data/nutrients.csv","data/prices.csv"];for(const t of p){console.log(`Worker: Fetching ${t}...`);const s=`${a}${t}`,e=await fetch(s);if(!e.ok){console.warn(`Worker: Failed to fetch ${t} (${e.status}) from ${s}`);continue}const f=await e.text();i(t,f)}i.destroy(),console.log("Worker: Initializing Fake Server..."),await o.runPythonAsync(`
    import sys
    import starlette.concurrency
    import js
    
    # Monkeypatch to avoid threading issues
    async def run_in_threadpool(func, *args, **kwargs):
        return func(*args, **kwargs)
    starlette.concurrency.run_in_threadpool = run_in_threadpool

    sys.path.append('.') 
    from server import app
    from httpx import AsyncClient, ASGITransport
    
    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://test")
    
    print("Python: Server Initialized (Async + NoThreads)!")
    `),c=o,console.log("Worker: READY")}catch(r){console.error("Worker: FATAL INIT ERROR:",r),d=r.toString(),self.postMessage({type:"FATAL_ERROR",error:d})}}self.onmessage=async a=>{if(a.data&&a.data.type==="INIT_WORKER"){h(a.data.baseUrl);return}const{id:r,method:g,url:o,body:n}=a.data;if(d){self.postMessage({id:r,error:`Worker failed to initialize: ${d}`});return}if(!c){self.postMessage({id:r,error:"System is still initializing. Please try again in a moment."});return}try{const i=typeof n=="string"?n:n?JSON.stringify(n):null;c.globals.set("req_body",i);const p=await c.runPythonAsync(`
      import json
      
      payload = json.loads(req_body) if req_body else None
      
      if "${g}" == "POST":
          response = await client.post("${o}", json=payload)
      else:
          response = await client.get("${o}")
          
      response.json()
    `),t=p.toJs({dict_converter:Object.fromEntries});if(p.destroy(),t&&t.detail&&Array.isArray(t.detail)){const s=t.detail.map(e=>`${e.loc?"["+e.loc.join("->")+"]":""} ${e.msg}`).join("; ");throw new Error(`Validation Error: ${s}`)}self.trigger_sync&&(await self.trigger_sync(),self.debug_fs("/")),self.postMessage({id:r,result:t})}catch(i){console.error("Worker: API Error",i),self.postMessage({id:r,error:i.toString()})}}})();
