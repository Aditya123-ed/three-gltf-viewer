export function GET() {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Model download check</title>
<style>body{font:16px system-ui;background:#171c24;color:#fff;padding:40px;max-width:800px}button{padding:12px}pre{white-space:pre-wrap}</style>
<h1>Model download check</h1><p>This checks the complete model download and glTF data in your browser. It does not test 3D rendering.</p>
<button id="run">Check model download</button><pre id="result" role="status">Ready.</pre>
<script>
const button=document.querySelector('#run'), result=document.querySelector('#result');
button.onclick=async()=>{
button.disabled=true; const start=performance.now(); let received=0, expected=0, prefix=new Uint8Array(0), jsonLength=0, metadata=null;
try {
const response=await fetch('/models/client.glb',{cache:'no-store'});
if(!response.ok) throw new Error('Download returned HTTP '+response.status);
if(!response.headers.get('content-type')?.includes('model/gltf-binary')) throw new Error('Response is not GLB data');
const reader=response.body.getReader();
while(true){
const {done,value}=await reader.read(); if(done)break;
received+=value.length;
if(!metadata) {
const merged=new Uint8Array(prefix.length+value.length); merged.set(prefix); merged.set(value,prefix.length); prefix=merged;
if(prefix.length>=20&&!expected) {
const data=new DataView(prefix.buffer);
if(new TextDecoder().decode(prefix.slice(0,4))!=='glTF'||data.getUint32(4,true)!==2) throw new Error('Invalid GLB header');
expected=data.getUint32(8,true); jsonLength=data.getUint32(12,true);
if(jsonLength>20000000||data.getUint32(16,true)!==0x4e4f534a)throw new Error('Invalid JSON chunk');
}
if(jsonLength&&prefix.length>=20+jsonLength) {
metadata=JSON.parse(new TextDecoder().decode(prefix.slice(20,20+jsonLength))); prefix=null;
}
}
result.textContent='Downloading: '+(received/1048576).toFixed(1)+' / '+(expected/1048576).toFixed(1)+' MB';
}
if(received!==expected||!metadata)throw new Error('Incomplete model download');
result.textContent='PASS — complete model received.\\nBytes: '+received+' / '+expected+'\\nglTF version: '+metadata.asset.version+'\\nMeshes: '+(metadata.meshes||[]).length+'\\nTime: '+((performance.now()-start)/1000).toFixed(1)+' seconds\\n3D rendering: not tested by this check.';
}catch(error){result.textContent='FAIL — '+error.message;}finally{button.disabled=false;}
};
</script>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
