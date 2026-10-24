/* Styled option popup over native selects; the original select remains the form/API source. */
const enhanceWorkspaceControls=(()=>{
  let active=null,serial=0;
  const make=(tag,cls,text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node};
  const eligible=node=>node instanceof HTMLSelectElement&&!node.multiple&&node.size<=1&&node.hasAttribute('data-ux-select');
  function labelFor(select){
    if(select.getAttribute('aria-label'))return select.getAttribute('aria-label');
    const label=select.labels?.[0]||select.closest('.field,.qw-field')?.querySelector('label');
    if(label){const copy=label.cloneNode(true);copy.querySelectorAll('select,input,textarea,button').forEach(node=>node.remove());if(copy.textContent.trim())return copy.textContent.trim()}
    return ({'environment-status':'连接状态'}[select.id])||select.name||'选择选项';
  }
  function close(restore=false){
    if(!active)return;const {select,menu}=active;active=null;
    select.setAttribute('aria-expanded','false');select.removeAttribute('aria-controls');menu.remove();
    if(restore&&select.isConnected)select.focus({preventScroll:true});
  }
  function place(){
    if(!active)return;const {select,menu,list}=active,rect=select.getBoundingClientRect();
    if(!select.isConnected||select.disabled||rect.width===0){close();return}
    const width=Math.min(Math.max(rect.width,260),window.innerWidth-24);
    menu.style.width=width+'px';menu.style.left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12))+'px';
    const below=window.innerHeight-rect.bottom-14,above=rect.top-14,up=below<220&&above>below;
    const available=Math.max(100,Math.min(360,up?above:below));
    menu.style.maxHeight=available+'px';list.style.maxHeight=Math.max(70,available-(active.search?65:20))+'px';
    menu.style.top=(up?Math.max(12,rect.top-menu.getBoundingClientRect().height-6):rect.bottom+6)+'px';
  }
  function highlight(index,scroll=true){
    if(!active)return;const items=[...active.list.querySelectorAll('[role=option]:not([aria-disabled=true])')];
    if(!items.length){active.focus.removeAttribute('aria-activedescendant');return}
    active.index=(index+items.length)%items.length;
    items.forEach((node,i)=>node.classList.toggle('is-active',i===active.index));
    active.focus.setAttribute('aria-activedescendant',items[active.index].id);
    if(scroll)items[active.index].scrollIntoView({block:'nearest'});
  }
  function choose(index){
    if(!active)return;const select=active.select,option=select.options[index];
    if(!option||option.disabled||option.parentElement?.disabled)return;
    const changed=select.selectedIndex!==index,id=select.id;close(true);select.selectedIndex=index;select.title=option.textContent;
    if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
    queueMicrotask(()=>{if(!select.isConnected&&id)document.getElementById(id)?.focus({preventScroll:true})});
  }
  function draw(){
    if(!active)return;const {select,list,search}=active,query=search?.value.trim().toLowerCase()||'';list.replaceChildren();let group='';
    [...select.options].forEach((option,index)=>{
      if(option.hidden||!option.textContent.toLowerCase().includes(query))return;
      const parent=option.parentElement,label=parent?.tagName==='OPTGROUP'?parent.label:'';
      if(label&&label!==group){list.append(make('div','ux-option-group',label));group=label}
      const row=make('div','ux-option');row.id='ux-option-'+serial+'-'+index;row.setAttribute('role','option');row.dataset.index=index;
      row.setAttribute('aria-selected',String(option.selected));row.setAttribute('aria-disabled',String(option.disabled||!!parent?.disabled));
      const check=make('span','ux-option-check',option.selected?'✓':'');check.setAttribute('aria-hidden','true');row.append(make('span','ux-option-text',option.textContent),check);list.append(row);
    });
    if(!list.childElementCount)list.append(make('p','ux-select-empty','没有匹配的选项'));
    const options=[...list.querySelectorAll('[role=option]:not([aria-disabled=true])')];
    highlight(Math.max(0,options.findIndex(node=>node.getAttribute('aria-selected')==='true')),false);place();
  }
  function open(select){
    if(!eligible(select)||select.disabled)return;
    if(active?.select===select){close(true);return}close();
    document.querySelectorAll('.dt-picker[open],.pr-switch[open]').forEach(node=>{node.open=false});
    const menu=make('div','ux-select-menu'),list=make('div','ux-select-options');serial++;list.id='ux-options-'+serial;list.setAttribute('role','listbox');
    const label=labelFor(select);list.setAttribute('aria-label',label);
    let search=null;
    if(select.options.length>6){search=make('input','ux-select-search');search.type='search';search.placeholder='搜索选项…';search.setAttribute('aria-label','搜索'+label);search.setAttribute('role','combobox');search.setAttribute('aria-expanded','true');search.setAttribute('aria-controls',list.id);search.setAttribute('aria-autocomplete','list');menu.append(search)}
    list.tabIndex=-1;menu.append(list);(select.closest('dialog[open],[role="dialog"]')||document.body).append(menu);
    select.setAttribute('aria-expanded','true');select.setAttribute('aria-controls',list.id);
    active={select,menu,list,search,focus:search||list,index:0};draw();active.focus.focus({preventScroll:true});
    search?.addEventListener('input',draw);
    list.addEventListener('pointermove',event=>{const row=event.target.closest('[role=option]');if(row&&row.getAttribute('aria-disabled')!=='true')highlight([...list.querySelectorAll('[role=option]:not([aria-disabled=true])')].indexOf(row),false)});
    list.addEventListener('click',event=>{const row=event.target.closest('[role=option]');if(row)choose(Number(row.dataset.index))});
    menu.addEventListener('keydown',event=>{
      if(!active)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true)}
      else if(event.key==='Tab'){const source=active.select,dialog=source.closest('dialog[open],[role="dialog"]');close(true);const controls=[...(dialog||document).querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length&&!node.closest('[inert]'));const at=controls.indexOf(source),index=at+(event.shiftKey?-1:1);const next=dialog?controls[(index+controls.length)%controls.length]:controls[index];if(next){event.preventDefault();event.stopPropagation();next.focus()}}
      else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();highlight(event.key==='Home'?0:event.key==='End'?-1:active.index+(event.key==='ArrowDown'?1:-1))}
      else if(event.key==='Enter'||(event.key===' '&&!search)){event.preventDefault();const row=list.querySelector('.is-active');if(row)choose(Number(row.dataset.index))}
      else if(!search&&event.key.length===1&&!event.ctrlKey&&!event.metaKey){const rows=[...list.querySelectorAll('[role=option]:not([aria-disabled=true])')],index=rows.findIndex(row=>row.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()));if(index>=0){event.preventDefault();highlight(index)}}
    });
  }
  document.addEventListener('pointerdown',event=>{if(eligible(event.target)&&!event.target.disabled){event.preventDefault();event.target.focus({preventScroll:true})}},true);
  document.addEventListener('click',event=>{if(eligible(event.target)){event.preventDefault();open(event.target)}else if(active&&!active.menu.contains(event.target))close()},true);
  document.addEventListener('keydown',event=>{if(eligible(event.target)&&['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();open(event.target)}},true);
  document.addEventListener('focusin',event=>{if(active&&event.target!==active.select&&!active.menu.contains(event.target))close()});
  document.addEventListener('scroll',event=>{if(active&&!active.menu.contains(event.target))place()},true);
  window.addEventListener('resize',()=>close());window.addEventListener('hashchange',()=>close());
  return ()=>{
    document.querySelectorAll('.studio-shell select,dialog select,[role="dialog"] select').forEach(select=>{if(!select.multiple&&select.size<=1){select.dataset.uxSelect='';select.title=select.selectedOptions[0]?.textContent||'';if(!select.hasAttribute('aria-label')&&!select.labels?.length)select.setAttribute('aria-label',labelFor(select))}});
    if(active&&(!active.select.isConnected||active.select.disabled))close();
  };
})();
