// ui.js — rendering + interaction. Imports the pure engine and data layer.
import { loadData, refreshLive } from "./data.js";
import { predict, DEFAULT_WEIGHTS } from "./prediction.js";

const $ = (s, r = document) => r.querySelector(s);
const pct = (x) => Math.round(x * 100);
const cloneW = (w) => JSON.parse(JSON.stringify(w));
const N_SIMS = 1800;

// count every leaf value the model touches — for the live workload counter
function countDataPoints() {
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
    else n++;
  };
  STATE.teams.list.forEach((t) =>
    walk({ code: t.code, name: t.name, flag: t.flag, group: t.group, elo: t.elo, fifaRank: t.fifaRank, stats: t.stats, norm: t.norm }));
  STATE.matches.groupMatches.forEach(walk);
  STATE.matches.knockout.forEach(walk);
  return n;
}

function animateCount(el, to, dur = 900) {
  const t0 = performance.now();
  (function tick(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(to * e).toLocaleString();
    if (k < 1) requestAnimationFrame(tick);
  })(t0);
}

function renderCounter(animate) {
  const s = STATE.result.stats, dp = STATE.dataPoints;
  if (animate) {
    animateCount($("#cTeams"), s.teams, 650);
    animateCount($("#cData"), dp, 900);
    animateCount($("#cSims"), s.mcRuns, 900);
    animateCount($("#cComp"), s.computations, 1100);
  } else {
    $("#cTeams").textContent = s.teams.toLocaleString();
    $("#cData").textContent = dp.toLocaleString();
    $("#cSims").textContent = s.mcRuns.toLocaleString();
    $("#cComp").textContent = s.computations.toLocaleString();
    const h = $("#cComp").closest(".headline");
    h.classList.remove("bump"); void h.offsetWidth; h.classList.add("bump");
  }
}

// ---- slider schema (every control maps to a real lever in the engine) -------
const SLIDERS = {
  b1: { color: "amber", title: "Historical DNA", blurb: "How much the past predicts the future.",
    items: [
      ["h2h", "Head-to-Head", "Real historical record between the two teams (recency-weighted, last 10 meetings, from ~49k internationals since 1872). Neutral when they've never met."],
      ["gfga", "Goals For ÷ Against", "Team scoring vs conceding so far, normalised across the field."],
      ["pedigree", "World Cup Pedigree", "Past titles ×3, finals ×1.5, semis ×1. Rewards historic powers."],
      ["knockout", "Knockout Win Rate", "How teams perform under elimination pressure."],
      ["experience", "All-Time Class", "Long-run win rate — a proxy for tournament pedigree."],
    ] },
  b2: { color: "blue", title: "Form & Squad", blurb: "Who is playing their best right now.",
    items: [
      ["form", "Recent Form", "Points per game from results so far at this tournament."],
      ["avail", "Squad Availability", "Share of the first-choice XI fit and available."],
      ["depth", "Squad Depth", "How little quality drops when rotating."],
      ["cohesion", "Tactical Cohesion", "Settled XI, time under the coach, formation consistency."],
      ["elo", "FIFA / Elo Rating", "World Football Elo computed from ~49k real internationals (1872–today). The single most predictive lever."],
    ] },
  b3: { color: "purple", title: "Strategic Wildcards", blurb: "What YOU believe about this tournament.",
    items: [
      ["upset", "Upset Sensitivity", "Chalk → favourites dominate. Chaos → every game a coin-flip."],
      ["penalty", "Penalty Shootout Weight", "Weights shootout history into tight knockout ties."],
      ["momentum", "Tournament Momentum", "A small bonus for teams arriving hot."],
      ["homeAdv", "Home / CONCACAF Edge", "A configurable boost for co-hosts USA, Mexico & Canada."],
      ["gutBoost", "Gut Pick Boost", "Boost your hand-picked team by up to 30%."],
    ] },
};
const MASTER = { b1: "Historical DNA", b2: "Form & Squad", b3: "Strategic Wildcards" };

// Bracket is laid out as a binary tree (see layoutBracket), not fixed columns.
const ROUND_LABEL = {
  "Round of 32": "Round of 32", "Round of 16": "Round of 16",
  "Quarter-final": "Quarter-finals", "Semi-final": "Semi-finals", "Final": "Final",
};

let STATE = null; // {teams, matches, snapshot, weights, result}

// ---- weights <-> URL --------------------------------------------------------
function encodeURLWeights(w) {
  const p = new URLSearchParams();
  for (const b of ["b1", "b2", "b3"]) for (const k in w[b]) p.set(`${b}.${k}`, w[b][k].toFixed(2));
  for (const k in w.bucketMaster) p.set(`m.${k}`, w.bucketMaster[k].toFixed(2));
  if (w.gutPick) p.set("gut", w.gutPick);
  return p.toString();
}
function decodeURLWeights() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return null;
  const w = cloneW(DEFAULT_WEIGHTS);
  for (const [key, val] of p) {
    if (key === "gut") { w.gutPick = val; continue; }
    const [a, b] = key.split(".");
    if (a === "m" && w.bucketMaster[b] != null) w.bucketMaster[b] = +val;
    else if (w[a] && w[a][b] != null) w[a][b] = +val;
  }
  return w;
}

// ---- compute + render -------------------------------------------------------
let firstPaint = true;
function recompute() {
  STATE.result = predict(STATE.teams, STATE.matches, STATE.weights, N_SIMS);
  renderChampion();
  renderBracket();
  renderGroups();
  renderCounter(firstPaint);
  firstPaint = false;
}

let debounce;
function scheduleRecompute() { clearTimeout(debounce); debounce = setTimeout(recompute, 150); }

function teamCell(code, p, isWinner, klass = "") {
  const t = STATE.teams.byCode[code];
  if (!t) return `<div class="team tbd ${klass}"><span class="flag">·</span><span class="tname">TBD</span><span class="wp">—</span></div>`;
  return `<div class="team ${isWinner ? "win" : ""} ${klass}">
    <span class="flag">${t.flag}</span><span class="tname">${t.name}</span>
    <span class="wp">${pct(p)}</span>
    <span class="bar" style="--w:${pct(p)}%"></span></div>`;
}

function renderChampion() {
  const champ = STATE.result.det.champion;
  const odds = STATE.result.titleOdds[champ] || 0;
  const t = STATE.teams.byCode[champ];
  $("#champ").innerHTML = t
    ? `<span class="cflag">${t.flag}</span>
       <span class="cmeta"><span class="clabel">Predicted champion</span>
       <span class="cname">${t.name}</span></span>
       <span class="codds">${pct(odds)}%<small>title odds</small></span>`
    : "—";
  if (STATE.prevChampion !== undefined && champ && champ !== STATE.prevChampion) celebrate(champ);
  STATE.prevChampion = champ;
}

function celebrate(code) {
  const t = STATE.teams.byCode[code]; if (!t) return;
  const el = $("#celebrate");
  el.innerHTML = `<div class="cele-card"><span class="cele-flag">${t.flag}</span>
    <div><span class="cele-label">🎉 New predicted champion</span><span class="cele-name">${t.name}</span></div></div>`;
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

// Build the knockout tree from the W## wiring and assign tree coordinates so
// connectors never cross. Final is the root; Round-of-32 ties are the leaves.
function layoutBracket() {
  const byNum = {};
  STATE.matches.knockout.forEach((m) => (byNum[m.num] = m));
  const ref = (tok) => (/^[WL](\d+)$/.test(tok) ? +tok.slice(1) : null);
  const nodes = [];
  const build = (num, depth) => {
    const m = byNum[num];
    const node = { num, round: m.round, depth, kids: [] };
    for (const tok of [m.team1, m.team2]) { const r = ref(tok); if (r != null) node.kids.push(build(r, depth + 1)); }
    nodes.push(node);
    return node;
  };
  const root = build(104, 0);
  const maxDepth = Math.max(...nodes.map((n) => n.depth));

  const mobile = window.matchMedia("(max-width:760px)").matches;
  const CARD_W = mobile ? 150 : 182, CARD_H = mobile ? 46 : 50;
  const ROW = CARD_H + (mobile ? 12 : 16), GAP = mobile ? 40 : 64, COL = CARD_W + GAP;

  let leaf = 0;
  const place = (n) => {
    if (!n.kids.length) { n.y = leaf * ROW; leaf++; }
    else { n.kids.forEach(place); n.y = n.kids.reduce((s, k) => s + k.y, 0) / n.kids.length; }
    n.x = (maxDepth - n.depth) * COL;
  };
  place(root);

  const leaves = leaf;
  const height = (leaves - 1) * ROW + CARD_H;
  const champX = root.x + COL;
  const width = champX + CARD_W + 8;
  return { nodes, root, maxDepth, CARD_W, CARD_H, COL, width, height, champX };
}

function renderBracket() {
  const res = STATE.result.det.res;
  const champ = STATE.result.det.champion;
  const L = layoutBracket();
  const cx = (n) => n.x, cy = (n) => n.y;

  // connectors
  let paths = "";
  for (const n of L.nodes) {
    for (const k of n.kids) {
      const x1 = cx(k) + L.CARD_W, y1 = cy(k) + L.CARD_H / 2;
      const x2 = cx(n), y2 = cy(n) + L.CARD_H / 2, mx = (x1 + x2) / 2;
      const lit = res[k.num]?.winner === champ && champ;
      paths += `<path class="link ${lit ? "lit" : ""}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
    }
  }
  // final -> champion connector
  const fy = cy(L.root) + L.CARD_H / 2, fx1 = cx(L.root) + L.CARD_W, cmx = (fx1 + L.champX) / 2;
  paths += `<path class="link lit" d="M${fx1},${fy} C${cmx},${fy} ${cmx},${fy} ${L.champX},${fy}"/>`;

  // round headers (one per depth column)
  const seen = new Set(); let headers = "";
  for (const n of [...L.nodes].sort((a, b) => b.depth - a.depth)) {
    if (seen.has(n.depth)) continue; seen.add(n.depth);
    headers += `<div class="rhead" style="left:${n.x}px;width:${L.CARD_W}px">${ROUND_LABEL[n.round] || n.round}</div>`;
  }
  headers += `<div class="rhead champ-h" style="left:${L.champX}px;width:${L.CARD_W}px">Champion</div>`;

  // match cards
  const nm = (c) => STATE.teams.byCode[c]?.name || "to be decided";
  let cards = "";
  for (const n of L.nodes) {
    const r = res[n.num], aWin = r.winner === r.t1, onPath = r.winner === champ && champ;
    const label = `${ROUND_LABEL[r.round] || r.round}: ${nm(r.t1)} versus ${nm(r.t2)}. Tap for the breakdown.`;
    cards += `<div class="match ${r.razor ? "razor" : ""} ${r.real ? "real" : ""} ${onPath ? "lit" : ""}"
        style="left:${n.x}px;top:${n.y}px;width:${L.CARD_W}px" data-num="${n.num}"
        role="button" tabindex="0" aria-label="${label}">
      <span class="dot" title="${r.razor ? "Razor-edge — a small swing flips this" : "Robust result"}"></span>
      ${teamCell(r.t1, r.pA, aWin)}${teamCell(r.t2, 1 - r.pA, !aWin)}
    </div>`;
  }
  // champion node
  const ct = STATE.teams.byCode[champ];
  const champCard = ct ? `<div class="match champ lit" style="left:${L.champX}px;top:${cy(L.root)}px;width:${L.CARD_W}px">
      <span class="trophy">🏆</span>
      <div class="cwrap"><span class="flag">${ct.flag}</span><span class="tname">${ct.name}</span>
      <span class="codds-sm">${pct(STATE.result.titleOdds[champ] || 0)}%</span></div></div>` : "";

  $("#bracket").innerHTML =
    `<div class="canvas" style="width:${L.width}px;height:${L.height + 34}px">
       <div class="heads" style="height:34px">${headers}</div>
       <div class="field" style="top:34px;height:${L.height}px">
         <svg class="links" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">
           <defs><linearGradient id="champgrad" x1="0" y1="0" x2="1" y2="0">
             <stop offset="0" stop-color="#2ea043" stop-opacity="0.5"/>
             <stop offset="1" stop-color="#3fb950" stop-opacity="1"/>
           </linearGradient></defs>${paths}</svg>
         ${cards}${champCard}
       </div>
     </div>`;
}

// click a match -> breakdown popover
function showPopover(num, anchor) {
  const r = STATE.result.det.res[num];
  if (!r.t1 || !r.t2) return;
  const bm = STATE.result.baseMap;
  const row = (code, p) => {
    const t = STATE.teams.byCode[code], b = bm[code];
    const seg = (v, cls, lbl) => `<div class="seg ${cls}" style="width:${pct(v * 0.92) + 4}%" title="${lbl} ${pct(v)}%"></div>`;
    return `<div class="pbrow">
      <div class="phead">${t.flag} ${t.name} <b>${pct(p)}%</b></div>
      <div class="pbars">${seg(b.b1, "amber", "Historical")}${seg(b.b2, "blue", "Form/Squad")}${seg(b.b3, "purple", "Wildcards")}</div>
      <div class="podds">title odds ${pct(STATE.result.titleOdds[code] || 0)}%</div>
    </div>`;
  };
  const pop = $("#popover");
  const hh = STATE.teams.byCode[r.t1].stats.h2h && STATE.teams.byCode[r.t1].stats.h2h[r.t2];
  let h2hLine;
  if (hh && hh[1] > 0) {
    const adv = hh[0];
    const lead = Math.abs(adv) < 0.04 ? "level record"
      : `${STATE.teams.byCode[adv > 0 ? r.t1 : r.t2].name} with the edge`;
    h2hLine = `<div class="ph2h">⚔️ Head-to-head · ${hh[1]} past meeting${hh[1] > 1 ? "s" : ""} · ${lead}</div>`;
  } else {
    h2hLine = `<div class="ph2h">⚔️ Head-to-head · no prior meetings on record</div>`;
  }
  pop.innerHTML = `<div class="ptitle">${r.round} · win probability</div>
    ${row(r.t1, r.pA)}${row(r.t2, 1 - r.pA)}
    ${h2hLine}
    <div class="plegend"><span class="amber">■</span>Historical <span class="blue">■</span>Form/Squad <span class="purple">■</span>Wildcards</div>`;
  const rect = anchor.getBoundingClientRect();
  pop.style.display = "block";
  const top = window.scrollY + rect.bottom + 8;
  const left = Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - pop.offsetWidth - 12);
  pop.style.top = top + "px"; pop.style.left = Math.max(8, left) + "px";
}

function renderGroups() {
  if (!$("#groups").classList.contains("open")) return;
  const st = STATE.result.seed.groups;
  const top8 = STATE.result.seed.top8 || [];
  const T = STATE.teams.byCode;
  const html = Object.keys(st.byGroup).sort().map((g) => {
    const ord = [...st.byGroup[g]].sort((a, b) =>
      st.standings[b].pts - st.standings[a].pts || st.standings[b].gd - st.standings[a].gd ||
      st.standings[b].gf - st.standings[a].gf || T[b].elo - T[a].elo);
    const rows = ord.map((c, i) => {
      const s = st.standings[c], adv = i < 2 ? "adv" : (top8.some((x) => x.code === c) ? "adv3" : "");
      return `<tr class="${adv}"><td>${T[c].flag} ${T[c].name}</td><td>${s.pts}</td><td>${s.gd > 0 ? "+" : ""}${s.gd}</td><td>${s.gf}</td></tr>`;
    }).join("");
    return `<div class="gtable"><h5>Group ${g}</h5><table><thead><tr><th>Team</th><th>Pt</th><th>GD</th><th>GF</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("");
  $("#groupsBody").innerHTML = html;
}

// ---- controls ---------------------------------------------------------------
function slider(bucket, key, label, info, val) {
  return `<div class="slider"><label><span>${label}<i class="info" data-tip="${info}">ⓘ</span></span><b class="val">${pct(val)}</b></label>
    <input type="range" min="0" max="100" value="${pct(val)}" style="--val:${pct(val)}%" data-b="${bucket}" data-k="${key}"></div>`;
}

function renderControls() {
  const w = STATE.weights;
  const cards = ["b1", "b2", "b3"].map((b) => {
    const cfg = SLIDERS[b];
    const subs = cfg.items.map(([k, l, i]) => slider(b, k, l, i, w[b][k])).join("");
    const master = `<div class="slider master"><label><span>Bucket weight</span><b class="val">${pct(w.bucketMaster[b])}</b></label>
      <input type="range" min="0" max="100" value="${pct(w.bucketMaster[b])}" style="--val:${pct(w.bucketMaster[b])}%" data-b="bucketMaster" data-k="${b}"></div>`;
    let extra = "";
    if (b === "b3") {
      const opts = STATE.teams.list.map((t) => `<option value="${t.code}" ${w.gutPick === t.code ? "selected" : ""}>${t.flag} ${t.name}</option>`).join("");
      extra = `<div class="gutpick"><label>Your gut pick</label><select id="gutPick"><option value="">— none —</option>${opts}</select></div>`;
    }
    return `<div class="bucket ${cfg.color}"><div class="bhead"><h3>${cfg.title}</h3><p>${cfg.blurb}</p></div>${master}<div class="subs">${subs}</div>${extra}</div>`;
  }).join("");
  $("#controls").innerHTML = cards;
}

function readControlsInto(w) {
  document.querySelectorAll("#controls input[type=range]").forEach((inp) => {
    const v = +inp.value / 100, b = inp.dataset.b, k = inp.dataset.k;
    if (b === "bucketMaster") w.bucketMaster[k] = v; else w[b][k] = v;
  });
  w.gutPick = $("#gutPick").value || null;
}

// ---- top-level wiring -------------------------------------------------------
function flash(msg, ok = true) {
  const t = $("#toast"); t.textContent = msg; t.className = "show " + (ok ? "ok" : "err");
  setTimeout(() => (t.className = ""), 3200);
}

function wire() {
  // sliders
  $("#controls").addEventListener("input", (e) => {
    const inp = e.target;
    if (inp.type !== "range") return;
    inp.style.setProperty("--val", inp.value + "%");
    inp.closest(".slider").querySelector(".val").textContent = inp.value;
    readControlsInto(STATE.weights);
    scheduleRecompute();
  });
  $("#controls").addEventListener("change", (e) => {
    if (e.target.id === "gutPick") { STATE.weights.gutPick = e.target.value || null; recompute(); }
  });
  // info tips
  document.body.addEventListener("mouseover", (e) => {
    const i = e.target.closest(".info"); if (!i) return;
    const tip = $("#tip"); tip.textContent = i.dataset.tip; tip.style.display = "block";
    const r = i.getBoundingClientRect();
    tip.style.top = window.scrollY + r.bottom + 6 + "px";
    tip.style.left = window.scrollX + Math.max(8, r.left - 120) + "px";
  });
  document.body.addEventListener("mouseout", (e) => { if (e.target.closest(".info")) $("#tip").style.display = "none"; });
  // match popover
  $("#bracket").addEventListener("click", (e) => {
    const m = e.target.closest(".match"); if (!m || !m.dataset.num) return;
    showPopover(+m.dataset.num, m);
  });
  $("#bracket").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const m = e.target.closest(".match"); if (!m || !m.dataset.num) return;
    e.preventDefault(); showPopover(+m.dataset.num, m);
  });
  // mobile: hide the swipe hint once the user scrolls the bracket
  const hint = $("#scrollHint");
  if (hint) $("#bracket").addEventListener("scroll", () => hint.classList.add("hide"), { once: true, passive: true });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".match") && !e.target.closest("#popover")) $("#popover").style.display = "none";
  });
  // buttons
  $("#reset").onclick = () => { STATE.weights = cloneW(DEFAULT_WEIGHTS); renderControls(); recompute(); flash("Reset to calibrated defaults"); };
  $("#randomize").onclick = () => {
    const w = STATE.weights;
    for (const b of ["b1", "b2", "b3"]) for (const k in w[b]) w[b][k] = Math.random();
    for (const k in w.bucketMaster) w.bucketMaster[k] = 0.3 + Math.random() * 0.7;
    renderControls(); recompute(); flash("Chaos engaged — random theory loaded");
  };
  $("#share").onclick = async () => {
    const url = location.origin + location.pathname + "?" + encodeURLWeights(STATE.weights);
    try { await navigator.clipboard.writeText(url); flash("Share link copied to clipboard"); }
    catch { prompt("Copy your share link:", url); }
  };
  $("#refresh").onclick = async () => {
    const btn = $("#refresh"); btn.disabled = true; btn.textContent = "Refreshing…";
    try {
      const r = await refreshLive(STATE);
      $("#snap").textContent = STATE.snapshot;
      recompute();
      flash(r.newResults ? `Pulled live data · ${r.newResults} new result(s)` : "Live data: already up to date");
    } catch (err) {
      flash("Couldn't reach live data — showing the embedded snapshot", false);
    } finally { btn.disabled = false; btn.textContent = "↻ Refresh live"; }
  };
  $("#toggleGroups").onclick = () => {
    const g = $("#groups"); g.classList.toggle("open");
    $("#toggleGroups").textContent = g.classList.contains("open") ? "Hide group stage" : "Show group stage";
    renderGroups();
  };
  // keep the bracket geometry correct across breakpoints
  let rz, lastMobile = window.matchMedia("(max-width:760px)").matches;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const m = window.matchMedia("(max-width:760px)").matches;
      if (m !== lastMobile) { lastMobile = m; if (STATE && STATE.result) renderBracket(); }
    }, 200);
  });
}

async function init() {
  try {
    const data = await loadData();
    STATE = { ...data, weights: decodeURLWeights() || cloneW(DEFAULT_WEIGHTS), result: null };
    STATE.dataPoints = countDataPoints();
    $("#snap").textContent = STATE.snapshot;
    renderControls();
    wire();
    recompute();
    $("#loading").style.display = "none";
  } catch (e) {
    $("#loading").innerHTML = `Couldn't load tournament data.<br><small>${e.message}</small><br>
      <small>This site needs to run over http(s) — open the live GitHub Pages URL, not a local file.</small>`;
  }
}

init();
