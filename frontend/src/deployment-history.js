export function createDeploymentHistory({request,render,escapeHtml,openTask,removed}) {
  const state={open:false,rows:[],selected:new Set(),loading:false,busy:false,error:'',confirmation:null,results:[]}
  const labels={PENDING:'等待中',ANALYZING:'分析中',AWAITING_REVIEW:'等待确认',PREPARING:'准备中',DEPLOYING:'部署中',SUCCEEDED:'成功',FAILED:'失败'}
  async function load(){
    if(state.loading||state.busy)return
    state.loading=true;state.error='';render(false)
    try{const rows=await request('/api/deployment-tasks');if(!Array.isArray(rows))throw Error('部署历史返回格式不正确');state.rows=rows;state.selected=new Set([...state.selected].filter(id=>rows.some(r=>r.id===id&&r.canDelete)))}catch(e){state.error=e.message}finally{state.loading=false;render(false)}
  }
  function html(){return '<section class="panel"><div class="panel-head"><div><h2>历史部署任务</h2><p class="qw-muted">删除仅移除任务记录及记录内日志，不卸载 Helm，不修改集群资源。</p></div><button class="button" data-dh-refresh '+(state.loading||state.busy?'disabled':'')+'>刷新</button></div><div class="panel-body"><button class="button danger" data-dh-delete-selected '+(!state.selected.size||state.busy||state.loading?'disabled':'')+'>删除选中（'+state.selected.size+'）</button>'+(state.error?'<p role="alert">'+escapeHtml(state.error)+'</p>':'')+(state.confirmation?'<div class="qw-notice" role="alert">确认删除这 '+state.confirmation.length+' 条部署记录？此操作不会删除集群资源。<button class="button danger" data-dh-confirm '+(state.busy?'disabled':'')+'>'+(state.busy?'删除中…':'确认删除')+'</button><button class="button" data-dh-cancel '+(state.busy?'disabled':'')+'>取消</button></div>':'')+state.results.map(r=>'<p role="status">'+escapeHtml(r.id.slice(0,8))+' · '+escapeHtml(r.message)+'</p>').join('')+'</div><div class="qw-table-wrap"><table class="qw-table"><thead><tr><th><input type="checkbox" aria-label="选择全部可删除部署记录" data-dh-all '+(state.busy||state.loading?'disabled':'')+' '+(state.rows.some(r=>r.canDelete)&&state.rows.filter(r=>r.canDelete).every(r=>state.selected.has(r.id))?'checked':'')+'></th><th>任务 / 模块</th><th>环境 ID / 命名空间</th><th>模式</th><th>服务数</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>'+state.rows.map(r=>'<tr><td><input type="checkbox" aria-label="选择部署 '+escapeHtml(r.id)+'" data-dh-check="'+escapeHtml(r.id)+'" '+(state.selected.has(r.id)?'checked':'')+' '+(!r.canDelete||state.busy||state.loading?'disabled':'')+'></td><td>'+escapeHtml(r.module)+'<span class="qw-sub">'+escapeHtml(r.id.slice(0,8))+'</span></td><td>'+escapeHtml(r.environmentId)+' / '+escapeHtml(r.namespace)+'</td><td>'+(r.mode==='QUICK'?'快速部署':'审阅部署')+'</td><td>'+r.serviceCount+'</td><td>'+escapeHtml(labels[r.status]||r.status)+'</td><td>'+escapeHtml(new Date(r.createdAt).toLocaleString('zh-CN'))+'</td><td><button class="qw-link" data-dh-view="'+escapeHtml(r.id)+'" '+(state.busy?'disabled':'')+'>查看</button> <button class="qw-link" data-dh-delete="'+escapeHtml(r.id)+'" '+(!r.canDelete||state.busy||state.loading?'disabled':'')+'>删除记录</button></td></tr>').join('')+(!state.rows.length?'<tr><td colspan="8">'+(state.loading?'正在加载…':'暂无部署任务')+'</td></tr>':'')+'</tbody></table></div></section>'}
  async function remove(){
    if(state.busy||!state.confirmation)return
    const rows=state.confirmation;state.busy=true;state.results=[];render(false)
    for(const r of rows){try{await request('/api/deployment-tasks/'+encodeURIComponent(r.id),{method:'DELETE',body:JSON.stringify({expectedRevision:r.revision})});state.rows=state.rows.filter(x=>x.id!==r.id);state.selected.delete(r.id);removed(r.id);state.results.push({id:r.id,message:'已删除'})}catch(e){state.results.push({id:r.id,message:'删除未完成：'+e.message+'；请刷新核对，不会自动重试'})}render(false)}
    state.confirmation=null;state.busy=false;render(false)
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-dh-tab],[data-dh-refresh],[data-dh-delete],[data-dh-delete-selected],[data-dh-confirm],[data-dh-cancel],[data-dh-view]');if(!b||b.disabled||state.busy)return
    if(b.hasAttribute('data-dh-tab')){state.open=b.dataset.dhTab==='history';state.confirmation=null;render(false);if(state.open)await load();return}
    if(b.hasAttribute('data-dh-refresh'))return load()
    if(b.hasAttribute('data-dh-cancel')){state.confirmation=null;render(false);return}
    if(b.hasAttribute('data-dh-confirm'))return remove()
    if(b.hasAttribute('data-dh-view')){await openTask(b.dataset.dhView);state.open=false;render(false);return}
    const ids=b.hasAttribute('data-dh-delete')?[b.dataset.dhDelete]:[...state.selected]
    state.confirmation=state.rows.filter(r=>ids.includes(r.id)&&r.canDelete).map(r=>({...r}));state.results=[];render(false)
  })
  document.addEventListener('change',e=>{if(state.busy||state.loading)return;const b=e.target;if(b.hasAttribute('data-dh-all'))state.selected=new Set(b.checked?state.rows.filter(r=>r.canDelete).map(r=>r.id):[]);else if(b.dataset.dhCheck){if(!state.rows.some(r=>r.id===b.dataset.dhCheck&&r.canDelete))return;if(b.checked)state.selected.add(b.dataset.dhCheck);else state.selected.delete(b.dataset.dhCheck)}else return;render(false)})
  return {state,html,load,tabs:()=>'<div class="workspace-tabs" style="margin-bottom:16px"><button data-dh-tab="current" class="'+(!state.open?'active':'')+'" '+(state.busy?'disabled':'')+'>当前部署</button><button data-dh-tab="history" class="'+(state.open?'active':'')+'" '+(state.busy?'disabled':'')+'>历史任务</button></div>'}
}
