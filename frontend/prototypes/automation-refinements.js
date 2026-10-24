/* Presentation-only automation refinements. Move existing controls; keep their listeners. */
const enhanceAutomationRefinements = (() => {
  const menuSelector = '.ux-row-more,.ut-task-more';
  let settingsRoot = null, settingsObserver = null;
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const setText = (element, text) => { if (element && element.textContent !== text) element.textContent = text; };
  function enhanceEffectiveness(main, key) {
    if (key !== 'automation') return;
    main.querySelectorAll('.governance-dashboard .ov-secondary .review-metric>strong').forEach(value => {
      const text = value.textContent.trim();
      const numeric = text.match(/^(\d+(?:\.\d+)?)(%|\s*分钟)$/);
      value.classList.toggle('ax-metric-empty', !numeric);
      if (value.dataset.axMetricValue === text) return;
      value.dataset.axMetricValue = text;
      if (numeric) value.replaceChildren(make('span', 'ax-metric-number', numeric[1]), make('span', 'ax-metric-unit', numeric[2]));
    });
  }
  function positionMenu(details) {
    const menu = details.querySelector(':scope>.ax-action-menu');
    if (!details.open || !menu) return;
    const anchor = details.querySelector('summary').getBoundingClientRect();
    const width = Math.min(184, window.innerWidth - 24);
    menu.style.width = width + 'px';
    menu.style.maxHeight = Math.max(100, window.innerHeight - 24) + 'px';
    const height = Math.min(menu.scrollHeight || 110, window.innerHeight - 24);
    const top = anchor.bottom + height + 8 > window.innerHeight - 12 ? Math.max(12, anchor.top - height - 6) : anchor.bottom + 6;
    menu.style.left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)) + 'px';
    menu.style.top = top + 'px';
  }
  function closeMenus(target, restoreFocus = false) {
    let closed = false;
    document.querySelectorAll('.ux-row-more[open],.ut-task-more[open]').forEach(details => {
      if (target && details.contains(target)) return;
      const hadFocus = details.contains(document.activeElement);
      details.open = false;
      details.querySelector('summary')?.setAttribute('aria-expanded', 'false');
      if (restoreFocus && hadFocus) details.querySelector('summary')?.focus();
      closed = true;
    });
    return closed;
  }
  function enhanceMenus(main) {
    main.querySelectorAll(menuSelector).forEach(details => {
      if (details.hasAttribute('data-ax-menu')) { positionMenu(details); return; }
      details.dataset.axMenu = '';
      const summary = details.querySelector(':scope>summary');
      if (!summary) return;
      let menu = details.querySelector(':scope>div');
      if (!menu) {
        menu = make('div', 'ax-action-menu');
        [...details.children].filter(child => child !== summary).forEach(child => menu.append(child));
        details.append(menu);
      }
      menu.classList.add('ax-action-menu');
      summary.setAttribute('aria-expanded', String(details.open));
      details.addEventListener('toggle', () => {
        summary.setAttribute('aria-expanded', String(details.open));
        if (details.open) { closeMenus(details); positionMenu(details); }
      });
    });
  }
  function labelTables(main, key) {
    if (!['automation/tasks', 'automation/schedules'].includes(key)) return;
    const tables = key.endsWith('tasks') ? main.querySelectorAll('.studio-record-table') : main.querySelectorAll('.qw-table');
    tables.forEach(table => {
      table.classList.add('ax-record-cards');
      table.closest('.qw-table-wrap')?.classList.add('ax-record-wrap');
      const headings = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(row => [...row.cells].forEach((cell, index) => {
        cell.dataset.label = headings[index] || '选择记录';
        cell.classList.toggle('ax-record-title', index === (table.classList.contains('studio-record-selectable') ? 1 : 0));
        cell.classList.toggle('ax-record-actions', index === row.cells.length - 1);
      }));
      const selectAll = table.querySelector('[data-record-select-all]');
      const filters = main.querySelector('.studio-record-filters');
      if (selectAll && filters && !filters.querySelector('.ax-select-all')) {
        const label = make('label', 'ax-select-all');
        selectAll.parentElement.append(document.createTextNode('选择'));
        label.append(selectAll, document.createTextNode('全选当前结果'));
        filters.append(label);
      }
    });
  }
  function syncQualitySummary(main = document) {
    const query = main.querySelector('.ux-preparation .qw-query:has([data-q-field])');
    if (!query) return;
    const values = key => [...query.querySelectorAll('[data-qw-pick="' + key + '"]:checked')].map(input => input.value);
    const versions = values('versions'), teams = values('teams');
    const kinds = [...query.querySelectorAll('[data-q-kind]:checked')].map(input => input.parentElement.textContent.trim());
    const copy = [versions.length ? versions.join('、') : '未选择版本', query.querySelector('[data-q-field="domain"]')?.value, query.querySelector('[data-q-field="date"]')?.value, teams.length + ' 个团队', kinds.join(' / ') || '未选择检查类型'].filter(Boolean).join(' · ');
    setText(query.closest('.ux-preparation').querySelector('.ux-preparation-copy small'), copy);
  }
  function setCurrentSection(main, id) {
    main.querySelectorAll('[data-ux-section]').forEach(button => {
      if (button.dataset.uxSection === id) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
  }
  function enhanceSettings(main, key) {
    const content = key === 'automation/settings' ? main.querySelector('.ux-settings-layout') : null;
    if (content === settingsRoot) return;
    settingsObserver?.disconnect();
    settingsObserver = null;
    settingsRoot = content;
    if (!content) return;
    const sections = [...content.querySelectorAll('.studio-setting-section')];
    if (sections[0]) setCurrentSection(main, sections[0].id);
    if (typeof IntersectionObserver !== 'function') return;
    settingsObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setCurrentSection(main, visible[0].target.id);
    }, {rootMargin: '-90px 0px -50% 0px', threshold: 0});
    sections.forEach(section => settingsObserver.observe(section));
  }
  function addScrollHints(main, key) {
    if (!['automation/auto-ut', 'automation/quality'].includes(key)) return;
    main.querySelectorAll('.qw-table-wrap').forEach(wrap => {
      if (!wrap.querySelector('table') || wrap.previousElementSibling?.classList.contains('ax-table-hint')) return;
      const hint = make('p', 'ax-table-hint', '左右滚动可查看完整指标与操作');
      wrap.before(hint);
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('aria-label', key.endsWith('quality') ? '检查结果，可横向滚动' : '治理仓库，可横向滚动');
    });
  }
  document.addEventListener('click', event => {
    closeMenus(event.target);
    const button = event.target.closest('[data-ux-section]');
    if (button) setCurrentSection(button.closest('.variant-a-main') || document, button.dataset.uxSection);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && closeMenus(null, true)) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  document.addEventListener('input', event => {
    if (event.target.matches('[data-q-field]')) syncQualitySummary();
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-q-kind],[data-qw-pick]')) syncQualitySummary();
  });
  document.addEventListener('scroll', () => document.querySelectorAll('.ux-row-more[open],.ut-task-more[open]').forEach(positionMenu), true);
  window.addEventListener('resize', () => document.querySelectorAll('.ux-row-more[open],.ut-task-more[open]').forEach(positionMenu));
  window.addEventListener('hashchange', () => closeMenus());
  return (main, key) => {
    enhanceSettings(main, key);
    if (!key.startsWith('automation')) return;
    main.classList.add('ax-workspace');
    enhanceEffectiveness(main, key);
    labelTables(main, key);
    enhanceMenus(main);
    syncQualitySummary(main);
    addScrollHints(main, key);
  };
})();
