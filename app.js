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

// ---- Percentage display formatting (Stage 2.1, frontend-only) ----
// Canonical values at these paths are numeric fractions (e.g. 0.9423) per
// the locked Build Dashboard JSON contract — this set exists only to tell
// rendering which fields to display as "94.2%" instead of "0.9423". It
// never touches the canonical data itself. Ratios like ROAS/MER/CPC/CPL
// are NOT percentages and must never be added here.
const PERCENTAGE_FIELDS = new Set([
  'imfnd.marketing.newTicketsConversionRate',
  'imfnd.marketing.organicConversionRate',
  'imfnd.marketing.paidConversionRate',
  'imfnd.marketing.revenueAchievement',
  'imfnd.marketing.ticketsAchievement',
  'imfnd.sales.b2b.b2bAchievement',
  'as.marketing.newTicketsConversionRate',
  'as.marketing.organicConversionRate',
  'as.marketing.paidConversionRate',
  'as.marketing.revenueAchievement',
  'as.marketing.ticketsAchievement',
  'as.sales.b2b.b2bAchievement',
  'oligence.finance.achievement',
]);
// Real zero (0) must render "0.0%", not be treated as missing; only
// undefined/null/'' (already normalized to undefined by getPath) stay —.
function formatPct(v){
  return (typeof v === 'number' && Number.isFinite(v)) ? (v * 100).toFixed(1) + '%' : undefined;
}

// OLIGENCE CONTENT KPI FIX: On-Time Delivery / Defect Rate are stored in
// Build Dashboard JSON as plain 0-100-scale numbers (e.g. 92, not 0.92,
// confirmed against real sheet data), unlike every field in
// PERCENTAGE_FIELDS above which are 0-1 fractions. Reusing formatPct()
// here would multiply by 100 again (92 -> "9200.0%"). This set/helper
// pair displays them as a percentage without rescaling.
const RAW_PERCENTAGE_FIELDS = new Set([
  'oligence.content.onTimeDelivery',
  'oligence.content.defectRate',
]);
function formatPctRaw(v){
  return (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(1) + '%' : undefined;
}

// ---- Type A Total Row helpers (Stage 6, frontend-only) ----
// Totals are computed ONLY from the rows actually rendered in a given
// table (post status-filter, where applicable) — never from the full
// canonical array. A column whose visible rows are all blank/non-numeric
// has no real measurement, so it stays absent (— once rendered), never a
// fabricated 0; a column with at least one genuine numeric value
// (including 0) sums only the valid numeric contributions. This mirrors
// the verified backend sumCol fix (Stage 4.1) at render-row granularity.
// Canonical arrays/objects are only ever read here, never mutated.
function numOrNull(v){
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function sumVisible(rows, field){
  let total = 0, found = false;
  for (const r of rows){
    const n = numOrNull(r[field]);
    if (n !== null){ found = true; total += n; }
  }
  return found ? total : undefined;
}
function ratioFromVisible(rows, numField, denField){
  const num = sumVisible(rows, numField);
  const den = sumVisible(rows, denField);
  if (num === undefined || den === undefined || den === 0) return undefined;
  return num / den;
}
// Plain numeric Total cell (no % formatting) — used for additive sums
// and ratio totals like MER that are displayed as a raw number.
function totalCell(value){
  return value === undefined ? '—' : String(value);
}
// Appends a Total <tr> to a tbody, but ONLY when the table actually has
// rows — an empty/no-data table keeps its existing empty-state behavior
// (renderRows' single blank row) rather than gaining a fake Total row.
function appendTotalRow(containerId, rows, trHtml){
  if (!rows.length) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  el.insertAdjacentHTML('beforeend', trHtml);
}
// Renders a Type A array as-is (every row, unfiltered/undeduped) plus a
// Total row built from those same rows.
function renderWithTotal(containerId, arr, rowFn, totalRowHtmlFn){
  const rows = Array.isArray(arr) ? arr : [];
  renderRows(containerId, rows, rowFn);
  appendTotalRow(containerId, rows, totalRowHtmlFn(rows));
}

function applyData(data){
  if(!data || typeof data !== 'object') data = {};

  document.querySelectorAll('[data-field]').forEach(el => {
    const path = el.getAttribute('data-field');
    let val = getPath(data, path);
    if(PERCENTAGE_FIELDS.has(path)) val = formatPct(val);
    else if(RAW_PERCENTAGE_FIELDS.has(path)) val = formatPctRaw(val);
    if(el.classList.contains('k-val')){
      const isEmpty = (val === undefined);
      const valStr = isEmpty ? '' : String(val);
      el.classList.toggle('k-val--empty', isEmpty);
      el.classList.toggle('k-val--long', !isEmpty && valStr.length > 10);
      el.innerHTML = isEmpty ? '—' : valStr;
    } else {
      // Status/decorative pills (e.g. statusLabel chips) intentionally stay
      // blank when unset — a colored badge showing "—" reads as broken, not
      // "no data". Every other non-.k-val binding (hero-stat "v" spans,
      // table "num" cells, inline health-score "b" tags, etc.) is a genuine
      // mapped value output and follows the same "—" no-data rule as .k-val.
      const isPill = el.classList.contains('pill');
      el.innerHTML = (val !== undefined) ? val : (isPill ? '' : '—');
    }
  });

  // Group Brand Health — canonical scalar source (Group Stage C).
  // group.brands[].keyMetric is n8n's pre-formatted Achievement display
  // string (built from each company's own canonical Achievement metrics)
  // — the frontend renders it uniformly for every brand and performs no
  // Achievement calculation or per-metric breakdown of its own.
  renderRows('groupBrandsBody', getPath(data,'group.brands'), b => `
    <tr>
      <td class="name" style="padding-left:20px;">${esc(b.name)}</td>
      <td class="muted-cell">${esc(b.keyMetric)}</td>
    </tr>`);

  const projectsRowFn = p => `
    <tr><td class="muted-cell" style="padding-left:20px;">${esc(p.brand)}</td><td class="name">${esc(p.task)}</td><td class="num">${esc(p.deadline)}</td><td class="muted-cell">${esc(p.status)}</td><td class="muted-cell">${esc(p.notes)}</td></tr>`;
  renderRows('groupProjectsBody', getPath(data,'group.projects'), projectsRowFn);
  renderRows('imfndProjectsBody', getPath(data,'imfnd.projects'), projectsRowFn);
  renderRows('asProjectsBody', getPath(data,'as.projects'), projectsRowFn);
  renderRows('oligenceProjectsBody', getPath(data,'oligence.projects'), projectsRowFn);

  // Reusable Team Scorecards card: renders one { name, role, score, gap,
  // ringColor?, source? } item as a ring-score card. The source citation
  // line only ever renders from the item's own `source` field — no
  // hardcoded fallback text, so a card with no source from the webhook
  // simply omits the line.
  function teamCardFn(){
    return t => {
      const score = Number(t.score) || 0;
      const off = (163.4 * (1 - Math.max(0, Math.min(100, score)) / 100)).toFixed(1);
      const color = t.ringColor || (score >= 75 ? '#059669' : score >= 55 ? '#D97706' : '#DC2626');
      return `
      <div class="team-card">
        <div class="ring-wrap"><svg width="62" height="62"><circle cx="31" cy="31" r="26" fill="none" stroke="#EEF0F3" stroke-width="6"/><circle cx="31" cy="31" r="26" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="163.4" stroke-dashoffset="${off}"/></svg><div class="ring-score">${esc(t.score)}</div></div>
        <div class="team-info"><div class="name">${esc(t.name)}</div><div class="role">${esc(t.role)}</div><div class="gap">${esc(t.gap)}</div>
          ${t.source ? `<div style="font-size:9.5px;color:var(--muted-2);margin-top:4px;">${esc(t.source)}</div>` : ''}
        </div>
      </div>`;
    };
  }
  // Group's Team Pulse and Oligence's own Team Scorecards are two distinct
  // sources (Oligence Stage D): Group reads the group-wide rollup, Oligence
  // reads its own canonical oligence.teamPulse.
  renderRows('groupTeamPulse', getPath(data,'group.teamPulse'), teamCardFn());
  renderRows('oligenceTeamPulse', getPath(data,'oligence.teamPulse'), teamCardFn());
  renderRows('imfndTeamScorecards', getPath(data,'imfnd.teamPulse'), teamCardFn());
  renderRows('asTeamScorecards', getPath(data,'as.teamPulse'), teamCardFn());

  const pillarSections = ['marketing','sales','finance','operations','projects'];
  const pillarNames = ['Marketing','Sales','Finance','Operations','Projects'];
  // Source-column citation per pillar mini-card, verified against each
  // tab's own documentation row. One citation per DISPLAYED number, so it
  // never mixes "/" (a true ratio shown as one fraction) with "+" (two
  // unrelated numbers just placed on the same line) in a single string —
  // that combination reads as a formula and isn't one.
  const PILLAR_SOURCE_COLUMNS = {
    imfnd: [
      { val: 'Total ROAS', sub: 'Total Spend ($)' },
      { val: 'New Tickets Sold / New Tickets Target', sub: 'total Conversion Rate (%)' },
      { val: 'Net Cash Flow (EGP)', sub: 'MER' },
      { val: 'Organic New Tickets + Paid New Tickets', sub: '' },
      { val: 'Top Program', sub: 'Top Program Revenue (EGP)' },
    ],
    as: [
      { val: 'Total ROAS', sub: 'Total Spend ($)' },
      { val: 'total new Tickets sold', sub: 'New Tickets Sold - new Organic + New Tickets Sold - paid' },
      { val: 'Net Cash Flow (EGP)', sub: 'MER' },
      { val: 'Total Platform Views', sub: 'Total engagment' },
      { val: 'B2B Pipeline (# open)', sub: '' },
    ],
    oligence: [
      { val: 'MER - Oligence (blended)', sub: '' },
      { val: 'Pipeline - Contracting (#) + Pipeline - Retainer (#)', sub: 'Pipeline - Potential (#) + Pipeline - Quotation (#)' },
      { val: 'Net Cash Flow (EGP)', sub: 'Overdue (EGP)' },
      { val: 'Total Outputs', sub: 'On-Time Delivery %' },
      { val: 'Top Risk / Escalation', sub: '' },
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
      // IMFND, AS, and Oligence (Oligence Stage B) have all migrated to the
      // canonical pillar field names — every page now reads the same shape.
      const usesCanonicalPillarFields = (page === 'imfnd' || page === 'as' || page === 'oligence');
      const pVal = usesCanonicalPillarFields ? p.primaryValue : p.value;
      const pSub = usesCanonicalPillarFields ? p.subValue : p.sub;
      const pSectionTarget = usesCanonicalPillarFields ? (p.sectionLink || section) : (p.section || section);
      return `
      <div class="pillar-mini" onclick="setSection('${page}','${esc(pSectionTarget)}')">
        <div class="pm-top"><span class="pm-name">${esc(p.name || pillarNames[i])}</span><span class="pill ${esc(p.statusColor||'grey')}">${esc(p.statusLabel)}</span></div>
        ${src && src.val ? `<div class="pm-source">${esc(src.val)}</div>` : ''}
        <div class="pm-val"${p.valSize?` style="font-size:${p.valSize};"`:''}>${esc(pVal)}</div>
        ${src && src.sub ? `<div class="pm-source">${esc(src.sub)}</div>` : ''}
        <div class="pm-sub">${esc(pSub)}</div>
      </div>`;
    }).join('');
  });

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
  // Lead Status Breakdown (Marketing + Sales tabs, per brand): single-row
  // table + funnel, each brand reusing its own leadFunnel data source.
  const imfndLeadStatusLabels = ['undercollection Leads','in pipeline follow up leads','not reached leads','Lost leads'];
  function renderLeadStatusTable(containerId, dataPath){
    const el = document.getElementById(containerId);
    if(!el) return;
    const list = getPath(data,dataPath);
    const arr = Array.isArray(list) ? list : [];
    const cells = imfndLeadStatusLabels.map((label, i) => {
      const match = arr.find(x => x && typeof x.name === 'string' && x.name.trim().toLowerCase() === label.toLowerCase());
      const val = match ? esc(match.value) : '';
      return `<td class="num"${i===0?' style="padding-left:20px;"':''}>${val}</td>`;
    }).join('');
    el.innerHTML = `<tr>${cells}</tr>`;
  }
  // IMFND Lead Status — canonical scalar sources (Stage C2). The TABLE shows
  // 5 raw fields (the 4 leadStatusBreakdown stages + newTicketsSold, in that
  // fixed order); the FUNNEL shows a fixed 4-stage business funnel (the same
  // minus Lost Leads) — order is NEVER derived from the values. Bar width is
  // presentation-only (scaled against the largest of the 4 stage values,
  // matching AS's funnel width rule) and is never displayed as a number or
  // stored/sent anywhere. (AS now has its own
  // separate canonical Lead Status functions below, added in AS Stage C2 —
  // renderFixedBarList/renderLeadStatusTable/imfndLeadStatusLabels just
  // below are no longer called by either brand; left in place, not removed,
  // per this migration's dead-code reporting policy.)
  const imfndLeadFunnelStages = [
    { label: 'Undercollection Leads', value: getPath(data,'imfnd.marketing.leadStatusBreakdown.undercollectionLeads') },
    { label: 'In Pipeline Follow Up Leads', value: getPath(data,'imfnd.marketing.leadStatusBreakdown.inPipelineFollowUpLeads') },
    { label: 'Not Reached Leads', value: getPath(data,'imfnd.marketing.leadStatusBreakdown.notReachedLeads') },
    { label: 'New Tickets Sold (Total)', value: getPath(data,'imfnd.marketing.newTicketsSold') },
  ];
  const imfndLeadStatusLostLeads = getPath(data,'imfnd.marketing.leadStatusBreakdown.lostLeads');
  function renderImfndLeadStatusTable(containerId){
    const el = document.getElementById(containerId);
    if(!el) return;
    const rowValues = [...imfndLeadFunnelStages.map(s => s.value), imfndLeadStatusLostLeads];
    const cells = rowValues.map((v, i) => `<td class="num"${i===0?' style="padding-left:20px;"':''}>${esc(v)}</td>`).join('');
    el.innerHTML = `<tr>${cells}</tr>`;
  }
  function renderImfndLeadFunnel(containerId){
    const el = document.getElementById(containerId);
    if(!el) return;
    const numericValues = imfndLeadFunnelStages.map(s => Number(s.value)).filter(n => Number.isFinite(n));
    const max = numericValues.length ? Math.max(...numericValues) : 0;
    const hasMax = Number.isFinite(max) && max > 0;
    el.innerHTML = imfndLeadFunnelStages.map(s => {
      const n = Number(s.value);
      const width = (hasMax && Number.isFinite(n)) ? Math.max(0, Math.min(100, (n / max) * 100)) : 100;
      return `
      <div class="imfnd-funnel-stage">
        <div class="imfnd-funnel-label">${esc(s.label)}</div>
        <div class="imfnd-funnel-value">${esc(s.value)}</div>
        <div class="imfnd-funnel-bar-wrap"><div class="imfnd-funnel-bar" style="width:${width}%;"></div></div>
      </div>`;
    }).join('');
  }
  renderImfndLeadStatusTable('imfndLeadStatusTableBody');
  renderImfndLeadFunnel('imfndLeadStatusFunnel');
  renderImfndLeadStatusTable('imfndLeadStatusTableBodySales');
  renderImfndLeadFunnel('imfndLeadStatusFunnelSales');
  // AS Lead Status — canonical scalar sources (AS Stage C2), mirroring the
  // IMFND Stage C2 pattern with dedicated AS-only functions (not shared with
  // IMFND or the old renderFixedBarList/renderLeadStatusTable, which AS no
  // longer uses). TABLE = 5 fixed fields (4 leadStatusBreakdown stages +
  // newTicketsSold); FUNNEL = fixed 4-stage business funnel (same minus Lost
  // Leads) — order is NEVER derived from the values. NOTE: AS's width rule
  // intentionally differs from IMFND's — AS scales against the MAX of the 4
  // funnel values (not the Undercollection/first-stage value IMFND uses);
  // this was the AS Stage C2 spec and IMFND's own denominator was left
  // unchanged, per instructions (see AS_STAGE_C2_REPORT.md Section 9).
  const asLeadFunnelStages = [
    { label: 'Undercollection Leads', value: getPath(data,'as.marketing.leadStatusBreakdown.undercollectionLeads') },
    { label: 'In Pipeline Follow Up Leads', value: getPath(data,'as.marketing.leadStatusBreakdown.inPipelineFollowUpLeads') },
    { label: 'Not Reached Leads', value: getPath(data,'as.marketing.leadStatusBreakdown.notReachedLeads') },
    { label: 'New Tickets Sold (Total)', value: getPath(data,'as.marketing.newTicketsSold') },
  ];
  const asLeadStatusLostLeads = getPath(data,'as.marketing.leadStatusBreakdown.lostLeads');
  function renderAsLeadStatusTable(containerId){
    const el = document.getElementById(containerId);
    if(!el) return;
    const rowValues = [...asLeadFunnelStages.map(s => s.value), asLeadStatusLostLeads];
    const cells = rowValues.map((v, i) => `<td class="num"${i===0?' style="padding-left:20px;"':''}>${esc(v)}</td>`).join('');
    el.innerHTML = `<tr>${cells}</tr>`;
  }
  function renderAsLeadFunnel(containerId){
    const el = document.getElementById(containerId);
    if(!el) return;
    const numericValues = asLeadFunnelStages.map(s => Number(s.value)).filter(n => Number.isFinite(n));
    const max = numericValues.length ? Math.max(...numericValues) : 0;
    const hasMax = Number.isFinite(max) && max > 0;
    el.innerHTML = asLeadFunnelStages.map(s => {
      const n = Number(s.value);
      const width = (hasMax && Number.isFinite(n)) ? Math.max(0, Math.min(100, (n / max) * 100)) : 100;
      return `
      <div class="as-funnel-stage">
        <div class="as-funnel-label">${esc(s.label)}</div>
        <div class="as-funnel-value">${esc(s.value)}</div>
        <div class="as-funnel-bar-wrap"><div class="as-funnel-bar" style="width:${width}%;"></div></div>
      </div>`;
    }).join('');
  }
  renderAsLeadStatusTable('asLeadStatusTableBody');
  renderAsLeadFunnel('asLeadStatusFunnel');
  renderAsLeadStatusTable('asLeadStatusTableBodySales');
  renderAsLeadFunnel('asLeadStatusFunnelSales');

  const platformBreakdownRowFn = r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.platform)}</td><td class="num">${esc(r.views)}</td><td class="num">${esc(r.engagement)}</td><td class="num">${esc(r.newFollowers)}</td></tr>`;
  renderRows('imfndPlatformBreakdownBody', getPath(data,'imfnd.marketing.platformBreakdown'), platformBreakdownRowFn);
  renderRows('asPlatformBreakdownBody', getPath(data,'as.marketing.platformBreakdown'), platformBreakdownRowFn);

  // Training Programs Summary (Sales + Operations tabs, per brand): each
  // brand's two table instances share the same underlying data source.
  // Both IMFND (Stage A) and AS (AS Stage A) now read the canonical `name`
  // field from their own canonical array path.
  const trainingProgramsSummaryRowFn = r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.name)}</td><td class="muted-cell">${esc(r.status)}</td><td class="num">${esc(r.targetTickets)}</td><td class="num">${esc(r.ticketsClosed)}</td><td class="num">${esc(r.targetRevenue)}</td><td class="num">${esc(r.salesRevenue)}</td><td class="num">${esc(r.achievement)}</td><td class="muted-cell">${esc(r.plannedStartDate)}</td><td class="muted-cell">${esc(r.actualStartDate)}</td><td class="muted-cell">${esc(r.plannedEndDate)}</td><td class="muted-cell">${esc(r.actualEndDate)}</td><td class="muted-cell">${esc(r.notes)}</td></tr>`;
  function trainingProgramsTotalRowHtml(rows){
    const achievement = ratioFromVisible(rows, 'salesRevenue', 'targetRevenue');
    const achievementDisplay = achievement === undefined ? '—' : formatPct(achievement);
    return `<tr class="total-row"><td class="name" style="padding-left:20px;">Total</td><td class="muted-cell"></td><td class="num">${totalCell(sumVisible(rows,'targetTickets'))}</td><td class="num">${totalCell(sumVisible(rows,'ticketsClosed'))}</td><td class="num">${totalCell(sumVisible(rows,'targetRevenue'))}</td><td class="num">${totalCell(sumVisible(rows,'salesRevenue'))}</td><td class="num">${achievementDisplay}</td><td class="muted-cell"></td><td class="muted-cell"></td><td class="muted-cell"></td><td class="muted-cell"></td><td class="muted-cell"></td></tr>`;
  }
  // USER-APPROVED status split (contract: Sales UI shows status=New only;
  // Operations UI shows status=Delivered OR Running only). The canonical
  // array itself (imfnd/as.sales.trainingPrograms) stays unfiltered — this
  // filtering is purely a render-time choice of which rows to display in
  // each of the two table instances, and each table's Total is computed
  // from ONLY the rows that table displays (never from the full array).
  function normTrainingStatus(s){ return String(s == null ? '' : s).trim().toLowerCase(); }
  function isSalesTrainingRow(r){ return normTrainingStatus(r.status) === 'new'; }
  function isOpsTrainingRow(r){ const s = normTrainingStatus(r.status); return s === 'delivered' || s === 'running'; }
  function renderTrainingProgramsTable(containerId, allPrograms, filterFn){
    const rows = (Array.isArray(allPrograms) ? allPrograms : []).filter(filterFn);
    renderRows(containerId, rows, trainingProgramsSummaryRowFn);
    appendTotalRow(containerId, rows, trainingProgramsTotalRowHtml(rows));
  }
  renderTrainingProgramsTable('imfndTrainingProgramsSummaryBodySales', getPath(data,'imfnd.sales.trainingPrograms'), isSalesTrainingRow);
  renderTrainingProgramsTable('imfndTrainingProgramsSummaryBodyOps', getPath(data,'imfnd.sales.trainingPrograms'), isOpsTrainingRow);
  renderTrainingProgramsTable('asTrainingProgramsSummaryBodySales', getPath(data,'as.sales.trainingPrograms'), isSalesTrainingRow);
  renderTrainingProgramsTable('asTrainingProgramsSummaryBodyOps', getPath(data,'as.sales.trainingPrograms'), isOpsTrainingRow);

  const oligencePlatformRowFn = r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.platform)}</td><td class="num">${esc(r.viewsImpressions)}</td><td class="num">${esc(r.engagement)}</td><td class="num">${esc(r.newFollowers)}</td><td class="num">${esc(r.visits)}</td></tr>`;
  renderRows('oligencePlatformBreakdownBody', getPath(data,'oligence.marketing.platformBreakdown'), oligencePlatformRowFn);

  // OLIGENCE CONTENT DELIVERY BY CLIENT KPI FIX: onTimeDelivery/defectRate
  // come from Rana OLIGENCE clients as 0-1 fractions (confirmed against
  // real data — a different scale than the sibling Rana OLIGENCE sheet's
  // 0-100 numbers used by the oligence.content.* cards), so they use the
  // existing fraction-scale formatPct(), not formatPctRaw(). numCell()
  // gives the standard missing->"—"/real-zero-included table-cell
  // behavior already used elsewhere (e.g. Client Portfolio).
  // fulfillmentTimeAverage stays a plain numeric cell, no % sign.
  const contentDeliveryByClientRowFn = r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.brand)}</td><td class="num">${esc(r.totalOutputs)}</td><td class="num">${esc(r.published)}</td><td class="num">${esc(r.readyToPublish)}</td><td class="num">${esc(r.inProgress)}</td><td class="num">${esc(r.approvalsPending)}</td><td class="num">${esc(r.videoProduction)}</td><td class="num">${esc(r.aiVideo)}</td><td class="num">${esc(r.carousels)}</td><td class="num">${esc(r.staticPosts)}</td><td class="num">${esc(r.copiesWritten)}</td><td class="num">${esc(r.shoots)}</td><td class="num">${numCell(formatPct(r.onTimeDelivery))}</td><td class="num">${numCell(formatPct(r.defectRate))}</td><td class="num">${numCell(r.fulfillmentTimeAverage)}</td></tr>`;
  renderRows('oligenceContentDeliveryByClientBody', getPath(data,'oligence.marketing.contentDeliveryByClient'), contentDeliveryByClientRowFn);

  // Stage 7 (Part 3): oligence.content.byBrand[] — Type B array, one
  // aggregate row per Brand (grouped/summed upstream). No Total row
  // (Type B arrays don't get one, per the established Stage 6 rule).
  // Mirrors contentDeliveryByClientRowFn's column order minus the 3
  // deferred ratio columns, which this array does not carry.
  const contentByBrandRowFn = r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.brand)}</td><td class="num">${esc(r.totalOutputs)}</td><td class="num">${esc(r.published)}</td><td class="num">${esc(r.readyToPublish)}</td><td class="num">${esc(r.inProgress)}</td><td class="num">${esc(r.approvalsPending)}</td><td class="num">${esc(r.videoProduction)}</td><td class="num">${esc(r.aiVideo)}</td><td class="num">${esc(r.carousels)}</td><td class="num">${esc(r.staticPosts)}</td><td class="num">${esc(r.copiesWritten)}</td><td class="num">${esc(r.shoots)}</td></tr>`;
  renderRows('oligenceContentByBrandBody', getPath(data,'oligence.content.byBrand'), contentByBrandRowFn);

  const subscriptionsRowFn = s => `
    <tr><td class="name" style="padding-left:20px;">${esc(s.brands)}</td><td class="muted-cell">${esc(s.tool)}</td><td class="num">${esc(s.monthlyCost)}</td><td class="muted-cell">${esc(s.billingCycle)}</td><td class="muted-cell">${esc(s.renewingDate)}</td><td class="muted-cell">${esc(s.paymentMethod)}</td><td class="muted-cell">${esc(s.status)}</td><td class="muted-cell">${esc(s.notes)}</td></tr>`;
  function subscriptionsTotalRowHtml(rows){
    return `<tr class="total-row"><td class="name" style="padding-left:20px;">Total</td><td class="muted-cell"></td><td class="num">${totalCell(sumVisible(rows,'monthlyCost'))}</td><td class="muted-cell"></td><td class="muted-cell"></td><td class="muted-cell"></td><td class="muted-cell"></td><td class="muted-cell"></td></tr>`;
  }
  renderWithTotal('oligenceSubscriptionsBody', getPath(data,'oligence.finance.subscriptions'), subscriptionsRowFn, subscriptionsTotalRowHtml);
  renderWithTotal('imfndSubscriptionsBody', getPath(data,'imfnd.finance.subscriptions'), subscriptionsRowFn, subscriptionsTotalRowHtml);
  renderWithTotal('asSubscriptionsBody', getPath(data,'as.finance.subscriptions'), subscriptionsRowFn, subscriptionsTotalRowHtml);

  // Group page: Cash Flow by Brand — canonical scalar source (Group Stage
  // A). group.cashFlowByBrand[] is built by n8n directly from the shared
  // "Nouran Cashflow" tab (same tab each company's own finance.cashFlow is
  // filtered from) — the frontend no longer joins the three companies' own
  // objects to construct this table.
  renderRows('groupCashFlowByBrandBody', getPath(data,'group.cashFlowByBrand'), r => `
    <tr><td class="name" style="padding-left:20px;">${esc(r.brand)}</td><td class="num">${esc(r.cashInTransactions)}</td><td class="num">${esc(r.cashIn)}</td><td class="num">${esc(r.cashOut)}</td><td class="num">${esc(r.netCashFlow)}</td></tr>`);

  // Group page: Cost Base & Subscriptions — canonical scalar source (Group
  // Stage B). group.subscriptions[] is built by n8n directly from the
  // shared "Nouran Subscriptions" tab (same tab each company's own
  // finance.subscriptions[] is filtered from) — the frontend no longer
  // joins the three companies' own arrays to construct this table.
  // subscriptionsRowFn's fields already match group.subscriptions[]'s
  // canonical shape exactly, so it's reused unmodified. renderRows' default
  // empty-state (one blank row via Array(1).fill({}), since this <tbody>
  // has no grid-N class) reproduces the previous [{}] fallback exactly.
  renderWithTotal('groupSubscriptionsCombinedBody', getPath(data,'group.subscriptions'), subscriptionsRowFn, subscriptionsTotalRowHtml);

  // Labels with no matching column anywhere in the Google Sheet (verified
  // against each tab's own documentation row) — flagged red so they're
  // never mistaken for a card that's just waiting on live data.
  const NO_SOURCE_LABELS = new Set([]);
  const kpiGridFn = k => {
    const rawVal = esc(k.value);
    const isEmpty = rawVal === '';
    const valStr = String(rawVal);
    const valClass = ['k-val', isEmpty ? 'k-val--empty' : '', (!isEmpty && valStr.length > 10) ? 'k-val--long' : ''].filter(Boolean).join(' ');
    return `
    <div class="card kpi"${NO_SOURCE_LABELS.has(k.label) ? ' style="background:#FEF2F2;"' : ''}>
      <div class="k-top"><span class="k-lbl">${esc(k.label)}</span><span class="pill ${esc(k.pillColor||'grey')}">${esc(k.pillLabel||'')}</span></div>
      <div class="${valClass}"${k.valSize?` style="font-size:${k.valSize};"`:''}>${isEmpty ? '—' : valStr}${(!isEmpty && k.unit)?` <span style="font-size:13px;color:var(--muted-2);">${esc(k.unit)}</span>`:''}</div>
      ${k.delta ? `<div class="k-delta ${esc(k.deltaDirection||'flat')}">${k.deltaDirection==='up'?'▲ ':k.deltaDirection==='down'?'▼ ':''}${esc(k.delta)}</div>` : (k.sub ? `<div class="k-sub">${esc(k.sub)}</div>` : '')}
    </div>`;
  };
  const imfndKeyMetricsLabels = ['Total Spend (EGP)','Total Leads','Total Organic Leads','SM Content Organic Leads','Other Tactics Leads (Webinars…etc)','Paid Leads','Cost / Paid Leads','New Tickets Sold (Total)','New Tickets Conversion Rate (%)','Organic New Sold Tickets','Organic Conversion Rate (%)','Paid New Sold Tickets','Paid Conversion Rate (%)','Cost / Paid New Tickets (EGP)','Total Revenue (EGP)','Total ROAS','Total Paid Revenue (EGP)','Total Organic Revenue (EGP)','Paid ROAS','Organic Clicks','Paid Clicks','Paid CPC ($)','Paid CPM ($)','Paid CTR (%)'];
  const asKeyMetricsLabels = ['Total Spend (EGP)','Total Leads','Total Organic Leads','SM Content Organic Leads','Other Tactics Leads (Webinars…etc)','Paid Leads','Cost / Paid Leads','New Tickets Sold (Total)','New Tickets Conversion Rate (%)','Organic New Sold Tickets','Organic Conversion Rate (%)','Paid New Sold Tickets','Paid Conversion Rate (%)','Cost / Paid New Tickets (EGP)','Total Revenue (EGP)','Total ROAS','Total Paid Revenue (EGP)','Total Organic Revenue (EGP)','Paid ROAS','Organic Clicks','Paid Clicks','Paid CPC ($)','Paid CPM ($)','Paid CTR (%)'];
  // IMFND Key Metrics is a frontend-only rendering adapter (Stage C1): the
  // canonical Mapping stores these 24 values as individual scalar fields
  // under imfnd.marketing.*, not as an array — there is no imfnd.keyMetrics
  // in the webhook contract, and none is created here. This local array is
  // assembled purely to feed the existing renderFixedMetricGrid/kpiGridFn
  // card renderer; it carries only label+value, no invented presentation
  // metadata (pillLabel/pillColor/delta/unit are intentionally omitted, not
  // sourced from Column H). AS has its own separate adapter below (AS Stage
  // C1) — kept independent rather than merged, per migration-isolation
  // policy; Oligence's revenue-metrics renderer is untouched by either.
  const imfndKeyMetricsData = [
    { label: 'Total Spend (EGP)', value: getPath(data,'imfnd.marketing.totalSpend') },
    { label: 'Total Leads', value: getPath(data,'imfnd.marketing.totalLeads') },
    { label: 'Total Organic Leads', value: getPath(data,'imfnd.marketing.totalOrganicLeads') },
    { label: 'SM Content Organic Leads', value: getPath(data,'imfnd.marketing.smContentOrganicLeads') },
    { label: 'Other Tactics Leads (Webinars…etc)', value: getPath(data,'imfnd.marketing.otherTacticsLeads') },
    { label: 'Paid Leads', value: getPath(data,'imfnd.marketing.paidLeads') },
    { label: 'Cost / Paid Leads', value: getPath(data,'imfnd.marketing.costPerPaidLead') },
    { label: 'New Tickets Sold (Total)', value: getPath(data,'imfnd.marketing.newTicketsSold') },
    { label: 'New Tickets Conversion Rate (%)', value: formatPct(getPath(data,'imfnd.marketing.newTicketsConversionRate')) },
    { label: 'Organic New Sold Tickets', value: getPath(data,'imfnd.marketing.organicNewSoldTickets') },
    { label: 'Organic Conversion Rate (%)', value: formatPct(getPath(data,'imfnd.marketing.organicConversionRate')) },
    { label: 'Paid New Sold Tickets', value: getPath(data,'imfnd.marketing.paidNewSoldTickets') },
    { label: 'Paid Conversion Rate (%)', value: formatPct(getPath(data,'imfnd.marketing.paidConversionRate')) },
    { label: 'Cost / Paid New Tickets (EGP)', value: getPath(data,'imfnd.marketing.costPerPaidNewTicket') },
    { label: 'Total Revenue (EGP)', value: getPath(data,'imfnd.marketing.totalRevenue') },
    { label: 'Total ROAS', value: getPath(data,'imfnd.marketing.totalRoas') },
    { label: 'Total Paid Revenue (EGP)', value: getPath(data,'imfnd.marketing.totalPaidRevenue') },
    { label: 'Total Organic Revenue (EGP)', value: getPath(data,'imfnd.marketing.totalOrganicRevenue') },
    { label: 'Paid ROAS', value: getPath(data,'imfnd.marketing.paidRoas') },
    { label: 'Organic Clicks', value: getPath(data,'imfnd.marketing.organicClicks') },
    { label: 'Paid Clicks', value: getPath(data,'imfnd.marketing.paidClicks') },
    { label: 'Paid CPC ($)', value: getPath(data,'imfnd.marketing.paidCpc') },
    { label: 'Paid CPM ($)', value: getPath(data,'imfnd.marketing.paidCpm') },
    { label: 'Paid CTR (%)', value: getPath(data,'imfnd.marketing.paidCtr') },
  ];
  renderFixedMetricGrid('imfndKeyMetrics', imfndKeyMetricsData, imfndKeyMetricsLabels, kpiGridFn);
  // AS Key Metrics — same frontend-only rendering-adapter pattern as IMFND
  // above (AS Stage C1): canonical values live as individual scalar fields
  // under as.marketing.*, not as an array. No as.keyMetrics in the webhook
  // contract, and none is created here. Kept as its own independent array
  // rather than merged with imfndKeyMetricsData.
  const asKeyMetricsData = [
    { label: 'Total Spend (EGP)', value: getPath(data,'as.marketing.totalSpend') },
    { label: 'Total Leads', value: getPath(data,'as.marketing.totalLeads') },
    { label: 'Total Organic Leads', value: getPath(data,'as.marketing.totalOrganicLeads') },
    { label: 'SM Content Organic Leads', value: getPath(data,'as.marketing.smContentOrganicLeads') },
    { label: 'Other Tactics Leads (Webinars…etc)', value: getPath(data,'as.marketing.otherTacticsLeads') },
    { label: 'Paid Leads', value: getPath(data,'as.marketing.paidLeads') },
    { label: 'Cost / Paid Leads', value: getPath(data,'as.marketing.costPerPaidLead') },
    { label: 'New Tickets Sold (Total)', value: getPath(data,'as.marketing.newTicketsSold') },
    { label: 'New Tickets Conversion Rate (%)', value: formatPct(getPath(data,'as.marketing.newTicketsConversionRate')) },
    { label: 'Organic New Sold Tickets', value: getPath(data,'as.marketing.organicNewSoldTickets') },
    { label: 'Organic Conversion Rate (%)', value: formatPct(getPath(data,'as.marketing.organicConversionRate')) },
    { label: 'Paid New Sold Tickets', value: getPath(data,'as.marketing.paidNewSoldTickets') },
    { label: 'Paid Conversion Rate (%)', value: formatPct(getPath(data,'as.marketing.paidConversionRate')) },
    { label: 'Cost / Paid New Tickets (EGP)', value: getPath(data,'as.marketing.costPerPaidNewTicket') },
    { label: 'Total Revenue (EGP)', value: getPath(data,'as.marketing.totalRevenue') },
    { label: 'Total ROAS', value: getPath(data,'as.marketing.totalRoas') },
    { label: 'Total Paid Revenue (EGP)', value: getPath(data,'as.marketing.totalPaidRevenue') },
    { label: 'Total Organic Revenue (EGP)', value: getPath(data,'as.marketing.totalOrganicRevenue') },
    { label: 'Paid ROAS', value: getPath(data,'as.marketing.paidRoas') },
    { label: 'Organic Clicks', value: getPath(data,'as.marketing.organicClicks') },
    { label: 'Paid Clicks', value: getPath(data,'as.marketing.paidClicks') },
    { label: 'Paid CPC ($)', value: getPath(data,'as.marketing.paidCpc') },
    { label: 'Paid CPM ($)', value: getPath(data,'as.marketing.paidCpm') },
    { label: 'Paid CTR (%)', value: getPath(data,'as.marketing.paidCtr') },
  ];
  renderFixedMetricGrid('asKeyMetrics', asKeyMetricsData, asKeyMetricsLabels, kpiGridFn);
  // Oligence Revenue Recognition — frontend-only rendering adapter (Stage
  // C): the canonical Mapping stores these 7 values as individual scalar
  // fields under oligence.finance.*, not as an array — there is no
  // oligence.revenueMetrics in the webhook contract, and none is created
  // here. Order matches the existing UI exactly. Top Delivered Service
  // Revenue (oligence.finance.topDeliveredServiceRevenue) is a Hero-only KPI
  // and is intentionally NOT part of this adapter. MER - Oligence (blended)
  // is a separate card outside this container, already migrated to
  // oligence.finance.merBlended in Oligence Stage A — left untouched here.
  const oligenceRevenueRecognitionData = [
    { label: 'Total Revenue - Agency (EGP)', value: getPath(data,'oligence.finance.totalRevenue') },
    { label: 'Achievement (%)', value: formatPct(getPath(data,'oligence.finance.achievement')) },
    { label: 'Total cash in / collected - Agency (EGP)', value: getPath(data,'oligence.finance.cashIn') },
    { label: 'Pending / outstanding (EGP)', value: getPath(data,'oligence.finance.pending') },
    { label: 'Overdue (EGP)', value: getPath(data,'oligence.finance.overdue') },
    { label: 'Pipeline - Potential (#)', value: getPath(data,'oligence.finance.pipelinePotential') },
    { label: 'Pipeline - Contracting (#)', value: getPath(data,'oligence.finance.pipelineContracting') },
  ];
  (function renderOligenceRevenueRecognition(){
    const el = document.getElementById('oligenceRevenueMetrics');
    if(!el) return;
    el.innerHTML = oligenceRevenueRecognitionData.map(kpiGridFn).join('');
  })();

  // Oligence Client Portfolio — canonical scalar sources (Oligence Stage
  // E2). Row shape verified in Stage E1: cashOut is NOT a Client Portfolio
  // field (it's the company-wide oligence.finance.cashFlow.cashOut, a
  // different concept from a different sheet) — totalSpend is the real
  // per-client field. Likewise "note" was never canonical here — topRisk is
  // the real field. The sheet's unmapped "Notes" column is intentionally
  // NOT added as an 11th column, per Stage E1.
  // Stage 6.1 fix: `c.cashIn||'Not tracked'` (etc.) used JS truthiness,
  // which mistakes a genuine numeric 0 for missing data (0 is falsy).
  // numCell() distinguishes them correctly — 0 is real data and renders
  // as 0; only undefined/null/'' render as the missing-value dash.
  function numCell(v){ return (v === undefined || v === null || v === '') ? '—' : esc(v); }
  const oligenceClientRowFn = c => `
    <tr>
      <td class="name" style="padding-left:20px;">${esc(c.brand)}</td>
      <td class="num">${esc(c.totalRevenue)}</td>
      <td class="num muted-cell">${numCell(c.cashIn)}</td>
      <td class="num muted-cell">${numCell(c.totalSpend)}</td>
      <td class="num muted-cell">${numCell(c.pending)}</td>
      <td class="num">${esc(c.overdue)}</td>
      <td class="num">${esc(c.mer)}</td>
      <td class="num">${esc(c.momGrowthRate)}</td>
      <td class="muted-cell">${esc(c.services)}</td>
      <td class="muted-cell" style="padding-right:20px;">${esc(c.topRisk)}</td>
    </tr>`;
  function oligenceClientsTotalRowHtml(rows){
    const mer = ratioFromVisible(rows, 'totalRevenue', 'totalSpend');
    return `<tr class="total-row">
      <td class="name" style="padding-left:20px;">Total</td>
      <td class="num">${totalCell(sumVisible(rows,'totalRevenue'))}</td>
      <td class="num">${totalCell(sumVisible(rows,'cashIn'))}</td>
      <td class="num">${totalCell(sumVisible(rows,'totalSpend'))}</td>
      <td class="num">${totalCell(sumVisible(rows,'pending'))}</td>
      <td class="num">${totalCell(sumVisible(rows,'overdue'))}</td>
      <td class="num">${totalCell(mer)}</td>
      <td class="num"></td>
      <td class="muted-cell"></td>
      <td class="muted-cell" style="padding-right:20px;"></td>
    </tr>`;
  }
  renderWithTotal('oligenceClientsBody', getPath(data,'oligence.finance.clientPortfolio'), oligenceClientRowFn, oligenceClientsTotalRowHtml);
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

// ---- Period selector (All Data / Filter by Year, Month + Week) ----
// "All Data" sends { range:'all' } — every row, no filter. n8n's own
// monthly-rollup-first/weekly-fallback rule for All Data is applied
// server-side only — the frontend never implements or approximates it.
// "Filter by Year, Month & Week" requires a year, a month, AND at least one
// week/month checkbox, and sends { range:'filtered', year, month, week },
// where week is an array of the checked values in checkbox order (each one
// of the 4 fixed weeks or "month", the monthly rollup row). The user may
// manually check any combination — including "month" together with
// individual weeks — with no mutual exclusion; whatever is checked is sent
// exactly as-is. Any change re-fetches live data.
function togglePeriodMenu(e){
  e.stopPropagation();
  document.getElementById('periodMenu').classList.toggle('open');
}
// Populates #periodYear with a fixed range around the current calendar
// year (current-5 .. current+5, 11 options) and pre-selects the current
// year. Runs once at load — this only sets the dropdown's default value,
// it does not switch the dashboard into filtered mode (currentRange stays
// { range: 'all' } until the user picks Month + Week and clicks Apply).
function populatePeriodYear(){
  const el = document.getElementById('periodYear');
  if(!el) return;
  const currentYear = new Date().getFullYear();
  const options = [];
  for(let y = currentYear - 5; y <= currentYear + 5; y++){
    options.push(`<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`);
  }
  el.innerHTML = options.join('');
}
populatePeriodYear();
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
  const year = document.getElementById('periodYear').value;
  const month = document.getElementById('periodMonth').value;
  const weeks = Array.from(document.querySelectorAll('#periodWeek input[type="checkbox"]:checked')).map(cb => cb.value);
  if(!year || !month || !weeks.length){ return; } // year, month, and at least one week/month checkbox are all required to filter
  const label = year + ' · ' + month + ' · ' + weeks.map(w => w === 'month' ? 'Month' : w.replace('week','Week')).join(', ');
  document.getElementById('periodLabel').textContent = label;
  document.querySelectorAll('.period-opt').forEach(el => el.classList.toggle('active', el.dataset.mode === 'filtered'));
  document.getElementById('periodMenu').classList.remove('open');
  currentRange = { range: 'filtered', year: Number(year), month: month, week: weeks };
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
