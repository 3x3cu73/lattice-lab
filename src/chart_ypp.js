/* Dual Engineering Stress-Strain SVG chart renderer:
   1) Full tensile curve (0 -> fracture) with zoom-window box
   2) Zoomed-in Lüders Bands / Yield Region chart with tightly framed axes,
      A (σUY), B (σLY), Δσ drop bracket, band nucleation markers, C (bands united),
      Lüders strain εL bracket, pinned & custom dataset overlays, and synced scrubbing. */
(function (root) {
  "use strict";

  const YPP = () => root.LudersYPP;
  const geomMap = new WeakMap();

  function rgb(c) {
    if (!c) return [0, 0, 0];
    if (c[0] === "#") {
      const n = parseInt(c.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  }

  function rgba(c, a) {
    const [r, g, b] = rgb(c);
    return `rgba(${r},${g},${b},${a})`;
  }

  function readColors() {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fb) => (cs.getPropertyValue("--" + name) || "").trim() || fb;
    return {
      isLight,
      bg: get("bg", isLight ? "#f3f1ec" : "#0e1113"),
      ink: get("ink", isLight ? "#111417" : "#e8ecef"),
      mute: get("mute", isLight ? "#57606a" : "#9ba4ad"),
      line: get("line", isLight ? "#dadde2" : "#262c31"),
      panel: get("panel", isLight ? "#ffffff" : "#161a1d"),
      steel: get("steel", isLight ? "#e5e9ee" : "#20262b"),
      trace: get("trace", isLight ? "#c8231a" : "#ff6b5e"),
      band: get("band", isLight ? "#2347c6" : "#7f9bff"),
      amber: get("amber", isLight ? "#b4690e" : "#f5b942"),
      carbon: get("carbon", isLight ? "#b42318" : "#ff8f80"),
      ghost: get("ghost", isLight ? "#8b949e" : "#59616a")
    };
  }

  function ticksRange(minVal, maxVal, n) {
    const span = Math.max(maxVal - minVal, 1e-6);
    const raw = span / Math.max(1, n);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
    const start = Math.ceil(minVal / step - 1e-9) * step;
    const out = [];
    for (let v = start; v <= maxVal + step * 1e-6; v += step) out.push(+v.toFixed(10));
    return { step, list: out };
  }

  function esc(str) {
    return String(str || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  }

  function zoomXMaxOf(cur) {
    const st = cur.st;
    const D = cur.D;
    if (st.brittle) return Math.max(st.eF * 1.35, 0.006);
    if (st.yp) {
      const target = Math.max(0.030, st.eP1 * 1.55, st.eP1 + Math.max(0.011, 0.55 * D.eL));
      return Math.min(Math.max(st.eF * 1.03, 0.008), target);
    }
    return Math.min(Math.max(st.eF * 1.03, 0.008), 0.036);
  }

  function makePath(E, S, X, Y, xMax, strideCap) {
    let d = "";
    const stride = E.length > strideCap ? Math.ceil(E.length / (strideCap - 100)) : 1;
    let lastDrawn = -1;
    for (let i = 0; i < E.length; i += stride) {
      d += (d ? "L" : "M") + X(E[i]).toFixed(1) + " " + Y(S[i]).toFixed(1);
      lastDrawn = i;
      if (E[i] > xMax) break;
    }
    // Ensure crisp endpoint near xMax
    if (lastDrawn >= 0 && lastDrawn < E.length - 1 && E[lastDrawn] < xMax) {
      for (let j = lastDrawn + 1; j < E.length; j++) {
        d += "L" + X(E[j]).toFixed(1) + " " + Y(S[j]).toFixed(1);
        if (E[j] > xMax) break;
      }
    }
    return d;
  }

  // ---------- 1) FULL ENGINEERING STRESS-STRAIN CURVE ----------

  function draw(svg, state) {
    if (!svg || !state || !state.run) return;
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    if (!W || !H) return;

    const C = readColors();
    const cur = state.run;
    const st = cur.st;
    const pins = state.pins || [];
    const overlays = state.overlays || [];
    const nar = W < 470;
    const m = { l: nar ? 42 : 50, r: nar ? 12 : 18, t: 14, b: 32 };
    const pw = Math.max(40, W - m.l - m.r);
    const ph = Math.max(40, H - m.t - m.b);

    const pinMax = pins.length ? Math.max(...pins.map(p => p.eF || 0)) : 0;
    const ovMax = overlays.length ? Math.max(...overlays.map(o => o.eF || 0)) : 0;
    const xMax = Math.max(st.eF, pinMax, ovMax, 0.004) * 1.04;

    const inX = (E, S) => {
      let mx = 0;
      for (let i = 0; i < E.length && E[i] <= xMax; i++) if (S[i] > mx) mx = S[i];
      return mx;
    };

    const yTop = Math.max(
      inX(cur.E, cur.S),
      ...pins.map(p => inX(p.E, p.S)),
      ...overlays.map(o => inX(o.E, o.S)),
      50
    );
    const yt = ticksRange(0, yTop * 1.14, nar ? 4 : 5);
    const yLast = yt.list[yt.list.length - 1];
    const yMax = yLast >= yTop * 1.08 ? yLast : yLast + yt.step;
    if (!yt.list.includes(yMax)) yt.list.push(yMax);

    const X = e => m.l + (e / xMax) * pw;
    const Y = s => m.t + ph - (s / yMax) * ph;
    geomMap.set(svg, { kind: "full", m, pw, ph, xMax, yMin: 0, yMax, X, Y });

    const xt = ticksRange(0, xMax * 100, nar ? 4 : 6);
    const clipId = "pc-full";
    let h = `<defs><clipPath id="${clipId}"><rect x="${m.l}" y="${m.t - 6}" width="${pw + 6}" height="${ph + 6}"/></clipPath></defs><g class="ax">`;

    for (const v of yt.list) {
      h += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${C.line}"/>` +
        `<text x="${m.l - 7}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
    }
    for (const v of xt.list) {
      if (v <= xMax * 100 + 1e-9) {
        const xv = X(v / 100).toFixed(1);
        h += `<line x1="${xv}" x2="${xv}" y1="${m.t + ph}" y2="${m.t + ph + 4}" stroke="${C.mute}"/>` +
          `<text x="${xv}" y="${m.t + ph + 17}" text-anchor="middle">${+v.toFixed(2)}</text>`;
      }
    }
    h += `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${C.mute}"/>` +
      `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="${C.mute}"/>`;
    h += `<text x="${m.l + pw}" y="${H - 2}" text-anchor="end">Strain, %</text>` +
      `<text x="${m.l + 6}" y="${m.t + 11}">Stress, MPa</text></g>`;

    const band = (a, b, col, lbl, al) => {
      const x1 = X(a);
      const x2 = Math.min(X(b), m.l + pw);
      if (x2 - x1 < 1) return "";
      return `<rect x="${x1.toFixed(1)}" y="${m.t}" width="${(x2 - x1).toFixed(1)}" height="${ph}" fill="${rgba(col, al)}"/>` +
        (x2 - x1 > 76 ? `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${m.t + ph - 9}" text-anchor="middle" fill="${col}">${lbl}</text>` : "");
    };
    if (st.yp) h += band(st.ePk, st.eP1, C.band, "Lüders", C.isLight ? 0.11 : 0.14);
    if (st.eF > st.eU + 1e-6) h += band(st.eU, st.eF, C.trace, "Necking", C.isLight ? 0.06 : 0.08);

    // Subtle zoom-window highlight box linking left chart -> right zoomed Lüders chart
    const zMax = zoomXMaxOf(cur);
    if (zMax < xMax * 0.72) {
      const zx2 = Math.min(X(zMax), m.l + pw);
      h += `<rect x="${m.l + 1}" y="${m.t + 1}" width="${Math.max(8, zx2 - m.l - 1).toFixed(1)}" height="${ph - 2}" fill="none" stroke="${C.band}" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.72"/>`;
      if (zx2 - m.l > 22) {
        h += `<text x="${(zx2 + 4).toFixed(1)}" y="${m.t + 22}" fill="${C.band}" font-size="11" font-weight="600">zoom →</text>`;
      }
    }

    h += `<g clip-path="url(#${clipId})">`;
    pins.forEach(p => {
      h += `<path d="${makePath(p.E, p.S, X, Y, xMax, 1200)}" fill="none" stroke="${C.ghost}" stroke-width="1.5"/>`;
    });
    overlays.forEach(o => {
      h += `<path d="${makePath(o.E, o.S, X, Y, xMax, 1200)}" fill="none" stroke="${o.color || "#3ddc97"}" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round" opacity="0.92"/>`;
    });
    h += `<path d="${makePath(cur.E, cur.S, X, Y, xMax, 1400)}" fill="none" stroke="${C.trace}" stroke-width="2.3" stroke-linejoin="round"/>`;
    if (st.eF <= xMax) {
      h += `<line x1="${X(st.eF).toFixed(1)}" x2="${X(st.eF).toFixed(1)}" y1="${Y(st.sF).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="${C.trace}" stroke-dasharray="3 4"/>`;
    }
    h += `</g>`;

    pins.forEach(p => {
      let i = 0;
      while (i < p.E.length - 1 && p.E[i + 1] <= xMax) i++;
      h += `<text x="${(Math.min(X(p.E[i]), m.l + pw) - 4).toFixed(1)}" y="${(Y(p.S[i]) - 8).toFixed(1)}" text-anchor="end" fill="${C.mute}">${esc(p.label)}</text>`;
    });
    overlays.forEach((o, idx) => {
      let i = 0;
      while (i < o.E.length - 1 && o.E[i + 1] <= xMax) i++;
      const y = Math.max(m.t + 16 + idx * 15, Y(o.S[i]) - 10);
      h += `<text x="${(Math.min(X(o.E[i]), m.l + pw) - 4).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" fill="${o.color || "#3ddc97"}" font-weight="600">${esc(o.label)}</text>`;
    });

    const lab = (e, s, t, dx, dy, anc) => {
      if (e > xMax) return "";
      anc = anc || "start";
      const cx = X(e), cy = Y(s);
      const tx = YPP().clamp(cx + dx, m.l + 6, m.l + pw - 6);
      const ty = YPP().clamp(cy + dy, m.t + 14, m.t + ph - 6);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.3" fill="${C.ink}"/>` +
        `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anc}" font-weight="600">${t}</text>`;
    };

    if (st.yp && st.ePk < st.eF) {
      h += lab(st.ePk, st.sUY, "A", 6, -8);
      let iB = 0, sB = 1e9;
      for (let i = 0; i < cur.E.length; i++) {
        if (cur.E[i] > st.ePk && cur.E[i] <= st.eP0 + 0.0025 && cur.S[i] < sB) { sB = cur.S[i]; iB = i; }
      }
      if (iB) h += lab(cur.E[iB], sB, "B", 6, 17);
      if (st.eP1 < st.eF && (!iB || X(st.eP1) - X(cur.E[iB]) > 14)) h += lab(st.eP1, YPP().sAt(cur, st.eP1), "C", 4, 18);
    } else if (st.ePk < st.eF) {
      h += lab(st.ePk, YPP().sAt(cur, st.ePk), "Yield", 8, 20);
    }
    if (st.frac === "ductile" && st.eU <= xMax) h += lab(st.eU, st.uts, "M " + Math.round(st.uts) + " MPa", 0, -11, "middle");
    if (st.eF <= xMax) {
      const fTxt = st.brittle ? "F cleavage" : st.frac === "cleavage" ? "F cleavage" : "F";
      h += lab(st.eF, st.sF, fTxt, -7, 17, "end");
    }

    h += `<g class="mk"></g>`;
    svg.innerHTML = h;
  }

  // ---------- 2) ZOOMED-IN LÜDERS BANDS / YIELD REGION CURVE ----------

  function drawZoom(svg, state) {
    if (!svg || !state || !state.run) return;
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    if (!W || !H) return;

    const C = readColors();
    const cur = state.run;
    const st = cur.st;
    const D = cur.D;
    const pins = state.pins || [];
    const overlays = state.overlays || [];
    const nar = W < 470;
    const m = { l: nar ? 44 : 52, r: nar ? 12 : 18, t: 18, b: 32 };
    const pw = Math.max(40, W - m.l - m.r);
    const ph = Math.max(40, H - m.t - m.b);

    const xMax = zoomXMaxOf(cur);

    // Collect stress bounds inside the zoomed strain window (for crisp framing around A -> B -> C!)
    const scanInRange = (E, S) => {
      let hi = 0, lo = 1e9;
      for (let i = 0; i < E.length && E[i] <= xMax; i++) {
        if (S[i] > hi) hi = S[i];
        if (E[i] >= Math.max(st.ePk * 0.85, 0.0005) && S[i] < lo) lo = S[i];
      }
      return { hi, lo };
    };
    const rCur = scanInRange(cur.E, cur.S);
    let hiS = Math.max(rCur.hi, st.yp ? st.sUY : st.sLY, 50);
    let loS = rCur.lo < 1e8 ? rCur.lo : st.sLY;
    for (const o of overlays) {
      const rO = scanInRange(o.E, o.S);
      if (rO.hi > hiS) hiS = rO.hi;
      if (rO.lo < loS) loS = rO.lo;
    }
    for (const p of pins) {
      const rP = scanInRange(p.E, p.S);
      if (rP.hi > hiS) hiS = rP.hi;
      if (rP.lo < loS) loS = rP.lo;
    }

    // Tight Y framing around yield drop & plateau when a yield region exists (with clean bottom axis break),
    // or full 0..yMax for brittle cleavage before yield.
    let yMin = 0;
    let yMax;
    if (!st.brittle && loS > 120) {
      const spanEst = Math.max(hiS - loS, 45);
      yMin = Math.max(0, Math.floor((loS - spanEst * 0.72) / 25) * 25);
      yMax = Math.ceil((hiS + spanEst * 0.42) / 25) * 25;
      if (yMax - yMin < 100) {
        yMin = Math.max(0, yMin - 25);
        yMax += 25;
      }
    } else {
      yMin = 0;
      yMax = Math.ceil((hiS * 1.16) / 50) * 50;
    }

    const yt = ticksRange(yMin, yMax, nar ? 4 : 5);
    if (yt.list.length) {
      yMax = Math.max(yMax, yt.list[yt.list.length - 1]);
    }
    const xt = ticksRange(0, xMax * 100, nar ? 4 : 6);

    const X = e => m.l + (e / xMax) * pw;
    const Y = s => m.t + ph - ((s - yMin) / Math.max(yMax - yMin, 1)) * ph;
    geomMap.set(svg, { kind: "zoom", m, pw, ph, xMax, yMin, yMax, X, Y });

    const clipId = "pc-zoom";
    let h = `<defs><clipPath id="${clipId}"><rect x="${m.l}" y="${m.t - 4}" width="${pw + 4}" height="${ph + 4}"/></clipPath></defs><g class="ax">`;

    for (const v of yt.list) {
      if (v < yMin - 1e-6 || v > yMax + 1e-6) continue;
      const yv = Y(v).toFixed(1);
      h += `<line x1="${m.l}" x2="${m.l + pw}" y1="${yv}" y2="${yv}" stroke="${C.line}"/>` +
        `<text x="${m.l - 7}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
    }
    for (const v of xt.list) {
      if (v <= xMax * 100 + 1e-9) {
        const xv = X(v / 100).toFixed(1);
        h += `<line x1="${xv}" x2="${xv}" y1="${m.t + ph}" y2="${m.t + ph + 4}" stroke="${C.mute}"/>` +
          `<text x="${xv}" y="${m.t + ph + 17}" text-anchor="middle">${+v.toFixed(2)}</text>`;
      }
    }
    h += `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${C.mute}"/>` +
      `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="${C.mute}"/>`;

    // Subtle y-axis break indicator if yMin > 0
    if (yMin > 0) {
      const yb = m.t + ph - 7;
      h += `<path d="M${m.l - 4} ${yb + 3}L${m.l + 4} ${yb - 1}M${m.l - 4} ${yb - 1}L${m.l + 4} ${yb - 5}" stroke="${C.mute}" stroke-width="1.3" fill="none"/>`;
    }

    h += `<text x="${m.l + pw}" y="${H - 2}" text-anchor="end">Strain, % (zoomed)</text>` +
      `<text x="${m.l + 6}" y="${m.t + 11}">Stress, MPa</text></g>`;

    // Shaded Lüders plateau region (ePk -> eP1)
    if (st.yp && st.eP1 > st.ePk + 1e-6) {
      const x1 = X(st.ePk);
      const x2 = Math.min(X(st.eP1), m.l + pw);
      h += `<rect x="${x1.toFixed(1)}" y="${m.t}" width="${Math.max(1, x2 - x1).toFixed(1)}" height="${ph}" fill="${rgba(C.band, C.isLight ? 0.10 : 0.13)}"/>`;
      // Lower yield reference horizontal dashed line
      const yLY = Y(D.sLY);
      if (yLY > m.t + 8 && yLY < m.t + ph - 8) {
        h += `<line x1="${x1.toFixed(1)}" x2="${x2.toFixed(1)}" y1="${yLY.toFixed(1)}" y2="${yLY.toFixed(1)}" stroke="${C.band}" stroke-dasharray="3 4" opacity="0.55"/>`;
      }
    }

    // Curves (clipped to plot area)
    h += `<g clip-path="url(#${clipId})">`;
    pins.forEach(p => {
      h += `<path d="${makePath(p.E, p.S, X, Y, xMax, 1600)}" fill="none" stroke="${C.ghost}" stroke-width="1.5"/>`;
    });
    overlays.forEach(o => {
      h += `<path d="${makePath(o.E, o.S, X, Y, xMax, 1600)}" fill="none" stroke="${o.color || "#3ddc97"}" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round" opacity="0.92"/>`;
    });
    h += `<path d="${makePath(cur.E, cur.S, X, Y, xMax, 2000)}" fill="none" stroke="${C.trace}" stroke-width="2.4" stroke-linejoin="round"/>`;
    if (st.brittle && st.eF <= xMax) {
      h += `<line x1="${X(st.eF).toFixed(1)}" x2="${X(st.eF).toFixed(1)}" y1="${Y(st.sF).toFixed(1)}" y2="${(m.t + ph).toFixed(1)}" stroke="${C.trace}" stroke-dasharray="3 4"/>`;
    }
    h += `</g>`;

    // Detailed Lüders feature annotations: A, B, Δσ yield drop, band nucleation triangles, C, εL bracket
    const pt = (e, s, txt, dx, dy, anc, col) => {
      if (e > xMax) return "";
      const cx = X(e), cy = YPP().clamp(Y(s), m.t + 6, m.t + ph - 6);
      const tx = YPP().clamp(cx + dx, m.l + 6, m.l + pw - 6);
      const ty = YPP().clamp(cy + dy, m.t + 14, m.t + ph - 6);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.8" fill="${col || C.ink}" stroke="${C.panel}" stroke-width="1.2"/>` +
        `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anc || "start"}" font-weight="600" fill="${col || C.ink}">${txt}</text>`;
    };

    if (st.yp && st.ePk < st.eF) {
      // A: Upper yield point
      h += pt(st.ePk, st.sUY, `A  σUY ${Math.round(st.sUY)} MPa`, 8, -7, "start", C.ink);

      // Find B: lower yield floor right after drop
      let iB = 0, sB = 1e9;
      for (let i = 0; i < cur.E.length; i++) {
        if (cur.E[i] > st.ePk && cur.E[i] <= st.eP0 + 0.002 && cur.S[i] < sB) {
          sB = cur.S[i];
          iB = i;
        }
      }
      const eB = iB ? cur.E[iB] : st.eP0;
      const valB = iB ? sB : D.sLY;
      h += pt(eB, valB, `B  σLY ${Math.round(D.sLY)} MPa`, 6, 17, "start", C.ink);

      // Vertical Δσ yield-drop indicator beside A -> B
      const yA = Y(st.sUY);
      const yB = Y(D.sLY);
      const xDrop = Math.max(m.l + 8, X(st.ePk) - 10);
      let dropLabelRightX = xDrop;
      if (yB - yA > 16) {
        h += `<line x1="${xDrop.toFixed(1)}" x2="${xDrop.toFixed(1)}" y1="${yA.toFixed(1)}" y2="${yB.toFixed(1)}" stroke="${C.trace}" stroke-width="1.5"/>` +
          `<path d="M${(xDrop - 3).toFixed(1)} ${(yA + 4).toFixed(1)}L${xDrop.toFixed(1)} ${yA.toFixed(1)}L${(xDrop + 3).toFixed(1)} ${(yA + 4).toFixed(1)}" fill="none" stroke="${C.trace}" stroke-width="1.3"/>` +
          `<path d="M${(xDrop - 3).toFixed(1)} ${(yB - 4).toFixed(1)}L${xDrop.toFixed(1)} ${yB.toFixed(1)}L${(xDrop + 3).toFixed(1)} ${(yB - 4).toFixed(1)}" fill="none" stroke="${C.trace}" stroke-width="1.3"/>`;
        const yMidDrop = yA + (yB - yA) * 0.38;
        if (xDrop - m.l > 42) {
          h += `<text x="${(xDrop - 5).toFixed(1)}" y="${(yMidDrop + 4).toFixed(1)}" text-anchor="end" fill="${C.trace}" font-size="11.5" font-weight="700">Δσ ${Math.round(D.dUY)}</text>`;
        } else {
          const lx = X(st.ePk) + 10;
          dropLabelRightX = lx + 64;
          h += `<text x="${lx.toFixed(1)}" y="${(yMidDrop + 4).toFixed(1)}" text-anchor="start" fill="${C.trace}" font-size="11.5" font-weight="700">Δσ ${Math.round(D.dUY)} MPa</text>`;
        }
      }

      // Band nucleation markers (2nd, 3rd, ...) along the serrated plateau
      if (st.sched && st.sched.events) {
        const ord = ["1st", "2nd", "3rd", "4th", "5th"];
        let lastLx = dropLabelRightX - 18;
        st.sched.events.slice(0, 4).forEach((ev, idx) => {
          const eEv = st.ePk + (D.eL * ev.k) / YPP().NC;
          if (eEv > xMax || idx === 0) return;
          const sEv = YPP().sAt(cur, eEv);
          const cx = X(eEv), cy = YPP().clamp(Y(sEv) - 8, m.t + 28, m.t + ph - 30);
          h += `<path d="M${(cx - 4).toFixed(1)} ${(cy - 6).toFixed(1)}L${(cx + 4).toFixed(1)} ${(cy - 6).toFixed(1)}L${cx.toFixed(1)} ${cy.toFixed(1)}z" fill="${C.amber}"/>`;
          if (cx - lastLx > 46) {
            h += `<text x="${cx.toFixed(1)}" y="${(cy - 9).toFixed(1)}" text-anchor="middle" fill="${C.amber}" font-size="11" font-weight="600">${ord[ev.band - 1]} band</text>`;
            lastLx = cx;
          }
        });
      }

      // C: Bands united
      if (st.eP1 <= xMax) {
        const sC = YPP().sAt(cur, st.eP1);
        const ancC = X(st.eP1) > m.l + pw - 95 ? "end" : "start";
        h += pt(st.eP1, sC, "C  Bands united", ancC === "end" ? -6 : 6, 17, ancC, C.ink);
      }

      // Span bracket for Lüders strain εL (kept cleanly below the B label!)
      const x1 = X(st.ePk);
      const x2 = Math.min(X(st.eP1), m.l + pw);
      if (x2 - x1 > 34) {
        const yBr = Math.min(m.t + ph - 18, Math.max(Y(valB) + 34, Y(D.sLY) + 46));
        h += `<path d="M${x1.toFixed(1)} ${(yBr - 5).toFixed(1)}V${yBr.toFixed(1)}H${x2.toFixed(1)}V${(yBr - 5).toFixed(1)}" fill="none" stroke="${C.band}" stroke-width="1.4"/>` +
          `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${(yBr + 14).toFixed(1)}" text-anchor="middle" fill="${C.band}" font-size="11.5" font-weight="600">Lüders strain εL = ${YPP().pct(D.eL)}</text>`;
      }
    } else if (st.brittle) {
      h += pt(st.eF, st.sF, `F cleavage (${Math.round(st.sF)} MPa) · no Lüders band`, -8, 16, "end", C.trace);
    } else if (st.ePk <= xMax) {
      h += pt(st.ePk, YPP().sAt(cur, st.ePk), `Smooth yielding (~${Math.round(D.sLY)} MPa) · no yield drop`, 8, 20, "start", C.band);
    }

    h += `<g class="mk"></g>`;
    svg.innerHTML = h;
  }

  // ---------- LIVE MARKER (SHARED FOR BOTH FULL AND ZOOMED CHARTS) ----------

  function drawMarker(svg, e, s, stageLabel) {
    if (!svg) return;
    const g = svg.querySelector(".mk");
    const geom = geomMap.get(svg);
    if (!g || !geom) return;

    const C = readColors();
    const { X, Y, m, pw, ph, xMax, yMin, kind } = geom;

    if (e > xMax) {
      const y = YPP().clamp(Y(s), m.t + 26, m.t + ph - 14);
      const xr = m.l + pw;
      const msg = kind === "zoom"
        ? `Beyond zoom · ${Math.round(s)} MPa, ${YPP().pct(e)}${stageLabel ? " (" + stageLabel + ")" : ""} →`
        : `${Math.round(s)} MPa at ${YPP().pct(e)}, past range`;
      g.innerHTML =
        `<rect x="${(xr - Math.min(pw - 12, msg.length * 6.5 + 18)).toFixed(1)}" y="${(y - 12).toFixed(1)}" width="${Math.min(pw - 12, msg.length * 6.5 + 14).toFixed(1)}" height="22" rx="6" fill="${C.panel}" stroke="${C.trace}" stroke-width="1.2" opacity="0.95"/>` +
        `<text x="${(xr - 12).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="11.5" font-weight="600" fill="${C.trace}">${esc(msg)}</text>`;
      return;
    }

    if (kind === "zoom" && s < yMin) {
      const x = X(e);
      const yb = m.t + ph - 4;
      g.innerHTML =
        `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t}" y2="${(m.t + ph).toFixed(1)}" stroke="${C.ink}" stroke-dasharray="2 4" opacity=".4"/>` +
        `<path d="M${(x - 5).toFixed(1)} ${(yb - 7).toFixed(1)}L${(x + 5).toFixed(1)} ${(yb - 7).toFixed(1)}L${x.toFixed(1)} ${yb.toFixed(1)}z" fill="${C.trace}"/>` +
        `<text x="${(x + 9).toFixed(1)}" y="${(yb - 4).toFixed(1)}" text-anchor="start" font-size="11.5" font-weight="600" fill="${C.trace}">${Math.round(s)} MPa, ${YPP().pct(e)} (elastic rise)</text>`;
      return;
    }

    const x = X(e);
    const y = YPP().clamp(Y(s), m.t, m.t + ph);
    const right = x > m.l + pw - 135;
    const labelY = (kind === "full" && y < m.t + ph * 0.36)
      ? Math.min(y + 21, m.t + ph - 6)
      : Math.max(y - 11, m.t + 14);
    g.innerHTML =
      `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y.toFixed(1)}" y2="${(m.t + ph).toFixed(1)}" stroke="${C.ink}" stroke-dasharray="2 4" opacity=".52"/>` +
      `<line x1="${m.l}" x2="${x.toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${C.ink}" stroke-dasharray="2 4" opacity=".52"/>` +
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${rgba(C.trace, 0.22)}"/>` +
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.8" fill="${C.trace}" stroke="${C.panel}" stroke-width="2"/>` +
      `<text x="${(right ? x - 11 : x + 11).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${right ? "end" : "start"}" font-weight="600">${Math.round(s)} MPa, ${YPP().pct(e)}</text>`;
  }

  function strainFromClientX(svg, clientX, eF) {
    const geom = geomMap.get(svg);
    if (!svg || !geom) return null;
    const r = svg.getBoundingClientRect();
    const x = clientX - r.left;
    return YPP().clamp(((x - geom.m.l) / geom.pw) * geom.xMax, 0, eF);
  }

  root.LudersChartYPP = { draw, drawZoom, drawMarker, strainFromClientX, zoomXMaxOf };
})(typeof window !== "undefined" ? window : globalThis);
