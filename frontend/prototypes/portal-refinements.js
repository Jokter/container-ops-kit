/* Portal presentation: retain original card actions, search and application handlers. */
const enhancePortalRefinements=(()=>{
  const make=(tag,cls,text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node};
  function clearInput(id){
    const input=document.getElementById(id);if(!input)return;
    input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById(id)?.focus();
  }
  function addClearSearch(input,kind){
    let host=input.closest('.pf-search');
    if(!host){host=make('div','pf-search');input.before(host);host.append(input);const clear=make('button','pf-search-clear','×');clear.type='button';clear.dataset.pfClear=input.id;clear.setAttribute('aria-label','清空'+kind+'搜索');host.append(clear)}
    host.querySelector('[data-pf-clear]').hidden=!input.value;
  }
  function applications(shell){
    const workspace=shell.querySelector('.ac-workspace');if(!workspace)return;
    workspace.classList.add('pf-apps');
    const toolbar=workspace.querySelector('.ac-toolbar'),search=workspace.querySelector('#ac-search'),view=workspace.querySelector('.ux-app-view');
    if(toolbar&&search&&view){
      addClearSearch(search,'应用');
      if(!toolbar.querySelector('.pf-app-controls')){const controls=make('div','pf-app-controls');toolbar.append(controls);controls.append(search.closest('.pf-search'),view)}
    }
    for(const card of workspace.querySelectorAll('.ac-card')){
      if(card.querySelector('.pf-app-identity'))continue;
      const top=card.querySelector('.ac-card-top'),title=card.querySelector('h2'),category=top.querySelector(':scope>span'),identity=make('div','pf-app-identity');
      top.querySelector('.ac-icon').after(identity);identity.append(title,category);
    }
    const cards=workspace.querySelector('#ac-cards'),empty=cards?.querySelector('.ac-empty'),grid=cards?.querySelector('.ac-grid');
    if(empty){
      grid.hidden=true;
      if(!empty.classList.contains('pf-app-empty')){
        empty.classList.add('pf-app-empty');empty.setAttribute('role','status');
        const reset=make('button','button','清除筛选，查看全部应用');reset.type='button';reset.dataset.pfResetApps='';
        empty.replaceChildren(make('strong','','没有匹配的应用'),make('span','','可以调整关键词、分类或收藏范围。'),reset);
        grid.before(empty);
      }
    }
    const loading=cards?.querySelector('.pr-no-data'),count=workspace.querySelector('.ux-app-count');
    if(loading&&count)count.textContent=loading.querySelector('h3')?.textContent||'应用未加载';
  }
  function home(shell){
    const home=shell.querySelector('.pr-home'),input=home?.querySelector('#pr-search');if(!input)return;
    addClearSearch(input,'功能');
    const query=input.value.trim(),results=home.querySelector('.ux-home-results'),spaces=home.querySelector('.pr-space-grid'),dock=home.querySelector('.ux-home-dock');
    if(!results||!spaces)return;
    const functions=results.querySelectorAll('.ux-home-result-grid a').length,workspaces=spaces.querySelectorAll('.pr-space-card').length;
    // A functional result and an unrelated workspace empty state must not contradict each other.
    spaces.hidden=!!query&&!workspaces;
    results.hidden=!query||(!functions&&!!workspaces);
    if(dock)dock.hidden=!!query;
    if(query&&!functions&&!workspaces){
      results.classList.add('pf-search-empty');results.querySelector('h2').textContent='没有搜索结果';
      const copy=results.querySelector(':scope>p');if(copy)copy.textContent='没有找到匹配的功能或工作空间，请尝试其他关键词。';
    }
  }
  document.addEventListener('click',event=>{
    const clear=event.target.closest('[data-pf-clear]');if(clear){clearInput(clear.dataset.pfClear);return}
    if(event.target.closest('[data-pf-reset-apps]')){
      // Drive the original controls so category, favorite and query state remain authoritative.
      clearInput('ac-search');
      document.querySelector('[data-app-category="全部应用"]')?.click();
      document.querySelector('[data-app-filter="all"]')?.click();
      document.getElementById('ac-search')?.focus();
    }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&['pr-search','ac-search'].includes(event.target.id)&&event.target.value){event.preventDefault();clearInput(event.target.id)}});
  return (shell,key)=>{if(key==='applications')applications(shell);if(key==='home/tools')home(shell)};
})();
