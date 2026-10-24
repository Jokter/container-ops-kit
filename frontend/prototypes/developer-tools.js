/* Developer workbench presentation. Existing processing/export handlers remain authoritative. */
const enhanceDeveloperTools = (() => {
  const el=(tag,cls='',text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
  const button=(text,key)=>{const node=el('button','',text);node.type='button';node.dataset[key]='';return node;};
  const undo=[];
  const jsonValues=new WeakMap();
  let pendingJson=null,outlineTimer,binInputHidden=false,mobilePane='input',showAfterParse=false;
  const setText=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};

  function picker(content,cls,label){
    const details=el('details','dt-picker '+cls),summary=el('summary');
    summary.append(el('small','',label),el('span','dt-picker-value'),el('i','','⌄'));
    details.append(summary,content);return details;
  }
  function enhanceCatalog(workspace){
    workspace.classList.add('dt-catalog');
    for(const card of workspace.querySelectorAll('.ct-card')){
      const json=card.dataset.toolCard==='json';
      const preview=el('div','dt-tool-preview');preview.setAttribute('aria-hidden','true');
      preview.append(el('span','dt-preview-label',json?'JSON / TEXT':'HEX → FIELDS'));
      const code=el('pre');
      if(json){code.append(el('span','dt-code-muted','{\n'),el('span','dt-code-key','  "service"'),el('span','',': '),el('span','dt-code-string','"gateway"'),el('span','',',\n'),el('span','dt-code-key','  "replicas"'),el('span','',': '),el('span','dt-code-number','3'),el('span','','\n}'))}
      else{code.append(el('span','dt-code-muted','0B17  BA94  0001  0000\n'),el('span','','───────────\n'),el('span','dt-code-key','命令号   '),el('span','dt-code-string','0B17\n'),el('span','dt-code-key','状态     '),el('span','dt-code-number','解析成功'))}
      preview.append(code);card.querySelector('h2').before(preview);
      const copy=el('div','dt-tool-copy');const heading=card.querySelector('h2');const description=heading.nextElementSibling;heading.before(copy);copy.append(heading,description);
    }
    const note=el('div','dt-catalog-note');note.append(el('span','','使用提示'),el('p','','JSON 内容在浏览器中处理。Binlog 支持单条、批量报文及自定义命令配置。'));workspace.append(note);
  }

  function enhanceBinlog(workspace){
    const layout=workspace.querySelector('.ct-bin-layout');
    if(!layout.classList.contains('dt-bin-workbench')){
      const directory=layout.querySelector('.ct-directory'),panes=layout.querySelector('.ct-bin-main'),input=panes.firstElementChild,result=panes.lastElementChild;
      const title=input.querySelector('.ct-command-title'),modes=input.querySelector('[data-bin-mode]').closest('.ct-toolbar');
      const feature=modes.querySelector('#ct-feature'),featureLabel=feature.closest('label');
      featureLabel.firstChild.textContent='特性标识 ';feature.setAttribute('aria-label','特性标识');
      const advancedBody=el('div','dt-advanced-body');advancedBody.append(featureLabel,el('p','','按报文中的特性标识过滤整条消息，留空表示全部。Tag 用于筛选解析后的字段分组。'));
      const advanced=picker(advancedBody,'dt-advanced-picker','高级筛选');
      const tags=picker(result.querySelector('#ct-bin-tag-controls'),'dt-tag-picker','Tag');
      const command=picker(directory,'dt-command-picker ux-command-picker','命令');
      const noCommand=el('p','dt-command-empty','没有匹配的命令，试试命令码或名称。');noCommand.hidden=true;directory.append(noCommand);
      const selected=el('span','dt-command-selected');selected.append(...title.firstElementChild.childNodes);command.querySelector('.dt-picker-value').replaceWith(selected);
      const configActions=title.querySelector('.ct-actions');
      const configBar=el('div','dt-config-bar');configBar.append(command,modes,tags,advanced,configActions);layout.prepend(configBar);title.remove();
      layout.classList.add('dt-bin-workbench');input.classList.add('dt-input-pane');result.classList.add('dt-output-pane','ux-parser-result');
      const body=el('div','dt-bin-body');body.append(input,result);layout.append(body);panes.remove();
      const switcher=el('div','dt-mobile-panes');switcher.setAttribute('role','group');switcher.setAttribute('aria-label','报文工作区');
      for(const [value,label]of [['input','输入报文'],['result','解析结果']]){const b=button(label,'dtPane');b.dataset.dtPane=value;switcher.append(b)}configBar.after(switcher);
      const inputZone=input.querySelector('.ct-input-zone');
      const metrics=el('div','dt-input-meta');metrics.append(el('span','dt-input-count'),el('kbd','','⌘ / Ctrl + Enter 解析'));inputZone.querySelector('textarea').after(metrics);
      const toggle=button(binInputHidden?'展开输入':'收起输入','dtInputToggle');toggle.className='button dt-secondary';result.querySelector('.ct-command-title>.ct-actions').prepend(toggle);
      const filters=el('div','dt-result-filters'),search=result.querySelector('.ct-search');
      const messages=picker(result.querySelector('#ct-bin-message-tabs'),'dt-message-picker','批量消息');
      search.before(filters);filters.append(search,messages);
      const scroll=el('div','dt-results-scroll');scroll.setAttribute('tabindex','0');scroll.setAttribute('aria-label','解析字段结果');
      scroll.append(result.querySelector('#ct-bin-results'),result.querySelector('#ct-bin-search-empty'));result.append(scroll);
      const status=el('div','dt-result-status');status.append(result.querySelector('#ct-bin-search-count'));result.append(status);
    }
    updateBinlog(workspace);
  }
  function updateBinlog(workspace){
    if(!workspace)return;
    const layout=workspace.querySelector('.dt-bin-workbench');if(!layout)return;
    const parsed=!!workspace.querySelector('.ct-record');
    if(showAfterParse&&parsed){mobilePane='result';showAfterParse=false}
    layout.classList.toggle('dt-input-hidden',binInputHidden);layout.dataset.pane=mobilePane;
    const toggle=layout.querySelector('[data-dt-input-toggle]');toggle.setAttribute('aria-expanded',String(!binInputHidden));setText(toggle,binInputHidden?'展开输入':'收起输入');
    layout.querySelectorAll('[data-dt-pane]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dtPane===mobilePane)));
    for(const [selector,control,fallback]of [['.dt-tag-picker','#ct-bin-tag-controls','全部字段'],['.dt-message-picker','#ct-bin-message-tabs','当前消息']]){
      const host=layout.querySelector(selector),content=host.querySelector(control),hasOptions=!!content.querySelector('button');
      host.hidden=selector!=='.dt-tag-picker'&&!hasOptions;
      if(selector==='.dt-tag-picker'&&!hasOptions&&!content.textContent)content.append(el('p','dt-picker-empty','解析报文后，可在这里选择 Tag 分组。'));
      const selected=content.querySelector('[aria-pressed="true"]')?.textContent||fallback;
      setText(host.querySelector('.dt-picker-value'),selector==='.dt-tag-picker'?selected.replace(/^Tag /,''):selected);
    }
    const feature=layout.querySelector('#ct-feature');setText(layout.querySelector('.dt-advanced-picker .dt-picker-value'),feature.value?'特性 '+feature.value:'全部消息');
    updateInputMeta(layout.querySelector('#ct-bin-input'));
    const noCommand=layout.querySelector('.dt-command-empty');
    noCommand.hidden=!layout.querySelector('#ct-command-search').value.trim()||!!layout.querySelector('[data-bin-command]:not([hidden])');
  }
  function updateInputMeta(input){
    if(!input)return;
    const scope=input.closest('.dt-workspace'),text=input.value;
    const count=scope?.querySelector('.dt-input-count');setText(count,text.length.toLocaleString()+' 字符 · '+(text?text.split('\n').length:0)+' 行');
  }

  // Source offsets are derived from tokens, preserving duplicate keys and large numbers.
  function outlineModel(text){
    JSON.parse(text);
    if(text.length>200000)return null;
    const tokens=[...text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g)];
    let at=0,count=0;
    function value(name,depth){
      if(depth>40)throw Error('结构层级较深，请使用编辑器搜索定位。');
      const first=tokens[at++],raw=first[0],node={name,start:first.index,end:first.index+raw.length,type:'',children:[],preview:''};
      count++;
      if(raw==='{'||raw==='['){
        node.type=raw==='{'?'object':'array';const end=raw==='{'?'}':']';let index=0;
        while(tokens[at][0]!==end){let label='['+index+']';if(raw==='{'){label=JSON.parse(tokens[at++][0]);at++}const visible=count<240,child=value(label,depth+1);if(visible)node.children.push(child);index++;if(tokens[at][0]===',')at++}
        node.end=tokens[at].index+1;at++;node.preview=index+' 项';
      }else{node.type=raw[0]==='"'?'string':raw==='null'?'null':raw==='true'||raw==='false'?'boolean':'number';node.preview=raw.length>48?raw.slice(0,45)+'…':raw}
      return node;
    }
    const root=value('$',0);return {root,count};
  }
  function renderOutline(input,host){
    if(!input.isConnected||!host.isConnected)return;
    host.replaceChildren();const text=input.value;
    if(!text.trim()){host.append(el('div','dt-outline-empty','{ }'),el('strong','','内容结构，一眼定位'),el('p','','粘贴 JSON 或载入示例，点击字段即可定位到原文。'));return}
    try{
      const model=outlineModel(text);if(!model){host.append(el('p','dt-outline-message','内容较长，结构导航已暂缓。格式化、搜索和导出仍可正常使用。'));return}
      function row(node,depth){
        const content=el('span','dt-node-content'),name=el('b','',node.name),preview=el('small','',node.preview);content.append(name,preview);
        const locate=button('','dtLocate');locate.dataset.dtStart=String(node.start);locate.dataset.dtEnd=String(node.end);locate.setAttribute('aria-label','定位 '+node.name);locate.title='定位到原文';locate.append(el('span','dt-type dt-type-'+node.type,{object:'{ }',array:'[ ]',string:'S',number:'#',boolean:'B',null:'∅'}[node.type]),content);
        if(!['object','array'].includes(node.type))return locate;
        const group=el('details','dt-node'),summary=el('summary');group.open=depth<2;summary.append(locate);group.append(summary);const children=el('div','dt-node-children');node.children.forEach(n=>children.append(row(n,depth+1)));group.append(children);return group;
      }
      host.append(row(model.root,0));if(model.count>240)host.append(el('p','dt-outline-message','结构导航展示前 240 个节点，其余内容可使用编辑器搜索。'));
    }catch(error){host.append(el('strong','dt-outline-invalid','暂时无法生成结构'),el('p','dt-outline-message',error.message))}
  }
  function syncJson(workspace,immediate=false){
    if(!workspace)return;
    const input=workspace.querySelector('#ct-json-input'),gutter=workspace.querySelector('.dt-line-numbers'),tree=workspace.querySelector('.dt-outline-tree');if(!input||!tree)return;
    if(pendingJson!==null){if(input.value!==pendingJson){undo.push(pendingJson);if(undo.length>10)undo.shift()}pendingJson=null}
    workspace.querySelector('[data-dt-undo]').disabled=!undo.length;
    if(jsonValues.get(input)===input.value)return;jsonValues.set(input,input.value);
    const lines=input.value.split('\n').length;setText(gutter,Array.from({length:Math.min(lines,10000)},(_,i)=>i+1).join('\n'));
    updateInputMeta(input);clearTimeout(outlineTimer);
    if(immediate)renderOutline(input,tree);else outlineTimer=setTimeout(()=>renderOutline(input,tree),180);
  }
  function enhanceJson(workspace){
    if(!workspace.querySelector('.dt-json-workbench')){
      const panel=workspace.querySelector('.ct-panel'),toolbar=panel.firstElementChild,search=panel.querySelector('.ct-search'),editors=panel.querySelector('.ct-editors'),input=panel.querySelector('#ct-json-input'),footer=panel.lastElementChild;
      panel.classList.add('dt-json-workbench');toolbar.classList.add('dt-json-actions');
      const undoButton=button('撤销处理','dtUndo');undoButton.className='button';toolbar.append(undoButton,el('kbd','dt-shortcut','⌘ / Ctrl + Enter 格式化'));
      const body=el('div','dt-json-body'),main=el('section','dt-json-main'),heading=el('div','dt-editor-heading'),label=el('label','','JSON / 文本');label.htmlFor=input.id;heading.append(label);
      const actions=el('div','ct-actions');for(const id of ['sample','clear','copy','download']){const action=panel.querySelector('[data-json-action="'+id+'"]');actions.append(action)}heading.append(actions);
      const surface=el('div','dt-editor-surface'),gutter=el('pre','dt-line-numbers');gutter.setAttribute('aria-hidden','true');input.setAttribute('aria-label','JSON / 文本');input.setAttribute('wrap','off');surface.append(gutter,input);editors.replaceChildren(surface);
      input.addEventListener('scroll',()=>{gutter.scrollTop=input.scrollTop},{passive:true});
      main.append(heading,search,editors);const outline=el('aside','dt-outline');outline.setAttribute('aria-label','JSON 结构导航');outline.append(el('div','dt-outline-heading','结构导航'),el('p','dt-outline-hint','展开层级 · 点击字段定位原文'),el('div','dt-outline-tree'));body.append(main,outline);toolbar.after(body);
      const stats=el('div','dt-input-meta');stats.append(el('span','dt-input-count'),el('span','','JSON / UTF-8'));footer.append(stats);footer.classList.add('dt-json-footer');
    }
    syncJson(workspace,true);
  }
  function enhance(main,key){
    if(!key.startsWith('tools'))return;
    const workspace=main.querySelector('.ct-workspace');if(!workspace)return;
    if(!workspace.classList.contains('dt-workspace')){
      workspace.classList.add('dt-workspace');const focus=main.querySelector('[data-ux-focus]');if(focus)workspace.querySelector('.ct-heading>.ct-actions').append(focus);
      if(!key.endsWith('/json')&&!key.endsWith('/binlog'))enhanceCatalog(workspace);
    }
    if(key.endsWith('/binlog'))enhanceBinlog(workspace);if(key.endsWith('/json'))enhanceJson(workspace);
  }
  document.addEventListener('click',event=>{
    for(const open of document.querySelectorAll('.dt-picker[open]'))if(!open.contains(event.target))open.open=false;
    const target=event.target.closest('button');if(!target?.closest('.dt-workspace'))return;
    if(['format','compact','escape','unescape','sample','clear'].includes(target.dataset.jsonAction))pendingJson=document.querySelector('#ct-json-input')?.value??null;
    if(target.hasAttribute('data-bin-parse'))showAfterParse=true;
    if(target.hasAttribute('data-bin-mode')||target.hasAttribute('data-bin-command')||target.hasAttribute('data-bin-clear')||target.hasAttribute('data-bin-sample')){binInputHidden=false;mobilePane='input';showAfterParse=false}
    if(target.matches('[data-bin-tag],[data-bin-tag-all],[data-bin-message]')){const host=target.closest('.dt-picker');if(host){host.open=false;host.querySelector('summary').focus()}}
    if(target.hasAttribute('data-dt-input-toggle')){binInputHidden=!binInputHidden;updateBinlog(target.closest('.dt-workspace'))}
    if(target.hasAttribute('data-dt-pane')){mobilePane=target.dataset.dtPane;if(mobilePane==='input')binInputHidden=false;updateBinlog(target.closest('.dt-workspace'))}
    if(target.hasAttribute('data-dt-locate')){
      event.preventDefault();const input=document.querySelector('#ct-json-input');input.focus();input.setSelectionRange(Number(target.dataset.dtStart),Number(target.dataset.dtEnd));input.scrollTop=Math.max(0,(input.value.slice(0,Number(target.dataset.dtStart)).split('\n').length-1)*22-input.clientHeight/3);
    }
    if(target.hasAttribute('data-dt-undo')&&undo.length){const input=document.querySelector('#ct-json-input');input.value=undo.pop();input.dispatchEvent(new Event('input',{bubbles:true}));setText(document.querySelector('#ct-json-message'),'已恢复上次内容');input.focus()}
  },true);
  document.addEventListener('input',event=>{
    if(event.target.id==='ct-json-input')syncJson(event.target.closest('.dt-workspace'));
    if(event.target.id==='ct-bin-input')updateInputMeta(event.target);
    if(event.target.id==='ct-feature')updateBinlog(event.target.closest('.dt-workspace'));
    if(event.target.id==='ct-command-search')updateBinlog(event.target.closest('.dt-workspace'));
  });
  function revealBinlogInput(event){
    if((event.type==='change'&&event.target.id==='ct-bin-file'&&event.target.files?.length)||(event.type==='drop'&&event.target.closest('#ct-bin-drop')&&event.dataTransfer?.files.length)){
      binInputHidden=false;mobilePane='input';showAfterParse=false;
      updateBinlog(event.target.closest('.dt-workspace'));
    }
  }
  document.addEventListener('change',revealBinlogInput,true);
  document.addEventListener('drop',revealBinlogInput,true);
  document.addEventListener('focusin',event=>{
    for(const open of document.querySelectorAll('.dt-picker[open]'))if(!open.contains(event.target))open.open=false;
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      const open=[...document.querySelectorAll('.dt-picker[open]')];
      if(open.length){event.preventDefault();event.stopPropagation();open.forEach(picker=>{picker.open=false});open.at(-1).querySelector('summary').focus();return}
    }
    if(!(event.ctrlKey||event.metaKey)||event.key!=='Enter'||!event.target.closest('.dt-workspace'))return;
    const action=document.querySelector('#ct-json-input')?document.querySelector('[data-json-action="format"]'):document.querySelector('[data-bin-parse]');
    if(action&&!action.disabled){event.preventDefault();action.click()}
  },true);
  return enhance;
})();
