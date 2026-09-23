import test from 'node:test';
import assert from 'node:assert/strict';
import {jsonValues,parseMr,mrIid,listObjects} from '../src/modules/autout/mr-codehub.js';

test('git remote ANSI colors do not swallow the uploaded MR JSON',()=>{
 const mr={id:1853,mr_url:'https://codehub.example/repo/merge_requests/1853'};
 const output='remote: \x1b[40;33mChecking hooks\x1b[0m\nremote: \x1b[40;36mDone\x1b[0m\n'+JSON.stringify(mr,null,2);
 assert.deepEqual(jsonValues(output),[mr]);assert.equal(mrIid(parseMr(output)),'1853');
});
test('colored arrays, OSC hyperlinks, nested JSON and escaped text remain intact',()=>{
 const mr={iid:1853,title:'literal \\u001b[0m and [brackets] "quotes"',extra:{items:[1,2]}};
 const output='\x1b]8;;https://example.com\x07link\x1b]8;;\x1b\\\n\x1b[32m'+JSON.stringify([mr])+'\x1b[0m';
 assert.deepEqual(listObjects(output),[mr]);assert.deepEqual(parseMr(output),{...mr,iid:'1853'});
 assert.throws(()=>parseMr('\x1b[31mremote: no MR returned\x1b[0m'),/缺少必要字段/);
 assert.throws(()=>parseMr('\x1b[32m'+JSON.stringify([mr,{iid:1854}])+'\x1b[0m'),/多个 MR/);
});
