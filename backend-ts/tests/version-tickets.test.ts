import test from 'node:test';
import assert from 'node:assert/strict';
import {reportConfig,executionReady,versionTicket} from '../src/modules/autout/reports.js';
import {dtsProductNames} from '../src/modules/autout/dts-product.js';
const base={username:'tester',ticket:'LEGACY',workspaceRoot:'/tmp',dateMode:'yesterday',schedule:{enabled:false,frequency:'daily',weekday:1,time:'09:00',timezone:'UTC',action:'REPAIR'}};
test('多版本治理拒绝共享旧单号，按版本获取各自单号',()=>{
 const c=reportConfig.parse({...base,versions:[{version:'R27C10',baseBranch:'main'},{version:'R27C00',baseBranch:'old'}]});
 assert.equal(executionReady(c),false);assert.equal(versionTicket(c,'R27C10'),'');
 c.versions[0]!.ticket='DTS1';c.versions[1]!.ticket='DTS2';assert.equal(executionReady(c),true);
 assert.equal(versionTicket(c,'R27C00'),'DTS2');c.versions[1]!.ticket='DTS1';assert.equal(executionReady(c),false);
});
test('单版本旧配置保留兼容，显式清空不会回退到旧单号',()=>{
 const c=reportConfig.parse({...base,versions:[{version:'R27C10',baseBranch:'main'}]});
 assert.equal(versionTicket(c,'R27C10'),'LEGACY');c.versions[0]!.ticket='';assert.equal(executionReady(c),false);
});
test('产品版本遵循 V100R0xxCxxB001 规则',()=>{
 assert.equal(dtsProductNames('r28c00').b,'MAE-NEM V100R028C00B001');assert.throws(()=>dtsProductNames('R28C00B012'));
});
