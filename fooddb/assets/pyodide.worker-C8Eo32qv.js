(function(){"use strict";console.log("Worker: Starting...");let p=null,f=null;async function m(){try{console.log("Worker: Loading Pyodide...");const n="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs",{loadPyodide:a}=await import(n),o=await a({indexURL:"https://cdn.jsdelivr.net/pyodide/v0.26.2/full/"});console.log("Worker: Mounting Persistent Storage..."),o.FS.mkdir("./userdata"),o.FS.mount(o.FS.filesystems.IDBFS,{root:"."},"./userdata"),await new Promise(t=>o.FS.syncfs(!0,t)),self.trigger_sync=async()=>(console.log("Worker: Syncing to IndexedDB..."),new Promise(t=>{o.FS.syncfs(!1,e=>{e?console.error("Sync Error:",e):(console.log("Worker: Sync Complete"),self.debug_fs("/")),t()})})),self.debug_fs=(t="/")=>{console.log(`--- FS TREE for ${t} ---`);function e(s,c){try{const g=o.FS.readdir(s);for(const d of g){if(d==="."||d==="..")continue;const y=s==="/"?`/${d}`:`${s}/${d}`,u=o.FS.isDir(o.FS.stat(y).mode);console.log(`${"  ".repeat(c)}${u?"📁":"📄"} ${d} (${y})`),u&&!["/lib","/proc","/sys","/dev"].includes(y)&&e(y,c+1)}}catch(g){console.warn(`Error reading ${s}: ${g}`)}}e(t,0),console.log("-------------------------")},self.debug_fs("/"),await o.loadPackage("ssl"),console.log("Worker: Installing Packages (pandas, scipy, fastapi)..."),await o.loadPackage(["numpy","pandas","scipy","micropip"]);const l=o.pyimport("micropip");await l.install("typing-extensions"),await l.install(["fastapi","httpx","python-multipart"]),await o.runPythonAsync(`
      import os
      def save_file(path, content):
          directory = os.path.dirname(path)
          if directory:
              os.makedirs(directory, exist_ok=True)
          with open(path, "w", encoding="utf-8") as f:
              f.write(content)
    `);const r=o.globals.get("save_file");console.log("Worker: Fetching & Writing Files...");const i=["server.py","utils.py","data/caffeine.csv","data/edibility.csv","data/rare.csv","data/foods.csv","data/foods_amino.csv","data/foods_carb.csv","data/foods_extra.csv","data/foods_fatty_acid.csv","data/foods_fiber.csv","data/foods_organic_acid.csv","data/isoflavones.csv","data/nutrients.csv","data/prices.csv"];for(const t of i){console.log(`Worker: Fetching ${t}...`);const e=await fetch(`/python/${t}`);if(!e.ok){console.warn(`Worker: Failed to fetch ${t} (${e.status})`);continue}const s=await e.text();r(t,s)}r.destroy(),console.log("Worker: Initializing Fake Server..."),await o.runPythonAsync(`
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
    `),p=o,console.log("Worker: READY")}catch(n){console.error("Worker: FATAL INIT ERROR:",n),f=n.toString(),self.postMessage({type:"FATAL_ERROR",error:f})}}m(),self.onmessage=async n=>{const{id:a,method:o,url:l,body:r}=n.data;if(f){self.postMessage({id:a,error:`Worker failed to initialize: ${f}`});return}if(!p){self.postMessage({id:a,error:"System is still initializing. Please try again in a moment."});return}try{const i=typeof r=="string"?r:r?JSON.stringify(r):null;p.globals.set("req_body",i);const t=await p.runPythonAsync(`
      import json
      
      payload = json.loads(req_body) if req_body else None
      
      if "${o}" == "POST":
          response = await client.post("${l}", json=payload)
      else:
          response = await client.get("${l}")
          
      response.json()
    `),e=t.toJs({dict_converter:Object.fromEntries});if(t.destroy(),e&&e.detail&&Array.isArray(e.detail)){const s=e.detail.map(c=>`${c.loc?"["+c.loc.join("->")+"]":""} ${c.msg}`).join("; ");throw new Error(`Validation Error: ${s}`)}self.trigger_sync&&(await self.trigger_sync(),self.debug_fs("/")),self.postMessage({id:a,result:e})}catch(i){console.error("Worker: API Error",i),self.postMessage({id:a,error:i.toString()})}}})();
