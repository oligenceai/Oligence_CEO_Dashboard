/* ==========================================================================
   WEBHOOK DATA LAYER
   ==========================================================================
   Fetches the dashboard's live data from the n8n webhook, which in turn
   pulls the Google Sheet (Basant/Khaled/Nouran/Rana/Fatma/Nourhan tabs) and
   returns it pre-shaped for render. Triggered on page load and on Refresh.

   REQUEST — sent as POST JSON body to WEBHOOK_URL:
     All data:        { "range": "all" }
     Month + Week:    { "range": "filtered", "month": "July", "week": "week 1" }
     ("month" is one of the 12 month names; "week" is one of
     "week 1" / "week 2" / "week 3" / "week 4" / "month".
     Each employee-owned table in the sheet has its own pair of columns —
     e.g. "Basant Month" / "Basant week number" — so n8n should apply this
     same month+week filter against every "<Name> Month" / "<Name> week
     number" column pair when building the response, matching rows where
     both the month and week values equal what was sent. "week":"month"
     means: return the monthly rollup row for that month rather than a
     single week's row.)

   RESPONSE — a single JSON object shaped like this (any key may be omitted;
   the page shows ONLY what this response actually contains — omitted or
   blank values render as an empty cell/card, never sample/dummy content,
   so a missing figure is immediately visible):

   {
     "group": {
       "statusLabel": "Mixed", "compositeScore": 71,
       "brandsOnTrack": "1 / 3", "brandsAtRisk": "2 / 3",
       "brands": [{ "name":"IMFND","health":92,"statusLabel":"Scale","statusColor":"green","keyMetric":"...","note":"..." }, ...],
       "aiSignals": [{ "typeLabel":"Red Flag","typeColor":"red","severity":"Critical","item":"...","detail":"...","source":"..." }, ...],
       "cashflowAlerts": [{ "levelLabel":"Critical","levelColor":"red","source":"...","issue":"...","detail":"...","balance":"..." }, ...],
       "decisions": { "scale":[{"title":"...","detail":"..."}], "fix":[...], "stop":[...], "automate":[...], "escalate":[...] },
       "projects": [{ "brand":"...","task":"...","deadline":"..." }, ...],
       "teamPulse": [{ "name":"...","role":"...","gap":"...","score":83 }, ...]
     },
     "imfnd": {
       "statusLabel":"Scale", "healthScore":92,
       "hero": { "totalRevenue":"1.06M EGP","targetAchievement":"90%","totalRoas":"30×","leads":"1,748","newTickets":"114" },
       "pillars": [{ "name":"Marketing","statusLabel":"Scale","statusColor":"green","value":"11.92× ROAS","sub":"...","section":"marketing" }, ...5 items],
       "keyMetrics": [{ "label":"Total Revenue","pillLabel":"On Track","pillColor":"green","value":"1,062,726","unit":"EGP","delta":"+32.8% vs May","deltaDirection":"up" }, ...]
     },
     "as": {
       "statusLabel":"Fix", "healthScore":58,
       "hero": { "totalRevenue":"...","targetAchievement":"...","b2cRevenue":"...","b2cLeads":"...","b2cNewTickets":"...","b2bRevenue":"...","b2bPipeline":"...","signedAccounts":"..." },
       "pillars": [ ...5 items, same shape as imfnd.pillars ],
       "b2cMetrics": [ ...same shape as imfnd.keyMetrics ]
     },
     "oligence": {
       "statusLabel":"At Risk", "healthScore":64,
       "hero": { "totalRevenue":"...","targetAchievement":"...","collected":"...","outstanding":"...","atRisk":"..." },
       "pillars": [ ...5 items ],
       "revenueMetrics": [ ...same shape as imfnd.keyMetrics ],
       "clients": [{ "name":"RED","service":"SEO","statusLabel":"Critical","statusColor":"red","note":"...","totalRevenue":"154,264 EGP","cashIn":"...","outstanding":"...","cashOut":"...","netCashFlow":"..." }, ...]
     }
   }
   ========================================================================== */

async function fetchDashboardWebhook(range){
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(range)
  });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
