const sidebarEl = document.querySelector('.sidebar');

let currentRange = { range: 'all' };

function setSyncStatus(text){
  const el = document.getElementById('syncStatus');
  if(el) el.textContent = text;
}

function showSyncError(msg){
  const banner = document.getElementById('syncErrorBanner');
  if(!banner) return;
  banner.textContent = '⚠ ' + msg + ' Cards below are empty until live data loads.';
  banner.style.display = 'block';
}
function hideSyncError(){
  const banner = document.getElementById('syncErrorBanner');
  if(banner) banner.style.display = 'none';
}

async function fetchDashboardData(){
  setSyncStatus('Loading…');
  hideSyncError();
  try{
    const raw = await fetchDashboardWebhook(currentRange);
    const data = Array.isArray(raw) ? raw[0] : raw;
    applyData(data);
    setSyncStatus('Updated ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}));
  }catch(err){
    console.error('Dashboard webhook fetch failed:', err);
    setSyncStatus('Live data unavailable');
    showSyncError('Could not load live data from the webhook (' + err.message + ').');
    applyData({});
  }
}

function handleRefreshClick(){ fetchDashboardData(); }

// ---- Generic path lookup + [data-field] binder ----
// Only a key that's actually present (and non-blank) in the webhook
// response renders; anything absent/blank renders as empty, so the page
// never shows sample/dummy content and gaps are obvious at a glance.
function getPath(obj, path){
  return path.split('.').reduce((o,k) => (o && o[k] !== undefined && o[k] !== null && o[k] !== '') ? o[k] : undefined, obj);
}
function esc(v){ return (v === undefined || v === null) ? '' : v; }

function applyData(data){
  if(!data || typeof data !== 'object') data = {};

  document.querySelectorAll('[data-field]').forEach(el => {
    const val = getPath(data, el.getAttribute('data-field'));
    el.innerHTML = (val !== undefined) ? val : '';
  });

  // Each brand's main (non program-specific) achievement columns. The
  // webhook doesn't expose per-metric achievement values on group.brands
  // yet (only one pre-formatted keyMetric string) — labels render now so
  // the source is clear; values stay blank until n8n_build_response.js is
  // updated to send them.
  const BRAND_ACHIEVEMENT_LABELS = {
    IMFND: ['Fatma Achievement (%) 1', 'Fatma Achievement (%) 2 - Tickets'],
    AS: ['Nourhan Achievement (%) B2C', 'Nourhan Achievement (%) B2B'],
    Oligence: ['Basant Achievement (%)'],
  };
  renderRows('groupBrandsBody', getPath(data,'group.brands'), b => {
    const labels = BRAND_ACHIEVEMENT_LABELS[b.name];
    const cell = labels
      ? labels.map(l => `<div>${esc(l)}: <span style="color:var(--muted-2);">—</span></div>`).join('')
      : esc(b.keyMetric);
    return `
    <tr>
      <td class="name" style="padding-left:20px;">${esc(b.name)}</td>
      <td class="muted-cell">${cell}</td>
    </tr>`;
  });

  renderRows('groupSignalsBody', getPath(data,'group.aiSignals'), s => `
    <tr>
      <td style="padding-left:20px;"><span class="pill ${esc(s.typeColor||'grey')}">${esc(s.typeLabel)}</span></td>
      <td class="muted-cell">${esc(s.severity)}</td>
      <td class="name">${esc(s.item)}</td>
      <td class="muted-cell">${esc(s.detail)}</td>
      <td class="muted-cell">${esc(s.source)}</td>
    </tr>`);

  renderRows('groupAlertsBody', getPath(data,'group.cashflowAlerts'), a => `
    <tr>
      <td style="padding-left:20px;"><span class="pill ${esc(a.levelColor||'grey')}">${esc(a.levelLabel)}</span></td>
      <td class="muted-cell">${esc(a.source)}</td>
      <td class="name">${esc(a.issue)}</td>
      <td class="muted-cell">${esc(a.detail)}</td>
      <td class="num">${esc(a.balance)}</td>
    </tr>`);

  ['scale','fix','stop','automate','escalate'].forEach(k => {
    renderRows('groupDec' + k.charAt(0).toUpperCase() + k.slice(1), getPath(data,'group.decisions.' + k),
      item => `<li><b>${esc(item.title)}</b>${esc(item.detail)}</li>`);
  });

  renderRows('groupProjectsBody', getPath(data,'group.projects'), p => `
    <tr><td class="muted-cell" style="padding-left:20px;">${esc(p.brand)}</td><td class="name">${esc(p.task)}</td><td class="num">${esc(p.deadline)}</td></tr>`);

  const teamCardFn = t => {
    const score = Number(t.score) || 0;
    const off = (163.4 * (1 - Math.max(0, Math.min(100, score)) / 100)).toFixed(1);
    const color = t.ringColor || (score >= 75 ? '#059669' : score >= 55 ? '#D97706' : '#DC2626');
    return `
    <div class="team-card">
      <div class="ring-wrap"><svg width="62" height="62"><circle cx="31" cy="31" r="26" fill="none" stroke="#EEF0F3" stroke-width="6"/><circle cx="31" cy="31" r="26" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="163.4" stroke-dashoffset="${off}"/></svg><div class="ring-score">${esc(t.score)}</div></div>
      <div class="team-info"><div class="name">${esc(t.name)}</div><div class="role">${esc(t.role)}</div><div class="gap">${esc(t.gap)}</div>
        <div style="font-size:9.5px;color:var(--muted-2);margin-top:4px;">Source: Basant team member / rank / note OR Rana team member / rank / note (OLIGENCE tab)</div>
      </div>
    </div>`;
  };
  // Both sections read the SAME field — n8n only ever builds "group.teamPulse";
  // "oligence.teamPulse" has never existed in the webhook shape, so the
  // Oligence page's team cards always fell back to 3 empty placeholders
  // instead of showing the real 4 (or however many) team members.
  renderRows('groupTeamPulse', getPath(data,'group.teamPulse'), teamCardFn);
  renderRows('oligenceTeamPulse', getPath(data,'group.teamPulse'), teamCardFn);

  const pillarSections = ['marketing','sales','finance','operations','projects'];
  const pillarNames = ['Marketing','Sales','Finance','Operations','Projects'];
  // Source-column citation per pillar mini-card, verified against each
  // tab's own documentation row. One citation per DISPLAYED number, so it
  // never mixes "/" (a true ratio shown as one fraction) with "+" (two
  // unrelated numbers just placed on the same line) in a single string —
  // that combination reads as a formula and isn't one.
  const PILLAR_SOURCE_COLUMNS = {
    imfnd: [
      { val: 'Fatma Total ROAS', sub: 'Fatma Total Spend ($)' },
      { val: 'Fatma New Tickets Sold / Fatma New Tickets Target', sub: 'Fatma total Conversion Rate (%)' },
      { val: 'Nouran Net Cash Flow (EGP)', sub: 'Nouran MER' },
      { val: 'Fatma Organic New Tickets + Fatma Paid New Tickets', sub: '' },
      { val: 'Fatma Top Program', sub: 'Fatma Top Program Revenue (EGP)' },
    ],
    as: [
      { val: 'Nourhan Total ROAS', sub: 'Nourhan Total Spend ($)' },
      { val: 'Nourhan total new Tickets sold', sub: 'Nourhan New Tickets Sold - new Organic + Nourhan New Tickets Sold - paid' },
      { val: 'Nouran Net Cash Flow (EGP)', sub: 'Nouran MER' },
      { val: 'Nourhan Total Platform Views', sub: 'Nourhan Total engagment' },
      { val: 'Nourhan B2B Pipeline (# open)', sub: '' },
    ],
    oligence: [
      { val: 'Basant MER - Oligence (blended)', sub: '' },
      { val: 'Basant Pipeline - Contracting (#) + Basant Pipeline - Retainer (#)', sub: 'Basant Pipeline - Potential (#) + Basant Pipeline - Quotation (#)' },
      { val: 'Nouran Net Cash Flow (EGP)', sub: 'Basant Overdue (EGP)' },
      { val: 'Rana Total Outputs', sub: 'Rana On-Time Delivery %' },
      { val: 'Basant Top Risk / Escalation', sub: '' },
    ],
  };
  ['imfnd','as','oligence'].forEach(page => {
    const el = document.getElementById(page + 'Pillars');
    if(!el) return;
    const arr = getPath(data, page + '.pillars');
    const sourceCols = PILLAR_SOURCE_COLUMNS[page];
    el.innerHTML = pillarSections.map((section, i) => {
      const p = (Array.isArray(arr) && arr[i]) ? arr[i] : {};
      const src = sourceCols ? sourceCols[i] : null;
      return `
      <div class="pillar-mini" onclick="setSection('${page}','${esc(p.section || section)}')">
        <div class="pm-top"><span class="pm-name">${esc(p.name || pillarNames[i])}</span><span class="pill ${esc(p.statusColor||'grey')}">${esc(p.statusLabel)}</span></div>
        ${src && src.val ? `<div class="pm-source" style="font-size:10px;color:var(--muted-2);margin-top:2px;">${esc(src.val)}</div>` : ''}
        <div class="pm-val"${p.valSize?` style="font-size:${p.valSize};"`:''}>${esc(p.value)}</div>
        ${src && src.sub ? `<div class="pm-source" style="font-size:10px;color:var(--muted-2);">${esc(src.sub)}</div>` : ''}
        <div class="pm-sub">${esc(p.sub)}</div>
      </div>`;
    }).join('');
  });

  const barRowFn = b => {
    const hasData = b && b.name !== undefined;
    const lbl = hasData ? esc(b.name) : 'Fatma Top Program';
    const val = hasData ? esc(b.value) : '<span style="color:var(--muted-2);font-weight:400;">Fatma Top Program Revenue (EGP)</span>';
    return `<div class="bar-row"><div class="lbl">${lbl}</div><div class="bar-track"><div class="bar-fill" style="width:${hasData && b.pct !== undefined ? esc(b.pct) : 0}%;background:var(--green-line);"></div></div><div class="val">${val}</div></div>`;
  };
  renderRows('imfndRoasByProgram', getPath(data,'imfnd.roasByProgram'), barRowFn);

  // Fixed-stage bar list (Lead Funnel): like renderFixedMetricGrid, but for
  // bar-rows — one bar per label, in that fixed order, matched by item.name.
  function renderFixedBarList(containerId, arr, labels, watchLabels) {
    const el = document.getElementById(containerId);
    if(!el) return;
    const list = Array.isArray(arr) ? arr : [];
    el.innerHTML = labels.map(label => {
      const match = list.find(x => x && typeof x.name === 'string' && x.name.trim().toLowerCase() === label.toLowerCase());
      const watchTag = watchLabels.has(label) ? ` <span style="color:var(--amber-line);font-weight:600;">watch</span>` : '';
      const pct = match && match.pct !== undefined ? esc(match.pct) : 0;
      const val = match ? esc(match.value) : '';
      return `<div class="bar-row"><div class="lbl">${esc(label)}${watchTag}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--green-line);"></div></div><div class="val">${val}</div></div>`;
    }).join('');
  }
  const imfndLeadFunnelLabels = ['Fatma Total Leads','Fatma in pipline leads','Fatma not reached leads','Fatma undercollection Leads','Fatma New Tickets Sold','Fatma Lost leads'];
  renderFixedBarList('imfndLeadFunnel', getPath(data,'imfnd.leadFunnel'), imfndLeadFunnelLabels, new Set(['Fatma undercollection Leads','Fatma Lost leads']));

  const imfndTrainingPipelineRowFn = r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.program)}</td><td class="num">${esc(r.ticketsClosed)}</td><td class="num">${esc(r.remaining)}</td><td class="num">${esc(r.targetTickets)}</td><td class="num">${esc(r.achievement)}</td><td class="num">${esc(r.underCollection)}</td></tr>`;
  renderRows('imfndTrainingPipelineBody', getPath(data,'imfnd.trainingPipeline'), imfndTrainingPipelineRowFn);

  const imfndTrainingDeliveredRowFn = r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.program)}</td><td class="num">${esc(r.targetTickets)}</td><td class="num">${esc(r.ticketsClosed)}</td><td class="num">${esc(r.targetRevenue)}</td><td class="num">${esc(r.salesRevenue)}</td><td class="num">${esc(r.achievement)}</td></tr>`;
  renderRows('imfndTrainingDeliveredBody', getPath(data,'imfnd.trainingDelivered'), imfndTrainingDeliveredRowFn);

  const platformBreakdownRowFn = r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.platform)}</td><td class="num">${esc(r.views)}</td><td class="num">${esc(r.engagement)}</td><td class="num">${esc(r.newFollowers)}</td></tr>`;
  renderRows('imfndPlatformBreakdownBody', getPath(data,'imfnd.platformBreakdown'), platformBreakdownRowFn);
  renderRows('asTrainingPipelineBody', getPath(data,'as.trainingPipeline'), imfndTrainingPipelineRowFn);
  renderRows('asTrainingDeliveredBody', getPath(data,'as.trainingDelivered'), imfndTrainingDeliveredRowFn);
  renderRows('asPlatformBreakdownBody', getPath(data,'as.platformBreakdown'), platformBreakdownRowFn);

  const oligencePlatformRowFn = r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.platform)}</td><td class="num">${esc(r.viewsImpressions)}</td><td class="num">${esc(r.engagement)}</td><td class="num">${esc(r.newFollowers)}</td><td class="num">${esc(r.visits)}</td></tr>`;
  renderRows('oligencePlatformBreakdownBody', getPath(data,'oligence.platformBreakdown'), oligencePlatformRowFn);

  const subscriptionsRowFn = s => `
    <tr><td class="name" style="padding-left:20px;">${esc(s.tool)}</td><td class="muted-cell">${esc(s.brands)}</td><td class="num">${esc(s.monthlyCost)}</td><td class="muted-cell">${esc(s.billingCycle)}</td><td class="muted-cell">${esc(s.renewingDate)}</td><td class="muted-cell">${esc(s.paymentMethod)}</td><td class="muted-cell">${esc(s.status)}</td></tr>`;
  renderRows('oligenceSubscriptionsBody', getPath(data,'oligence.subscriptions'), subscriptionsRowFn);

  // Labels with no matching column anywhere in the Google Sheet (verified
  // against each tab's own documentation row) — flagged red so they're
  // never mistaken for a card that's just waiting on live data.
  const NO_SOURCE_LABELS = new Set(['Paid Revenue', 'Organic Revenue']);
  const kpiGridFn = k => `
    <div class="card kpi"${NO_SOURCE_LABELS.has(k.label) ? ' style="background:#FEF2F2;"' : ''}>
      <div class="k-top"><span class="k-lbl">${esc(k.label)}</span><span class="pill ${esc(k.pillColor||'grey')}">${esc(k.pillLabel||'')}</span></div>
      <div class="k-val"${k.valSize?` style="font-size:${k.valSize};"`:''}>${esc(k.value)}${k.unit?` <span style="font-size:13px;color:var(--muted-2);">${esc(k.unit)}</span>`:''}</div>
      ${k.delta ? `<div class="k-delta ${esc(k.deltaDirection||'flat')}">${k.deltaDirection==='up'?'▲ ':k.deltaDirection==='down'?'▼ ':''}${esc(k.delta)}</div>` : (k.sub ? `<div class="k-sub">${esc(k.sub)}</div>` : '')}
    </div>`;
  const imfndKeyMetricsLabels = ['Fatma Total Revenue (EGP)','Paid Revenue','Organic Revenue','Fatma Achievement (%) 1','Fatma Total Leads','Fatma Cost / Paid leads','Fatma New Tickets Sold','Fatma Organic New Tickets','Fatma Paid New Tickets','Fatma total Conversion Rate (%)','Fatma Organic Conversion Rate (%)','Fatma Paid Conversion Rate (%)','Fatma Total Spend ($)','Fatma Cost / Paid New Tickets (EGP)','Fatma Total ROAS','Fatma Paid ROAS','Fatma Refund Value (EGP)','Khaled Clicks','Khaled CPC ($)','Khaled CPM ($)','Khaled CTR (%)'];
  renderFixedMetricGrid('imfndKeyMetrics', getPath(data,'imfnd.keyMetrics'), imfndKeyMetricsLabels, kpiGridFn);
  const asB2cMetricsLabels = ['Nourhan B2C Sales new tickets revenue (EGP)','Nourhan total new Tickets sold','Nourhan total leads','Nourhan New Tickets Sold - new Organic / - paid'];
  renderRows('asB2cMetrics', getPath(data,'as.b2cMetrics'), (k, i) => kpiGridFn({ ...k, label: asB2cMetricsLabels[i] || k.label }));
  const oligenceRevenueLabels = ['Basant Total Revenue - Agency (EGP)','Basant Total cash in / collected - Agency (EGP)','Basant Pending / outstanding (EGP)','Basant Pipeline - Contracting (#) + Retainer (#)','Basant Overdue (EGP)'];
  renderRows('oligenceRevenueMetrics', getPath(data,'oligence.revenueMetrics'), (k, i) => kpiGridFn({ ...k, label: oligenceRevenueLabels[i] || k.label }));

  renderRows('oligenceClientsBody', getPath(data,'oligence.clients'), c => `
    <tr>
      <td class="name" style="padding-left:20px;">${esc(c.name)}</td><td class="muted-cell">${esc(c.service)}</td>
      <td><span class="pill ${esc(c.statusColor||'grey')}"><span class="dt"></span>${esc(c.statusLabel)}</span></td>
      <td class="muted-cell">${esc(c.note)}</td>
      <td class="num">${esc(c.totalRevenue)}</td>
      <td class="num muted-cell">${esc(c.cashIn||'Not tracked')}</td>
      <td class="num muted-cell">${esc(c.outstanding||'Not tracked')}</td>
      <td class="num muted-cell">${esc(c.cashOut||'Not tracked')}</td>
      <td class="num muted-cell" style="padding-right:20px;">${esc(c.netCashFlow||'Not tracked')}</td>
    </tr>`);
}

// Replaces a container's content with `rowFn(item, index)` per array item.
// The card/row containers themselves must always stay visible, even when
// the webhook omits the key or returns an empty array — so if `arr` isn't
// a populated array, we render placeholder item(s) (empty object -> rowFn
// renders its usual empty-field styling) instead of leaving the container
// blank. Grid containers (class="grid-N") get N placeholders to fill out
// a full row; everything else (table bodies, lists) gets one.
function renderRows(containerId, arr, rowFn){
  const el = document.getElementById(containerId);
  if(!el) return;
  const gridClass = Array.from(el.classList).find(c => /^grid-\d+$/.test(c));
  const minCount = gridClass ? parseInt(gridClass.split('-')[1], 10) : 1;
  const list = (Array.isArray(arr) && arr.length) ? arr : Array(minCount).fill({});
  el.innerHTML = list.map(rowFn).join('');
}

// Renders exactly `labels.length` KPI cards, always — one per label, in
// that fixed order. Each webhook item in `arr` is matched to its card by
// comparing item.label (case-insensitive) to the fixed label; unmatched
// labels still render a card (label only, value left blank), and webhook
// items that don't match any known label are dropped.
function renderFixedMetricGrid(containerId, arr, labels, cardFn){
  const el = document.getElementById(containerId);
  if(!el) return;
  const list = Array.isArray(arr) ? arr : [];
  el.innerHTML = labels.map(label => {
    const match = list.find(k => k && typeof k.label === 'string' && k.label.trim().toLowerCase() === label.toLowerCase());
    return cardFn(match ? { ...match, label: match.label || label } : { label });
  }).join('');
}

// ---- Period selector (All Data / Filter by Month + Week) ----
// "All Data" sends { range:'all' } — every row, no filter.
// "Filter by Month & Week" requires BOTH a month and at least one week choice
// and sends { range:'filtered', month, week }, where week is an array of the
// checked values (each one of the 4 fixed weeks or "month", the monthly
// rollup row). Any change re-fetches live data.
function togglePeriodMenu(e){
  e.stopPropagation();
  document.getElementById('periodMenu').classList.toggle('open');
}
function setAllPeriod(e){
  if(e) e.stopPropagation();
  document.getElementById('periodLabel').textContent = 'All Data';
  document.querySelectorAll('.period-opt').forEach(el => el.classList.toggle('active', el.dataset.mode === 'all'));
  document.getElementById('periodMenu').classList.remove('open');
  currentRange = { range: 'all' };
  fetchDashboardData();
}
function applyFilteredPeriod(e){
  e.stopPropagation();
  const month = document.getElementById('periodMonth').value;
  const weeks = Array.from(document.querySelectorAll('#periodWeek input[type="checkbox"]:checked')).map(cb => cb.value);
  if(!month || !weeks.length){ return; } // both conditions are required to filter
  const label = month + ' · ' + weeks.map(w => w === 'month' ? 'Month' : w.replace('week','Week')).join(', ');
  document.getElementById('periodLabel').textContent = label;
  document.querySelectorAll('.period-opt').forEach(el => el.classList.toggle('active', el.dataset.mode === 'filtered'));
  document.getElementById('periodMenu').classList.remove('open');
  currentRange = { range: 'filtered', month: month, week: weeks };
  fetchDashboardData();
}
document.addEventListener('click', () => document.getElementById('periodMenu').classList.remove('open'));


// Show only the elements belonging to `section` within a given page.
// Elements are bucketed by the nearest preceding [data-section] marker
// (default bucket = "home"); .dash-subhead always stays visible as the
// page's own header.
function applySection(pageEl, section){
  let current = 'home';
  Array.from(pageEl.children).forEach(el => {
    if(el.hasAttribute('data-section')) current = el.getAttribute('data-section');
    if(el.classList.contains('dash-subhead')){ el.style.display = ''; return; }
    el.style.display = (current === section) ? '' : 'none';
  });
}

function setSection(pageId, section){
  const pageEl = document.getElementById('page-' + pageId);
  if(!pageEl) return;
  applySection(pageEl, section);
  document.querySelectorAll('.sidebar .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.section === section);
  });
  window.scrollTo(0,0);
}

function go(pageId){
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.page === pageId));
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === 'page-' + pageId));
  document.querySelector('.sidebar').classList.toggle('home-only-page', pageId === 'group');
  setSection(pageId, 'home');
}

document.querySelectorAll('.tab').forEach(el => el.addEventListener('click', () => go(el.dataset.page)));

document.querySelectorAll('.sidebar .nav-item').forEach(el => {
  el.addEventListener('click', () => {
    const activeTab = document.querySelector('.tab.active');
    const pageId = activeTab ? activeTab.dataset.page : 'group';
    setSection(pageId, el.dataset.section);
  });
});

// Initial state: Group → Executive Home
go('group');

// Render all cards empty-but-visible immediately, then fetch live data
applyData({});
fetchDashboardData();
