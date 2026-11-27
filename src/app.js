/* Main multiscale controller for the Lüders Band Simulator.
   Coordinates one shared simulation clock across cm (50 mm), µm (polycrystal),
   and nm (9 nm), full YPP parameters & presets, dual stress-strain + zoomed Lüders
   charts in cm, and custom dataset simulation/overlay. */
(function () {
  "use strict";

  const YPP = window.LudersYPP;
  const DS = window.LudersDatasets;
  const Chart = window.LudersChartYPP;
  const Spec = window.LudersSpecimenYPP;
  const Atomic = window.LudersAtomicYPP;
  const Grain = window.LudersGrain;
  const Clock = window.LudersClock;

  const DUR = 18; // seconds for a full 1x test
  const THEME_KEY = "luders-sim-theme";
  const SUN_SVG = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/>';
  const MOON_SVG = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';

  const state = {
    theme: "dark",        // "dark" | "light"
    scale: "cm",          // "cm" | "mm" (internal key for µm) | "nm"
    sidebarTab: "params", // "params" | "datasets"
    P: { ...YPP.BASE },
    ref: null,
    cur: null,
    u: 0.30,
    playing: false,
    speed: 1,
    pins: [],
    datasets: [],
    activeDatasetId: null,
    savedModelP: null
  };

  let rafId = 0;
  let lastT = 0;
  let toastTimer = 0;
  let lastSnap = null;

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    const el = $("toast");
    if (!el || !msg) return;
    el.textContent = msg;
    el.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove("show"), 3200);
  }

  function esc(str) {
    return String(str || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  }

  function activeDataset() {
    if (!state.activeDatasetId) return null;
    return state.datasets.find(d => d.id === state.activeDatasetId) || null;
  }

  function overlayList() {
    return state.datasets
      .filter(d => d.overlay && d.id !== state.activeDatasetId)
      .map(d => ({
        id: d.id,
        label: d.name,
        color: d.color,
        E: d.points.map(p => p.strain),
        S: d.points.map(p => p.stress),
        eF: d.metrics.eF
      }));
  }

  function stageNameOf(stage) {
    const names = {
      elastic: "Elastic",
      upper: "Upper yield",
      smooth: "Smooth yield",
      drop: "Yield drop",
      luders: "Lüders plateau",
      hardening: "Work hardening",
      necking: "Necking",
      prebrittle: "Cleavage",
      fracture: state.cur && state.cur.st.frac === "cleavage" ? "Cleavage" : "Fracture"
    };
    return names[stage] || stage;
  }

  function stageLabelOf(stage) {
    const names = {
      elastic: "Elastic",
      upper: "Upper yield A",
      smooth: "Smooth yield",
      drop: "Yield drop",
      luders: "Lüders bands",
      hardening: "Work hardening",
      necking: "Necking",
      prebrittle: "Pre-cleavage",
      fracture: state.cur && state.cur.st.frac === "cleavage" ? "Cleavage F" : "Fracture F"
    };
    return names[stage] || stage;
  }

  // ---------- recompute & parameter outputs ----------

  function recompute() {
    const ds = activeDataset();
    if (ds && ds.kind === "curve") {
      state.cur = YPP.buildCustomRun(ds, state.P);
    } else {
      state.cur = YPP.buildRun(state.P);
    }
    if (Atomic && Atomic.setRun) Atomic.setRun(state.cur);
    if (Grain && Grain.onParamsChanged) Grain.onParamsChanged();
  }

  function renderFigs() {
    const cur = state.cur;
    const ref = state.ref;
    if (!cur || !ref) return;
    const D = cur.D;
    const st = cur.st;
    const R = ref.D;
    const rs = ref.st;
    const br = st.brittle;

    const rows = [
      ["Upper yield<em> σ<sub>UY</sub></em>", st.yp && !br ? D.sUY : null, rs.yp ? R.sUY : null, "MPa", 0],
      ["Lower yield<em> σ<sub>LY</sub></em>", br ? null : D.sLY, R.sLY, "MPa", 0],
      ["Yield drop", br ? null : st.yp ? D.dUY : 0, R.dUY, "MPa", 0],
      ["Lüders strain<em> ε<sub>L</sub></em>", br ? null : D.eL * 100, R.eL * 100, "%", 2],
      ["<em>Tensile strength</em><u>UTS</u>", st.uts, rs.uts, "MPa", 0],
      ["Elongation", st.eF * 100, rs.eF * 100, "%", 1]
    ];

    const figs = $("figs");
    if (figs) {
      figs.innerHTML = rows.map(([l, v, r, un, dg]) => {
        const val = v === null ? "none" : `${v.toFixed(dg)} <small>${un}</small>`;
        let dl = "";
        if (v !== null && r !== null && Math.abs(v - r) >= (dg ? 0.5 * Math.pow(10, -dg) : 0.5)) {
          dl = `${v > r ? "+" : "−"}${Math.abs(v - r).toFixed(dg)}`;
        } else if (v === null) {
          dl = br ? "broke first" : "no yield point";
        }
        const cls = dl && v !== null && r !== null ? (v > r ? "up" : "dn") : "";
        const brTag = l === "Elongation" && st.frac === "cleavage" ? (dl ? ", brittle" : "brittle") : "";
        const note = (dl || brTag) ? `<i class="${cls}">${dl}${brTag}</i>` : "";
        return `<div class="fg"><span>${l}</span><b>${val}</b>${note}</div>`;
      }).join("");
    }

    const nb = D.nBands;
    const nf = YPP.nFronts(nb);
    const dl = [
      ["Locked C/N", Math.round(D.fLock * 100) + "%"],
      ["ρ<sub>m</sub>", YPP.sciHtml(D.rhoEff) + " m<sup>−2</sup>"],
      ["k<sub>y</sub>", D.ky.toFixed(2) + " MPa·m<sup>½</sup>"],
      ["Bands", st.yp ? `${nb}` : "none"]
    ];
    const derivedEl = $("derived");
    if (derivedEl) derivedEl.innerHTML = dl.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
  }

  function updateParamOutputs() {
    const P = state.P;
    const G = -6.6457 * Math.log10(P.d / 1000) - 3.298;
    $("oD").textContent = `${YPP.fmtD(P.d)} µm, ASTM ${G.toFixed(1)}`;
    $("oC").textContent = `${P.c} wt ppm`;
    $("oR").innerHTML = YPP.sciHtml(P.rho) + " m<sup>−2</sup>";
    $("oT").textContent = `${String(P.T - 273).replace("-", "−")} °C (${P.T} K)`;
    $("oE").innerHTML = YPP.rateHtml(P.rate);

    const eq = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30) < 0.02;
    const isCustom = !!state.activeDatasetId;
    let activePresetName = null;
    [...$("presets").children].forEach((b, i) => {
      const q = { ...YPP.BASE, ...YPP.PRESETS[i][1] };
      const match = !isCustom && Object.keys(q).every(k => eq(P[k], q[k]));
      b.setAttribute("aria-pressed", match ? "true" : "false");
      if (match) activePresetName = YPP.PRESETS[i][0];
    });

    const ds = activeDataset();
    const badge = $("sourceBadge");
    const exitBtn = $("exitDatasetBtn");
    if (badge) {
      if (ds) {
        badge.textContent = `Dataset: ${ds.name}`;
        badge.classList.add("is-dataset");
      } else {
        badge.textContent = activePresetName || `Custom (${YPP.fmtD(P.d)} µm, ${P.c} ppm, ${YPP.tC(P.T)})`;
        badge.classList.remove("is-dataset");
      }
    }
    if (exitBtn) exitBtn.hidden = !ds;
  }

  function syncSliders() {
    $("sD").value = String(YPP.sFromD(state.P.d));
    $("sC").value = String(state.P.c);
    $("sR").value = String(Math.log10(state.P.rho));
    $("sT").value = String(state.P.T);
    $("sE").value = String(Math.log10(state.P.rate));
    updateParamOutputs();
  }

  function pinLabel() {
    const ds = activeDataset();
    if (ds) return ds.name;
    const P = state.P;
    const B = YPP.BASE;
    const t = [];
    if (Math.abs(P.d - B.d) > 0.3) t.push(YPP.fmtD(P.d) + " µm");
    if (P.c !== B.c) t.push(P.c + " ppm");
    if (Math.abs(Math.log10(P.rho / B.rho)) > 0.02) t.push("ρ " + YPP.sci(P.rho));
    if (P.T !== B.T) t.push((P.T - 273) + " °C");
    if (Math.abs(Math.log10(P.rate / B.rate)) > 0.02) t.push(YPP.rateTxt(P.rate));
    return t.join(", ") || "default";
  }

  // ---------- timeline chips & stage track ----------

  function buildStageBar() {
    const cur = state.cur;
    if (!cur) return;
    const st = cur.st;

    const track = $("scrubTrack");
    if (track) {
      const segColors = [];
      const uPk = YPP.eToU(cur, st.ePk);
      const uP0 = YPP.eToU(cur, st.eP0);
      const uP1 = YPP.eToU(cur, st.eP1);
      const uU = YPP.eToU(cur, st.eU);
      const pushSeg = (cls, a, b) => {
        const w = Math.max(0, (b - a) * 100);
        if (w > 0.1) segColors.push(`<span class="seg-${cls}" style="width:${w.toFixed(2)}%"></span>`);
      };
      pushSeg("elastic", 0, uPk);
      if (st.yp) {
        pushSeg("drop", uPk, uP0);
        pushSeg("luders", uP0, uP1);
      }
      pushSeg("hardening", st.yp ? uP1 : uPk, uU);
      pushSeg("necking", uU, 1);
      track.innerHTML = segColors.join("") + `<div class="scrub-fill" id="scrubFill"></div>`;
    }

    const chips = [
      { id: "elastic", label: "Elastic", u: YPP.eToU(cur, st.ePk * 0.5), enabled: true },
      { id: "upper", label: "A UYP", u: YPP.eToU(cur, st.ePk), enabled: st.yp && !st.brittle },
      { id: "drop", label: "B LYP", u: YPP.eToU(cur, st.eP0), enabled: st.yp && !st.brittle },
      { id: "luders", label: "Plateau", u: YPP.eToU(cur, st.ePk + (st.eP1 - st.ePk) * 0.5), enabled: st.yp && !st.brittle },
      { id: "hardening", label: "C United", u: YPP.eToU(cur, st.eP1 + (st.eU - st.eP1) * 0.12), enabled: !st.brittle && st.eU > st.eP1 + 1e-5 },
      { id: "necking", label: "M UTS", u: YPP.eToU(cur, st.eU), enabled: !st.brittle && st.frac === "ductile" },
      { id: "fracture", label: "F Fracture", u: 1.0, enabled: true }
    ];

    const wrap = $("stageChips");
    if (wrap) {
      wrap.innerHTML = chips.map(c =>
        `<button type="button" class="stage-chip" data-stage="${c.id}" data-u="${c.u.toFixed(5)}" ${c.enabled ? "" : "disabled"}>${c.label}</button>`
      ).join("");
      wrap.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
          state.u = Number(btn.getAttribute("data-u")) || 0;
          $("scrub").value = String(Math.round(state.u * 1000));
          setPlaying(false);
          kick();
        });
      });
    }
  }

  function updateStageHighlight(stage, e, s) {
    const wrap = $("stageChips");
    if (wrap) {
      const mapStage = stage === "smooth" ? "hardening" : (stage === "prebrittle" ? "elastic" : stage);
      wrap.querySelectorAll("button").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-stage") === mapStage);
      });
    }
    const fill = $("scrubFill");
    if (fill) fill.style.left = (state.u * 100).toFixed(2) + "%";
    const tpS = $("tpStress");
    const tpE = $("tpStrain");
    const tpSt = $("tpStage");
    if (tpS) tpS.textContent = `${Math.round(s)} MPa`;
    if (tpE) tpE.textContent = YPP.pct(e);
    if (tpSt) {
      tpSt.textContent = stageLabelOf(stage);
      tpSt.setAttribute("data-stage", stage);
    }
  }

  // ---------- main render loop ----------

  function drawCharts() {
    const payload = {
      run: state.cur,
      pins: state.pins,
      overlays: overlayList()
    };
    Chart.draw($("chart"), payload);
    Chart.drawZoom($("zoomChart"), payload);
  }

  function updateZoomBadge(cur, e, stage) {
    const el = $("zoomBadge");
    if (!el || !cur) return;
    const zMax = Chart.zoomXMaxOf(cur);
    if (e > zMax) {
      el.textContent = `Past zoom · now ${YPP.pct(e)} (${stageLabelOf(stage)})`;
      el.className = "zoom-badge past";
    } else if (cur.st.brittle) {
      el.textContent = "Below DBTT · cleavage before yield";
      el.className = "zoom-badge past";
    } else if (cur.st.yp) {
      el.textContent = `0–${(zMax * 100).toFixed(1)}% strain · Δσ ${Math.round(cur.D.dUY)} MPa · εL ${YPP.pct(cur.D.eL)}`;
      el.className = "zoom-badge";
    } else {
      el.textContent = `0–${(zMax * 100).toFixed(1)}% strain · smooth yielding`;
      el.className = "zoom-badge";
    }
  }

  function renderAll(dt) {
    const cur = state.cur;
    if (!cur) return;
    const e = YPP.uToE(cur, state.u);
    const s = YPP.sAt(cur, e);
    const fl = YPP.field(cur, e, state.u);
    const stage = YPP.stageOf(cur, e, state.u);
    lastSnap = { run: cur, u: state.u, e, s, fl, stage };

    updateStageHighlight(stage, e, s);
    if (Atomic && Atomic.sync) Atomic.sync(e, s, stage);

    if (state.scale === "cm") {
      const stName = stageLabelOf(stage);
      Chart.drawMarker($("chart"), e, s, stName);
      Chart.drawMarker($("zoomChart"), e, s, stName);
      updateZoomBadge(cur, e, stage);
      const specInfo = Spec.draw($("spec"), cur, fl, e, s, stage, null);
      const specInfoEl = $("specInfo");
      if (specInfoEl) specInfoEl.textContent = specInfo;
      const stT = $("stTitle");
      if (stT) stT.textContent = stageNameOf(stage);
    } else if (state.scale === "mm") {
      if (Grain) {
        Grain.tick(dt);
        Grain.draw();
      }
    }
  }

  function frame(t) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    if (state.playing) {
      state.u = Math.min(1, state.u + (dt * state.speed) / DUR);
      $("scrub").value = String(Math.round(state.u * 1000));
      if (state.u >= 1) setPlaying(false);
    }
    renderAll(dt);
    const keepGoing = state.playing || state.scale === "mm";
    if (keepGoing) {
      rafId = window.requestAnimationFrame(frame);
    } else {
      rafId = 0;
      lastT = 0;
    }
  }

  function kick() {
    if (!rafId) {
      lastT = 0;
      rafId = window.requestAnimationFrame(frame);
    }
  }

  function setPlaying(p) {
    state.playing = !!p;
    const btn = $("play");
    if (btn) {
      btn.setAttribute("aria-pressed", state.playing ? "true" : "false");
      btn.setAttribute("aria-label", state.playing ? "Pause" : "Play");
    }
    const ico = $("playIco");
    if (ico) {
      ico.innerHTML = state.playing
        ? '<path d="M4 3h4v14H4zM12 3h4v14h-4z"/>'
        : '<path d="M5 3l12 7-12 7z"/>';
    }
    if (state.playing) {
      if (state.u >= 0.999) state.u = 0;
      kick();
    }
  }

  function updateModel() {
    recompute();
    renderFigs();
    updateParamOutputs();
    buildStageBar();
    drawCharts();
    renderDatasetList();
    kick();
  }

  // ---------- scale, theme & sidebar navigation ----------

  function setScale(sc) {
    if (sc === "um" || sc === "µm") sc = "mm";
    if (sc !== "cm" && sc !== "mm" && sc !== "nm") return;
    state.scale = sc;
    const appEl = $("app");
    if (appEl) appEl.setAttribute("data-scale", sc);
    $("viewCm").hidden = sc !== "cm";
    $("viewMm").hidden = sc !== "mm";
    $("viewNm").hidden = sc !== "nm";
    $("scaleCm").setAttribute("aria-selected", sc === "cm" ? "true" : "false");
    $("scaleMm").setAttribute("aria-selected", sc === "mm" ? "true" : "false");
    $("scaleNm").setAttribute("aria-selected", sc === "nm" ? "true" : "false");

    if (Atomic && Atomic.setVisible) Atomic.setVisible(sc === "nm");

    window.requestAnimationFrame(() => {
      if (sc === "cm") drawCharts();
      kick();
    });
  }

  function setSidebarTab(tab) {
    state.sidebarTab = tab;
    $("tabParams").setAttribute("aria-pressed", tab === "params" ? "true" : "false");
    $("tabDatasets").setAttribute("aria-pressed", tab === "datasets" ? "true" : "false");
    $("paneParams").hidden = tab !== "params";
    $("paneDatasets").hidden = tab !== "datasets";
  }

  function setSidebarCollapsed(collapsed) {
    const app = $("app");
    if (!app) return;
    app.classList.toggle("sidebar-collapsed", !!collapsed);
    const btn = $("sidebarToggle");
    if (btn) btn.setAttribute("aria-pressed", collapsed ? "false" : "true");
    window.requestAnimationFrame(() => {
      if (state.scale === "cm") drawCharts();
      kick();
    });
  }

  function applyTheme(theme, persist) {
    const next = theme === "light" ? "light" : "dark";
    state.theme = next;
    document.documentElement.setAttribute("data-theme", next);
    if (persist) {
      try { window.localStorage.setItem(THEME_KEY, next); } catch (e) {}
    }
    const btn = $("themeToggle");
    const ico = $("themeIcon");
    const lbl = $("themeLabel");
    const isLight = next === "light";
    if (btn) {
      btn.setAttribute("aria-pressed", isLight ? "true" : "false");
      btn.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
    }
    if (ico) ico.innerHTML = isLight ? MOON_SVG : SUN_SVG;
    if (lbl) lbl.textContent = isLight ? "Dark" : "Light";

    if (DS && DS.colorForIndex) {
      state.datasets.forEach(d => {
        if (d.colorIdx != null) d.color = DS.colorForIndex(d.colorIdx, next);
      });
    }

    if (state.cur) {
      drawCharts();
      const e = YPP.uToE(state.cur, state.u);
      const s = YPP.sAt(state.cur, e);
      const stName = stageLabelOf(YPP.stageOf(state.cur, e, state.u));
      Chart.drawMarker($("chart"), e, s, stName);
      Chart.drawMarker($("zoomChart"), e, s, stName);
      renderDatasetList();
      if (state.scale === "mm" && Grain) Grain.draw();
      if (Atomic && Atomic.redraw) Atomic.redraw();
      kick();
    }
  }

  function toggleTheme() {
    applyTheme(state.theme === "light" ? "dark" : "light", true);
  }

  // ---------- custom datasets ----------

  function syncDatasetBadges() {
    const n = state.datasets.length;
    const b1 = $("dsCountBadge");
    const b2 = $("tabDsCount");
    if (b1) { b1.textContent = String(n); b1.hidden = n === 0; }
    if (b2) { b2.textContent = String(n); b2.hidden = n === 0; }
    const banner = $("activeDsBanner");
    const ds = activeDataset();
    if (banner) {
      banner.hidden = !ds;
      if (ds) {
        const nameEl = $("activeDsName");
        if (nameEl) nameEl.textContent = ds.name;
      }
    }
  }

  function renderDatasetList() {
    syncDatasetBadges();
    const listEl = $("dsList");
    if (!listEl) return;
    if (!state.datasets.length) {
      listEl.innerHTML = `<div class="ds-empty">No datasets yet.</div>`;
      return;
    }

    const baseModelRun = state.activeDatasetId ? YPP.buildRun(state.P) : state.cur;

    listEl.innerHTML = state.datasets.map(d => {
      const m = d.metrics;
      const isActive = d.id === state.activeDatasetId;
      const cmp = (!isActive && d.overlay && baseModelRun) ? DS.compareToRun(d, baseModelRun) : null;
      const metaChips = [
        `E ${Math.round(m.E / 1000)} GPa`,
        m.hasDrop ? `σUY ${Math.round(m.sUY)}` : `Smooth`,
        `σLY ${Math.round(m.sLY)}`,
        m.hasDrop ? `εL ${(m.eL * 100).toFixed(2)}%` : null,
        `UTS ${Math.round(m.uts)}`,
        `εf ${(m.eF * 100).toFixed(1)}%`
      ].filter(Boolean).map(t => `<span>${t}</span>`).join("");

      const cmpHtml = cmp
        ? `<div class="ds-cmp">
             <b>Overlay vs current model:</b>
             <span>RMS ${cmp.rms.toFixed(1)} MPa</span>
             ${cmp.dUYP !== null ? `<span>ΔUYP ${cmp.dUYP >= 0 ? "+" : ""}${Math.round(cmp.dUYP)}</span>` : ""}
             <span>ΔLYP ${cmp.dLYP >= 0 ? "+" : ""}${Math.round(cmp.dLYP)}</span>
             <span>ΔUTS ${cmp.dUTS >= 0 ? "+" : ""}${Math.round(cmp.dUTS)}</span>
             <span>Δεf ${cmp.dEF >= 0 ? "+" : ""}${cmp.dEF.toFixed(1)}%</span>
           </div>`
        : "";

      return `<div class="ds-card ${isActive ? "is-sim" : ""}" data-id="${d.id}">
        <div class="ds-head">
          <span class="ds-swatch" style="background:${d.color}"></span>
          <strong class="ds-name" title="${esc(d.name)}">${esc(d.name)}</strong>
          <span class="ds-pts">${d.kind === "params" ? "Params" : d.points.length.toLocaleString() + " pts"}</span>
          <button type="button" class="ds-del" data-act="del" title="Remove dataset" aria-label="Remove ${esc(d.name)}">×</button>
        </div>
        <div class="ds-metrics">${metaChips}</div>
        <div class="ds-actions">
          <button type="button" class="ds-btn ${isActive ? "sim-on" : ""}" data-act="sim" aria-pressed="${isActive ? "true" : "false"}">${isActive ? "Simulating" : "Simulate dataset"}</button>
          <button type="button" class="ds-btn ${d.overlay && !isActive ? "ov-on" : ""}" data-act="overlay" aria-pressed="${d.overlay ? "true" : "false"}" ${isActive ? "disabled" : ""}>Overlay</button>
        </div>
        ${cmpHtml}
      </div>`;
    }).join("");

    listEl.querySelectorAll(".ds-card").forEach(card => {
      const id = card.getAttribute("data-id");
      card.querySelectorAll("button[data-act]").forEach(btn => {
        btn.addEventListener("click", () => {
          const act = btn.getAttribute("data-act");
          if (act === "del") deleteDataset(id);
          else if (act === "sim") toggleSimulateDataset(id);
          else if (act === "overlay") toggleOverlayDataset(id);
        });
      });
    });
  }

  function addParsedDataset(text, fallbackName, mode) {
    const parsed = DS.parsePoints(text);
    if (!parsed) {
      toast("Could not parse dataset. Provide at least 3 rows of (strain, stress) in CSV, TSV, or JSON.");
      return null;
    }
    let ds;
    if (parsed.kind === "params") {
      ds = DS.createParamDataset(parsed.name || fallbackName || "Imported parameters", parsed.params);
    } else {
      ds = DS.createCurveDataset(parsed.name || fallbackName || "Uploaded curve", parsed.points);
    }
    if (mode === "overlay") {
      ds.overlay = true;
      state.datasets.unshift(ds);
      drawCharts();
      renderDatasetList();
      toast(`Added “${ds.name}” (${ds.points.length} pts) as overlay.`);
    } else {
      ds.overlay = true;
      state.datasets.unshift(ds);
      activateDataset(ds.id);
      toast(`Simulating “${ds.name}” (${ds.points.length} pts)${ds.metrics.hasDrop ? ` · σUY ${Math.round(ds.metrics.sUY)} MPa, εL ${(ds.metrics.eL * 100).toFixed(2)}%` : " · smooth yielding"}.`);
    }
    return ds;
  }

  function activateDataset(id) {
    const ds = state.datasets.find(d => d.id === id);
    if (!ds) return;
    if (ds.kind === "params") {
      state.activeDatasetId = null;
      state.savedModelP = null;
      state.P = { ...YPP.BASE, ...ds.params };
      syncSliders();
      updateModel();
      toast(`Applied parameter dataset “${ds.name}”.`);
      return;
    }
    if (!state.activeDatasetId) {
      state.savedModelP = { ...state.P };
    }
    state.activeDatasetId = ds.id;
    state.P = { ...YPP.BASE, ...ds.inferredParams };
    syncSliders();
    state.u = Math.min(state.u, 0.99);
    updateModel();
  }

  function exitDatasetMode(silent) {
    if (!state.activeDatasetId) return;
    state.activeDatasetId = null;
    if (state.savedModelP) {
      state.P = { ...state.savedModelP };
      state.savedModelP = null;
      syncSliders();
    }
    updateModel();
    if (!silent) toast("Returned to parametric YPP model.");
  }

  function toggleSimulateDataset(id) {
    if (state.activeDatasetId === id) {
      exitDatasetMode(false);
    } else {
      activateDataset(id);
    }
  }

  function toggleOverlayDataset(id) {
    const ds = state.datasets.find(d => d.id === id);
    if (!ds) return;
    ds.overlay = !ds.overlay;
    drawCharts();
    renderDatasetList();
    kick();
  }

  function deleteDataset(id) {
    const wasActive = state.activeDatasetId === id;
    state.datasets = state.datasets.filter(d => d.id !== id);
    if (wasActive) {
      exitDatasetMode(true);
    } else {
      drawCharts();
      renderDatasetList();
      kick();
    }
  }

  function handleFiles(files, mode) {
    if (!files || !files.length) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      addParsedDataset(String(reader.result || ""), file.name, mode || "simulate");
    };
    reader.readAsText(file);
  }

  function loadSampleCsv() {
    fetch("data/synthetic_lab_curve.csv")
      .then(res => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(text => {
        const existing = state.datasets.find(d => d.name === "synthetic_lab_curve.csv");
        if (existing) {
          activateDataset(existing.id);
          return;
        }
        addParsedDataset(text, "synthetic_lab_curve.csv", "simulate");
      })
      .catch(err => {
        toast("Could not load data/synthetic_lab_curve.csv (" + err.message + ").");
      });
  }

  function exportActiveCsv() {
    if (!state.cur) return;
    const csv = DS.runToCsv(state.cur);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = pinLabel().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "luders_curve";
    a.href = url;
    a.download = slug + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Exported " + slug + ".csv (" + state.cur.E.length + " points).");
  }

  // ---------- event wiring ----------

  function onParamTouched() {
    if (state.activeDatasetId) {
      state.activeDatasetId = null;
      state.savedModelP = null;
      toast("Switched to parametric model (dataset kept in list).");
    }
    updateModel();
  }

  function wireScrubSvg(containerEl, svgEl) {
    if (!containerEl || !svgEl) return;
    let dragging = false;
    const doScrub = ev => {
      if (!state.cur) return;
      const e = Chart.strainFromClientX(svgEl, ev.clientX, state.cur.st.eF);
      if (e == null) return;
      state.u = YPP.eToU(state.cur, e);
      $("scrub").value = String(Math.round(state.u * 1000));
      setPlaying(false);
      kick();
    };
    containerEl.addEventListener("pointerdown", ev => {
      dragging = true;
      containerEl.setPointerCapture(ev.pointerId);
      doScrub(ev);
    });
    containerEl.addEventListener("pointermove", ev => { if (dragging) doScrub(ev); });
    containerEl.addEventListener("pointerup", () => { dragging = false; });
    containerEl.addEventListener("pointercancel", () => { dragging = false; });
  }

  function wire() {
    $("scaleCm").addEventListener("click", () => setScale("cm"));
    $("scaleMm").addEventListener("click", () => setScale("mm"));
    $("scaleNm").addEventListener("click", () => setScale("nm"));

    $("openDatasetsBtn").addEventListener("click", () => {
      setSidebarCollapsed(false);
      setSidebarTab("datasets");
    });
    $("sidebarToggle").addEventListener("click", () => {
      const collapsed = $("app").classList.contains("sidebar-collapsed");
      setSidebarCollapsed(!collapsed);
    });
    if ($("themeToggle")) $("themeToggle").addEventListener("click", toggleTheme);
    $("exitDatasetBtn").addEventListener("click", () => exitDatasetMode(false));

    const dlg = $("modelDialog");
    if ($("openModelBtn") && dlg) {
      $("openModelBtn").addEventListener("click", () => {
        if (typeof dlg.showModal === "function") dlg.showModal();
        else dlg.setAttribute("open", "");
      });
      $("closeModelBtn").addEventListener("click", () => {
        if (typeof dlg.close === "function") dlg.close();
        else dlg.removeAttribute("open");
      });
      dlg.addEventListener("click", ev => {
        if (ev.target === dlg && typeof dlg.close === "function") dlg.close();
      });
    }

    $("tabParams").addEventListener("click", () => setSidebarTab("params"));
    $("tabDatasets").addEventListener("click", () => setSidebarTab("datasets"));
    if ($("backParams")) $("backParams").addEventListener("click", () => setSidebarTab("params"));

    const presetsEl = $("presets");
    presetsEl.innerHTML = YPP.PRESETS.map(p => `<button type="button">${p[0]}</button>`).join("");
    [...presetsEl.children].forEach((b, i) => {
      b.addEventListener("click", () => {
        state.activeDatasetId = null;
        state.savedModelP = null;
        state.P = { ...YPP.BASE, ...YPP.PRESETS[i][1] };
        syncSliders();
        updateModel();
      });
    });

    $("reset").addEventListener("click", () => {
      state.activeDatasetId = null;
      state.savedModelP = null;
      state.P = { ...YPP.BASE };
      syncSliders();
      updateModel();
    });

    $("sD").addEventListener("input", ev => { state.P.d = YPP.dFromS(+ev.target.value); onParamTouched(); });
    $("sC").addEventListener("input", ev => { state.P.c = +ev.target.value; onParamTouched(); });
    $("sR").addEventListener("input", ev => { state.P.rho = Math.pow(10, +ev.target.value); onParamTouched(); });
    $("sT").addEventListener("input", ev => { state.P.T = +ev.target.value; onParamTouched(); });
    $("sE").addEventListener("input", ev => { state.P.rate = Math.pow(10, +ev.target.value); onParamTouched(); });

    $("pin").addEventListener("click", () => {
      if (!state.cur) return;
      state.pins.push({
        E: state.cur.E.slice(),
        S: state.cur.S.slice(),
        eF: state.cur.st.eF,
        label: pinLabel()
      });
      if (state.pins.length > 4) state.pins.shift();
      $("clear").hidden = false;
      drawCharts();
      kick();
    });
    $("clear").addEventListener("click", () => {
      state.pins = [];
      $("clear").hidden = true;
      drawCharts();
      kick();
    });

    // Interactive pointer scrubbing on BOTH full and zoomed Lüders charts
    wireScrubSvg($("chartF"), $("chart"));
    wireScrubSvg($("zoomChartF"), $("zoomChart"));

    $("play").addEventListener("click", () => setPlaying(!state.playing));
    $("scrub").addEventListener("input", ev => {
      state.u = +ev.target.value / 1000;
      setPlaying(false);
      kick();
    });
    $("speedGroup").querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        state.speed = Number(btn.getAttribute("data-speed")) || 1;
        $("speedGroup").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      });
    });

    $("backToModelBtn").addEventListener("click", () => exitDatasetMode(false));
    $("dsLoadSample").addEventListener("click", loadSampleCsv);
    $("dsExportCsv").addEventListener("click", exportActiveCsv);

    const fileInput = $("dsFileInput");
    fileInput.addEventListener("change", () => {
      handleFiles(fileInput.files, "simulate");
      fileInput.value = "";
    });

    const dz = $("dsDropzone");
    dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("drag-over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
    dz.addEventListener("drop", ev => {
      ev.preventDefault();
      dz.classList.remove("drag-over");
      if (ev.dataTransfer && ev.dataTransfer.files) handleFiles(ev.dataTransfer.files, "simulate");
    });

    $("dsPasteSim").addEventListener("click", () => {
      const txt = $("dsPasteText").value;
      const name = $("dsPasteName").value.trim() || ("Pasted dataset #" + (state.datasets.length + 1));
      if (addParsedDataset(txt, name, "simulate")) {
        $("dsPasteText").value = "";
        $("dsPasteName").value = "";
      }
    });
    $("dsPasteOverlay").addEventListener("click", () => {
      const txt = $("dsPasteText").value;
      const name = $("dsPasteName").value.trim() || ("Pasted dataset #" + (state.datasets.length + 1));
      if (addParsedDataset(txt, name, "overlay")) {
        $("dsPasteText").value = "";
        $("dsPasteName").value = "";
      }
    });

    $("dsSaveParam").addEventListener("click", () => {
      const name = $("dsParamName").value.trim() || pinLabel();
      const ds = DS.createParamDataset(name, state.P);
      ds.overlay = true;
      state.datasets.unshift(ds);
      $("dsParamName").value = "";
      drawCharts();
      renderDatasetList();
      toast(`Saved parameter snapshot “${ds.name}”.`);
    });

    document.addEventListener("keydown", ev => {
      const tag = ev.target && ev.target.tagName;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (typing && ev.target.type !== "range") return;
      if (ev.code === "Space") {
        if (tag === "BUTTON") ev.target.blur();
        ev.preventDefault();
        setPlaying(!state.playing);
        return;
      }
      if (typing) return;
      const k = ev.key.toLowerCase();
      if (k === "1") setScale("cm");
      else if (k === "2") setScale("mm");
      else if (k === "3") setScale("nm");
      else if (k === "t") toggleTheme();
      else if (k === "h") setSidebarCollapsed(!$("app").classList.contains("sidebar-collapsed"));
      else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        state.u = YPP.clamp(state.u + (ev.shiftKey ? 0.05 : 0.01), 0, 1);
        $("scrub").value = String(Math.round(state.u * 1000));
        setPlaying(false);
        kick();
      } else if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        state.u = YPP.clamp(state.u - (ev.shiftKey ? 0.05 : 0.01), 0, 1);
        $("scrub").value = String(Math.round(state.u * 1000));
        setPlaying(false);
        kick();
      } else if (ev.key === "Home") {
        ev.preventDefault();
        state.u = 0;
        $("scrub").value = "0";
        setPlaying(false);
        kick();
      } else if (ev.key === "End") {
        ev.preventDefault();
        state.u = 1;
        $("scrub").value = "1000";
        setPlaying(false);
        kick();
      }
    });

    const roCharts = new ResizeObserver(() => {
      if (state.scale === "cm") {
        drawCharts();
        kick();
      }
    });
    roCharts.observe($("chartF"));
    roCharts.observe($("zoomChartF"));

    const roCanvases = new ResizeObserver(() => kick());
    roCanvases.observe($("spec"));
    if ($("grainCanvas")) roCanvases.observe($("grainCanvas"));
  }

  function boot() {
    state.ref = YPP.buildRun(YPP.BASE);

    Clock.attach({
      getSnapshot: () => lastSnap,
      togglePlay: () => { setPlaying(!state.playing); return state.playing; },
      setPlaying: on => setPlaying(on),
      isPlaying: () => state.playing,
      getSpeed: () => state.speed
    });

    if (Atomic && Atomic.init) Atomic.init();
    if (Grain && Grain.init) {
      Grain.init({
        onJumpAtomic: () => {
          setScale("nm");
          toast("Zoomed to 9 nm atomic lattice at the grain boundary.");
        }
      });
    }

    wire();
    applyTheme("dark", false);
    syncSliders();
    $("scrub").value = String(Math.round(state.u * 1000));
    updateModel();
    setScale("cm");
  }

  window.LudersApp = {
    setScale,
    setSidebarTab,
    applyTheme,
    toggleTheme,
    loadSampleCsv,
    addParsedDataset,
    getState: () => ({
      theme: state.theme,
      scale: state.scale,
      u: state.u,
      playing: state.playing,
      P: { ...state.P },
      activeDatasetId: state.activeDatasetId,
      datasets: state.datasets.length,
      stage: lastSnap ? lastSnap.stage : null
    })
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
