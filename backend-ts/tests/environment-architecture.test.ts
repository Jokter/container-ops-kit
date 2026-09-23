import test from 'node:test';
import assert from 'node:assert/strict';
import {EnvironmentService, environmentInput, testEnvironmentConnection} from '../src/modules/environment/environment.js';
import {SshOperations} from '../src/infrastructure/ssh.js';
import {TaskStore} from '../src/platform/store.js';

class Probe extends SshOperations {
  output = 'arm64';
  override async test() { return {status:'REACHABLE' as const,latencyMs:1,error:null}; }
  override async execute() { return {exitCode:0,lines:[this.output]}; }
}
test('connection test normalizes architecture, persists it and clears it after host changes', async () => {
  const store = new TaskStore(':memory:');
  try {
    const ssh = new Probe(), service = new EnvironmentService(store,ssh);
    const input = environmentInput.parse({releaseVersionId:1,type:'BUILD',name:'build',host:'host',sshPort:22,password:'test'});
    const created = service.create(input);
    assert.equal(created.architecture,null);
    const result = await service.testSaved(created.id,'HUAWEI');
    assert.equal(result.architecture,'aarch64');
    assert.equal(service.get(created.id).architecture,'aarch64');
    const edited = service.update(created.id,{...input,name:'renamed',version:result.version});
    assert.equal(edited.architecture,'aarch64');
    assert.equal(service.update(created.id,{...input,host:'other',version:edited.version}).architecture,null);
    ssh.output='amd64';
    assert.equal((await testEnvironmentConnection(ssh,{host:'host',port:22,username:'huawei',password:'test'})).architecture,'x86_64');
    ssh.output='unknown';
    const unknown=await service.testSaved(created.id,'HUAWEI');
    assert.equal(unknown.status,'REACHABLE');
    assert.equal(unknown.architecture,null);
    assert.ok(unknown.architectureError);
  } finally {store.db.close();}
});
