/* Micrometre (µm) grain-scale metallographic & EBSD/DIC simulation view.
   Renders exact Lloyd-relaxed vector Voronoi polycrystals (zero pixel seams),
   strictly isotropic 1:1 scaling, Nital-etched α-ferrite + lamellar pearlite colonies,
   pinned Cottrell dislocations in elastic grains, continuously sweeping ~54.7° ragged
   Lüders front (0% -> 100% across the entire FOV), animated gliding dislocations,
   heterogeneous Schmid-weighted primary & secondary slip bands, true grain elongation,
   <101> EBSD IPF rotation, KAM/GND boundary buildup, necking microvoids, and
   cryogenic Neumann twins / {001} transgranular cleavage. */
(function (root) {
  "use strict";

  const G = () => root.LudersGrainModel;
  const clock = () => root.LudersClock;

  const ui = {
    viewMode: "micrograph", // "micrograph" | "strain" | "ipf"
    mode: "synced",         // "synced" | "sandbox"
    agingOverride: null,    // null = follow current parameters
    split: false,
    seed: 4,
    piles: true,
    frontLine: true,
    zoom: 1,
    panX: 0,
    panY: 0
  };

  const cache = { key: "", model: null, off: null, offKey: "", sim: null, simKey: "" };
  let glyphs = [];
  let hoveredGlyph = -1;
  let shownStart = 0;
  let playingSandbox = false;
  let sandK = 0;
  let sandAcc = 0;
  let animTime = 0;
  let onJumpAtomic = null;

  function $(id) { return document.getElementById(id); }
  function put(id, text) { const n = $(id); if (n) n.textContent = text; }

  function themePalette() {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fb) => (cs.getPropertyValue("--" + name) || "").trim() || fb;
    return {
      isLight,
      bg: get("bg", isLight ? "#f3f1ec" : "#0e1113"),
      panel: get("panel", isLight ? "#ffffff" : "#161a1d"),
      steel: get("steel", isLight ? "#e5e9ee" : "#20262b"),
      ink: get("ink", isLight ? "#111417" : "#e8ecef"),
      mute: get("mute", isLight ? "#57606a" : "#9ba4ad"),
      line: get("line", isLight ? "#dadde2" : "#262c31"),
      line2: get("line-2", isLight ? "#bec5ce" : "#2b333b"),
      trace: get("trace", isLight ? "#c8231a" : "#ff6b5e"),
      band: get("band", isLight ? "#2347c6" : "#7f9bff"),
      badgeBg: isLight ? "rgba(255, 255, 255, 0.92)" : "rgba(14, 17, 19, 0.86)",
      badgeInk: isLight ? "#111417" : "#e8ecef",
      badgeBorder: isLight ? "rgba(17, 20, 23, 0.22)" : "rgba(232, 236, 239, 0.16)",
      hudBg: isLight ? "#faf9f6" : "#0e1113",
      thumbOutline: isLight ? "#4a535e" : "#8f9aa6",
      thumbWinFill: isLight ? "rgba(35, 71, 198, 0.26)" : "rgba(127, 155, 255, 0.45)",
      dotGlow: isLight ? "rgba(200, 35, 26, 0.22)" : "rgba(255, 107, 94, 0.25)"
    };
  }

  /* Field-of-view sizing in mm (displayed everywhere to the user in µm!). */
  function fovFor(st, aspect) {
    const rawD = (st && isFinite(st.dUm)) ? st.dUm : 25;
    let winL = 0.82;
    let dBuild = rawD;
    if (rawD >= 30) {
      winL = 1.20;
      dBuild = Math.min(120, rawD);
    } else if (rawD >= 18) {
      winL = 0.82;
      dBuild = rawD;
    } else {
      winL = Math.max(0.28, (rawD / 18) * 0.72);
      dBuild = Math.max(8, rawD * 1.15);
    }
    const asp = Math.max(0.42, Math.min(0.76, aspect || 0.56));
    const winW = +(winL * asp).toFixed(3);
    return {
      winL: +winL.toFixed(3),
      winW,
      umL: Math.round(winL * 1000),
      umW: Math.round(winW * 1000),
      dBuild: Math.round(dBuild * 10) / 10,
      trueD: rawD
    };
  }

  function effectiveAging(st) {
    if (ui.agingOverride !== null) return ui.agingOverride;
    return st ? !!st.agingOn : true;
  }

  function gapFromMacro(st) {
    if (!st || !st.flow) return 40;
    const g = st.flow.upper - st.flow.lower;
    return (!isFinite(g) || g < 20) ? 40 : g;
  }

  function keyOf(fov, aging, cPpm) {
    const cBucket = cPpm <= 2 ? 0 : Math.round(cPpm / 10) * 10;
    return `${ui.seed}:${fov.dBuild}:${fov.winL}:${fov.winW}:${aging ? 1 : 0}:${cBucket}`;
  }

  function ensureModel(st, aging, aspect) {
    const fov = fovFor(st, aspect);
    const cPpm = st && st.cPpm != null ? st.cPpm : 30;
    const key = keyOf(fov, aging, cPpm);
    if (cache.key === key && cache.model && cache.model.aging === !!aging) return { model: cache.model, fov };
    cache.model = G().build(fov.dBuild, ui.seed, !!aging, gapFromMacro(st), {
      winL: fov.winL,
      winW: fov.winW,
      cPpm,
      relaxPasses: 2
    });
    cache.key = key;
    return { model: cache.model, fov };
  }

  function ensureOff(st, aspect) {
    const fov = fovFor(st, aspect);
    const cPpm = st && st.cPpm != null ? st.cPpm : 30;
    const key = keyOf(fov, false, cPpm);
    if (cache.off && cache.offKey === key) return cache.off;
    cache.off = G().build(fov.dBuild, ui.seed, false, gapFromMacro(st), {
      winL: fov.winL,
      winW: fov.winW,
      cPpm,
      relaxPasses: 2
    });
    cache.offKey = key;
    return cache.off;
  }

  function sandbox(model, st) {
    const key = `${model.seed}:${model.dUm}:${model.W}:${model.H}:${model.aging ? 1 : 0}:${gapFromMacro(st).toFixed(1)}`;
    if (cache.sim && cache.simKey === key) return cache.sim;
    cache.sim = G().simulate(model);
    cache.simKey = key;
    sandK = 0;
    return cache.sim;
  }

  /* Compute continuous plateau sweep across the FULL width of the µm microscope window:
     0% plateau -> front enters left edge; 100% plateau -> front exits right edge (100% yielded!).
     Fixes the old sliding-camera bug that froze the front at 46% across the entire plateau. */
  function frontSweepState(st, winL, winW) {
    const L = (st && st.L0) || 50;
    const stage = st ? st.stage : "elastic";
    const e = st ? st.strain : 0;
    const ePk = st && st.ePk != null ? st.ePk : 0.0014;
    const eP1 = st && st.eP1 != null ? st.eP1 : 0.019;

    // Fixed optical microscope window on the specimen thumb
    shownStart = (stage === "necking" || stage === "fracture")
      ? Math.max(0, Math.min(L - winL, L * 0.48 - winL * 0.5))
      : Math.max(0, Math.min(L - winL, L * 0.25 - winL * 0.5));

    let plateauFrac = 0;
    if (stage === "elastic" || stage === "prebrittle") {
      plateauFrac = 0;
    } else if (stage === "upper") {
      plateauFrac = 0.03;
    } else if (stage === "drop" || stage === "luders") {
      plateauFrac = Math.max(0.03, Math.min(1, (e - ePk) / Math.max(eP1 - ePk, 1e-5)));
    } else {
      plateauFrac = 1;
    }

    // Sweep from just outside top-left to completely past bottom-right so every grain transitions
    const margin = (winW * 0.5) / G().TAN_LUDERS + 0.04;
    const localFrontMm = -margin + plateauFrac * (winL + 2 * margin);
    return { plateauFrac, localFrontMm };
  }

  // Scientific perceptual strain colormap (navy -> teal -> amber -> crimson)
  function strainColor(val, maxVal) {
    const t = Math.max(0, Math.min(1, val / Math.max(maxVal, 0.02)));
    const stops = [
      [0.00, [22, 32, 54]],
      [0.14, [27, 86, 142]],
      [0.34, [32, 152, 144]],
      [0.58, [232, 182, 68]],
      [0.82, [224, 96, 44]],
      [1.00, [196, 30, 42]]
    ];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const f = (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
        const a = stops[i - 1][1], b = stops[i][1];
        return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
      }
    }
    return "rgb(196,30,42)";
  }

  function kamColor(kamVal) {
    const t = Math.max(0, Math.min(1, kamVal / 4.5));
    if (t < 0.35) {
      const f = t / 0.35;
      return `rgba(${Math.round(35 + 25 * f)}, ${Math.round(115 + 110 * f)}, ${Math.round(215 - 40 * f)}, ${0.38 + 0.32 * f})`;
    }
    if (t < 0.7) {
      const f = (t - 0.35) / 0.35;
      return `rgba(${Math.round(60 + 185 * f)}, ${Math.round(225 - 35 * f)}, ${Math.round(175 - 125 * f)}, ${0.72 + 0.18 * f})`;
    }
    const f = (t - 0.7) / 0.3;
    return `rgba(${Math.round(245 - 20 * f)}, ${Math.round(190 - 135 * f)}, ${Math.round(50 - 15 * f)}, 0.94)`;
  }

  /* Full-frame edge-to-edge optical FOV preserving true plastic grain elongation (sx / sy = exp(1.5 * eps)). */
  function makeTransform(model, epsMean, neckQ, x, y, w, h) {
    const effEps = Math.min(0.38, epsMean * 0.95);
    const sxBase = Math.exp(effEps);
    const syBase = Math.exp(-0.5 * effEps);
    const syMin = syBase * (1 - 0.14 * neckQ);
    const scale = Math.max(w / (model.W * sxBase), h / (model.H * syMin)) * ui.zoom;
    const cx = model.W * 0.5;
    const cy = model.H * 0.5;
    const pxCenter = x + w * 0.5 + ui.panX;
    const pyCenter = y + h * 0.5 + ui.panY;

    return {
      scale,
      toScreen(mx, my) {
        let dx = mx - cx;
        let dy = my - cy;
        let sx = sxBase;
        let sy = syBase;
        if (neckQ > 0) {
          const env = Math.exp(-Math.pow(dx / (model.W * 0.32), 2));
          sx *= 1 + 0.26 * neckQ * env;
          sy *= 1 - 0.14 * neckQ * env;
        }
        return [pxCenter + dx * sx * scale, pyCenter + dy * sy * scale];
      }
    };
  }

  function tracePoly(ctx, poly, tr) {
    ctx.beginPath();
    const p0 = tr.toScreen(poly[0][0], poly[0][1]);
    ctx.moveTo(p0[0], p0[1]);
    for (let k = 1; k < poly.length; k++) {
      const pk = tr.toScreen(poly[k][0], poly[k][1]);
      ctx.lineTo(pk[0], pk[1]);
    }
    ctx.closePath();
  }

  /* Natural heterogeneous crystallographic slip bands (varying spacing, clustering,
     and line weight with Schmid factor m and local strain, NOT flat uniform stripes). */
  function drawSlipBands(ctx, cx, cy, radius, angle, strength, schmid, seed1, seed2, primaryCol, highlightCol) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const nx = -sin, ny = cos;
    const sNorm = Math.max(0, Math.min(1, (schmid - 0.34) / 0.16));
    // Sparse delicate traces on low-Schmid / early yield; denser bold packets on high-Schmid / high strain
    const nBands = Math.max(2, Math.round(2 + (4.5 + 3.5 * sNorm) * strength));
    const span = radius * 1.75;

    ctx.lineCap = "round";
    for (let k = 0; k < nBands; k++) {
      const u = (k + 0.5) / nBands - 0.5;
      // Organic micro-clustering jitter per band so grains don't look like uniform wallpaper
      const j = Math.sin(k * 2.71 + seed1 * 19.3) * 0.14 / nBands;
      const offset = (u + j) * span;
      const ox = cx + nx * offset;
      const oy = cy + ny * offset;
      const halfLen = radius * (0.72 + 0.35 * Math.abs(Math.cos(k * 1.9 + seed2 * 11)));
      const w = 0.65 + 0.72 * strength * (0.55 + 0.45 * sNorm) * (k % 2 === 0 ? 1.1 : 0.78);

      // Faint bright etched step relief beside bold slip bands
      if (highlightCol && strength > 0.35 && k % 2 === 0) {
        ctx.strokeStyle = highlightCol;
        ctx.lineWidth = w * 0.9;
        ctx.beginPath();
        ctx.moveTo(ox + nx * 0.9 - cos * halfLen, oy + ny * 0.9 - sin * halfLen);
        ctx.lineTo(ox + nx * 0.9 + cos * halfLen, oy + ny * 0.9 + sin * halfLen);
        ctx.stroke();
      }

      ctx.strokeStyle = primaryCol;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(ox - cos * halfLen, oy - sin * halfLen);
      ctx.lineTo(ox + cos * halfLen, oy + sin * halfLen);
      ctx.stroke();
    }
  }

  function drawPearliteLamellae(ctx, cx, cy, radius, angle, spacing, darkCol, lightCol, phase) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const nx = -sin, ny = cos;
    const start = -radius + ((phase || 0) * spacing);

    ctx.strokeStyle = darkCol;
    ctx.lineWidth = Math.max(1.05, spacing * 0.40);
    ctx.beginPath();
    for (let d = start; d <= radius; d += spacing) {
      const ox = cx + nx * d, oy = cy + ny * d;
      ctx.moveTo(ox - cos * radius, oy - sin * radius);
      ctx.lineTo(ox + cos * radius, oy + sin * radius);
    }
    ctx.stroke();

    if (lightCol) {
      ctx.strokeStyle = lightCol;
      ctx.lineWidth = Math.max(0.6, spacing * 0.18);
      ctx.beginPath();
      for (let d = start + spacing * 0.5; d <= radius; d += spacing) {
        const ox = cx + nx * d, oy = cy + ny * d;
        ctx.moveTo(ox - cos * radius, oy - sin * radius);
        ctx.lineTo(ox + cos * radius, oy + sin * radius);
      }
      ctx.stroke();
    }
  }

  function drawDislocationGlyph(ctx, x, y, angle, size, col, lw) {
    const c = Math.cos(angle), s = Math.sin(angle);
    ctx.strokeStyle = col;
    ctx.lineWidth = lw || 1.3;
    ctx.beginPath();
    ctx.moveTo(x - size * c, y - size * s);
    ctx.lineTo(x + size * c, y + size * s);
    ctx.moveTo(x, y);
    ctx.lineTo(x + size * 1.15 * s, y - size * 1.15 * c);
    ctx.stroke();
  }

  function drawGrainScene(ctx, model, micro, tr, pal, localFrontMm, aging, showFrontLine, st) {
    const g = model.grains;
    const n = model.n;
    const mode = ui.viewMode;
    let maxEps = 0.04;
    for (let i = 0; i < n; i++) if (micro.eps[i] > maxEps) maxEps = micro.eps[i];
    const epsCap = Math.max(0.035, maxEps * 1.05);
    const hasCN = (st && st.cPpm != null ? st.cPpm : model.cPpm) >= 4;
    const elasticStressFrac = st && st.sUy ? Math.max(0, Math.min(1, st.stress / st.sUy)) : 0;

    // 1. Exact vector Voronoi polygons with realistic Nital-etched relief, slip bands, and Cottrell markers
    for (let i = 0; i < n; i++) {
      const gr = g[i];
      const poly = gr.poly;
      if (!poly || poly.length < 3) continue;

      const yl = micro.yielded[i];
      const ep = micro.eps[i];
      const fr = micro.frontGrain[i];
      const s1 = micro.slip1[i];
      const s2 = micro.slip2[i];
      const center = tr.toScreen(gr.x, gr.y);
      const radPx = Math.max(11, gr.eqD * tr.scale * 0.92);

      let fill, sealCol;
      if (mode === "strain") {
        fill = gr.isPearlite && !yl ? "#2c313a" : strainColor(ep, epsCap);
        sealCol = fill;
      } else if (mode === "ipf") {
        if (gr.isPearlite) {
          fill = "#4c525b";
        } else {
          const rgb = ep > 0.004
            ? G().ipfRgbFromAxis(gr.ipf[0], gr.ipf[1], gr.ipf[2], ep * 1.55)
            : gr.ipfRgb;
          fill = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        }
        sealCol = fill;
      } else {
        // Nital-etched optical/SEM micrograph with subtle crystallographic surface gradient
        if (gr.isPearlite) {
          fill = "#aba69c";
          sealCol = "#969086";
        } else {
          const sh = gr.etchShade;
          let r0 = 236 * sh, g0 = 231 * sh, b0 = 221 * sh;
          if (yl) {
            // Subtle metallographic strain relief + cool steel tint (never flat cartoon blue!)
            const t = Math.min(1, 0.22 + 0.50 * s1 + 0.28 * s2);
            const mTone = 0.75 + 0.5 * Math.max(0, Math.min(1, (gr.mRaw - 0.34) / 0.16));
            const kMix = Math.min(0.42, 0.18 * t * mTone);
            r0 = r0 * (1 - kMix) + 178 * kMix;
            g0 = g0 * (1 - kMix) + 194 * kMix;
            b0 = b0 * (1 - kMix) + 224 * kMix;
          }
          const rHi = Math.min(252, Math.round(r0 + 8));
          const gHi = Math.min(250, Math.round(g0 + 7));
          const bHi = Math.min(246, Math.round(b0 + 6));
          const rLo = Math.max(0, Math.round(r0 - 11));
          const gLo = Math.max(0, Math.round(g0 - 11));
          const bLo = Math.max(0, Math.round(b0 - 10));
          const gx = Math.cos(gr.slip1Angle) * radPx * 0.75;
          const gy = Math.sin(gr.slip1Angle) * radPx * 0.75;
          const grad = ctx.createLinearGradient(center[0] - gx, center[1] - gy, center[0] + gx, center[1] + gy);
          grad.addColorStop(0, `rgb(${rHi},${gHi},${bHi})`);
          grad.addColorStop(1, `rgb(${rLo},${gLo},${bLo})`);
          fill = grad;
          sealCol = `rgb(${Math.round(r0)},${Math.round(g0)},${Math.round(b0)})`;
        }
      }

      tracePoly(ctx, poly, tr);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = sealCol;
      ctx.lineWidth = 0.85;
      ctx.stroke();

      // Clipped intragranular microstructure features
      const showPinned = mode === "micrograph" && !yl && !gr.isPearlite && hasCN && radPx > 13 && gr.rand1 < 0.72;
      const needsClip = gr.isPearlite || yl || fr || showPinned;

      if (needsClip) {
        ctx.save();
        tracePoly(ctx, poly, tr);
        ctx.clip();

        if (gr.isPearlite) {
          const lamSpace = Math.max(2.4, Math.min(4.8, tr.scale * 0.0040));
          const darkCol = mode === "strain" ? "rgba(10, 14, 22, 0.45)" : "rgba(42, 40, 38, 0.80)";
          const lightCol = mode === "strain" ? null : "rgba(232, 227, 218, 0.35)";
          drawPearliteLamellae(ctx, center[0], center[1], radPx, gr.lamAngle, lamSpace, darkCol, lightCol, gr.rand2);
        } else if (!yl && showPinned) {
          // Subtle pinned Cottrell dislocation (⊥ + crimson C/N dots) inside elastic ferrite grains
          const bow = elasticStressFrac > 0.72 ? (elasticStressFrac - 0.72) * 3.5 : 0;
          const dxP = (gr.rand2 - 0.5) * radPx * 0.45;
          const dyP = (gr.rand1 - 0.36) * radPx * 0.45;
          const px = center[0] + dxP;
          const py = center[1] + dyP;
          const cA = Math.cos(gr.slip1Angle), sA = Math.sin(gr.slip1Angle);
          // Tiny C/N Cottrell cloud dots on tensile side
          ctx.fillStyle = "rgba(180, 35, 24, 0.62)";
          ctx.beginPath();
          ctx.arc(px - 1.5 * cA - 2.3 * sA, py - 1.5 * sA + 2.3 * cA, 1.15, 0, Math.PI * 2);
          ctx.arc(px + 1.6 * cA - 2.6 * sA, py + 1.6 * sA + 2.6 * cA, 1.15, 0, Math.PI * 2);
          ctx.fill();
          drawDislocationGlyph(ctx, px + bow * cA, py + bow * sA, gr.slip1Angle, 3.1, "rgba(38, 36, 34, 0.55)", 1.15);
        } else if (yl) {
          // Soft mottled GND / dislocation-cell subgrain shading at higher work-hardening strains
          if (mode === "micrograph" && s2 > 0.08) {
            const gndRad = ctx.createRadialGradient(center[0], center[1], radPx * 0.12, center[0], center[1], radPx * 0.92);
            gndRad.addColorStop(0, "rgba(35, 58, 128, 0)");
            gndRad.addColorStop(1, `rgba(28, 44, 96, ${(0.22 * s2).toFixed(2)})`);
            ctx.fillStyle = gndRad;
            ctx.fillRect(center[0] - radPx, center[1] - radPx, radPx * 2, radPx * 2);
          }

          // Active Lüders front strain-rate glow
          if (fr && mode === "micrograph") {
            ctx.fillStyle = `rgba(218, 86, 36, ${(0.12 + 0.16 * micro.rate[i]).toFixed(2)})`;
            ctx.fillRect(center[0] - radPx, center[1] - radPx, radPx * 2, radPx * 2);
          }

          // Heterogeneous primary slip bands along grain's {110}/{112} trace angle
          if (s1 > 0.06) {
            const pCol = mode === "micrograph"
              ? `rgba(27, 50, 124, ${(0.28 + 0.44 * s1).toFixed(2)})`
              : (mode === "ipf" ? `rgba(14, 18, 26, ${(0.26 * s1).toFixed(2)})` : `rgba(14, 18, 26, ${(0.18 * s1).toFixed(2)})`);
            const hiCol = mode === "micrograph" ? `rgba(255, 255, 255, ${(0.26 * s1).toFixed(2)})` : null;
            drawSlipBands(ctx, center[0], center[1], radPx, gr.slip1Angle, s1, gr.mRaw, gr.rand1, gr.rand2, pCol, hiCol);
          }

          // Secondary / conjugate cross-slip traces activating during work hardening & necking
          if (s2 > 0.06) {
            const secCol = mode === "micrograph"
              ? `rgba(76, 40, 118, ${(0.20 + 0.42 * s2).toFixed(2)})`
              : (mode === "ipf" ? `rgba(255, 255, 255, ${(0.22 * s2).toFixed(2)})` : `rgba(255, 255, 255, ${(0.16 * s2).toFixed(2)})`);
            drawSlipBands(ctx, center[0], center[1], radPx, gr.slip2Angle, s2 * 0.9, gr.m2, gr.rand2, gr.rand1, secCol, null);
          }

          // Animated mobile blue ⊥ dislocations gliding inside active front grains
          if (fr && mode === "micrograph" && radPx > 11) {
            const cA = Math.cos(gr.slip1Angle), sA = Math.sin(gr.slip1Angle);
            const glide = (((animTime * 0.85 + gr.rand1) % 1) - 0.5) * radPx * 0.95;
            drawDislocationGlyph(ctx, center[0] + glide * cA, center[1] + glide * sA, gr.slip1Angle, 3.6, "#14b8a6", 1.5);
          }
        }
        ctx.restore();
      }
    }

    // 2. Cryogenic Neumann mechanical deformation twins (when T < DBTT)
    if (micro.twins.length) {
      for (let ti = 0; ti < micro.twins.length; ti++) {
        const tw = micro.twins[ti];
        const gr = g[tw.grain];
        if (!gr || !gr.poly || gr.poly.length < 3) continue;
        const center = tr.toScreen(gr.x, gr.y);
        const radPx = gr.eqD * tr.scale * 0.44;
        ctx.save();
        tracePoly(ctx, gr.poly, tr);
        ctx.clip();
        ctx.fillStyle = mode === "strain" ? "rgba(255, 255, 255, 0.86)" : "rgba(40, 36, 33, 0.88)";
        for (let c = 0; c < tw.count; c++) {
          const shift = (c - (tw.count - 1) * 0.5) * Math.max(4, radPx * 0.38);
          const nx = -Math.sin(tw.angle), ny = Math.cos(tw.angle);
          ctx.beginPath();
          ctx.ellipse(center[0] + nx * shift, center[1] + ny * shift, radPx, Math.max(1.5, radPx * 0.08), tw.angle, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // 3. Crisp grain boundaries + KAM/GND boundary accumulation ribbons
    const edges = model.edges;
    ctx.lineCap = "round";
    for (let ei = 0; ei < edges.length; ei++) {
      const ed = edges[ei];
      const p1 = tr.toScreen(ed.p1[0], ed.p1[1]);
      const p2 = tr.toScreen(ed.p2[0], ed.p2[1]);
      const ya = micro.yielded[ed.a], yb = micro.yielded[ed.b];

      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.strokeStyle = mode === "strain"
        ? "rgba(255, 255, 255, 0.20)"
        : (mode === "ipf" ? "rgba(18, 22, 28, 0.56)" : "rgba(44, 40, 36, 0.54)");
      ctx.lineWidth = mode === "micrograph" ? 1.05 : 0.9;
      ctx.stroke();

      if (ya || yb) {
        const edgeKam = 0.5 * (micro.kam[ed.a] + micro.kam[ed.b]) * (1.2 - 0.75 * ed.mPrime) * (ed.isFP ? 1.35 : 1.0);
        if (mode === "strain" && edgeKam > 0.7) {
          ctx.beginPath();
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
          ctx.strokeStyle = kamColor(edgeKam);
          ctx.lineWidth = Math.min(3.4, 1.3 + 0.45 * edgeKam);
          ctx.stroke();
        } else if (ya !== yb && aging && showFrontLine) {
          ctx.beginPath();
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
          ctx.strokeStyle = pal.trace;
          ctx.lineWidth = 2.2;
          ctx.stroke();
        }
      }
    }

    // 4. Theoretical ~54.7° macroscopic Lüders front guide line (only while actively sweeping across FOV)
    if (aging && showFrontLine && localFrontMm != null && localFrontMm > -0.25 * model.H && localFrontMm < model.W + 0.25 * model.H) {
      const topX = localFrontMm + (model.H * 0.5) / G().TAN_LUDERS;
      const botX = localFrontMm - (model.H * 0.5) / G().TAN_LUDERS;
      const ptTop = tr.toScreen(topX, 0);
      const ptBot = tr.toScreen(botX, model.H);
      ctx.save();
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = mode === "strain" ? "rgba(255, 255, 255, 0.74)" : "rgba(200, 35, 26, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ptTop[0], ptTop[1]);
      ctx.lineTo(ptBot[0], ptBot[1]);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Clickable dislocation pile-up trains (⊥) at blocking grain boundaries
    if (ui.piles && micro.pileups.length) {
      for (let pi = 0; pi < micro.pileups.length; pi++) {
        const pu = micro.pileups[pi];
        const bPt = tr.toScreen(pu.bx, pu.by);
        const cPt = tr.toScreen(pu.x, pu.y);
        const dx = bPt[0] - cPt[0];
        const dy = bPt[1] - cPt[1];
        const len = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / len, uy = dy / len;
        const a = Math.atan2(uy, ux);
        const ca = Math.cos(a), sa = Math.sin(a);
        const isHov = (glyphs.length === hoveredGlyph);
        glyphs.push({ x: cPt[0], y: cPt[1], bx: bPt[0], by: bPt[1], mPrime: pu.mPrime });

        if (pu.mPrime < 0.65) {
          ctx.strokeStyle = mode === "strain" ? "rgba(255, 224, 102, 0.82)" : "rgba(180, 35, 24, 0.68)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(bPt[0], bPt[1], 5.5, a - 0.85, a + 0.85);
          ctx.stroke();
        }
        if (isHov) {
          ctx.fillStyle = "rgba(35, 71, 198, 0.22)";
          ctx.beginPath();
          ctx.arc(cPt[0], cPt[1], 13, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.strokeStyle = mode === "strain" ? "#ffffff" : "#111417";
        ctx.lineWidth = 1.6;
        const offsets = [2.5, 6.8, 12.2];
        for (let k = 0; k < offsets.length; k++) {
          const px = bPt[0] - ux * offsets[k];
          const py = bPt[1] - uy * offsets[k];
          ctx.beginPath();
          ctx.moveTo(px - 4 * ca, py - 4 * sa);
          ctx.lineTo(px + 4 * ca, py + 4 * sa);
          ctx.moveTo(px, py);
          ctx.lineTo(px + 4.8 * sa, py - 4.8 * ca);
          ctx.stroke();
        }
      }
    }

    // 6. Microvoids nucleating at ferrite-pearlite interfaces & triple junctions in necking
    if (micro.voids.length) {
      for (let vi = 0; vi < micro.voids.length; vi++) {
        const v = micro.voids[vi];
        const pt = tr.toScreen(v.x, v.y);
        const rx = Math.max(1.8, v.r * tr.scale * 1.45);
        const ry = Math.max(1.2, v.r * tr.scale * 0.88);
        ctx.fillStyle = "#141312";
        ctx.beginPath();
        ctx.ellipse(pt[0], pt[1], rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
  }

  function drawIpfTriangle(ctx, x, y, size, pal) {
    const pad = 8;
    const bw = size + pad * 2 + 26;
    const bh = size + pad * 2 + 12;
    ctx.fillStyle = pal.badgeBg;
    ctx.fillRect(x, y - bh, bw, bh);
    ctx.strokeStyle = pal.badgeBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - bh + 0.5, bw - 1, bh - 1);

    const p001 = [x + pad + 10, y - pad - 4];
    const p101 = [x + pad + 10 + size, y - pad - 4];
    const p111 = [x + pad + 10 + size * 0.78, y - pad - 4 - size * 0.78];

    const steps = 16;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps - i; j++) {
        const u = (i + 0.35) / steps;
        const v = (j + 0.35) / steps;
        const w = Math.max(0, 1 - u - v);
        const mx = Math.max(w, u, v, 1e-4);
        const r = Math.round(32 + 212 * Math.pow(w / mx, 0.72));
        const gg = Math.round(36 + 198 * Math.pow(u / mx, 0.72));
        const b = Math.round(44 + 206 * Math.pow(v / mx, 0.72));
        const ax = w * p001[0] + u * p101[0] + v * p111[0];
        const ay = w * p001[1] + u * p101[1] + v * p111[1];
        ctx.fillStyle = `rgb(${r},${gg},${b})`;
        ctx.fillRect(ax - 2.2, ay - 2.2, 4.4, 4.4);
      }
    }
    ctx.strokeStyle = pal.badgeInk;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(p001[0], p001[1]);
    ctx.lineTo(p101[0], p101[1]);
    ctx.lineTo(p111[0], p111[1]);
    ctx.closePath();
    ctx.stroke();

    ctx.font = '700 9.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = pal.badgeInk;
    ctx.textAlign = "center";
    ctx.fillText("001", p001[0], p001[1] + 9);
    ctx.fillText("101", p101[0], p101[1] + 9);
    ctx.fillText("111", p111[0], p111[1] - 4);
  }

  function drawStrainColorbar(ctx, x, y, maxEps, pal) {
    const bw = 152, bh = 38;
    ctx.fillStyle = pal.badgeBg;
    ctx.fillRect(x, y - bh, bw, bh);
    ctx.strokeStyle = pal.badgeBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - bh + 0.5, bw - 1, bh - 1);

    const barX = x + 9, barY = y - 16, barW = bw - 18, barH = 8;
    for (let i = 0; i < barW; i++) {
      ctx.fillStyle = strainColor((i / barW) * maxEps, maxEps);
      ctx.fillRect(barX + i, barY, 1.5, barH);
    }
    ctx.strokeStyle = pal.badgeBorder;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = pal.badgeInk;
    ctx.textAlign = "left";
    ctx.fillText("Local εp: 0%", barX, y - 22);
    ctx.textAlign = "right";
    ctx.fillText((Math.max(0.035, maxEps) * 100).toFixed(1) + "%", barX + barW, y - 22);
  }

  function drawPanel(ctx, model, micro, x, y, w, h, titleTag, pal, localFrontMm, aging, st) {
    const tr = makeTransform(model, micro.epsMean, micro.neckQ, x, y, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.fillStyle = ui.viewMode === "strain" ? "#111622" : (pal.isLight ? "#e6e2da" : "#181d22");
    ctx.fillRect(x, y, w, h);

    if (micro.crack) {
      const gap = micro.crack.isCleavage ? 5 : 8;
      const pts = micro.crack.pts.map(p => tr.toScreen(p[0], p[1]));
      const clipHalf = left => {
        ctx.beginPath();
        ctx.moveTo(left ? x - 40 : x + w + 40, y - 30);
        for (let i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.lineTo(left ? x - 40 : x + w + 40, y + h + 30);
        ctx.closePath();
        ctx.clip();
      };
      for (const left of [true, false]) {
        ctx.save();
        ctx.translate(left ? -gap / 2 : gap / 2, 0);
        clipHalf(left);
        drawGrainScene(ctx, model, micro, tr, pal, localFrontMm, aging, ui.frontLine, st);
        ctx.restore();
      }
      ctx.strokeStyle = micro.crack.isCleavage ? "#111417" : "#2b2520";
      ctx.lineWidth = micro.crack.isCleavage ? 1.6 : 2.0;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const px = pts[i][0] + sgn * gap / 2;
          if (i === 0) ctx.moveTo(px, pts[i][1]);
          else ctx.lineTo(px, pts[i][1]);
        }
        ctx.stroke();
      }
    } else {
      drawGrainScene(ctx, model, micro, tr, pal, localFrontMm, aging, ui.frontLine, st);
    }

    const drawBox = (bx, by, bw, bh) => {
      ctx.fillStyle = pal.badgeBg;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = pal.badgeBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    };

    if (titleTag) {
      ctx.font = '600 11.5px "Segoe UI", system-ui, sans-serif';
      const tw = ctx.measureText(titleTag).width;
      drawBox(x + 10, y + 10, tw + 14, 22);
      ctx.fillStyle = pal.badgeInk;
      ctx.textAlign = "left";
      ctx.fillText(titleTag, x + 17, y + 25);
    }

    if (ui.viewMode === "ipf") {
      drawIpfTriangle(ctx, x + 10, y + h - 42, 48, pal);
    } else if (ui.viewMode === "strain") {
      let mxE = 0.035;
      for (let i = 0; i < micro.eps.length; i++) if (micro.eps[i] > mxE) mxE = micro.eps[i];
      drawStrainColorbar(ctx, x + 10, y + h - 42, mxE, pal);
    }

    const targetUm = tr.scale * 0.2 <= 150 && tr.scale * 0.2 >= 55 ? 200 : (tr.scale * 0.1 >= 45 ? 100 : 50);
    const barPx = tr.scale * (targetUm / 1000);
    drawBox(x + 10, y + h - 34, Math.max(barPx + 18, 66), 24);
    ctx.fillStyle = pal.badgeInk;
    ctx.fillRect(x + 19, y + h - 16, barPx, 3);
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(`${targetUm} µm`, x + 19, y + h - 20);

    drawBox(x + w - 114, y + h - 34, 104, 24);
    ctx.strokeStyle = pal.badgeInk;
    ctx.fillStyle = pal.badgeInk;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + w - 104, y + h - 18);
    ctx.lineTo(x + w - 24, y + h - 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w - 24, y + h - 22);
    ctx.lineTo(x + w - 16, y + h - 18);
    ctx.lineTo(x + w - 24, y + h - 14);
    ctx.closePath();
    ctx.fill();
    ctx.font = '600 10.5px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "right";
    ctx.fillText("tensile axis", x + w - 26, y + h - 23);

    ctx.restore();
    ctx.strokeStyle = pal.line2;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function drawHud(canvas, samples, cursor, title, pal) {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || 240;
    const H = canvas.clientHeight || 118;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pal.hudBg;
    ctx.fillRect(0, 0, W, H);
    if (!samples || !samples.length) return;

    let maxS = 1, maxE = 0.001;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].stress > maxS) maxS = samples[i].stress;
      if (samples[i].strain > maxE) maxE = samples[i].strain;
    }
    maxS *= 1.1;
    const L = 40, R = 10, T = 21, B = 18;
    const X = e => L + (e / maxE) * (W - L - R);
    const Y = s => T + (1 - s / maxS) * (H - T - B);

    ctx.strokeStyle = pal.line2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, T);
    ctx.lineTo(L, H - B);
    ctx.lineTo(W - R, H - B);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = pal.trace;
    ctx.lineWidth = 2;
    for (let i = 0; i < samples.length; i++) {
      const x = X(samples[i].strain), y = Y(samples[i].stress);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (cursor) {
      const cx = X(cursor.strain), cy = Y(cursor.stress);
      ctx.fillStyle = pal.dotGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.trace;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = pal.ink;
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(title || "", 8, 14);
    ctx.fillStyle = pal.mute;
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "right";
    ctx.fillText(Math.round(maxS), L - 4, T + 7);
    ctx.fillText("0", L - 4, H - B + 3);
    ctx.textAlign = "left";
    ctx.fillText("MPa", L + 4, T + 8);
    ctx.textAlign = "right";
    ctx.fillText((maxE * 100).toFixed(0) + "%", W - R, H - 4);
  }

  function drawThumb(canvas, st, winL, pal) {
    if (!canvas || !st) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || 240;
    const H = canvas.clientHeight || 46;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pal.hudBg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = pal.thumbOutline;
    ctx.fillStyle = pal.steel;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(10, H * 0.34);
    ctx.lineTo(28, H * 0.34);
    ctx.lineTo(36, H * 0.22);
    ctx.lineTo(W - 36, H * 0.22);
    ctx.lineTo(W - 28, H * 0.34);
    ctx.lineTo(W - 10, H * 0.34);
    ctx.lineTo(W - 10, H * 0.66);
    ctx.lineTo(W - 28, H * 0.66);
    ctx.lineTo(W - 36, H * 0.78);
    ctx.lineTo(36, H * 0.78);
    ctx.lineTo(28, H * 0.66);
    ctx.lineTo(10, H * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const L = st.L0 || 50;
    const x0 = 36 + (shownStart / L) * (W - 72);
    const x1 = 36 + ((shownStart + winL) / L) * (W - 72);
    ctx.fillStyle = pal.thumbWinFill;
    ctx.fillRect(x0, H * 0.22, Math.max(5, x1 - x0), H * 0.56);
    ctx.strokeStyle = pal.band;
    ctx.strokeRect(x0, H * 0.22, Math.max(5, x1 - x0), H * 0.56);

    const xf = 36 + (st.frontMm / L) * (W - 72);
    ctx.strokeStyle = pal.trace;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xf, H * 0.14);
    ctx.lineTo(xf, H * 0.86);
    ctx.stroke();
  }

  function sandboxToMicro(model, fr) {
    const n = model.n;
    const g = model.grains;
    const eps = fr.ep;
    const yielded = fr.yielded;
    const frontGrain = new Uint8Array(n);
    const rate = new Float32Array(n);
    const kam = new Float32Array(n);
    const slip1 = new Float32Array(n);
    const slip2 = new Float32Array(n);
    let epsSum = 0;

    for (let i = 0; i < n; i++) {
      epsSum += eps[i];
      if (!yielded[i]) continue;
      if (!g[i].isPearlite) {
        slip1[i] = Math.min(1, eps[i] / Math.max(model.epsL * 0.85, 0.01));
        slip2[i] = eps[i] > model.epsL * 1.15 ? Math.min(1, (eps[i] - model.epsL * 1.15) / 0.10) : 0;
      }
      if (fr.bornAt[i] >= 0 && fr.t - fr.bornAt[i] < 0.45 && fr.t - fr.bornAt[i] >= 0) {
        frontGrain[i] = 1;
        rate[i] = 0.85;
      }
      kam[i] = Math.min(4.5, 0.4 + 6 * Math.sqrt(Math.max(0, eps[i])) + (frontGrain[i] ? 0.8 : 0));
    }

    const pileups = [];
    for (let ei = 0; ei < model.edges.length; ei++) {
      const ed = model.edges[ei];
      if (yielded[ed.a] !== yielded[ed.b]) {
        const yId = yielded[ed.a] ? ed.a : ed.b;
        const uId = yielded[ed.a] ? ed.b : ed.a;
        const dxB = g[uId].x - g[yId].x, dyB = g[uId].y - g[yId].y;
        const dist = Math.max(1e-5, Math.hypot(dxB, dyB));
        pileups.push({
          x: ed.mx - (dxB / dist) * (0.22 * model.dMm),
          y: ed.my - (dyB / dist) * (0.22 * model.dMm),
          bx: ed.mx, by: ed.my,
          nx: dxB / dist, ny: dyB / dist,
          angle: g[yId].slip1Angle,
          mPrime: ed.mPrime, grainA: yId, grainB: uId,
          strength: 1 - ed.mPrime
        });
      }
    }
    return {
      yielded, frontGrain, eps, rate, kam, slip1, slip2,
      pileups: pileups.slice(0, 36), voids: [], twins: [], crack: null,
      epsMean: n ? epsSum / n : 0, neckQ: 0
    };
  }

  function updateReadouts(st, model, micro, fov, aging) {
    let nY = 0, nP = 0, maxKam = 0;
    for (let i = 0; i < model.n; i++) {
      if (micro.yielded[i]) nY++;
      if (model.grains[i].isPearlite) nP++;
      if (micro.kam[i] > maxKam) maxKam = micro.kam[i];
    }
    const frac = model.n ? Math.round((100 * nY) / model.n) : 0;
    const pPct = model.n ? Math.round((100 * nP) / model.n) : 0;
    const dl = $("grainDer");
    if (dl) {
      const dTxt = fov.trueD < 10 ? fov.trueD.toFixed(1) : Math.round(fov.trueD);
      const rows = [
        ["Stage", st.phaseName],
        ["Applied stress", Math.round(st.stress) + " MPa"],
        ["Grain size", `${dTxt} µm (${model.n} grains)`],
        ["Phases", `${100 - pPct}% α-Fe · ${pPct}% pearlite`],
        ["Yielded in FOV", `${frac}% · mean ${(micro.epsMean * 100).toFixed(2)}%`],
        ["Peak KAM / GND", maxKam.toFixed(1) + "°"],
        ["Front geometry", st.brittle ? "Cleavage (below DBTT)" : (aging ? "~54.7° inclined" : "Diffuse (no front)")],
        ["Field of view", `${fov.umL} × ${fov.umW} µm`]
      ];
      dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    }
    put("mmTitle", `Micrometre scale · ${fov.umL} × ${fov.umW} µm polycrystal`);
    put("scaleMmSub", `${fov.umL} µm`);
  }

  function draw() {
    const canvas = $("grainCanvas");
    if (!canvas || !clock() || !G()) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const st = clock().state();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = rect.width;
    const H = rect.height;
    const rw = Math.max(300, Math.round(W * dpr));
    const rh = Math.max(200, Math.round(H * dpr));
    if (canvas.width !== rw || canvas.height !== rh) {
      canvas.width = rw;
      canvas.height = rh;
    }

    const pal = themePalette();
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    glyphs = [];

    const aging = effectiveAging(st);
    const ageBtn = $("grainAging");
    if (ageBtn) ageBtn.setAttribute("aria-pressed", aging ? "true" : "false");

    const aspect = ui.split ? (H / Math.max(120, (W - 8) * 0.5)) : (H / Math.max(200, W));

    if (ui.mode === "sandbox") {
      const { model, fov } = ensureModel(st, aging, aspect);
      const sim = sandbox(model, st);
      const fr = sim.frames[Math.max(0, Math.min(sim.frames.length - 1, Math.round(sandK)))];
      const micro = sandboxToMicro(model, fr);
      drawPanel(ctx, model, micro, 0, 0, W, H, aging ? "Sandbox · C/N locking ON" : "Sandbox · locking OFF", pal, null, aging, st);
      const samples = sim.frames.map(f => ({ strain: f.strain, stress: f.stress }));
      drawHud($("grainCurve"), samples, { strain: fr.strain, stress: fr.stress }, "Sandbox stress–strain", pal);
      drawThumb($("grainThumb"), st, fov.winL, pal);
      updateReadouts({ ...st, stress: fr.stress, phaseName: "Sandbox automaton" }, model, micro, fov, aging);
      return;
    }

    const { model: modelOn, fov } = ensureModel(st, true, aspect);
    const { plateauFrac, localFrontMm } = frontSweepState(st, fov.winL, fov.winW);
    const stEval = { ...st, windowStartMm: shownStart, localFrontMm, plateauFrac };
    const frontActive = aging && !st.brittle && (st.stage === "upper" || st.stage === "drop" || st.stage === "luders");

    if (ui.split) {
      const leftMicro = G().evaluateMicroState(modelOn, stEval, true);
      const modelOff = ensureOff(st, aspect);
      const rightMicro = G().evaluateMicroState(modelOff, stEval, false);
      const gap = 8;
      const halfW = (W - gap) * 0.5;
      drawPanel(ctx, modelOn, leftMicro, 0, 0, halfW, H, "C/N locking ON (~55° front)", pal, frontActive ? localFrontMm : null, true, stEval);
      drawPanel(ctx, modelOff, rightMicro, halfW + gap, 0, halfW, H, "C/N locking OFF (diffuse)", pal, null, false, stEval);
      updateReadouts(st, modelOn, leftMicro, fov, true);
    } else {
      const modelU = aging ? modelOn : ensureOff(st, aspect);
      const microU = G().evaluateMicroState(modelU, stEval, aging);
      const modeNames = { micrograph: "Micrograph", strain: "Strain & KAM", ipf: "EBSD IPF" };
      const statusTag = st.brittle ? "below DBTT (cleavage)" : (aging ? "C/N locking ON" : "locking OFF");
      const tag = `${modeNames[ui.viewMode]} · ${statusTag}`;
      drawPanel(ctx, modelU, microU, 0, 0, W, H, tag, pal, frontActive ? localFrontMm : null, aging, stEval);
      updateReadouts(st, modelU, microU, fov, aging);
    }

    drawHud($("grainCurve"), clock().curve(), { strain: st.strain, stress: st.stress }, st.phaseName, pal);
    drawThumb($("grainThumb"), st, fov.winL, pal);
  }

  function tick(dt) {
    animTime += dt * (clock() && clock().isPlaying() ? Math.max(0.5, clock().speed() || 1) : 0.45);
    if (ui.mode === "sandbox" && playingSandbox && clock()) {
      const canvas = $("grainCanvas");
      const rect = canvas ? canvas.getBoundingClientRect() : { width: 700, height: 420 };
      const st = clock().state();
      const { model } = ensureModel(st, effectiveAging(st), rect.height / Math.max(200, rect.width));
      const sim = sandbox(model, st);
      sandAcc += dt * (clock().speed() || 1) * 18;
      if (sandAcc >= 1) {
        sandK = Math.min(sim.frames.length - 1, sandK + Math.floor(sandAcc));
        sandAcc -= Math.floor(sandAcc);
        if (sandK >= sim.frames.length - 1) playingSandbox = false;
      }
    }
  }

  function findGlyphNear(ev) {
    const canvas = $("grainCanvas");
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let best = -1, bd = 18;
    for (let i = 0; i < glyphs.length; i++) {
      const d = Math.hypot(glyphs[i].x - x, glyphs[i].y - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function syncSeg() {
    const setP = (id, on) => { const n = $(id); if (n) n.setAttribute("aria-pressed", on ? "true" : "false"); };
    setP("grainSynced", ui.mode === "synced");
    setP("grainSandbox", ui.mode === "sandbox");
    setP("grainViewMicro", ui.viewMode === "micrograph");
    setP("grainViewStrain", ui.viewMode === "strain");
    setP("grainViewIpf", ui.viewMode === "ipf");
  }

  function init(opts) {
    onJumpAtomic = opts && opts.onJumpAtomic ? opts.onJumpAtomic : null;
    const press = (id, fn) => { const n = $(id); if (n) n.addEventListener("click", fn); };
    press("grainViewMicro", () => { ui.viewMode = "micrograph"; syncSeg(); draw(); });
    press("grainViewStrain", () => { ui.viewMode = "strain"; syncSeg(); draw(); });
    press("grainViewIpf", () => { ui.viewMode = "ipf"; syncSeg(); draw(); });
    press("grainSynced", () => { ui.mode = "synced"; playingSandbox = false; syncSeg(); draw(); });
    press("grainSandbox", () => { ui.mode = "sandbox"; playingSandbox = true; sandK = 0; syncSeg(); draw(); });
    press("grainAging", () => {
      const st = clock() ? clock().state() : null;
      ui.agingOverride = !effectiveAging(st);
      cache.sim = null;
      draw();
    });
    press("grainSplit", () => {
      ui.split = !ui.split;
      const b = $("grainSplit");
      if (b) b.setAttribute("aria-pressed", ui.split ? "true" : "false");
      draw();
    });
    press("grainPiles", () => {
      ui.piles = !ui.piles;
      const b = $("grainPiles");
      if (b) b.setAttribute("aria-pressed", ui.piles ? "true" : "false");
      draw();
    });
    press("grainContour", () => {
      ui.frontLine = !ui.frontLine;
      const b = $("grainContour");
      if (b) b.setAttribute("aria-pressed", ui.frontLine ? "true" : "false");
      draw();
    });
    press("grainFit", () => { ui.zoom = 1; ui.panX = 0; ui.panY = 0; draw(); });

    const canvas = $("grainCanvas");
    if (canvas) {
      let drag = null;
      canvas.addEventListener("pointerdown", ev => {
        drag = { x: ev.clientX, y: ev.clientY, px: ui.panX, py: ui.panY };
        if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
      });
      canvas.addEventListener("pointermove", ev => {
        if (drag) {
          ui.panX = drag.px + (ev.clientX - drag.x);
          ui.panY = drag.py + (ev.clientY - drag.y);
          draw();
          return;
        }
        const hit = findGlyphNear(ev);
        if (hit !== hoveredGlyph) {
          hoveredGlyph = hit;
          canvas.style.cursor = hit >= 0 ? "pointer" : "grab";
          draw();
        }
      });
      canvas.addEventListener("pointerup", ev => {
        if (drag && Math.abs(ev.clientX - drag.x) < 5 && Math.abs(ev.clientY - drag.y) < 5) {
          if (findGlyphNear(ev) >= 0 && onJumpAtomic) onJumpAtomic();
        }
        drag = null;
      });
      canvas.addEventListener("pointercancel", () => { drag = null; });
      canvas.addEventListener("wheel", ev => {
        ev.preventDefault();
        ui.zoom *= ev.deltaY > 0 ? 0.92 : 1.08;
        ui.zoom = Math.max(0.75, Math.min(5, ui.zoom));
        draw();
      }, { passive: false });
    }
    syncSeg();
  }

  function onParamsChanged() {
    ui.agingOverride = null;
    cache.sim = null;
  }

  root.LudersGrain = { init, draw, tick, onParamsChanged };
})(typeof window !== "undefined" ? window : globalThis);
