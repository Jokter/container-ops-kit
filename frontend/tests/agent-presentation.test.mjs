import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {JSDOM} from 'jsdom'

const html=await readFile(new URL('../../index.html',import.meta.url),'utf8')
const pause=()=>new Promise(resolve=>setTimeout(resolve,170))
async function setup({events=[],saved}={}){
  const task={id:'agent-ui',repository:'ExampleService',reportVersion:'R27C00',status:'REPAIRING',nextStage:'REPAIR',progress:45,message:'正在修复',lineGoal:0.8,branchGoal:0.7,liveEvents:events}
  const streams=[]
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'dangerously',beforeParse(window){
    window.scrollTo=()=>{}
    if(saved)window.sessionStorage.setItem('ut-view:agent-ui',saved)
    window.EventSource=class{constructor(){streams.push(this)}close(){}}
    window.fetch=async url=>({ok:true,status:200,json:async()=>url==='/api/auto-ut/tasks'?JSON.parse(JSON.stringify([task])):{}})
  }})
  const d=dom.window.document
  d.querySelector('[data-platform-domain="automation"]').click()
  d.querySelector('[data-automation-capability="auto-ut"]').click()
  await pause()
  d.querySelector('[data-qw-auto-tab="tasks"]').click()
  return {dom,d,task,emit:event=>streams[0].onmessage({data:JSON.stringify(event)})}
}

test('消息按语义合并，工具按调用 ID 更新，重放不重复，输出转义',async()=>{
  const {dom,d,emit}=await setup()
  try{
    emit({sequence:1,type:'message_start'})
    emit({sequence:2,type:'message_delta',content:'先检查 **测试**。'})
    emit({sequence:3,type:'message_delta',content:'<img src=x onerror=alert(1)>'})
    emit({sequence:3,type:'message_delta',content:'重复消息'})
    emit({sequence:4,type:'tool_start',toolCallId:'read-1',toolName:'read',content:'ExampleTest.java'})
    emit({sequence:5,type:'tool_output',toolCallId:'read-1',content:'partial',replace:true})
    emit({sequence:6,type:'tool_end',toolCallId:'read-1',content:'final',replace:true})
    emit({sequence:7,type:'message_start'})
    emit({sequence:8,type:'message_delta',content:'定位完成。'})
    await pause()
    const events=[...d.querySelectorAll('[data-ut-event]')]
    assert.equal(events.length,3)
    assert.match(events[0].textContent,/先检查 测试/)
    assert.equal(events[0].querySelector('img'),null)
    assert.equal(events[0].querySelector('strong').textContent,'测试')
    assert.doesNotMatch(events[0].textContent,/重复消息/)
    assert.match(events[1].textContent,/final/)
    assert.doesNotMatch(events[1].textContent,/partial/)
    assert.match(events[2].textContent,/定位完成/)
  }finally{dom.window.close()}
})

test('工具详情与不跟随选择持久化，重新打开页面恢复',async()=>{
  const events=[{sequence:1,type:'tool_start',toolCallId:'read-1',toolName:'read',content:'ExampleTest.java'}]
  const first=await setup({events})
  let saved
  try{
    first.d.querySelector('[data-ut-entry] summary').click()
    first.d.querySelector('[data-ut-follow]').click()
    await pause()
    saved=first.dom.window.sessionStorage.getItem('ut-view:agent-ui')
    assert.equal(JSON.parse(saved).follow,false)
    assert.equal(JSON.parse(saved).open['tool-read-1'],true)
  }finally{first.dom.window.close()}
  const second=await setup({events,saved})
  try{
    assert.equal(second.d.querySelector('[data-ut-entry]').open,true)
    assert.equal(second.d.querySelector('[data-ut-follow]').checked,false)
    second.emit({sequence:2,type:'tool_end',toolCallId:'read-1',content:'done'})
    await pause()
    assert.equal(second.d.querySelector('[data-ut-entry]').open,true)
    assert.equal(second.d.querySelector('[data-ut-follow]').checked,false)
    assert.equal(second.d.querySelector('[data-ut-latest]').hidden,false)
  }finally{second.dom.window.close()}
})

test('工具失败自动展开，用户手动折叠后不会被后续输出打开',async()=>{
  const {dom,d,emit}=await setup()
  try{
    emit({sequence:1,type:'tool_start',toolCallId:'test-1',toolName:'bash',content:'codecovcli analyze'})
    await pause()
    assert.equal(d.querySelector('[data-ut-entry]').open,false)
    emit({sequence:2,type:'tool_end',toolCallId:'test-1',toolName:'bash',error:true,content:'测试失败'})
    await pause()
    assert.equal(d.querySelector('[data-ut-entry]').open,true)
    d.querySelector('[data-ut-entry] summary').click()
    emit({sequence:3,type:'message_delta',content:'将继续修复失败测试'})
    await pause()
    assert.equal(d.querySelector('[data-ut-entry]').open,false)
    assert.match(d.querySelector('[data-ut-entry]').textContent,/测试失败/)
  }finally{dom.window.close()}
})

test('手动滚动暂停跟随，后续输出保持滚动位置，回到底部恢复跟随',async()=>{
  const {dom,d,emit}=await setup()
  try{
    const feed=d.querySelector('[data-ut-feed]')
    Object.defineProperties(feed,{scrollHeight:{value:1200},clientHeight:{value:400}})
    feed.scrollTop=120
    feed.dispatchEvent(new dom.window.Event('scroll'))
    assert.equal(d.querySelector('[data-ut-follow]').checked,false)
    emit({sequence:1,type:'message_delta',content:'新输出'})
    await pause()
    assert.equal(d.querySelector('[data-ut-feed]').scrollTop,120)
    d.querySelector('[data-ut-latest]').click()
    assert.equal(d.querySelector('[data-ut-follow]').checked,true)
  }finally{dom.window.close()}
})

test('完成任务显示独立结果区和 MR，不编造覆盖率结果',async()=>{
  const {dom,d,task}=await setup()
  try{
    d.querySelector('[data-auto-ut-detail-tab="process"]').click()
    assert.match(d.querySelector('.ut-agent-overview').textContent,/80.0%/)
    assert.match(d.querySelector('.ut-agent-overview').textContent,/70.0%/)
    Object.assign(task,{status:'RESOLVED',nextStage:'DONE',progress:100,message:'验证通过，已创建 MR',pullRequestUrl:'https://example.com/mr/1'})
    await new Promise(resolve=>setTimeout(resolve,1500))
    assert.match(d.querySelector('.ut-agent-result').textContent,/验证通过，已创建 MR/)
    assert.equal(d.querySelector('.ut-agent-result a').href,'https://example.com/mr/1')
    assert.equal(d.querySelectorAll('.ut-task-timeline .done').length,5)
    assert.doesNotMatch(d.querySelector('.ut-agent-result').textContent,/83.6|74.2/)
  }finally{dom.window.close()}
})
