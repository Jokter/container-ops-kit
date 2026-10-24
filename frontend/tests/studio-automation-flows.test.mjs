import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudio } from './helpers/studio-harness.mjs';

const reportId = '41111111-1111-4111-8111-111111111111';
const taskId = '51111111-1111-4111-8111-111111111111';
const knowledgeId = '61111111-1111-4111-8111-111111111111';
const pendingKnowledgeId = '61111111-1111-4111-8111-222222222222';
const generatedKnowledgeId = '61111111-1111-4111-8111-333333333333';
const reviewId = '71111111-1111-4111-8111-111111111111';
const sha = 'a'.repeat(40);
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const recorded = (scene, path, method = 'POST') => scene.calls.filter(call => call.path === path && call.method === method);

function cleanup(t, scene) {
  t.after(() => {
    scene.close();
    assert.deepEqual(scene.errors, []);
  });
  return scene;
}

async function utScene(t, { flowBlocked = false, unknownCreate = false } = {}) {
  const config = {
    domain: 'Access', teams: ['Access_智能驾舱组'],
    versions: [{ version: 'R27C10', baseBranch: 'release/R27C10', ticket: '' }, { version: 'R27C00', baseBranch: 'release/R27C00', ticket: '' }],
    dateMode: 'yesterday', username: 'integration-user', ticket: '', workspaceRoot: '/srv/ut',
    schedule: { enabled: false, frequency: 'weekdays', weekday: 1, time: '09:00', timezone: 'Asia/Shanghai', action: 'FETCH' }
  };
  const plan = ['Gateway', 'Browser'].map((repository, index) => ({
    version: 'R27C10', repository, language: index ? 'JS' : 'Java', team: 'Access_智能驾舱组',
    configured: true, repairSupported: true, repositoryCustomized: false, repositoryUrl: 'https://example.test/' + repository + '.git',
    baseBranch: 'release/R27C10', repairBranch: 'repair/' + repository, failedTests: index + 1,
    lineCoverage: .5, lineGoal: .8, branchCoverage: .4, branchGoal: .7
  }));
  const run = { id: reportId, jobId: '81111111-1111-4111-8111-111111111111', status: 'READY', createdAt: now(), config: clone(config), trigger: 'MANUAL', messages: ['报告读取完成'], claimed: [], taskIds: [], plan, versionResults: { R27C10: 'SUCCEEDED', R27C00: 'EMPTY' } };
  const calls = [], tasks = [], tickets = [];
  let failedOnce = false;
  const scene = await createStudio({ route: 'automation/auto-ut', beforeParse(w) {
    const fallback = w.fetch;
    w.fetch = async (input, options = {}) => {
      const path = new URL(String(input), 'http://studio.test').pathname;
      const method = options.method || 'GET';
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : null;
      calls.push({ path, method, body });
      if (path === '/api/auto-ut/report-settings') {
        if (method === 'PUT') Object.assign(config, body);
        return response({ config, nextRunAt: null });
      }
      if (path === '/api/auto-ut/reports') {
        if (method === 'POST') {
          run.config = { ...clone(config), versions: config.versions.filter(version => body.versions.includes(version.version)) };
          run.createdAt = now();
          return response(run);
        }
        return response([run]);
      }
      if (path === '/api/auto-ut/reports/' + reportId) return response(run);
      if (path === '/api/auto-ut/tasks') return response(tasks);
      if (path === '/api/auto-ut/governance') return response({ records: tasks, blockedRecords: [], metrics: { streak: tasks.length ? 1 : 0 } });
      if (path === '/api/auto-ut/tickets') {
        if (method === 'GET') return response(tickets);
        if (unknownCreate && !failedOnce) { failedOnce = true; throw Error('建单结果未知，请先核对 DTS'); }
        const ticket = { requestId: body.requestId, username: body.username, version: body.version, ticket: 'DTS2610250012345', status: flowBlocked ? 'REVIEW' : 'READY', stage: flowBlocked ? 'FLOW' : 'CONFIRM', nodeStatus: flowBlocked ? 'DTS001' : 'DTS009', message: flowBlocked ? '流转待确认，请人工核对' : '已到开发人员实施修改' };
        tickets.splice(0, tickets.length, ticket);
        return response(ticket);
      }
      if (path === '/api/auto-ut/tickets/control') {
        Object.assign(tickets[0], { status: 'READY', stage: 'CONFIRM', nodeStatus: 'DTS009', message: '流转成功' });
        return response(tickets[0]);
      }
      if (path === '/api/auto-ut/reports/' + reportId + '/tasks') {
        for (const [index, key] of body.selected.entries()) {
          const item = plan.find(item => key === item.version + '/' + item.repository + (item.language === 'JS' ? '/JS' : ''));
          assert.ok(item, 'Only displayed report items may start');
          const id = index ? '51111111-1111-4111-8111-222222222222' : taskId;
          tasks.push({ id, repository: item.repository, repositoryUrl: item.repositoryUrl, language: item.language, reportVersion: item.version, sourceReportId: reportId, username: config.username, ticket: config.ticket, baseBranch: item.baseBranch, repairBranch: item.repairBranch, reportedFailedTests: item.failedTests, lineGoal: item.lineGoal, branchGoal: item.branchGoal, workspaceRoot: config.workspaceRoot, workspacePath: '/srv/ut/R27C10/' + item.repository, executionMode: 'AUTOMATIC', status: 'BASELINE_RUNNING', nextStage: 'BASELINE', progress: 25, attempts: 0, message: '执行基线检查', pullRequestUrl: '', createdAt: now(), updatedAt: now(), history: [], liveEvents: [], liveSequence: 0 });
          run.claimed.push(key); run.taskIds.push(id);
        }
        return response(run);
      }
      const task = tasks.find(task => path === '/api/auto-ut/tasks/' + task.id);
      if (task) return response(task);
      return fallback(input, options);
    };
  } });
  return cleanup(t, { ...scene, calls, config, tasks });
}

test('正式 UT 工作区从查询范围、报告、建单到选仓执行保留完整原始参数', async t => {
  const s = await utScene(t);
  await s.input('[data-ut-domain]', 'Access_Integration');
  await s.click('[data-qw-pick="utTeams"][value="Access_网络优化开放组"]');
  assert.equal(s.find('[data-ut-create="R27C10"]').disabled, true, 'Changed scope requires a fresh report');
  await s.click('[data-ut-fetch="R27C10"]');
  assert.deepEqual(recorded(s, '/api/auto-ut/reports')[0].body, { versions: ['R27C10'] });
  const saved = recorded(s, '/api/auto-ut/report-settings', 'PUT').at(-1).body;
  assert.equal(saved.domain, 'Access_Integration');
  assert.deepEqual(saved.teams, ['Access_智能驾舱组', 'Access_网络优化开放组']);
  assert.equal(saved.username, 'integration-user');
  assert.equal(saved.workspaceRoot, '/srv/ut');
  assert.equal(saved.managedSchedules, true);
  assert.equal(s.find('[data-ut-create="R27C00"]').disabled, true, 'An empty version cannot create an issue');
  await s.click('#ut-auto-start');
  await s.click('[data-ut-create="R27C10"]');
  const creation = recorded(s, '/api/auto-ut/tickets');
  assert.equal(creation.length, 1);
  assert.match(creation[0].body.requestId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual({ ...creation[0].body, requestId: 'generated' }, { requestId: 'generated', username: 'integration-user', version: 'R27C10', reportId });
  assert.equal(recorded(s, '/api/auto-ut/reports/' + reportId + '/tasks').length, 0);
  assert.equal(s.find('a[href$="DTS2610250012345"]').target, '_blank');
  await s.click('[data-report-select="R27C10/Browser/JS"]');
  await s.click('[data-auto-ut-start]');
  assert.deepEqual(recorded(s, '/api/auto-ut/reports/' + reportId + '/tasks').map(call => call.body), [{ mode: 'AUTOMATIC', selected: ['R27C10/Browser/JS'] }]);
  assert.equal(s.find('[data-ut-fetch="R27C10"]').disabled, true);
  assert.equal(s.find('[data-report-select="R27C10/Browser/JS"]').disabled, true);
  await s.click('[data-governance-detail="' + taskId + '"]');
  assert.equal(s.w.location.hash, '#/automation/tasks');
  assert.match(s.find('.ut-task-detail').textContent, /Browser/);
  assert.match(s.find('.ut-task-meta').textContent, /\/srv\/ut\/R27C10\/Browser/);
  assert.equal(s.d.querySelectorAll('.ut-task-timeline>div').length, 6);
  await s.click('[data-auto-ut-detail-tab="history"]');
  assert.equal(s.find('[data-auto-ut-detail-tab="history"]').getAttribute('aria-selected'), 'true');
  assert.equal(recorded(s, '/api/auto-ut/reports/' + reportId + '/tasks').length, 1);
});

test('正式 UT 建单流转待确认时不启动，手动继续后只执行当前版本一次', async t => {
  const s = await utScene(t, { flowBlocked: true });
  await s.click('[data-ut-create="R27C10"]');
  assert.equal(s.find('[data-ut-start="R27C10"]').disabled, true);
  assert.match(s.find('.ut-error-summary').textContent, /流转待确认/);
  assert.equal(recorded(s, '/api/auto-ut/reports/' + reportId + '/tasks').length, 0);
  await s.click('[data-ut-continue="R27C10"]');
  assert.deepEqual(recorded(s, '/api/auto-ut/tickets/control').map(call => call.body), [{ ticket: 'DTS2610250012345', username: 'integration-user', version: 'R27C10', reportId, action: 'continue' }]);
  assert.deepEqual(recorded(s, '/api/auto-ut/reports/' + reportId + '/tasks').map(call => call.body), [{ mode: 'AUTOMATIC', selected: ['R27C10/Gateway', 'R27C10/Browser/JS'] }]);
  await s.click('[data-ux-density]');
  assert.equal(recorded(s, '/api/auto-ut/tickets').length, 1);
  assert.equal(recorded(s, '/api/auto-ut/reports/' + reportId + '/tasks').length, 1);
});

test('正式 UT 建单未知结果不自动重放，再次明确点击沿用同一请求标识', async t => {
  const s = await utScene(t, { unknownCreate: true });
  await s.click('#ut-auto-start');
  await s.click('[data-ut-create="R27C10"]');
  assert.match(s.find('.ut-error-summary').textContent, /建单结果未知/);
  await s.click('[data-ux-density]');
  await s.wait(100);
  assert.equal(recorded(s, '/api/auto-ut/tickets').length, 1);
  assert.equal(recorded(s, '/api/auto-ut/reports/' + reportId + '/tasks').length, 0);
  await s.click('[data-ut-create="R27C10"]');
  const attempts = recorded(s, '/api/auto-ut/tickets');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].body.requestId, attempts[1].body.requestId);
  assert.equal(recorded(s, '/api/auto-ut/reports/' + reportId + '/tasks').length, 0);
});

async function knowledgeScene(t, { route = 'automation/knowledge', conflict = false } = {}) {
  const repo = 'Demo/Platform/gateway-service';
  const review = { id: reviewId, entryId: '2', repo, iid: '247', url: 'https://example.test/mr/247', sha, decision: 'reject', reason: '超时路径必须释放连接并增加回归断言', category: '验证不足', time: now(), waitMs: 60000, actor: '平台人工审核', knowledgeStatus: 'failed', knowledgeError: 'Agent 整理未完成，请手动重试' };
  const items = [
    { id: knowledgeId, repo, title: '连接释放规则', content: '异常路径通过 finally 释放连接', scope: '连接池调用', status: 'active', revision: 4, sources: [reviewId], updatedAt: now() },
    { id: pendingKnowledgeId, repo: 'Demo/Platform/another-service', title: '另一个服务的知识', content: '不得混用仓库经验', scope: '另一个服务', status: 'pending', revision: 1, sources: [], updatedAt: now() }
  ];
  const calls = [];
  const s = await createStudio({ route, beforeParse(w) {
    const fallback = w.fetch;
    w.fetch = async (input, options = {}) => {
      const path = new URL(String(input), 'http://studio.test').pathname, method = options.method || 'GET';
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : null;
      calls.push({ path, method, body });
      if (path === '/api/automation/knowledge') return response({ items, reviews: [review] });
      if (path === '/api/automation/knowledge/reviews/' + reviewId + '/retry') {
        review.knowledgeStatus = 'done'; delete review.knowledgeError;
        items.push({ id: generatedKnowledgeId, repo, title: '超时回归断言', content: '超时抛错后验证连接释放一次', scope: '连接池超时路径', status: 'active', revision: 1, sources: [reviewId], updatedAt: now() });
        return response(review);
      }
      const item = items.find(item => path === '/api/automation/knowledge/' + item.id);
      if (item && method === 'PUT') {
        if (conflict || body.revision !== item.revision) return response({ message: '知识已更新，请刷新' }, 409);
        Object.assign(item, body, { revision: item.revision + 1, updatedAt: now() });
        return response(item);
      }
      return fallback(input, options);
    };
  } });
  return cleanup(t, { ...s, calls, items });
}

test('正式服务知识保留来源、编辑取消、带 revision 保存、停用与启用', async t => {
  const s = await knowledgeScene(t);
  assert.equal(s.d.querySelectorAll('[data-knowledge-edit]').length, 1, 'Knowledge is isolated by repository');
  await s.click('.review-knowledge .review-human details summary');
  assert.match(s.find('.review-knowledge .review-human details').textContent, /超时路径必须释放连接并增加回归断言/);
  await s.click('[data-knowledge-edit="' + knowledgeId + '"]');
  await s.input('[data-studio-input]', '取消的编辑');
  await s.click('[data-studio-cancel]');
  assert.equal(recorded(s, '/api/automation/knowledge/' + knowledgeId, 'PUT').length, 0);
  await s.click('[data-knowledge-edit="' + knowledgeId + '"]');
  await s.input('[data-studio-input]', '  所有异常路径都释放连接并覆盖测试  ');
  await s.click('[data-studio-confirm]');
  assert.deepEqual(recorded(s, '/api/automation/knowledge/' + knowledgeId, 'PUT')[0].body, { title: '连接释放规则', content: '所有异常路径都释放连接并覆盖测试', scope: '连接池调用', status: 'active', revision: 4 });
  assert.match(s.find('.review-knowledge').textContent, /所有异常路径都释放连接并覆盖测试/);
  await s.click('[data-knowledge-toggle="' + knowledgeId + '"]');
  assert.equal(s.find('[data-knowledge-toggle="' + knowledgeId + '"]').textContent, '确认启用');
  assert.equal(recorded(s, '/api/automation/knowledge/' + knowledgeId, 'PUT')[1].body.revision, 5);
  assert.equal(recorded(s, '/api/automation/knowledge/' + knowledgeId, 'PUT')[1].body.status, 'disabled');
  await s.click('[data-knowledge-toggle="' + knowledgeId + '"]');
  assert.equal(recorded(s, '/api/automation/knowledge/' + knowledgeId, 'PUT')[2].body.revision, 6);
  assert.equal(recorded(s, '/api/automation/knowledge/' + knowledgeId, 'PUT')[2].body.status, 'active');
  await s.input('#knowledge-service', 'Demo/Platform/another-service', 'change');
  assert.equal(s.d.querySelector('[data-knowledge-edit="' + knowledgeId + '"]'), null);
  await s.click('[data-knowledge-toggle="' + pendingKnowledgeId + '"]');
  assert.equal(recorded(s, '/api/automation/knowledge/' + pendingKnowledgeId, 'PUT')[0].body.status, 'active');
  assert.equal(s.find('[data-knowledge-toggle="' + pendingKnowledgeId + '"]').textContent, '停用');
});

test('正式服务知识遇到并发修改错误时保留原内容且不自动再次提交', async t => {
  const s = await knowledgeScene(t, { conflict: true });
  await s.click('[data-knowledge-edit="' + knowledgeId + '"]');
  await s.input('[data-studio-input]', '过期编辑不应覆盖');
  await s.click('[data-studio-confirm]');
  assert.match(s.d.body.textContent, /知识已更新，请刷新/);
  assert.match(s.find('.review-knowledge').textContent, /异常路径通过 finally 释放连接/);
  await s.click('[data-ux-density]'); await s.wait(100);
  assert.equal(recorded(s, '/api/automation/knowledge/' + knowledgeId, 'PUT').length, 1);
});

test('正式 MR 审核记录重新整理知识后可进入服务知识查看新增条目与来源', async t => {
  const s = await knowledgeScene(t, { route: 'automation/group-mr' });
  await s.click('.nav-enter[data-mr-open="2"]');
  await s.click('[data-mr-records]');
  assert.match(s.find('.review-history').textContent, /知识整理：失败/);
  await s.click('[data-knowledge-retry="' + reviewId + '"]');
  assert.deepEqual(recorded(s, '/api/automation/knowledge/reviews/' + reviewId + '/retry').map(call => call.body), [{}]);
  assert.match(s.find('.review-history').textContent, /知识整理：已完成/);
  assert.equal(s.d.querySelector('[data-knowledge-retry]'), null);
  await s.click('.review-human [data-review-knowledge]');
  assert.equal(s.w.location.hash, '#/automation/knowledge');
  const card = s.find('[data-knowledge-edit="' + generatedKnowledgeId + '"]').closest('article');
  assert.match(card.textContent, /超时回归断言/);
  card.querySelector('details summary').click(); await s.wait();
  assert.match(card.querySelector('details').textContent, /超时路径必须释放连接并增加回归断言/);
  assert.equal(recorded(s, '/api/automation/knowledge/reviews/' + reviewId + '/retry').length, 1);
});
