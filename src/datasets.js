/* Custom user dataset parsing, feature extraction, simulation inference,
   overlay comparison metrics, and CSV export. */
(function (root) {
  "use strict";

  const OVERLAY_PALETTE_DARK = [
    "#3ddc97",
    "#f5b942",
    "#c084fc",
    "#38bdf8",
    "#fb7185"
  ];

  const OVERLAY_PALETTE_LIGHT = [
    "#0d8a5f",
    "#c46d00",
    "#7c3aed",
    "#0284c7",
    "#d61f52"
  ];

  function colorForIndex(idx, theme) {
    const isLight = theme ? theme === "light" : (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light");
    const pal = isLight ? OVERLAY_PALETTE_LIGHT : OVERLAY_PALETTE_DARK;
    return pal[((idx % pal.length) + pal.length) % pal.length];
  }

  let nextId = 1;

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
  }

  function detectColumnsFromHeader(parts) {
    let eCol = -1, sCol = -1;
    for (let i = 0; i < parts.length; i++) {
      const h = parts[i].toLowerCase().trim();
      if (eCol < 0 && /(strain|eps|elong|ext)/.test(h) && !/rate/.test(h)) eCol = i;
      if (sCol < 0 && /(stress|sig|mpa|load|strength)/.test(h)) sCol = i;
    }
    if (eCol >= 0 && sCol >= 0 && eCol !== sCol) return { eCol, sCol };
    return null;
  }

  function parsePoints(text) {
    const raw = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!raw) return null;

    // Try JSON first if it begins with { or [
    if (raw[0] === "{" || raw[0] === "[") {
      try {
        const obj = JSON.parse(raw);
        if (obj && !Array.isArray(obj) && obj.params && typeof obj.params === "object" && !obj.points && !obj.E) {
          return { kind: "params", name: obj.name || "Imported parameters", params: obj.params };
        }
        let pts = [];
        if (Array.isArray(obj)) {
          for (const row of obj) {
            if (Array.isArray(row) && row.length >= 2) {
              const e = Number(row[0]), s = Number(row[1]);
              if (isFinite(e) && isFinite(s)) pts.push({ strain: e, stress: s });
            } else if (row && typeof row === "object") {
              const e = Number(row.strain ?? row.eps ?? row.e ?? row.x);
              const s = Number(row.stress ?? row.sig ?? row.sigma ?? row.s ?? row.y);
              if (isFinite(e) && isFinite(s)) pts.push({ strain: e, stress: s });
            }
          }
        } else if (obj && Array.isArray(obj.points)) {
          return parsePoints(JSON.stringify(obj.points));
        } else if (obj && Array.isArray(obj.E) && Array.isArray(obj.S)) {
          const n = Math.min(obj.E.length, obj.S.length);
          for (let i = 0; i < n; i++) {
            const e = Number(obj.E[i]), s = Number(obj.S[i]);
            if (isFinite(e) && isFinite(s)) pts.push({ strain: e, stress: s });
          }
        }
        if (pts.length >= 3) {
          return { kind: "curve", points: normalizePoints(pts), name: (obj && obj.name) || null };
        }
      } catch (e) {
        // Fall through to delimited parser
      }
    }

    const lines = raw.split(/\r?\n/);
    let eCol = 0, sCol = 1;
    let headerChecked = false;
    const pts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line[0] === "#") continue;
      let parts = line.split(/[,\t;]+/).map(x => x.trim()).filter(Boolean);
      if (parts.length < 2) parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      const n0 = Number(parts[0]);
      const n1 = Number(parts[1]);
      if (!headerChecked && (!isFinite(n0) || !isFinite(n1))) {
        headerChecked = true;
        const cols = detectColumnsFromHeader(parts);
        if (cols) { eCol = cols.eCol; sCol = cols.sCol; }
        continue;
      }
      headerChecked = true;
      if (parts.length <= Math.max(eCol, sCol)) continue;
      const a = Number(parts[eCol]);
      const b = Number(parts[sCol]);
      if (!isFinite(a) || !isFinite(b)) continue;
      pts.push({ strain: a, stress: b });
    }

    if (pts.length < 3) return null;
    return { kind: "curve", points: normalizePoints(pts) };
  }

  function normalizePoints(pts) {
    const out = pts.map(p => ({ strain: p.strain, stress: p.stress }));
    // Swap if column 0 looks like stress (MPa) and column 1 looks like strain
    const medE = median(out.map(p => p.strain));
    const medS = median(out.map(p => p.stress));
    if (medE > 30 && medS < 5) {
      for (const p of out) {
        const tmp = p.strain;
        p.strain = p.stress;
        p.stress = tmp;
      }
    }
    // Auto-convert percentage strain to fraction if max strain > 1.5
    let maxE = 0;
    for (const p of out) if (p.strain > maxE) maxE = p.strain;
    const wasPercent = maxE > 1.5;
    if (wasPercent) {
      for (const p of out) p.strain = p.strain / 100;
    }
    // Ensure non-negative strains and non-decreasing order
    let inversions = 0;
    for (let i = 1; i < out.length; i++) {
      if (out[i].strain < out[i - 1].strain - 1e-9) inversions++;
    }
    if (inversions > Math.max(3, out.length * 0.05)) {
      out.sort((a, b) => a.strain - b.strain);
    } else if (inversions > 0) {
      for (let i = 1; i < out.length; i++) {
        if (out[i].strain < out[i - 1].strain) out[i].strain = out[i - 1].strain;
      }
    }
    // Prepend origin (0, 0) if the dataset starts significantly above 0
    if (out[0].strain > 1e-4 && out[0].stress > 5) {
      out.unshift({ strain: 0, stress: 0 });
    }
    out._wasPercent = wasPercent;
    return out;
  }

  function analyzeCurve(points) {
    const n = points.length;
    const E_arr = points.map(p => p.strain);
    const S_arr = points.map(p => p.stress);
    const eF = E_arr[n - 1];
    const sF = S_arr[n - 1];

    // Global maximum (UTS)
    let utsIdx = 0;
    for (let i = 1; i < n; i++) {
      if (S_arr[i] > S_arr[utsIdx]) utsIdx = i;
    }
    const uts = S_arr[utsIdx];
    const eU_global = E_arr[utsIdx];

    // Estimate elastic modulus E from early positive linear segment
    let sumEE = 0, sumES = 0, countE = 0;
    const eLinearCap = Math.min(0.0025, Math.max(0.0008, eF * 0.06));
    let sCap = uts * 0.65;
    for (let i = 1; i < n; i++) {
      const e = E_arr[i], s = S_arr[i];
      if (e <= 1e-6 || s <= 0) continue;
      if (e > eLinearCap || s > sCap) break;
      sumEE += e * e;
      sumES += e * s;
      countE++;
    }
    let E_mod = countE >= 2 && sumEE > 0 ? sumES / sumEE : 210000;
    if (!isFinite(E_mod) || E_mod < 20000 || E_mod > 500000) E_mod = 210000;

    // Detect upper yield peak and subsequent yield drop in the early region
    const searchMaxE = Math.min(0.08, Math.max(0.025, eF * 0.45));
    let hasDrop = false;
    let iPk = -1;
    let iB = -1;
    let bestDrop = 0;

    for (let i = 1; i < n - 2; i++) {
      if (E_arr[i] > searchMaxE) break;
      if (S_arr[i] < uts * 0.35) continue;
      // Local peak check (allow flat top of 1-2 samples)
      if (S_arr[i] >= S_arr[i - 1] && S_arr[i] >= S_arr[i + 1]) {
        // Look ahead up to +0.035 strain for the drop floor before rising back above peak
        let minS = S_arr[i];
        let minJ = i;
        for (let j = i + 1; j < n && E_arr[j] <= E_arr[i] + 0.035; j++) {
          if (S_arr[j] < minS) { minS = S_arr[j]; minJ = j; }
          if (S_arr[j] > S_arr[i] + 4 && j > i + 2) break;
        }
        const drop = S_arr[i] - minS;
        if (drop >= 4.5 && drop > bestDrop && E_arr[minJ] > E_arr[i] + 1e-5) {
          // Confirm it is not fracture at the very end of the curve
          if (minJ < n - 2 && E_arr[minJ] < eF * 0.85) {
            bestDrop = drop;
            iPk = i;
            iB = minJ;
            hasDrop = true;
            // Take the first substantial yield drop (upper yield point)
            if (drop >= 10) break;
          }
        }
      }
    }

    let ePk, eP0, eP1, sUY, sLY, sLYmin, eL, eU, frac;

    if (hasDrop && iPk >= 0 && iB > iPk) {
      ePk = E_arr[iPk];
      sUY = S_arr[iPk];
      // Find immediate floor after drop (first trough right after iPk)
      let floorJ = iPk + 1;
      while (floorJ + 1 < n && S_arr[floorJ + 1] <= S_arr[floorJ] + 0.3 && E_arr[floorJ] < ePk + 0.01) {
        floorJ++;
      }
      eP0 = Math.max(E_arr[floorJ], ePk + 0.0003);
      sLYmin = S_arr[iB];

      // Plateau median around floorJ..floorJ+window
      const platSamples = [];
      for (let j = floorJ; j < n && E_arr[j] <= ePk + Math.min(0.06, eF * 0.35); j++) {
        if (S_arr[j] <= sUY + 2) platSamples.push(S_arr[j]);
        if (platSamples.length >= 6 && S_arr[j] > median(platSamples) + Math.max(9, 0.035 * sUY)) break;
      }
      sLY = platSamples.length ? median(platSamples) : sLYmin;

      // Find end of Lüders plateau C (sustained rise above plateau band)
      const riseThresh = sLY + Math.max(8, Math.min(18, 0.32 * (sUY - sLY) + 4));
      let iC = Math.max(iB, floorJ);
      for (let j = Math.max(floorJ, iB); j < n; j++) {
        if (E_arr[j] > Math.min(eU_global, ePk + 0.12)) { iC = j; break; }
        if (S_arr[j] > riseThresh) {
          // Confirm it stays above threshold (not a single serration spike)
          let stayed = true;
          const look = Math.min(n - 1, j + 4);
          for (let q = j; q <= look; q++) {
            if (S_arr[q] < riseThresh - 2) { stayed = false; break; }
          }
          if (stayed) {
            iC = Math.max(floorJ, j - 1);
            break;
          }
        }
        iC = j;
      }
      eP1 = Math.max(E_arr[iC], eP0 + 0.002);
      if (eP1 > eU_global && eU_global > eP0 + 0.002) eP1 = eU_global;
      eL = Math.max(0.002, eP1 - ePk);

      // Recompute UTS after plateau
      let postUtsIdx = iC;
      for (let j = iC; j < n; j++) {
        if (S_arr[j] > S_arr[postUtsIdx]) postUtsIdx = j;
      }
      eU = E_arr[postUtsIdx];
      frac = (eF - eU > 0.004 && sF < S_arr[postUtsIdx] * 0.985) ? "ductile" : (eF < 0.05 ? "cleavage" : "ductile");
    } else {
      // Smooth yielding or brittle fracture
      const brittle = eF < 0.015 && sF >= uts * 0.9;
      if (brittle) {
        ePk = eP0 = eP1 = eU = eF;
        sUY = sLY = sLYmin = uts;
        eL = 0;
        frac = "cleavage";
      } else {
        // 0.2% offset yield point
        let iY = Math.min(n - 1, Math.max(1, Math.floor(n * 0.05)));
        for (let i = 1; i < n; i++) {
          const offsetStress = E_mod * Math.max(0, E_arr[i] - 0.002);
          if (E_arr[i] > 0.002 && S_arr[i] <= offsetStress) {
            iY = i;
            break;
          }
        }
        ePk = eP0 = eP1 = E_arr[iY];
        sUY = sLY = sLYmin = S_arr[iY];
        eL = 0;
        eU = Math.max(ePk, eU_global);
        frac = (eF - eU > 0.004 && sF < uts * 0.985) ? "ductile" : (eF < 0.04 ? "cleavage" : "ductile");
      }
    }

    // Infer plausible physical parameters (d, c, rho, T, rate) for micro/atomic views
    const YPP = root.LudersYPP;
    let dEst = 25;
    if (sLY > 150) {
      // Rough inverse Hall-Petch around room temperature
      const sHP_est = Math.max(30, sLY - 125);
      const ky_est = hasDrop ? 0.70 : 0.30;
      dEst = YPP.clamp(Math.pow(ky_est / sHP_est, 2) * 1e6, 4, 150);
    }
    const cEst = hasDrop ? YPP.clamp(Math.round(15 + (sUY - sLY) * 0.45), 10, 80) : 1;
    const rhoEst = hasDrop ? 5e11 : 2.5e13;
    const TEst = (frac === "cleavage" && eF < 0.02) ? 105 : 298;
    const nBands = hasDrop ? YPP.clamp(Math.round(1 + (sUY - sLY) / 28), 1, 4) : 1;

    return {
      metrics: {
        E: E_mod,
        hasDrop,
        ePk, eP0, eP1, eU, eF,
        sUY, sLY, sLYmin, eL, uts, sF,
        frac, nBands,
        wasPercent: !!points._wasPercent
      },
      inferredParams: { d: dEst, c: cEst, rho: rhoEst, T: TEst, rate: 1e-3 }
    };
  }

  function compareToRun(dataset, modelRun) {
    if (!dataset || !dataset.points || !modelRun || !root.LudersYPP) return null;
    const YPP = root.LudersYPP;
    const pts = dataset.points;
    const maxOverlap = Math.min(pts[pts.length - 1].strain, modelRun.st.eF);
    let sq = 0, cnt = 0;
    for (let i = 0; i < pts.length; i++) {
      const e = pts[i].strain;
      if (e > maxOverlap) break;
      const diff = pts[i].stress - YPP.sAt(modelRun, e);
      sq += diff * diff;
      cnt++;
    }
    const rms = cnt > 0 ? Math.sqrt(sq / cnt) : 0;
    const m = dataset.metrics;
    const dUYP = (m.hasDrop && modelRun.st.yp) ? (m.sUY - modelRun.D.sUY) : null;
    const dLYP = m.sLY - modelRun.D.sLY;
    const dUTS = m.uts - modelRun.st.uts;
    const dEF = (m.eF - modelRun.st.eF) * 100;
    return { rms, dUYP, dLYP, dUTS, dEF, overlapPct: maxOverlap * 100 };
  }

  function createCurveDataset(name, points) {
    const colorIdx = nextId - 1;
    const id = "ds-" + (nextId++);
    const color = colorForIndex(colorIdx);
    const analysis = analyzeCurve(points);
    return {
      id,
      kind: "curve",
      name: (name || "Custom curve").trim(),
      points,
      metrics: analysis.metrics,
      inferredParams: analysis.inferredParams,
      overlay: true,
      colorIdx,
      color
    };
  }

  function createParamDataset(name, params) {
    const colorIdx = nextId - 1;
    const id = "ds-" + (nextId++);
    const color = colorForIndex(colorIdx);
    const YPP = root.LudersYPP;
    const p = { ...YPP.BASE, ...params };
    const run = YPP.buildRun(p);
    const pts = run.E.map((e, i) => ({ strain: e, stress: run.S[i] }));
    const analysis = analyzeCurve(pts);
    return {
      id,
      kind: "params",
      name: (name || "Custom alloy").trim(),
      params: p,
      points: pts,
      metrics: {
        ...analysis.metrics,
        E: run.D.E,
        hasDrop: run.st.yp,
        ePk: run.st.ePk,
        eP0: run.st.eP0,
        eP1: run.st.eP1,
        eU: run.st.eU,
        eF: run.st.eF,
        sUY: run.D.sUY,
        sLY: run.D.sLY,
        eL: run.D.eL,
        uts: run.st.uts,
        sF: run.st.sF,
        frac: run.st.frac
      },
      inferredParams: p,
      overlay: false,
      colorIdx,
      color
    };
  }

  function runToCsv(run) {
    const lines = ["strain,stress_MPa"];
    for (let i = 0; i < run.E.length; i++) {
      lines.push(run.E[i].toFixed(7) + "," + run.S[i].toFixed(4));
    }
    return lines.join("\n") + "\n";
  }

  root.LudersDatasets = {
    parsePoints,
    analyzeCurve,
    compareToRun,
    createCurveDataset,
    createParamDataset,
    runToCsv,
    colorForIndex
  };
})(typeof window !== "undefined" ? window : globalThis);
