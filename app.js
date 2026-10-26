/* Our Next Dates — config-driven engine.
   Data: places.json (spots), config.json (types, moods, filters, planner), plans.json (ready-made plans).
   Nothing here is specific to a venue or a category; change the JSON, not this file. */
(async function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const b64e = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = s => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));

  /* ---------- load ---------- */
  async function load() {
    if (window.__BUNDLE__) return window.__BUNDLE__;
    const get = f => fetch(f, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
    const [config, places, plans] = await Promise.all([get("config.json"), get("places.json"), get("plans.json")]);
    return { config, places, plans };
  }
  let C, P, PLANS;
  try { ({ config: C, places: P, plans: PLANS } = await load()); }
  catch (e) { $("#app").innerHTML = `<p class="empty">Couldn't load the date list. Refresh to try again.</p>`; return; }

  const today = new Date().toISOString().slice(0, 10);
  const ALL = Object.fromEntries(P.map(p => [p.id, p]));                         /* includes closed, for old links */
  const live = p => (p.status || "active") === "active" && !(p.dates && p.dates.to && p.dates.to < today);
  P = P.filter(live);
  const byId = Object.fromEntries(P.map(p => [p.id, p]));
  const TYPE = Object.fromEntries(C.types.map(t => [t.id, t]));
  const MOOD = Object.fromEntries(C.moods.map(m => [m.id, m]));
  const KIND = C.kinds || {};
  const TRAVEL = C.planner.travel;
  const MODE = Object.fromEntries(TRAVEL.modes.map(m => [m.id, m]));
  const SITE = location.origin + location.pathname;
  /* short, stable 4-char code per place id (for compact links) */
  const code = id => { let h = 5381; for (const c of id) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36).slice(-4).padStart(4, "0"); };
  const FROM_CODE = Object.fromEntries(Object.keys(ALL).map(id => [code(id), id]));

  /* ---------- rules ---------- */
  function match(p, rule) {
    if (!rule) return true;
    if (rule.any) return rule.any.some(r => match(p, r));
    if (rule.all) return rule.all.every(r => match(p, r));
    if (rule.tags && !rule.tags.some(t => (p.tags || []).includes(t))) return false;
    if (rule.types && !rule.types.includes(p.type)) return false;
    if (rule.text) { const s = (p.name + " " + p.note + " " + (p.tip || "")).toLowerCase(); if (!rule.text.some(w => s.includes(w))) return false; }
    if (rule.dressMin && p.dress < rule.dressMin) return false;
    if (rule.dressMax && p.dress > rule.dressMax) return false;
    if (rule.spendMin && p.spend < rule.spendMin) return false;
    if (rule.spendMax && p.spend > rule.spendMax) return false;
    return true;
  }
  const moodOf = id => MOOD[id] ? MOOD[id].rule : null;

  /* ---------- geo & links ---------- */
  function km(a, b) {
    if (a.lat == null || b.lat == null) return Infinity;
    const R = 6371, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function minutes(a, b, mode) {
    const m = MODE[mode] || MODE[TRAVEL.default], d = km(a, b);
    if (!isFinite(d)) return Infinity;
    if (d < 0.35) return Math.max(2, Math.round(d * 1000 / 80));
    return Math.round(m.fixed + d * TRAVEL.detour * m.minPerKm);
  }
  const isHome = p => p.type === "nightin";
  const q = p => p.maps_query || (p.name + " " + p.area + " London");
  const mapsUrl = p => isHome(p) ? "" : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q(p));
  const dirUrl = (a, b, mode) => "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(q(a)) + "&destination=" + encodeURIComponent(q(b)) + "&travelmode=" + (MODE[mode] || MODE[TRAVEL.default]).gmaps;
  const needsBooking = p => { const t = (p.tip || "") + " " + (p.book || "") + " " + p.note; return !/no booking|walk-in only|free entry/i.test(t) && /book|sell out|sells out|reserve|ticket|slot/i.test(t); };
  const dm = (iso, wd) => new Date(iso + "T12:00").toLocaleDateString("en-GB", wd ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
  const whenText = p => { const d = p.dates || {}, f = d.from, t = d.to;
    if (f && t && f === t) return dm(f, true);
    if (f && f > today) return t ? dm(f) + " – " + dm(t) : "From " + dm(f);
    return t ? "Until " + dm(t) : ""; };

  /* ---------- planner ---------- */
  const ask = Object.assign({ when: "eve", scope: "london", where: "any", travel: TRAVEL.default, mood: "any", spend: "treat" }, store.get("ask", {}));
  const SCOPE = Object.fromEntries(C.regions.map(r => [r.id, r.scope || "london"]));
  if (SCOPE[ask.where] === "surrey") { ask.scope = "surrey"; ask.where = "any"; }               /* old saved choice */
  if (MODE[ask.travel]?.scope === "surrey") ask.travel = TRAVEL.default;
  const surrey = () => ask.scope === "surrey";
  /* travel mode in use: Surrey always drives; London uses the chosen mode */
  const mode = () => surrey() ? (TRAVEL.modes.find(m => m.scope === "surrey") || MODE[TRAVEL.default]).id : ask.travel;
  const qOf = id => C.planner.questions.find(x => x.id === id);
  function optionsFor(qn) {
    let opts = qn.options;
    if (opts === "scopes") opts = C.scopes.map(r => ({ id: r.id, label: r.label }));
    else if (opts === "regions") opts = C.regions.filter(r => (r.scope || "london") === "london").map(r => ({ id: r.id, label: r.label }));
    else if (opts === "moods") opts = C.moods.map(m => ({ id: m.id, label: m.label }));
    else if (opts === "travel") opts = TRAVEL.modes.filter(m => (m.scope || "london") === "london").map(m => ({ id: m.id, label: m.label }));
    return qn.any ? [{ id: "any", label: qn.any }, ...opts] : opts;
  }
  const spendOpt = () => qOf("spend").options.find(o => o.id === ask.spend) || { spendMax: 4 };
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const home = () => ask.when === "in";

  function buildPlan(tpl, used, usedCuisine) {
    const steps = tpl.steps, chosen = new Array(steps.length).fill(null);
    const sp = spendOpt(), moodRule = ask.mood === "any" ? null : moodOf(ask.mood);
    const base = s => P.filter(p => s.types.includes(p.type) && !used.has(p.id)
      && (s.home || p.lat != null) && (!s.kinds || s.kinds.includes(p.kind))
      && (!s.slot || p.slot === s.slot || p.slot === "both") && p.spend <= sp.spendMax);
    const score = (p, s) => Math.random() + (moodRule && match(p, moodRule) ? 1.4 : 0)
      + (sp.prefer && p.spend >= sp.prefer ? 0.6 : 0) + ((p.tags || []).includes("vibe") ? 0.3 : 0)
      + (s.meal && p.cuisine && usedCuisine.has(p.cuisine) ? -1.5 : 0);
    const best = (list, s, ref) => list.map(p => [score(p, s) - (ref ? minutes(ref, p, mode()) / 15 : 0), p]).sort((a, b) => b[0] - a[0])[0]?.[1] || null;
    const inArea = (p, s) => s.home || (SCOPE[p.region] === ask.scope && (surrey() || ask.where === "any" || p.region === ask.where));

    const fits = i => base(steps[i]).filter(p => inArea(p, steps[i]) && (!moodRule || match(p, moodRule)));
    let ai = steps.findIndex(s => s.anchor), anchors = fits(ai);
    if (!anchors.length) {
      const alt = steps.map((s, i) => i).filter(i => i !== ai && !steps[i].optional && fits(i).length);
      if (!alt.length) return null;
      ai = pick(alt); anchors = fits(ai);
    }
    chosen[ai] = pick(anchors.slice().sort(() => Math.random() - .5).slice(0, 12).sort((a, b) => score(b, steps[ai]) - score(a, steps[ai])).slice(0, 4));

    let progress = true;
    while (progress) {
      progress = false;
      steps.forEach((s, i) => {
        if (chosen[i] !== null) return;
        const taken = new Set(chosen.filter(Boolean).map(p => p.id));
        if (s.home) {                                   /* nights in: no travel, just pick well */
          const p = best(base(s).filter(p => !taken.has(p.id)), s, null);
          chosen[i] = p || false; progress = true; return;
        }
        let ref = null, lim = s.maxMin || TRAVEL.maxMin;
        if (s.near != null && chosen[s.near]) ref = chosen[s.near];
        else { const j = steps.findIndex(t => t.near === i); if (j >= 0 && chosen[j]) { ref = chosen[j]; lim = steps[j].maxMin || TRAVEL.maxMin; } }
        if (!ref) return;
        const cands = base(s).filter(p => !taken.has(p.id) && minutes(ref, p, mode()) <= lim);
        const p = best(cands, s, ref);
        chosen[i] = p && (!s.optional || Math.random() < 0.75) ? p : false;
        progress = true;
      });
    }
    if (steps.some((s, i) => !s.optional && !chosen[i])) return null;
    return steps.map((s, i) => chosen[i] ? { step: s, place: chosen[i] } : null).filter(Boolean);
  }

  function generate() {
    const tpls = C.planner.templates[ask.when] || [];
    const out = [], used = new Set(), usedCuisine = new Set();
    const usedTpl = new Set();
    const run = (tries, flag) => {
      for (let t = 0; out.length < 3 && t < tries; t++) {
        const fresh = tpls.filter(x => !usedTpl.has(x.name)), tpl = pick(fresh.length && t < tries / 2 ? fresh : tpls);
        const plan = buildPlan(tpl, used, usedCuisine);
        if (!plan) continue;
        plan.forEach(x => { used.add(x.place.id); if (x.step.meal && x.place.cuisine) usedCuisine.add(x.place.cuisine); });
        if (flag) plan.flag = flag;
        usedTpl.add(tpl.name); out.push(plan);
      }
    };
    run(60);
    if (out.length < 3 && ask.where !== "any" && !surrey() && !home()) { const w = ask.where; ask.where = "any"; run(40, "A bit further out"); ask.where = w; }
    if (out.length < 3 && ask.mood !== "any") { const m = ask.mood; ask.mood = "any"; run(40, "A different mood, as a wildcard"); ask.mood = m; }
    return out;
  }
  const whenLabel = () => (qOf("when").options.find(o => o.id === ask.when) || {}).label || "";
  function planTitle(plan) {
    const a = plan.find(x => x.step.anchor)?.place || plan[0].place;
    if (home()) return `A night in: ${(KIND[a.kind] || "").toLowerCase()}`;
    const area = a.area.replace(/\s*\(.*?\)/, "").split(/ \/ |, /)[0];
    return SCOPE[a.region] === "surrey" ? `${whenLabel()} in ${area}` : `${whenLabel()} around ${area}`;
  }
  /* a plan as a portable object: what links and saves carry */
  const planObj = (title, stops, extra = {}) => Object.assign({ t: title, m: mode(), w0: ask.when, s: stops }, extra);
  const fromGenerated = plan => planObj(planTitle(plan), plan.map(x => [x.place.id, x.step.time]));
  const fromReady = rp => planObj(rp.title, rp.steps.map(s => [s.place || s.text, s.time, s.what || ""]), { w: rp.why, r: rp.id });
  const planLines = o => o.s.map(([id, time]) => `${time}  ${ALL[id]?.name || id}`);
  /* compact links: #r=<ready id>~<yyyymmdd>  or  #g=<when><mode>.<code><hhmm>.<code><hhmm>~<yyyymmdd> */
  const encodeTail = d => d ? "~" + d.replace(/-/g, "") : "";
  function planHash(o, d) {
    if (o.r) return "#r=" + o.r + encodeTail(d);
    return "#g=" + (o.w0 || "e")[0] + (o.m || "c")[0] + "." + o.s.map(([id, t]) => code(id) + String(t).replace(":", "")).join(".") + encodeTail(d);
  }
  const planLink = (o, extra = {}) => SITE + planHash(o, extra.d);
  const WHEN_BY = { e: "eve", d: "day", f: "full", i: "in" }, MODE_BY = Object.fromEntries(TRAVEL.modes.map(m => [m.id[0], m.id]));
  function decodeHash(h) {
    const [body, dt] = h.split("~"), d = dt ? dt.slice(0, 4) + "-" + dt.slice(4, 6) + "-" + dt.slice(6, 8) : undefined;
    if (body.startsWith("r=")) { const rp = PLANS.find(x => x.id === body.slice(2)); return rp ? Object.assign(fromReady(rp), { d }) : null; }
    const [hd, ...stops] = body.slice(2).split(".");
    const s = stops.map(x => [FROM_CODE[x.slice(0, 4)] || x.slice(0, 4), x.slice(4, 6) + ":" + x.slice(6, 8)]);
    const when = WHEN_BY[hd[0]] || "eve", first = ALL[s.find(x => ALL[x[0]] && ALL[x[0]].type !== "drinks")?.[0] || s[0][0]];
    const label = (qOf("when").options.find(o => o.id === when) || {}).label || "A date";
    const t = when === "in" ? "A night in" : first ? `${label} around ${first.area}` : label;
    return { t, m: MODE_BY[hd[1]] || TRAVEL.default, s, d };
  }

  /* ---------- picks ---------- */
  let picks = store.get("picks2", []);              /* [{k:'place',id} | {k:'plan', o}] */
  const pickKey = x => x.k === "place" ? "p:" + x.id : "plan:" + x.o.t + x.o.s.map(s => s[0]).join(",");
  function togglePick(x) {
    const k = pickKey(x), i = picks.findIndex(y => pickKey(y) === k);
    i >= 0 ? picks.splice(i, 1) : picks.push(x);
    store.set("picks2", picks); renderBar();
  }
  const isPicked = x => picks.some(y => pickKey(y) === pickKey(x));

  /* ---------- shell ---------- */
  const app = $("#app");
  app.innerHTML = `
    <header class="cover"><div class="wrap pad">
      <div class="eyebrow">${esc(C.copy.eyebrow)}</div>
      <h1>${esc(C.copy.title)}</h1>
      <p>${esc(C.copy.intro)}</p>
    </div></header>
    <nav class="tabs" role="tablist"><div class="wrap pad tabrow">
      <button role="tab" data-tab="plan">Plan a date</button>
      <button role="tab" data-tab="browse">Browse</button>
      <button role="tab" data-tab="map">Map</button>
    </div></nav>
    <main class="wrap pad">
      <section id="tab-plan" hidden></section>
      <section id="tab-browse" hidden></section>
      <section id="tab-map" hidden><div class="row" id="map-filter"></div><div id="map"></div><p class="small">Pins are approximate. Tap one, then Photos & map for the exact spot.</p></section>
      <footer>${esc(C.copy.footer)}</footer>
    </main>
    <div class="bar pad" id="bar"><button class="n" id="bar-n" type="button"></button><span class="acts"><a class="solid" id="bar-send" target="_blank" rel="noopener" href="#">${esc(C.copy.sendPicks)}</a></span></div>
    <div class="sheet" id="sheet" hidden><div class="scrim" data-close></div><div class="panel" role="dialog" aria-modal="true"><button class="x" data-close aria-label="Close">×</button><div id="sheet-body"></div></div></div>
    <div class="toast" id="toast" role="status"></div>`;

  const toast = t => { const el = $("#toast"); el.textContent = t; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 1800); };
  const waHref = text => "https://wa.me/" + (C.copy.whatsappNumber || "") + "?text=" + encodeURIComponent(text);
  async function copy(text) { try { await navigator.clipboard.writeText(text); toast("Copied"); } catch (e) { toast("Couldn't copy"); } }

  /* ---------- tabs ---------- */
  let tab = ["plan", "browse", "map"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "plan";
  function showTab(t) {
    tab = t;
    document.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    ["plan", "browse", "map"].forEach(x => $("#tab-" + x).hidden = x !== t);
    if (t === "map") initMap();
  }
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { showTab(b.dataset.tab); window.scrollTo({ top: $(".tabs").offsetTop }); });

  function chipRow(label, opts, value, onPick) {
    const row = document.createElement("div"); row.className = "q";
    row.innerHTML = `<div class="qlabel">${esc(label)}</div><div class="row"></div>`;
    opts.forEach(o => {
      const b = document.createElement("button"); b.type = "button"; b.className = "chip";
      b.innerHTML = esc(o.label) + (o.n != null ? ` <span class="cn">${o.n}</span>` : "");
      b.setAttribute("aria-pressed", String(value === o.id)); b.onclick = () => onPick(o.id); row.lastChild.appendChild(b);
    });
    return row;
  }

  /* ---------- plan tab ---------- */
  let current = [], tried = false;
  function renderPlanTab() {
    const el = $("#tab-plan"); el.innerHTML = "";
    const form = document.createElement("div"); form.className = "planner";
    C.planner.questions.forEach(qn => {
      if (home() && ["scope", "where", "travel"].includes(qn.id)) return;
      if (surrey() && (qn.id === "where" || qn.id === "travel")) return;
      form.appendChild(chipRow(qn.label, optionsFor(qn), ask[qn.id], v => { ask[qn.id] = v; store.set("ask", ask); current = []; tried = false; renderPlanTab(); }));
    });
    const go = document.createElement("button"); go.className = "solid big"; go.type = "button";
    go.textContent = current.length ? "Shuffle" : "Plan our date";
    go.onclick = () => { tried = true; current = generate(); renderPlanTab(); $("#results")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
    form.appendChild(go); el.appendChild(form);

    const res = document.createElement("div"); res.id = "results";
    if (current.length) res.innerHTML = current.map((plan, i) => planCard(plan, i)).join("");
    else if (tried) res.innerHTML = `<p class="empty">Nothing fits all of that. Try ${surrey() ? "London" : "Anywhere"}, a different mood, or a bigger spend.</p>`;
    el.appendChild(res);

    const ready = document.createElement("div"); ready.className = "ready";
    ready.innerHTML = `<h2>Ready-made</h2>` + PLANS.filter(rp => rp.steps.every(s => !s.place || byId[s.place])).map(readyCard).join("");
    el.appendChild(ready);
    wirePlanButtons(el);
  }
  function stopHtml(p, time, sub) {
    return `<li class="stop"><b>${esc(time)}</b><button class="link" data-open="${esc(p.id)}">${esc(p.name)}</button><span class="sub">${esc(sub)}</span></li>`;
  }
  function hopHtml(a, b, mode) {
    if (isHome(a) || isHome(b)) return "";
    const m = minutes(a, b, mode); if (!isFinite(m)) return "";
    return `<li class="hop"><span>~${m} min by ${esc((MODE[mode] || MODE[TRAVEL.default]).label.toLowerCase())}</span><a href="${dirUrl(a, b, mode)}" target="_blank" rel="noopener">Directions</a></li>`;
  }
  function planCard(plan, i) {
    const o = fromGenerated(plan), mood = ask.mood !== "any" ? MOOD[ask.mood]?.label : whenLabel();
    let html = `<article class="plan"><div class="kind">${esc(plan.flag || mood)}</div><h3>${esc(o.t)}</h3><ol>`;
    plan.forEach((x, j) => {
      if (j) html += hopHtml(plan[j - 1].place, x.place, mode());
      const p = x.place, sub = [isHome(p) ? KIND[p.kind] : TYPE[p.type]?.label, isHome(p) ? p.time : p.area, p.dress === 3 ? C.dress["3"] : "", whenText(p)].filter(Boolean).join(" · ");
      html += stopHtml(p, x.step.time, sub);
    });
    const on = isPicked({ k: "plan", o });
    html += `</ol><div class="acts"><button class="heart" data-pickplan="${i}" aria-pressed="${on}">${on ? "♥ Saved" : "♡ Save"}</button><button class="solid" data-request="${i}">${esc(C.copy.requestTitle)}</button><button class="ghost" data-view="${i}">Details</button></div></article>`;
    return html;
  }
  function readyCard(rp) {
    const o = fromReady(rp), on = isPicked({ k: "plan", o });
    return `<article class="plan ready-plan"><div class="kind">${esc(rp.when)}</div><h3>${esc(rp.title)}</h3><ol>` +
      rp.steps.map(s => { const p = s.place && byId[s.place]; return p ? stopHtml(p, s.time, s.what || "") : `<li class="stop"><b>${esc(s.time)}</b><span class="plain">${esc(s.text || "")}</span><span class="sub">${esc(s.what || "")}</span></li>`; }).join("") +
      `</ol><p class="why">${esc(rp.why)}</p><div class="acts"><button class="heart" data-pickready="${esc(rp.id)}" aria-pressed="${on}">${on ? "♥ Saved" : "♡ Save"}</button><button class="solid" data-requestready="${esc(rp.id)}">${esc(C.copy.requestTitle)}</button><button class="ghost" data-viewready="${esc(rp.id)}">Details</button></div></article>`;
  }
  function wirePlanButtons(root) {
    root.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openPlace(b.dataset.open));
    const gen = i => fromGenerated(current[+i]), rdy = id => fromReady(PLANS.find(x => x.id === id));
    root.querySelectorAll("[data-pickplan]").forEach(b => b.onclick = () => { togglePick({ k: "plan", o: gen(b.dataset.pickplan) }); renderPlanTab(); });
    root.querySelectorAll("[data-request]").forEach(b => b.onclick = () => requestSheet(gen(b.dataset.request)));
    root.querySelectorAll("[data-view]").forEach(b => b.onclick = () => planView(gen(b.dataset.view)));
    root.querySelectorAll("[data-pickready]").forEach(b => b.onclick = () => { togglePick({ k: "plan", o: rdy(b.dataset.pickready) }); renderPlanTab(); });
    root.querySelectorAll("[data-requestready]").forEach(b => b.onclick = () => requestSheet(rdy(b.dataset.requestready)));
    root.querySelectorAll("[data-viewready]").forEach(b => b.onclick = () => planView(rdy(b.dataset.viewready)));
  }

  /* ---------- plan view: everything needed to book ---------- */
  function planView(o) {
    const stops = o.s.map(([id, time, what]) => ({ p: ALL[id], id, time, what }));
    const day = o.d ? new Date(o.d + "T12:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "";
    let html = `<div class="kind">${esc(day || "The plan")}</div><h2>${esc(o.t)}</h2>${o.n ? `<p class="note">“${esc(o.n)}”</p>` : ""}${o.w ? `<p class="why">${esc(o.w)}</p>` : ""}<ol class="pv">`;
    stops.forEach((x, j) => {
      if (j && x.p && stops[j - 1].p) html += hopHtml(stops[j - 1].p, x.p, o.m);
      if (!x.p) { html += `<li class="pvstop"><b>${esc(x.time)}</b><div><div class="name">${esc(x.id)}</div></div></li>`; return; }
      const p = x.p, closed = !byId[p.id];
      const links = [
        mapsUrl(p) && `<a href="${mapsUrl(p)}" target="_blank" rel="noopener">Maps</a>`,
        p.website && `<a href="${esc(p.website)}" target="_blank" rel="noopener">Website</a>`,
        `<a href="${esc(p.source.url)}" target="_blank" rel="noopener">${isHome(p) ? "Recipe / buy" : "Read about it"}</a>`
      ].filter(Boolean).join("");
      html += `<li class="pvstop"><b>${esc(x.time)}</b><div>
        <div class="name">${esc(p.name)}${closed ? ' <span class="flagx">no longer listed</span>' : ""}</div>
        <div class="area">${esc([isHome(p) ? KIND[p.kind] : p.area, x.what, whenText(p)].filter(Boolean).join(" · "))}</div>
        ${p.tip || p.book ? `<p class="tip">${needsBooking(p) ? "<strong>Book:</strong> " : ""}${esc(p.book || p.tip)}</p>` : ""}
        <div class="links">${links}</div></div></li>`;
    });
    html += `</ol><div class="acts col"><button class="ghost" id="pv-copy" type="button">Copy link to this plan</button></div>`;
    openSheet(html);
    $("#pv-copy").onclick = () => copy(planLink(o));
  }

  /* ---------- browse tab ---------- */
  const filt = Object.assign({ q: "" }, Object.fromEntries(C.browse.filters.map(f => [f.id, "all"])));
  function sourceOpts(src) {
    if (src === "types") return C.types.map(t => ({ id: t.id, label: t.label }));
    if (src === "moods") return C.moods.map(m => ({ id: m.id, label: m.label }));
    if (src === "regions") return C.regions.map(r => ({ id: r.id, label: r.label }));
    if (src === "kinds") return Object.entries(KIND).map(([id, label]) => ({ id, label }));
    if (src === "on") return (C.on || []).map(o => ({ id: o.id, label: o.id === "pick" && filt.onDate ? fmtDay(filt.onDate) : o.label }));
    return [];
  }
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const fmtDay = iso => new Date(iso + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  function onRange(v) {                                  /* [start, end] ISO dates for a "When" chip */
    const o = (C.on || []).find(x => x.id === v) || {};
    if (o.days) return [today, addDays(today, o.days)];
    if (o.from) { const y = today.slice(0, 4), a = y + "-" + o.from, b = y + "-" + o.to; return b < today ? [(+y + 1) + "-" + o.from, (+y + 1) + "-" + o.to] : [a, b]; }
    const d = filt.onDate || today; return [d, d];
  }
  const isOn = (p, v) => { if (p.type !== "event") return true; const [a, b] = onRange(v), d = p.dates || {}; return (!d.from || d.from <= b) && (!d.to || d.to >= a); };
  const testF = (f, p, v) => f.source === "types" ? p.type === v : f.source === "regions" ? p.region === v : f.source === "kinds" ? p.kind === v : f.source === "moods" ? match(p, moodOf(v)) : f.source === "on" ? isOn(p, v) : true;
  function passes(p, skip) {
    for (const f of C.browse.filters) { if (f.id === skip) continue; const v = filt[f.id]; if (v !== "all" && !testF(f, p, v)) return false; }
    if (filt.q) { const s = (p.name + " " + p.area + " " + p.note + " " + (p.cuisine || "") + " " + (p.tags || []).join(" ")).toLowerCase(); if (!s.includes(filt.q)) return false; }
    return true;
  }
  function renderBrowse() {
    const el = $("#tab-browse");
    if (!el.dataset.ready) {
      el.dataset.ready = "1";
      el.innerHTML = `<div class="filters"><input type="search" id="q" placeholder="Search a name, food or area" aria-label="Search"></div><div id="frows"></div><p class="count" id="count"></p><div class="list" id="list"></div>`;
      $("#q").oninput = e => { filt.q = e.target.value.toLowerCase().trim(); renderBrowse(); };
    }
    const rows = $("#frows"); rows.innerHTML = "";
    C.browse.filters.forEach(f => {
      if (f.when && Object.entries(f.when).some(([k, v]) => filt[k] !== v)) { filt[f.id] = "all"; return; }
      const pool = P.filter(p => passes(p, f.id));
      const opts = sourceOpts(f.source).map(o => Object.assign(o, { n: pool.filter(p => testF(f, p, o.id)).length })).filter(o => o.n > 0 || filt[f.id] === o.id);
      if (!opts.length) return;
      rows.appendChild(chipRow(f.label, [{ id: "all", label: "All", n: pool.length }, ...opts], filt[f.id], v => { filt[f.id] = v; renderBrowse(); }));
      if (f.source === "on" && filt[f.id] === "pick") {         /* date picker for "Pick a date" */
        const inp = document.createElement("input"); inp.type = "date"; inp.min = today; inp.value = filt.onDate || today; inp.className = "datepick"; inp.setAttribute("aria-label", "Pick a date");
        inp.onchange = () => { filt.onDate = inp.value || today; renderBrowse(); };
        rows.appendChild(inp);
      }
    });
    renderList();
  }
  function renderList() {
    const r = P.filter(p => passes(p));
    if (filt.type === "event") {                              /* soonest first, ongoing shows sorted by end */
      const k = p => { const d = p.dates || {}; return (d.from && d.from > today ? d.from : today) + (d.to || "9999"); };
      r.sort((a, b) => k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0);
    }
    $("#count").textContent = r.length + (r.length === 1 ? " idea" : " ideas");
    $("#list").innerHTML = r.length ? r.map(p => {
      const on = isPicked({ k: "place", id: p.id });
      const kind = [isHome(p) ? KIND[p.kind] : TYPE[p.type]?.label, p.dress === 3 ? C.dress["3"] : "", whenText(p)].filter(Boolean).join(" · ");
      return `<article class="item"><button class="itembody" data-open="${esc(p.id)}">
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        <span class="kind">${esc(kind)}</span><span class="name">${esc(p.name)}</span><span class="area">${esc(isHome(p) ? (p.time ? "About " + p.time : "At home") : p.area)}</span><span class="note">${esc(p.note)}</span></button>
        <button class="heart round" data-pick="${esc(p.id)}" aria-pressed="${on}" aria-label="Heart ${esc(p.name)}">${on ? "♥" : "♡"}</button></article>`;
    }).join("") : `<p class="empty">Nothing here. Try fewer filters.</p>`;
    $("#list").querySelectorAll("[data-open]").forEach(b => b.onclick = () => openPlace(b.dataset.open));
    $("#list").querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { togglePick({ k: "place", id: b.dataset.pick }); renderList(); });
  }

  /* ---------- sheets ---------- */
  function openSheet(html) { $("#sheet-body").innerHTML = html; $("#sheet").hidden = false; document.body.classList.add("locked"); $(".panel").scrollTop = 0; }
  function closeSheet() { $("#sheet").hidden = true; document.body.classList.remove("locked"); }
  $("#sheet").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
  function openPlace(id) {
    const p = ALL[id]; if (!p) return;
    const on = isPicked({ k: "place", id });
    openSheet(`${p.image ? `<img class="hero" src="${esc(p.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      <div class="kind">${esc(isHome(p) ? "Night in · " + (KIND[p.kind] || "") : (TYPE[p.type]?.label || "") + (p.cuisine ? " · " + p.cuisine : ""))}</div>
      <h2>${esc(p.name)}</h2><div class="area">${esc(isHome(p) ? (p.time ? "About " + p.time : "At home") : p.area)}${whenText(p) ? " · " + esc(whenText(p)) : ""}</div>
      <p class="note">${esc(p.note)}</p>${p.tip ? `<p class="tip">${esc(p.tip)}</p>` : ""}
      <dl>${isHome(p) ? "" : `<div><dt>Dress</dt><dd>${esc(C.dress[p.dress])}</dd></div>`}<div><dt>Spend</dt><dd>${esc(C.spend[p.spend])}</dd></div></dl>
      <div class="acts col">
        ${mapsUrl(p) ? `<a class="solid" href="${mapsUrl(p)}" target="_blank" rel="noopener">Photos & map</a>` : ""}
        <a class="${mapsUrl(p) ? "ghost" : "solid"}" href="${esc(p.source.url)}" target="_blank" rel="noopener">${isHome(p) ? "Recipe / where to buy" : "Read about it"} · ${esc(p.source.name)}</a>
        <button class="ghost" id="sheet-pick" type="button">${on ? "♥ Saved" : "♡ Save"}</button>
      </div>`);
    $("#sheet-pick").onclick = () => { togglePick({ k: "place", id }); openPlace(id); if (tab === "browse") renderList(); };
  }

  /* ---------- request ---------- */
  function requestSheet(o) {
    openSheet(`<div class="kind">${esc(C.copy.requestTitle)}</div><h2>${esc(o.t)}</h2>
      <ol class="plain-list">${planLines(o).map(l => `<li>${esc(l)}</li>`).join("")}</ol>
      <label class="field" for="req-date">Which day?</label><input id="req-date" type="date" min="${today}">
      <label class="field" for="req-note">Anything else?</label><textarea id="req-note" rows="2" placeholder="e.g. Not too late, I'm up early"></textarea>
      <div class="acts col"><a class="solid" id="req-send" target="_blank" rel="noopener" href="#">Send on WhatsApp</a><button class="ghost" id="req-copy" type="button">Copy instead</button></div>`);
    const msg = () => {
      const d = $("#req-date").value, n = $("#req-note").value.trim();
      const day = d ? new Date(d + "T12:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "Any day soon";
      return `${C.copy.requestMessage}\n${o.t}\n${day}\n\n${planLines(o).join("\n")}${n ? "\n\n" + n : ""}\n\nLinks and booking: ${planLink(o, { d: d || undefined })}`;
    };
    const upd = () => { $("#req-send").href = waHref(msg()); };
    $("#req-date").oninput = upd; $("#req-note").oninput = upd; upd();
    $("#req-copy").onclick = () => copy(msg());
  }

  /* ---------- saved ---------- */
  const savedLink = () => SITE + "#s=" + picks.map(x => x.k === "place" ? code(x.id) : planHash(x.o).slice(1).replace(/\./g, ",")).join(".");
  function decodeSaved(body) {
    return body.split(".").map(x => x.length === 4 ? FROM_CODE[x] : decodeHash(x.replace(/,/g, "."))).filter(Boolean);
  }
  function picksText() {
    const lines = picks.map(x => x.k === "place" ? "• " + (ALL[x.id]?.name || x.id) : "• " + x.o.t);
    return `${C.copy.picksMessage}\n\n${lines.join("\n")}\n\nAll the details: ${savedLink()}`;
  }
  function savedView(list) {
    const places = list.filter(x => typeof x === "string").map(id => ALL[id]).filter(Boolean);
    const plans = list.filter(x => typeof x === "object");
    openSheet(`<div class="kind">Saved</div><h2>${places.length + plans.length} ideas</h2>
      ${plans.length ? `<div class="qlabel">Plans</div><ol class="plain-list">${plans.map((o, i) => `<li><button class="link" data-sv="${i}">${esc(o.t)}</button></li>`).join("")}</ol>` : ""}
      ${places.length ? `<div class="qlabel" style="margin-top:18px">Places</div><ol class="plain-list">${places.map(p => `<li><button class="link" data-open="${esc(p.id)}">${esc(p.name)}</button></li>`).join("")}</ol>` : ""}`);
    $("#sheet-body").querySelectorAll("[data-sv]").forEach(b => b.onclick = () => planView(plans[+b.dataset.sv]));
    $("#sheet-body").querySelectorAll("[data-open]").forEach(b => b.onclick = () => openPlace(b.dataset.open));
  }
  function renderBar() {
    const n = picks.length; $("#bar").classList.toggle("on", n > 0);
    $("#bar-n").textContent = n === 1 ? "1 saved" : n + " saved"; $("#bar-send").href = waHref(picksText());
  }
  $("#bar-n").onclick = () => savedView(picks.map(x => x.k === "place" ? x.id : x.o));

  /* ---------- map ---------- */
  let map, layer, mapType = "all";
  function initMap() {
    if (!window.L) { $("#map").innerHTML = `<p class="empty">The map loads on the live site.</p>`; return; }
    if (!map) {
      map = L.map("map").setView(C.map.center, C.map.zoom);
      L.tileLayer(C.map.tiles, { attribution: C.map.attribution, maxZoom: 19, subdomains: "abcd" }).addTo(map);
      const fr = $("#map-filter"); fr.innerHTML = "";
      [{ id: "all", label: "All" }, ...C.types.filter(t => t.id !== "nightin").map(t => ({ id: t.id, label: t.label }))].forEach(o => {
        const b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.textContent = o.label; b.dataset.v = o.id;
        b.setAttribute("aria-pressed", String(mapType === o.id));
        b.onclick = () => { mapType = o.id; fr.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c.dataset.v === mapType))); drawPins(); };
        fr.appendChild(b);
      });
      drawPins();
    }
    setTimeout(() => map.invalidateSize(), 60);
  }
  function drawPins() {
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    P.filter(p => p.lat != null && (mapType === "all" || p.type === mapType)).forEach(p => {
      const m = L.circleMarker([p.lat, p.lng], { radius: 7, weight: 2, color: "#FBF7F4", fillColor: TYPE[p.type]?.color || "#5A1830", fillOpacity: .95 });
      m.bindPopup(`<b>${esc(p.name)}</b><br>${esc(TYPE[p.type]?.label || "")} · ${esc(p.area)}<br><a href="#" data-open="${esc(p.id)}">Details</a>`);
      m.on("popupopen", e => { const a = e.popup.getElement().querySelector("[data-open]"); if (a) a.onclick = ev => { ev.preventDefault(); openPlace(p.id); }; });
      m.addTo(layer);
    });
  }

  /* ---------- boot ---------- */
  renderPlanTab(); renderBrowse(); renderBar(); showTab(tab);
  function openFromHash() {
    const h = location.hash;
    try {
      if (h.startsWith("#g=") || h.startsWith("#r=")) { const o = decodeHash(h.slice(1)); if (o) planView(o); else throw 0; }
      else if (h.startsWith("#s=")) savedView(decodeSaved(h.slice(3)));
      else if (h.startsWith("#plan=")) planView(b64d(h.slice(6)));
      else if (h.startsWith("#saved=")) savedView(b64d(h.slice(7)));
    } catch (e) { toast("That link didn't open. Ask for a fresh one."); }
  }
  openFromHash(); window.addEventListener("hashchange", openFromHash);
})();
