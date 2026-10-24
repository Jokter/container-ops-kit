/* Container presentation keeps original controls, nodes and request handlers intact. */
const enhanceContainerWorkspace=(()=>{
  let resourcePane='services',treeHidden=false;const storageReads=new Set();
  const make=(tag,cls,text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node};
  let createDialog=null,createReturn=null,createOverflow='',createInert=[],createFocus=null;
  const focusable=dialog=>[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(node=>!node.disabled&&!node.closest('[hidden],[inert]')&&node.getClientRects().length);
  function releaseCreateBackground(){for(const [node,value]of createInert)node.inert=value;createInert=[];}
  function enhanceCreateDialog(){
    const dialog=document.querySelector('.cr-dialog');
    if(!dialog){if(createDialog){releaseCreateBackground();document.body.style.overflow=createOverflow;createDialog=null;(createReturn?.isConnected?createReturn:document.querySelector('[data-open-resource-create]'))?.focus({preventScroll:true});createReturn=null}return}
    const first=!createDialog;
    if(first){createOverflow=document.body.style.overflow;createReturn ||= document.activeElement;createFocus=null;}
    if(createDialog!==dialog){
      releaseCreateBackground();createDialog=dialog;
      const heading=dialog.querySelector('h2');heading.id='cx-create-title';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby',heading.id);dialog.tabIndex=-1;
      dialog.querySelector('.cr-dialog-head [data-close-resource-create]')?.setAttribute('aria-label','关闭新增资源');
      dialog.querySelector('#create-resource-yaml')?.setAttribute('aria-label','新增资源 YAML');
      const body=make('div','cx-create-body'),footer=dialog.querySelector('.cr-dialog-actions');
      for(const child of [...dialog.children])if(!child.matches('.cr-dialog-head,.cr-dialog-actions'))body.append(child);
      footer.before(body);
      // Keep the original form nodes and handlers, while making the background non-interactive.
      for(let branch=dialog.closest('.cr-modal');branch&&branch.parentElement&&branch.parentElement!==document.documentElement;branch=branch.parentElement){for(const sibling of branch.parentElement.children)if(sibling!==branch&&!sibling.matches('script,style,link')){createInert.push([sibling,sibling.inert]);sibling.inert=true}}
      document.body.style.overflow='hidden';
      queueMicrotask(()=>{if(createDialog===dialog&&dialog.isConnected&&!dialog.contains(document.activeElement)){const previous=createFocus?.id?document.getElementById(createFocus.id):createFocus?.action?dialog.querySelector('['+createFocus.action+']'):null;(previous||dialog.querySelector('#create-resource-type')||dialog).focus({preventScroll:true})}});
    }
  }
  function resourceLayout(main){
    const bench=main.querySelector('.cr-workbench');if(!bench)return;
    if(!main.querySelector('.cx-resource-panes')){
      const panes=make('div','cx-resource-panes');panes.setAttribute('role','group');panes.setAttribute('aria-label','资源工作区');
      for(const [key,label]of [['services','服务'],['resources','资源'],['editor','YAML / Diff']]){const button=make('button','',label);button.type='button';button.dataset.cxPane=key;panes.append(button)}bench.before(panes);
    }
    bench.dataset.cxPane=resourcePane;bench.classList.toggle('cx-tree-hidden',treeHidden);
    main.querySelectorAll('[data-cx-pane]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.cxPane===resourcePane)));
    const actions=bench.querySelector('.cr-editor-head>div:last-child');
    if(actions&&!actions.querySelector('[data-cx-tree]')){const toggle=make('button','button small cx-tree-toggle',treeHidden?'展开目录':'收起目录');toggle.type='button';toggle.dataset.cxTree='';toggle.setAttribute('aria-expanded',String(!treeHidden));actions.prepend(toggle)}
    const editor=bench.querySelector('textarea.cr-yaml');
    if(editor&&!editor.closest('.cx-code-surface')){
      const surface=make('div','cx-code-surface'),gutter=make('pre','cx-code-lines');gutter.setAttribute('aria-hidden','true');editor.before(surface);surface.append(gutter,editor);editor.wrap='off';
      const sync=()=>{gutter.textContent=Array.from({length:Math.min(10000,editor.value.split('\n').length)},(_,i)=>i+1).join('\n')};sync();editor.addEventListener('input',sync);editor.addEventListener('scroll',()=>{gutter.scrollTop=editor.scrollTop},{passive:true});
    }
  }
  function buildLayout(main){
    const layout=main.querySelector('.ux-build-workspace');
    if(layout){layout.classList.toggle('cx-compare',!!layout.querySelector('#compare-build-form'));layout.classList.toggle('cx-completed',!!layout.querySelector('.br-results'));}
    for(const form of main.querySelectorAll('#single-build-form,#compare-build-form'))for(const grid of form.querySelectorAll('.form-grid')){
      if(grid.classList.contains('cx-build-fields'))continue;grid.classList.add('cx-build-fields');
      const fields=[...grid.children];
      for(let index=0;index<fields.length;index++){
        const field=fields[index];if(field.querySelector('input[readonly]')&&fields[index+1]?.querySelector('input[name$="Branch"]')){
          const pair=make('div','cx-repository-pair');field.before(pair);pair.append(field,fields[++index]);
        }
      }
    }
    const bar=main.querySelector('.environment-bar'),storage=main.querySelector('.build-storage');
    if(bar&&storage&&!main.querySelector('.cx-environment-context')){const context=make('section','cx-environment-context');bar.before(context);context.append(bar,storage)}
    // Hash navigation can reach the prototype without the original click-to-load hook.
    const retry=storage?.querySelector('[data-refresh-build-storage]'),env=main.querySelector('#build-environment-selector')?.value;
    if(retry?.textContent==='重试'&&env&&!storageReads.has(env)){storageReads.add(env);queueMicrotask(()=>{if(retry.isConnected)retry.click()})}
  }
  function deployLayout(main){
    const setup=main.querySelector('.ux-deploy-setup'),guide=setup?.querySelector('.ux-deploy-guide');
    if(setup&&guide&&!setup.querySelector('.cx-deploy-help')){
      const help=make('details','cx-deploy-help'),summary=make('summary','','部署说明与注意事项');help.append(summary,guide);setup.append(help);
    }
    const panel=main.querySelector('.ux-deploy-input');if(panel){const services=panel.querySelector('.deployment-service-options');if(services)services.setAttribute('aria-label','本次部署服务');}
  }
  function enhance(main,key){
    if(!key.startsWith('container/')){enhanceCreateDialog();return}main.classList.add('cx-workspace');
    if(key==='container/build')buildLayout(main);
    if(key==='container/deploy')deployLayout(main);
    if(key==='container/operations')resourceLayout(main);
    const focus=main.querySelector('[data-ux-focus]'),head=main.querySelector(':scope>.page-head');
    if(focus&&head&&!head.contains(focus)){let actions=head.querySelector('.cx-page-actions');if(!actions){actions=make('div','cx-page-actions');head.append(actions)}actions.append(focus)}
    enhanceCreateDialog();
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-open-resource-create'))createReturn=button;
    if(button.dataset.cxPane){resourcePane=button.dataset.cxPane;resourceLayout(button.closest('.cx-workspace'))}
    if(button.hasAttribute('data-resource-service'))resourcePane='resources';
    if(button.hasAttribute('data-resource-item'))resourcePane='editor';
    if(button.hasAttribute('data-load-resource-workspace'))resourcePane='services';
    if(button.hasAttribute('data-cx-tree')){treeHidden=!treeHidden;button.textContent=treeHidden?'展开目录':'收起目录';button.setAttribute('aria-expanded',String(!treeHidden));button.closest('.cr-workbench').classList.toggle('cx-tree-hidden',treeHidden)}
  },true);
  document.addEventListener('keydown',event=>{
    if(!createDialog?.isConnected||event.defaultPrevented)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();createDialog.querySelector('[data-close-resource-create]:not(:disabled)')?.click()}
    if(event.key==='Tab'){const nodes=focusable(createDialog),at=nodes.indexOf(document.activeElement);if(!nodes.length){event.preventDefault();createDialog.focus()}else if(at<0||event.shiftKey&&at===0||!event.shiftKey&&at===nodes.length-1){event.preventDefault();(event.shiftKey?nodes.at(-1):nodes[0]).focus()}}
  });
  document.addEventListener('focusin',event=>{if(!createDialog?.isConnected)return;if(!createDialog.contains(event.target)){(focusable(createDialog)[0]||createDialog).focus({preventScroll:true});return}if(!event.target.closest('.ux-select-menu'))createFocus={id:event.target.id,action:['data-close-resource-create','data-preview-resource-create','data-create-resource'].find(name=>event.target.hasAttribute(name))}});
  return enhance;
})();
