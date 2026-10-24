/* Presentation-only prototype enhancement. Existing controls and listeners stay intact. */
(() => {
  const routes = [
    ['container/dashboard','容器工作台','容器运维','任务与环境总览'],
    ['container/build','构建','容器运维','单分支、双分支对比、产物、日志'],
    ['container/deploy','部署','容器运维','快速部署、审阅 Values、服务进度'],
    ['container/operations','服务资源','容器运维','命名空间、资源、YAML 和变更预览'],
    ['container/resources','环境管理','容器运维','版本、构建环境与容器环境'],
    ['automation','自动化概览','自动化','执行情况与治理入口'],
    ['automation/tools','自动化工具','自动化','UT 治理、MR 检视与质量检查'],
    ['automation/group-mr','群组 MR 检视','自动化','代码差异、意见、人工审核与合入'],
    ['automation/auto-ut','UT 治理','自动化','质量报告、治理仓库与执行'],
    ['automation/quality','质量检查','自动化','查询范围、检查结果与日志'],
    ['automation/tasks','执行记录','自动化','任务详情、执行输出与 MR'],
    ['automation/schedules','定时计划','自动化','计划配置、执行与历史'],
    ['automation/knowledge','服务知识','自动化','检视经验与知识维护'],
    ['automation/settings','连接与设置','自动化','认证、执行配置、MR 与通知'],
    ['applications','应用中心','应用','应用入口、收藏与管理'],
    ['tools/json','JSON 解析','常用工具','格式化、校验、搜索与导出'],
    ['tools/binlog','Binlog 解析','常用工具','命令、报文、解析与 Excel'],
    ['home/tools','工具中心','首页','全部工作空间与工具'],
    ['home/overview','平台概览','首页','平台总览']
  ];
  const icon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">'+({search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',focus:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',command:'<path d="M8 8h8v8H8zM8 8H5a3 3 0 1 1 3-3zm8 0V5a3 3 0 1 1 3 3zm0 8h3a3 3 0 1 1-3 3zm-8 0v3a3 3 0 1 1-3-3z"/>'}[name]||'')+'</svg>';
  const make=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text)el.textContent=text;return el;};
  let focusMode=false,compact=false,navOpen=false,appList=false,observer;
  let navReturnFocus=null;
  const navInert=new Map();
  const sectionState=new Map();
  function route(){return location.hash.replace(/^#\/?/,'').split('?')[0]||'home/tools'}
  function releaseNavigationBackground(){for(const [node,inert]of navInert)node.inert=inert;navInert.clear()}
  function syncNavigation(shell){
    const sidebar=shell?.querySelector('.variant-a-sidebar');
    if(!sidebar){navOpen=false;document.body.classList.remove('ux-nav-open');releaseNavigationBackground();return}
    if(!sidebar.querySelector('[data-ux-nav-close]')){
      const close=make('button','ux-nav-close','关闭');close.type='button';close.dataset.uxNavClose='';close.setAttribute('aria-label','关闭工作空间导航');
      sidebar.querySelector('.ux-space-name')?.append(close);
    }
    let scrim=shell.querySelector('.ux-nav-scrim');
    if(!scrim){scrim=make('button','ux-nav-scrim');scrim.type='button';scrim.tabIndex=-1;scrim.dataset.uxNavClose='';scrim.setAttribute('aria-label','关闭工作空间导航');sidebar.before(scrim)}
    const modal=navOpen&&window.innerWidth<=600;scrim.hidden=!modal;
    if(modal){
      sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');sidebar.setAttribute('aria-label','工作空间导航');sidebar.dataset.uxModalNav='';
      for(let branch=sidebar;branch&&branch!==document.body;branch=branch.parentElement){
        for(const sibling of branch.parentElement.children){
          if(sibling===branch||sibling===scrim||sibling.contains(scrim)||sibling.matches('script,style,link'))continue;
          if(!navInert.has(sibling))navInert.set(sibling,sibling.inert);sibling.inert=true;
        }
      }
      if(!sidebar.contains(document.activeElement))sidebar.querySelector('[data-ux-nav-close]')?.focus({preventScroll:true});
    }else{
      releaseNavigationBackground();
      if(sidebar.hasAttribute('data-ux-modal-nav')){sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');sidebar.removeAttribute('aria-label');delete sidebar.dataset.uxModalNav}
    }
  }
  function setNavigation(open,restore=true){
    if(open&&!navOpen)navReturnFocus=document.querySelector('[data-ux-nav]')||document.activeElement;
    navOpen=open;document.body.classList.toggle('ux-nav-open',navOpen);enhance();
    if(open&&window.innerWidth<=600)document.querySelector('#ux-navigation [data-ux-nav-close]')?.focus({preventScroll:true});
    else if(!open&&restore){const target=navReturnFocus?.isConnected?navReturnFocus:document.querySelector('[data-ux-nav]');target?.focus({preventScroll:true});navReturnFocus=null}
  }
  function addCommand(){
    if(document.querySelector('.ux-command'))return;
    const dialog=make('dialog','ux-command');dialog.setAttribute('aria-label','搜索功能与页面');
    dialog.innerHTML='<div class="ux-command-input">'+icon('search')+'<input aria-label="搜索功能" placeholder="搜索功能，例如 MR、部署、YAML…" autocomplete="off"><button type="button" data-ux-close aria-label="关闭功能搜索">Esc</button></div><div class="ux-command-results"></div><footer>↑ ↓ 选择 · Enter 打开 · Esc 关闭</footer>';
    document.body.append(dialog);
    const input=dialog.querySelector('input');
    function results(){const query=input.value.toLowerCase().trim();const results=dialog.querySelector('.ux-command-results');results.replaceChildren();for(const [path,name,group,description]of routes.filter(row=>row.join(' ').toLowerCase().includes(query))){const a=make('a','ux-command-item');a.href='#/'+path;const title=make('span');title.append(make('strong','',name),make('small','',description));a.append(title,make('em','',group));a.addEventListener('click',()=>dialog.close());results.append(a)}if(!results.childElementCount)results.append(make('p','ux-command-empty','没有匹配的功能，试试“构建”“检视”或“设置”。'))}
    input.addEventListener('input',results);dialog.addEventListener('keydown',e=>{const items=[input,...dialog.querySelectorAll('.ux-command-item')];const index=items.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}if(e.key==='Enter'&&document.activeElement===input){dialog.querySelector('.ux-command-item')?.click()}});dialog.addEventListener('click',e=>{if(e.target===dialog||e.target.closest('[data-ux-close]'))dialog.close()});dialog.addEventListener('close',()=>document.querySelector('[data-ux-search]')?.focus());results();
  }
  function openCommand(){if(navOpen)setNavigation(false,false);addCommand();const d=document.querySelector('.ux-command');d.showModal();d.querySelector('input').focus()}
  function addNavigation(shell,key){
    const sidebar=shell.querySelector('.variant-a-sidebar');if(!sidebar||sidebar.querySelector('.ux-space-name'))return;
    sidebar.id='ux-navigation';
    const group=key.startsWith('container')?'容器运维':key.startsWith('automation')?'研发自动化':key.startsWith('tools')?'开发工具':'应用工作区';
    const head=make('div','ux-space-name');head.append(make('span','ux-space-mark',group.slice(0,1)),make('div','',group));head.append(make('small','','WORKSPACE'));sidebar.prepend(head);
    if(key.startsWith('automation')){
      const original=shell.querySelector('.capability-switch');
      const nav=original||make('nav','ux-direct-nav');nav.classList.add('ux-direct-nav');nav.setAttribute('aria-label','自动化能力直达');nav.prepend(make('div','nav-section','研发能力'));
      for(const path of (original?['automation/knowledge']:['automation/group-mr','automation/auto-ut','automation/quality','automation/knowledge'])){const item=routes.find(r=>r[0]===path);const a=make('a',key===path?'active':'',item[1]);a.href='#/'+path;if(key===path)a.setAttribute('aria-current','page');a.prepend(make('span','ux-nav-dot'));nav.append(a)}
      const mr=nav.querySelector('[data-automation-nav="group-mr"]');if(mr)nav.insertBefore(mr,nav.querySelector('button'));
      if(!original){const back=make('a','ux-all-tools','所有工具 ↗');back.href='#/automation/tools';nav.append(back)}
      sidebar.querySelector('.variant-a-nav')?.after(nav);
      if(['automation/group-mr','automation/auto-ut','automation/quality','automation/knowledge'].includes(key)){const parent=sidebar.querySelector('.variant-a-nav [data-automation-nav="tools"]');parent?.classList.remove('active');parent?.removeAttribute('aria-current')}
      const oldBack=shell.querySelector('.qw-crumb button');if(oldBack){oldBack.classList.add('studio-settings-link');sidebar.querySelector('.studio-sidebar-bottom')?.prepend(oldBack)}
      // Keep original listeners, but show only one route to the tool catalog.
      sidebar.querySelector('.variant-a-nav [data-automation-nav="tools"] span')?.replaceChildren(document.createTextNode('工具总览'));
      for(const duplicate of sidebar.querySelectorAll('.ux-direct-nav [data-automation-nav="tools"],.ux-all-tools,.studio-sidebar-bottom [data-automation-nav="tools"],.studio-sidebar-bottom [data-automation-back]'))duplicate.classList.add('ux-redundant');
    }
    for(const active of sidebar.querySelectorAll('button.active'))active.setAttribute('aria-current','page');
  }
  function addTools(shell){
    const top=shell.querySelector('.studio-topbar');if(!top||top.querySelector('.ux-global-tools'))return;
    const tools=make('div','ux-global-tools');tools.innerHTML='<button type="button" data-ux-nav class="ux-mobile-nav" aria-controls="ux-navigation" aria-expanded="'+navOpen+'" aria-label="展开工作空间导航">'+icon('menu')+'</button><button type="button" data-ux-search class="ux-search-trigger">'+icon('search')+'<span>搜索功能</span><kbd>⌘ K</kbd></button><button type="button" data-ux-density class="ux-icon-button" aria-label="切换紧凑布局" title="切换紧凑布局" aria-pressed="'+compact+'">'+icon('menu')+'</button>';
    tools.querySelector('[data-ux-search]').setAttribute('aria-label','搜索功能');top.append(tools);
  }
  function addPageContext(main,key){
    const existing=main.querySelector('.ux-page-context');if(existing){if(!main.querySelector('[data-ux-focus]')&&main.querySelector('.nav-review,.cr-workbench,.ct-editors,.ct-bin-layout,.deployment-editor-panel')){const b=make('button','ux-focus-button','专注工作区');b.type='button';b.dataset.uxFocus='';b.setAttribute('aria-pressed','false');b.insertAdjacentHTML('afterbegin',icon('focus'));existing.querySelector('.ux-context-actions').append(b)}return;}
    const current=routes.find(r=>r[0]===key);if(!current)return;
    const context=make('div','ux-page-context');const trail=make('div','ux-breadcrumb');const home=make('a','','工作空间');home.href='#/home/tools';trail.append(home,make('span','','/'),make('span','',current[2]));context.append(trail);
    const actions=make('div','ux-context-actions');if(main.querySelector('.nav-review,.cr-workbench,.ct-editors,.ct-bin-layout,.deployment-editor-panel')){const button=make('button','ux-focus-button',focusMode?'退出专注':'专注工作区');button.type='button';button.dataset.uxFocus='';button.setAttribute('aria-pressed',String(focusMode));button.insertAdjacentHTML('afterbegin',icon('focus'));actions.append(button)}context.append(actions);main.prepend(context);
  }
  function addSectionNavigation(main,key){
    const targets=[];
    const candidates=key==='automation/settings'?[...main.querySelectorAll('.studio-setting-section')]:key==='container/build'?[...main.querySelectorAll('.br-config,.br-results,.summary-stack>.panel,.br-logs')]:key==='container/deploy'?[...main.querySelectorAll('.deployment-overview,.deployment-workspace,.deployment-log-disclosure')]:[];
    for(const el of candidates){const title=el.querySelector('h2,summary')?.textContent.trim().replace(/\s+/g,' ');if(!title)continue;const id='ux-section-'+targets.length;el.id=id;targets.push({el,id,title:title.slice(0,24)})}
    if(targets.length<2||main.querySelector('.ux-section-nav'))return;
    const nav=make('nav','ux-section-nav');nav.setAttribute('aria-label','本页分区');nav.append(make('span','ux-section-label',key==='automation/settings'?'设置目录':'工作流程'));
    targets.forEach(({id,title},i)=>{const button=make('button','',title);button.type='button';button.dataset.uxSection=id;button.prepend(make('span','ux-section-number',String(i+1).padStart(2,'0')));nav.append(button)});
    const head=main.querySelector('.page-head');head?.after(nav);
  }
  function addReviewFocus(main){
    const flow=main.querySelector('.nav-flow-card');if(!flow||flow.classList.contains('ux-process'))return;
    const heading=flow.querySelector('.nav-flow-heading'),steps=flow.querySelector('.group-mr-flow');if(!heading||!steps)return;
    const record=typeof mrSelected==='function'?mrSelected():null;
    const task=record&&typeof mrTask==='function'?mrTask(record):null;
    flow.classList.add('ux-process');flow.dataset.uxProcessTone=task?.tone||'active';
    const copy=make('div','ux-process-copy'),actions=make('div','ux-process-actions');
    copy.append(...heading.querySelectorAll(':scope>strong,:scope>.nav-flow-status'));
    actions.append(...heading.children);heading.append(copy,actions);
    if(task?.hint)heading.after(make('p','ux-process-hint',task.hint));
    const items=[...steps.children];
    let current=steps.querySelector('[aria-current="step"]');
    if(!current&&task&&!['DONE','CLOSED'].includes(record?.phase)){
      const label={notes:'检视意见',review:'人工审核',merge:'合并'}[task.target];
      current=label?items.find(item=>item.querySelector('b')?.textContent===label&&!item.classList.contains('done')&&!item.classList.contains('skipped')):null;
      current?.setAttribute('aria-current','step');
    }
    items.forEach((item,index)=>{
      const dot=item.querySelector('.group-mr-dot'),state=item.querySelector('small'),active=item===current;
      const done=item.classList.contains('done'),skipped=item.classList.contains('skipped');
      if(active)item.classList.add('ux-process-current');
      if(active&&['warn','error'].includes(task?.tone))item.classList.add('ux-process-attention');
      if(dot){if(done)dot.innerHTML='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m5 10 3.2 3.2L15 6.5"/></svg>';else dot.textContent=skipped?'−':String(index+1)}
      if(state&&!done&&!skipped&&!active)state.textContent='待开始';
      if(state&&active&&!done&&!skipped&&task?.target==='notes')state.textContent='待确认';
      if(state&&index===0&&done)state.textContent='已接收';
    });
  }
  function disclosure(element,id,title,copy,open){
    const details=make('details','ux-preparation'),summary=make('summary'),text=make('span','ux-preparation-copy');
    details.dataset.uxDisclosure=id;details.open=sectionState.get(id)??open;
    text.append(make('strong','',title),make('small','',copy));summary.append(text,make('span','ux-disclosure-hint'));
    summary.addEventListener('click',()=>sectionState.set(id,!details.open));
    element.before(details);details.append(summary,element);return details;
  }
  function composeAutomation(main,key){
    if(key==='automation/schedules'||key==='automation/tasks'){
      for(const cell of main.querySelectorAll('.qw-table tbody tr>td:last-child')){
        if(cell.querySelector('.ux-row-more'))continue;
        const actions=[...cell.querySelectorAll('[data-schedule-toggle],[data-schedule-delete],.studio-delete-record')];if(!actions.length)continue;
        const more=make('details','ux-row-more'),summary=make('summary','','更多');more.append(summary);actions[0].before(more);actions.forEach(action=>more.append(action));
      }
      return;
    }
    if(!['automation/auto-ut','automation/quality'].includes(key))return;
    const query=main.querySelector('.qw-query');if(!query||query.closest('.ux-preparation'))return;
    const ut=key.endsWith('auto-ut'),hasResults=!!main.querySelector(ut?'#qw-plan-search':'.qw-stats');
    const copy=ut?[...query.querySelectorAll('.ut-version-card')].map(card=>card.querySelector('b')?.textContent+' · '+(card.classList.contains('is-locked')?'已有治理任务':'报告与建单')).join('  /  '):[query.querySelector('[data-q-field="domain"]')?.value,query.querySelector('[data-q-field="date"]')?.value,'版本、团队与检查类型'].filter(Boolean).join(' · ');
    const schedule=query.querySelector('.qw-schedule-strip')?.closest('.qw-query-foot');
    const details=disclosure(query,ut?'ut-setup':'quality-setup',ut?'报告范围与版本建单':'检查范围',copy,!hasResults);
    if(schedule){schedule.classList.add('ux-schedule-bar');details.parentElement.append(schedule)}
    if(ut&&hasResults){const result=main.querySelector('#qw-plan-search')?.closest('.panel');result?.classList.add('ux-primary-results')}
  }
  function composeTools(main,key){enhanceDeveloperTools(main,key)}
  function composeApplications(main){
    const content=main.querySelector('.ac-workspace');if(!content)return;
    content.classList.toggle('ux-app-list',appList);
    if(!content.querySelector('.ux-app-view')){const bar=make('div','ux-app-view'),count=make('span','ux-app-count');count.setAttribute('role','status');bar.append(count);const group=make('div','ux-view-switch');group.setAttribute('role','group');group.setAttribute('aria-label','应用显示方式');for(const [value,label]of [['cards','卡片'],['list','列表']]){const b=make('button','',label);b.type='button';b.dataset.uxAppView=value;group.append(b)}bar.append(group);content.querySelector('#ac-cards')?.before(bar)}
    const count=content.querySelectorAll('.ac-card').length;content.querySelector('.ux-app-count').textContent='当前显示 '+count+' 个应用';
    content.querySelectorAll('[data-ux-app-view]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.uxAppView==='list')===appList)));
  }
  function composeContainer(main,key){
    if(key==='container/dashboard'){const metrics=main.querySelector('.home-metrics'),welcome=main.querySelector('.home-welcome');if(metrics&&welcome&&welcome.nextElementSibling!==metrics)welcome.after(metrics)}
    const environment=main.querySelector('.environment-bar');if(environment&&!environment.querySelector('.ux-environment-label'))environment.firstElementChild?.prepend(make('span','ux-environment-label','当前操作环境'));
    main.querySelectorAll('.field').forEach((field,index)=>{const label=field.querySelector('label'),control=field.querySelector('input,select,textarea');if(label&&control&&!control.labels?.length){control.id ||= 'ux-field-'+index;label.htmlFor=control.id}});
    if(key==='container/deploy'&&!main.querySelector('.ux-deploy-guide')&&main.querySelector('#deployment-artifact')){
      const panel=main.querySelector('#deployment-artifact').closest('.panel');panel.classList.add('ux-deploy-input');
      const guide=make('aside','ux-deploy-guide');guide.setAttribute('aria-label','部署操作步骤');guide.append(make('small','','DEPLOYMENT'),make('h2','','准备一次部署'));
      const selected=!!main.querySelector('#deployment-namespace')?.value;
      for(const [i,title,copy]of [[1,'确认目标环境','选择上方环境与成功构建产物。'],[2,'读取服务范围','连接环境，选择命名空间和本次服务。'],[3,'选择部署方式','分析并审阅可逐项修改 Values；快速部署使用自动分析结果。']]){const row=make('div','ux-deploy-step'+(i===(selected?3:2)?' current':''));row.append(make('b','',String(i)),make('div',''));row.lastElementChild.append(make('strong','',title),make('p','',copy));guide.append(row)}
      guide.append(make('p','ux-deploy-note','部署会先卸载再安装已选服务。请在执行前核对环境、命名空间与服务范围。'));
      const layout=make('div','ux-deploy-setup');panel.before(layout);layout.append(panel,guide);
    }
  }
  function composeHome(shell,key){
    if(key!=='home/tools')return;
    const home=shell.querySelector('.pr-home'),input=home?.querySelector('#pr-search');if(!input||home.querySelector('.ux-home-results'))return;
    input.placeholder='搜索功能：部署、JSON、质量检查…';
    const query=input.value.toLowerCase().trim(),results=make('section','ux-home-results');results.setAttribute('aria-label','功能搜索结果');results.hidden=!query;
    if(query){const matches=routes.filter(r=>!r[0].startsWith('home/')&&r.join(' ').toLowerCase().includes(query));results.append(make('h2','','功能直达 · '+matches.length+' 项'));const list=make('div','ux-home-result-grid');matches.forEach(([path,name,group,description])=>{const a=make('a');a.href='#/'+path;a.append(make('small','',group),make('strong','',name),make('span','',description));list.append(a)});results.append(list);if(!matches.length)results.append(make('p','','没有找到功能，试试“构建”“日志”或“JSON”。'))}
    home.querySelector('.pr-home-head').after(results);
    const heads=[...home.querySelectorAll(':scope>.pr-section-head')];if(heads.length===2){const dock=make('div','ux-home-dock');heads[0].before(dock);heads.forEach(head=>{const body=head.nextElementSibling,section=make('section','ux-home-dock-section');dock.append(section);section.append(head);if(body)section.append(body)})}
  }
  function composeWorkspace(main,key){
    const inbox=main.querySelector('.nav-list');
    if(inbox&&!inbox.querySelector('.ux-inbox-layout')){
      const layout=make('div','ux-inbox-layout'),queue=make('section','ux-inbox-queue'),insights=make('aside','ux-inbox-insights');
      queue.setAttribute('aria-label','MR 待办队列');insights.setAttribute('aria-label','群监听与处理概况');
      const metrics=inbox.querySelector('.group-mr-overview'),monitor=inbox.querySelector('.group-mr-monitor');
      const title=make('div','ux-rail-heading','运行概况');insights.append(title);if(metrics)insights.append(metrics);if(monitor)insights.append(monitor);
      const elements=[...inbox.children].filter(e=>e.matches('.group-mr-tabs,.group-mr-toolbar,.mr-batch-bar,.mr-split,.group-mr-notice,.review-human'));
      if(elements.length){elements[0].before(layout);elements.forEach(e=>queue.append(e));layout.append(insights,queue)}
    }
    if(key==='automation/settings'){
      const content=main.querySelector('.quality-workspace');
      if(content&&!content.querySelector('.ux-settings-layout')){const sections=[...content.querySelectorAll(':scope>.studio-setting-section')],nav=content.querySelector('.ux-section-nav');if(sections.length&&nav){const layout=make('div','ux-settings-layout'),body=make('div','ux-settings-body');nav.before(layout);layout.append(nav,body);sections.forEach(e=>body.append(e))}}
    }
    if(key==='container/build'&&!main.querySelector('.ux-build-workspace')){
      const config=main.querySelector(':scope>.br-config');
      if(config){const result=config.nextElementSibling;if(result&&result.tagName==='DIV'){const layout=make('div','ux-build-workspace');config.before(layout);layout.append(config,result)}}
    }
    composeAutomation(main,key);composeTools(main,key);composeContainer(main,key);enhanceContainerWorkspace(main,key);if(key==='applications')composeApplications(main);enhanceAutomationRefinements(main,key);
  }
  function enhance(){
    observer?.disconnect();
    if(typeof document==='undefined'||!document.body)return;
    const shell=document.querySelector('.studio-shell'),main=shell?.querySelector('.variant-a-main');const internal=shell&&!shell.classList.contains('pr-portal-shell');const key=route();
    document.body.classList.toggle('ux-focus',!!internal&&focusMode);document.body.classList.toggle('ux-compact',compact);
    if(internal&&main){shell.classList.add('ux-shell');shell.dataset.uxRoute=key;main.id='ux-main';main.setAttribute('tabindex','-1');if(!shell.querySelector('.ux-skip')){const skip=make('a','ux-skip','跳到工作区');skip.href='#ux-main';skip.dataset.uxSkip='';shell.prepend(skip)}addNavigation(shell,key);addTools(shell);const menu=shell.querySelector('[data-ux-nav]');if(menu){menu.setAttribute('aria-expanded',String(navOpen));menu.setAttribute('aria-label',navOpen?'收起工作空间导航':'展开工作空间导航')}addPageContext(main,key);addSectionNavigation(main,key);addReviewFocus(main);composeWorkspace(main,key);for(const b of main.querySelectorAll('[data-ux-focus]')){b.setAttribute('aria-pressed',String(focusMode));const text=focusMode?'退出专注':'专注工作区';if(b.textContent!==text)b.innerHTML=icon('focus')+text}for(const el of main.querySelectorAll('textarea:not([aria-label])')){if(!el.labels?.length)el.setAttribute('aria-label',el.classList.contains('cr-yaml')?'资源 YAML':el.classList.contains('deployment-values')?'部署 Values':'编辑内容')}
      const exit=document.querySelector('.ux-focus-exit');if(focusMode&&!exit){const button=make('button','ux-focus-exit','退出专注');button.type='button';button.dataset.uxFocus='';button.insertAdjacentHTML('afterbegin',icon('focus'));document.body.append(button)}else if(!focusMode)exit?.remove();
    }else {document.querySelector('.ux-focus-exit')?.remove();if(shell)composeHome(shell,key)}
    if(shell){
      enhancePortalRefinements(shell,key);
      const host=internal?shell.querySelector('.ux-context-actions'):shell.querySelector('.pr-eyebrow');
      if(host&&!host.querySelector('.ux-prototype-note')){const note=make('span','ux-prototype-note','模拟数据');note.title='交互原型，刷新后重置模拟数据';host.append(note)}
    }
    syncNavigation(internal?shell:null);enhanceWorkspaceControls();
    observer?.observe(document.body,{childList:true,subtree:true});
  }
  document.addEventListener('click',e=>{
    if(!navOpen||!e.target.closest('#ux-navigation'))return;
    const destination=e.target.closest('a[href],button');
    if(!destination||destination.disabled||destination.hasAttribute('data-ux-nav-close'))return;
    setNavigation(false,false);
    queueMicrotask(()=>document.getElementById('ux-main')?.focus({preventScroll:true}));
  },true);
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-ux-search],[data-ux-density],[data-ux-focus],[data-ux-section],[data-ux-skip],[data-ux-nav],[data-ux-nav-close],[data-ux-app-view]');if(!button)return;
    if(button.hasAttribute('data-ux-app-view')){appList=button.dataset.uxAppView==='list';enhance()}
    if(button.hasAttribute('data-ux-nav'))setNavigation(!navOpen);
    if(button.hasAttribute('data-ux-nav-close'))setNavigation(false);
    if(button.hasAttribute('data-ux-skip')){e.preventDefault();document.getElementById('ux-main')?.focus()}
    if(button.hasAttribute('data-ux-search'))openCommand();
    if(button.hasAttribute('data-ux-density')){compact=!compact;button.setAttribute('aria-pressed',String(compact));document.body.classList.toggle('ux-compact',compact)}
    if(button.hasAttribute('data-ux-focus')){focusMode=!focusMode;document.querySelectorAll('[data-ux-focus]').forEach(b=>{b.setAttribute('aria-pressed',String(focusMode));b.innerHTML=icon('focus')+(focusMode?'退出专注':'专注工作区')});enhance()}
    if(button.dataset.uxSection){const el=document.getElementById(button.dataset.uxSection);if(el?.tagName==='DETAILS')el.open=true;el?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});if(el){el.setAttribute('tabindex','-1');el.focus({preventScroll:true})}}
  });
  document.addEventListener('keydown',e=>{
    if(!navOpen||window.innerWidth>600)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setNavigation(false);return}
    if(e.key==='Tab'){
      const items=[...document.querySelectorAll('#ux-navigation button,#ux-navigation a[href],#ux-navigation [tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length&&!node.closest('[inert]'));
      const first=items[0],last=items.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
    }
  },true);
  document.addEventListener('focusin',e=>{if(navOpen&&window.innerWidth<=600&&!e.target.closest('#ux-navigation'))document.querySelector('#ux-navigation [data-ux-nav-close]')?.focus({preventScroll:true})});
  document.addEventListener('keydown',e=>{if(e.defaultPrevented)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommand()}if(e.key==='Escape'&&focusMode&&!document.querySelector('.ux-command[open]')){focusMode=false;enhance()}});
  window.addEventListener('hashchange',()=>{navOpen=false;document.body.classList.remove('ux-nav-open');focusMode=false;enhance()});
  window.addEventListener('resize',()=>{if(navOpen&&window.innerWidth>600)setNavigation(false,false)});
  function start(){addCommand();observer=new MutationObserver(enhance);enhance()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
