/* ==========================================================================
   WEBHOOK DATA LAYER
   ==========================================================================
   Fetches the dashboard's live data from the n8n webhook, which in turn
   pulls the Google Sheet (Basant/Khaled/Nouran/Rana/Fatma/Nourhan tabs) and
   returns it pre-shaped for render. Triggered on page load and on Refresh.

   REQUEST — sent as POST JSON body to WEBHOOK_URL:

     All Data:
       { "range": "all" }

     Manual Filter (Year + Month + Week):
       { "range": "filtered", "year": 2026, "month": "October", "week": ["week 1", "week 2"] }

     - "year" is a plain number (e.g. 2026), taken directly from the Year
       dropdown (defaults to the current calendar year, but the user can
       pick any year in the dropdown's range).
     - "month" is a full English month name ("January".."December").
     - "week" is ALWAYS an array, never a bare string — one entry per
       checked box, in the order the user checked them: any combination of
       "week 1" / "week 2" / "week 3" / "week 4" / "month". The user may
       manually combine "month" with individual weeks (e.g.
       ["week 1", "week 2", "month"]) — the frontend applies no mutual
       exclusion and sends exactly what was checked, unmodified.
     - The frontend never parses or normalizes the Google Sheet's own Month
       date values (e.g. a cell displaying "Oct-2026" backed by a real date
       serial) — it only ever sends the plain year number and month name
       above. Matching that against the sheet's real date values is n8n's
       responsibility.
     - The "Monthly Rollup First → Weekly Fallback" rule (prefer a period's
       monthly-rollup row when one exists, otherwise fall back to summing
       its weekly rows) applies ONLY to "range":"all" processing, and is
       implemented entirely in n8n — the frontend does not implement,
       approximate, or depend on this rule.

   RESPONSE — a single JSON object shaped like this (any key may be omitted;
   the page shows ONLY what this response actually contains — omitted or
   blank values render as an empty cell/card, never sample/dummy content,
   so a missing figure is immediately visible):

   {
     "group": {
       "statusLabel": "Mixed", "compositeScore": 71,
       "brandsOnTrack": "1 / 3", "brandsAtRisk": "2 / 3",
       "brands": [{ "name":"IMFND","health":92,"statusLabel":"Scale","statusColor":"green","keyMetric":"...","note":"..." }, ...],
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
