import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {JSDOM} from 'jsdom'

const html=await readFile(new URL('../../index.html',import.meta.url),'utf8')
const response=data=>({ok:true,status:200,json:async()=>data})
test('现有自动化工具保留两张卡片，新增 MR 卡片和独立监听开关',async()=>{
 const writes=[]
 const config={enabled:false,groupId:'1234567891011',authorizedSender:'w00789509',repositoryPrefix:'MAE-M/Access/',intervalSeconds:10}
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/#/automation/tools',beforeParse(w){w.scrollTo=()=>{};const timeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>delay>500?0:timeout(callback,delay,...args);w.fetch=async(url,options)=>{
  if(url==='/api/automation/group-mr/config'&&options?.method==='PUT'){writes.push(JSON.parse(options.body));config.enabled=writes.at(-1).enabled;return response({...config})}
  if(url==='/api/automation/group-mr')return response({config:{...config},pending:[],history:[],metrics:{pending:0,issues:0,mergedToday:0},monitor:{error:'',at:''}})
  return response([])
 }}})
 await new Promise(r=>setTimeout(r,40))
 const doc=dom.window.document
 assert.deepEqual([...doc.querySelectorAll('[data-automation-capability]')].map(x=>x.dataset.automationCapability),['auto-ut','quality','group-mr'])
 const toggle=doc.querySelector('[data-group-mr-toggle]')
 toggle.click();await new Promise(r=>setTimeout(r,20))
 assert.equal(writes.length,1);assert.equal(writes[0].enabled,true)
 assert.equal(dom.window.location.hash,'#/automation/tools')
 doc.querySelector('[data-automation-capability="group-mr"] h2').click()
 assert.equal(dom.window.location.hash,'#/automation/group-mr')
 assert.ok(doc.querySelector('.group-mr-overview'))
 assert.match(doc.querySelector('.studio-section-head h2').textContent,/MR 列表/)
 await new Promise(r=>setTimeout(r,250))
 dom.window.close()
})
