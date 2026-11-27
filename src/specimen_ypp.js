/* Specimen in the grips Canvas renderer.
   Ported faithfully from luders-band-simulator.html with interactive gauge
   probe marker so clicking or dragging along the gauge moves the microstructure probe. */
(function (root) {
  "use strict";

  const YPP = () => root.LudersYPP;
  const BAND_COL = "#14b8a6";
  let lastHitGeom = null;

  function rgb(c) {
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

  function mix(a, b, t) {
    const A = rgb(a), B = rgb(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
  }

  function heatColor(eps, eL) {
    return eps <= Math.max(eL, 0.002) + 1e-6
      ? BAND_COL
      : mix(BAND_COL, "#c2261c", YPP().clamp((eps - 0.28) / 0.45, 0, 1));
  }

  function setup(cv) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (!W || !H) return { ctx: null, W: 0, H: 0 };
    const rw = Math.round(W * dpr);
    const rh = Math.round(H * dpr);
    if (cv.width !== rw || cv.height !== rh) {
      cv.width = rw;
      cv.height = rh;
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W, H };
  }

  function draw(cv, cur, fl, e, s, stage, probeMm) {
    if (!cv || !cur) return "";
    const { ctx, W, H } = setup(cv);
    if (!ctx || !W || !H) return "";

    const Y = YPP();
    const NC = Y.NC;
    const L0 = Y.L0;
    const SLOPE = Y.SLOPE;
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const cs = getComputedStyle(document.documentElement);
    const ink = (cs.getPropertyValue("--ink") || (isLight ? "#111417" : "#e8ecef")).trim();
    const probeCol = (cs.getPropertyValue("--amber") || (isLight ? "#b4690e" : "#f5b942")).trim();
    const arrowCol = "#2dd4bf";
    const sparkStroke = "#14b8a6";
    const sparkFillAlpha = isLight ? 0.25 : 0.34;
    const outlineCol = isLight ? "rgba(20,24,28,.68)" : "rgba(20,24,28,.55)";

    ctx.clearRect(0, 0, W, H);
    const st = cur.st;
    const D = cur.D;
    const tabL = 18, filL = 12, tabW = 20, gw = 12.5;
    const Lmax = 2 * (tabL + filL) + L0 * 1.42 + 6;
    const topPad = Y.clamp(H * 0.19, 26, 40);
    const sparkSpace = Y.clamp(H * 0.30, 44, 58);
    const k = Math.min((W - 28) / Lmax, Math.max(1.4, (H - topPad - sparkSpace) / tabW));
    const cy = topPad + (tabW * k) / 2;
    const el = s / Math.max(D.E, 1000);

    const X = [0];
    for (let i = 0; i < NC; i++) X.push(X[i] + (L0 / NC) * (1 + fl.eps[i] + el));
    const Lg = X[NC];
    const tot = 2 * (tabL + filL) + Lg;
    const gap = fl.fr ? 12 : 0;
    const x0 = (W - tot * k) / 2;
    const gx = i => x0 + (tabL + filL) * k + X[i] * k;
    const hw = i => (gw / 2 / Math.sqrt(1 + fl.eps[Math.min(i, NC - 1)] + el)) * k;
    const gEnd = gx(NC);
    const xEnd = x0 + tot * k;
    const tH = (tabW * k) / 2;
    const top = cy - (gw / 2) * k;
    const bot = cy + (gw / 2) * k;

    lastHitGeom = { gx0: gx(0), gEnd, L0, top, bot, tH, cy };

    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(x0, cy - tH);
      ctx.lineTo(x0 + tabL * k, cy - tH);
      ctx.bezierCurveTo(x0 + (tabL + filL * 0.6) * k, cy - tH, gx(0) - filL * 0.4 * k, cy - hw(0), gx(0), cy - hw(0));
      for (let i = 1; i <= NC; i++) ctx.lineTo(gx(i), cy - (hw(i - 1) + hw(i)) / 2);
      ctx.bezierCurveTo(gEnd + filL * 0.4 * k, cy - hw(NC), xEnd - (tabL + filL * 0.6) * k, cy - tH, xEnd - tabL * k, cy - tH);
      ctx.lineTo(xEnd, cy - tH);
      ctx.lineTo(xEnd, cy + tH);
      ctx.lineTo(xEnd - tabL * k, cy + tH);
      ctx.bezierCurveTo(xEnd - (tabL + filL * 0.6) * k, cy + tH, gEnd + filL * 0.4 * k, cy + hw(NC), gEnd, cy + hw(NC));
      for (let i = NC - 1; i >= 0; i--) ctx.lineTo(gx(i), cy + (hw(i) + hw(Math.max(i - 1, 0))) / 2);
      ctx.bezierCurveTo(gx(0) - filL * 0.4 * k, cy + hw(0), x0 + (tabL + filL * 0.6) * k, cy + tH, x0 + tabL * k, cy + tH);
      ctx.lineTo(x0, cy + tH);
      ctx.closePath();
    };

    const sl = SLOPE * (bot - top);
    const body = () => {
      outline();
      const gr = ctx.createLinearGradient(0, cy - tH, 0, cy + tH);
      gr.addColorStop(0, "#c9d0d6");
      gr.addColorStop(0.32, "#f5f7f8");
      gr.addColorStop(0.56, "#b7bfc6");
      gr.addColorStop(1, "#8d969e");
      ctx.fillStyle = gr;
      ctx.fill();

      ctx.save();
      outline();
      ctx.clip();
      if (fl.f > 0 && fl.f < 1 && st.yp && st.sched) {
        const w = st.sched.when;
        let a = -1;
        for (let i = 0; i <= NC; i++) {
          const on = i < NC && w[i] < fl.k;
          if (on && a < 0) a = i;
          if (!on && a >= 0) {
            const xl = a === 0 ? gx(0) - 0.4 * filL * k : gx(a);
            const xr = i === NC ? gEnd + 0.4 * filL * k : gx(i);
            const s1 = sl / 2, s2 = sl / 2;
            ctx.beginPath();
            ctx.moveTo(xl + s1, top - 30);
            ctx.lineTo(xr + s2, top - 30);
            ctx.lineTo(xr - s2, bot + 30);
            ctx.lineTo(xl - s1, bot + 30);
            ctx.closePath();
            ctx.fillStyle = rgba(BAND_COL, 0.82);
            ctx.fill();
            a = -1;
          }
        }
      } else if (fl.f >= 1) {
        for (let i = 0; i < NC; i++) {
          ctx.fillStyle = heatColor(fl.eps[i], D.eL);
          ctx.globalAlpha = 0.82;
          ctx.fillRect(gx(i) - 0.5, top - 30, gx(i + 1) - gx(i) + 1, bot - top + 60);
        }
        ctx.globalAlpha = 1;
      }
      if (fl.f > 0) {
        ctx.strokeStyle = "rgba(255,255,255,.16)";
        ctx.lineWidth = 1;
        for (let x = gx(0) - sl; x < gEnd + sl; x += 5) {
          ctx.beginPath();
          ctx.moveTo(x + sl / 2, top - 2);
          ctx.lineTo(x - sl / 2, bot + 2);
          ctx.stroke();
        }
      }
      ctx.restore();
      outline();
      ctx.strokeStyle = outlineCol;
      ctx.lineWidth = isLight ? 1.1 : 1;
      ctx.stroke();
    };

    const iCFrac = Y.clamp(Math.floor((st.xFrac / L0) * NC), 1, NC - 1);
    if (fl.fr) {
      const xc = gx(iCFrac);
      const duct = st.frac === "ductile";
      const edge = y => duct
        ? 6 * (1 - Math.abs(y - cy) / ((gw / 2) * k + 1))
        : 1.5 * Math.sin(y * 1.7);
      const clipSide = left => {
        ctx.beginPath();
        ctx.moveTo(left ? -50 : W + 50, -10);
        for (let y = -10; y <= H + 10; y += 3) ctx.lineTo(xc + edge(y), y);
        ctx.lineTo(left ? -50 : W + 50, H + 10);
        ctx.closePath();
        ctx.clip();
      };
      for (const left of [true, false]) {
        ctx.save();
        ctx.translate(left ? -gap / 2 : gap / 2, 0);
        clipSide(left);
        body();
        ctx.restore();
      }
    } else {
      body();
    }

    // Grips
    for (const [ex, dir] of [[x0 - gap / 2, 1], [xEnd + gap / 2, -1]]) {
      const gw2 = (tabL - 5) * k;
      const gl = dir > 0 ? ex - 8 : ex - gw2;
      ctx.fillStyle = "#3b434b";
      ctx.fillRect(gl, cy - tH - 8, gw2 + 8, 2 * tH + 16);
      ctx.strokeStyle = "rgba(255,255,255,.15)";
      ctx.lineWidth = 1;
      for (let yy = cy - tH - 5; yy < cy + tH + 7; yy += 5) {
        ctx.beginPath();
        ctx.moveTo(gl + 2, yy);
        ctx.lineTo(gl + gw2 + 6, yy);
        ctx.stroke();
      }
    }

    // Gauge marks, band labels, front arrows
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.fillStyle = ink;
    const off = i => fl.fr ? (i < iCFrac ? -gap / 2 : gap / 2) : 0;
    for (const i of [0, NC]) {
      const x = gx(i) + off(i === NC ? NC - 1 : 0);
      ctx.fillRect(x - 0.75, top - 11, 1.5, 7);
    }

    const ord = ["1st", "2nd", "3rd", "4th", "5th"];
    if (st.yp && st.sched && (stage === "luders" || stage === "drop")) {
      let px = -1e9, lvl = 0;
      st.sched.events
        .filter(ev => ev.k <= fl.k)
        .map(ev => ({ ev, x: Y.clamp(gx(ev.x) + 4, gx(0) + 20, gEnd - 20) }))
        .sort((a, b) => a.x - b.x)
        .forEach(({ ev, x }) => {
          lvl = x - px < 64 ? (lvl + 1) % 2 : 0;
          px = x;
          ctx.fillText(ord[ev.band - 1] + " band", x, Math.max(13, top - 16 - 13 * lvl));
        });
      ctx.fillStyle = arrowCol;
      Y.frontsNow(cur, fl).forEach(fr => {
        const x = gx(fr.pos + (fr.dir > 0 ? 1 : 0)) + sl / 2;
        ctx.beginPath();
        ctx.moveTo(x + fr.dir * 7, top - 5);
        ctx.lineTo(x, top - 9);
        ctx.lineTo(x, top - 1);
        ctx.closePath();
        ctx.fill();
      });
    } else if (st.yp && stage === "hardening" && e < st.eP1 + 0.015) {
      ctx.fillText("All Lüders bands united", (gx(0) + gEnd) / 2, Math.max(13, top - 16));
    }

    // Optional manual microstructure probe marker on the gauge
    if (probeMm != null && isFinite(probeMm)) {
      const pi = Y.clamp(Math.round((probeMm / L0) * NC), 0, NC);
      const px = gx(pi) + off(Math.min(pi, NC - 1));
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = probeCol;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px, top - 6);
      ctx.lineTo(px, bot + 6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = probeCol;
      ctx.beginPath();
      ctx.moveTo(px, top - 4);
      ctx.lineTo(px - 4.5, top - 11);
      ctx.lineTo(px + 4.5, top - 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Local strain profile sparkline beneath the specimen
    const availBottom = H - (cy + tH);
    const hh = Y.clamp(availBottom - 26, 14, 30);
    const y0 = Math.min(H - 6, cy + tH + 20 + hh);
    let maxEps = 0.04;
    for (let i = 0; i < NC; i++) if (fl.eps[i] > maxEps) maxEps = fl.eps[i];
    const mx = maxEps * 1.1;

    ctx.strokeStyle = rgba(ink, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx(0), y0);
    ctx.lineTo(gEnd, y0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(gx(0) + off(0), y0);
    for (let i = 0; i < NC; i++) {
      const xx = (gx(i) + gx(i + 1)) / 2 + off(i);
      ctx.lineTo(xx, y0 - (fl.eps[i] / mx) * hh);
    }
    ctx.lineTo(gEnd + off(NC - 1), y0);
    ctx.closePath();
    ctx.fillStyle = rgba(BAND_COL, sparkFillAlpha);
    ctx.fill();
    ctx.strokeStyle = sparkStroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "left";
    const lblY = Math.max(cy + tH + 14, y0 - hh - 4);
    ctx.fillText(gEnd - gx(0) > 290 ? "Local strain along the gauge" : "Local strain", gx(0), lblY);
    ctx.textAlign = "right";
    let peakEps = 0;
    for (let i = 0; i < NC; i++) if (fl.eps[i] > peakEps) peakEps = fl.eps[i];
    if (gEnd - gx(0) > 170) ctx.fillText("peak " + Y.pct(peakEps), gEnd, lblY);

    const nb = st.yp && st.sched ? st.sched.events.filter(ev => ev.k <= fl.k).length : 0;
    return `Gauge 50.0 → ${Lg.toFixed(1)} mm` +
      (stage === "luders" ? `, ${Math.round(fl.f * 100)}% yielded, ${nb} band${nb > 1 ? "s" : ""}`
        : st.brittle ? ", below the DBTT: no bands" : "");
  }

  function hitGauge(cv, clientX, clientY) {
    if (!cv || !lastHitGeom) return null;
    const r = cv.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const g = lastHitGeom;
    if (y < g.top - 22 || y > g.bot + 26) return null;
    if (x < g.gx0 - 16 || x > g.gEnd + 16) return null;
    const frac = YPP().clamp((x - g.gx0) / Math.max(g.gEnd - g.gx0, 1), 0, 1);
    return frac * g.L0;
  }

  root.LudersSpecimenYPP = { draw, hitGauge };
})(typeof window !== "undefined" ? window : globalThis);
