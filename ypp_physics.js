/* Physics model: yield point phenomenon & Lüders bands in mild steel.
   Ported faithfully from luders-band-simulator.html, extended with
   custom stress-strain dataset driving so uploaded curves animate all views. */
(function (root) {
  "use strict";

  const kB = 8.617e-5;
  const b = 2.48e-10;
  const phi = 0.5;
  const v0 = 1e3;
  const dG0 = 0.75;
  const sHat = 900;
  const rhoAnn = 1e13;
  const rhoLY = 1e13;
  const rhoCrit = 1e12;
  const Ub = 0.5;
  const cStar = 5;
  const aMmub = 1.637e-5;
  const Qd = 0.87;
  const L0 = 50;
  const NC = 200;
  const SLOPE = 0.75;
  const ADSA = 1e-3 * Math.exp(Qd / (kB * 473));
  const ADRAG = 1e-3 * Math.exp(Qd / (kB * 620));

  const BASE = { d: 25, c: 30, rho: 5e11, T: 298, rate: 1e-3 };

  const PRESETS = [
    ["Annealed mild steel", {}],
    ["Fine grain, 5 μm", { d: 5 }],
    ["Coarse grain, 120 μm", { d: 120 }],
    ["IF steel, no free C/N", { c: 0 }],
    ["Temper-rolled", { rho: 3e13 }],
    ["Liquid N₂, −196 °C", { T: 77 }],
    ["Blue-brittle, 220 °C", { T: 493 }],
    ["Fast test", { rate: 0.1 }]
  ];

  // ---------- formatting & math helpers ----------
  const SUP = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  const sup = s => String(s).replace(/[-0-9]/g, ch => SUP[ch]);

  function sci(x, dig) {
    if (dig == null) dig = 1;
    if (!isFinite(x) || x <= 0) return "0";
    let e = Math.floor(Math.log10(x));
    let m = x / Math.pow(10, e);
    if (+m.toFixed(dig) >= 10) { m /= 10; e++; }
    return (Math.abs(m - 1) < 0.05 ? "" : m.toFixed(dig) + " × ") + "10" + sup(e);
  }

  function sciHtml(x, dig) {
    if (dig == null) dig = 1;
    if (!isFinite(x) || x <= 0) return "0";
    let e = Math.floor(Math.log10(x));
    let m = x / Math.pow(10, e);
    if (+m.toFixed(dig) >= 10) { m /= 10; e++; }
    const expStr = String(e).replace("-", "−");
    return (Math.abs(m - 1) < 0.05 ? "" : m.toFixed(dig) + " × ") + "10<sup>" + expStr + "</sup>";
  }

  const rateTxt = r => sci(r) + " s⁻¹";
  const rateHtml = r => sciHtml(r) + " s<sup>−1</sup>";
  const pct = x => (x * 100).toFixed(Math.abs(x) < 0.1 ? 2 : 1) + "%";
  const fmtD = d => d < 10 ? d.toFixed(1) : Math.round(d).toString();
  const vel = v => {
    if (!isFinite(v) || v <= 0) return "0 μm/s";
    return v < 1e-3 ? (v * 1e6).toPrecision(2) + " μm/s" : (v * 1e3).toPrecision(2) + " mm/s";
  };
  const dFromS = v => 2 * Math.pow(100, v / 1000);
  const sFromD = d => Math.round(1000 * Math.log(Math.max(2, Math.min(200, d)) / 2) / Math.log(100));
  const clamp = (x, a, bVal) => Math.max(a, Math.min(bVal, x));
  const tC = T => String(Math.round(T - 273)).replace("-", "−") + " °C";

  function fmtDur(s) {
    if (!isFinite(s) || s > 3.15e9) return "never at this temperature";
    return s < 90
      ? Math.round(s) + " s"
      : s < 5400
        ? Math.round(s / 60) + " min"
        : s < 172800
          ? (s / 3600).toPrecision(2) + " h"
          : s < 6.3e7
            ? (s / 86400).toPrecision(2) + " days"
            : (s / 3.15e7).toPrecision(2) + " years";
  }

  function rng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function rnd(seed) {
    let s = seed % 2147483647 || 1;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function sigTh(v, T) {
    if (v >= v0) return sHat;
    const x = (kB * T * Math.log(v0 / v)) / dG0;
    return x >= 1 ? 0 : sHat * Math.pow(1 - Math.pow(x, 2 / 3), 2);
  }

  function derive(p) {
    const fmu = 1 - 3.5e-4 * (p.T - 298);
    const E = 210000 * fmu;
    const cat = p.c * 1e-6 * 55.85 / 12.01;
    const z = cat * Math.exp(Ub / (kB * p.T));
    const theta = z / (1 + z);
    const supply = 1 - Math.exp(-p.c / cStar);
    const fLock = theta * supply;
    const rhoEff = p.rho + (1 - fLock) * rhoAnn;
    const rhoFlow = Math.max(rhoLY, rhoEff);
    const vLY = p.rate / (phi * b * rhoFlow);
    const vUY = p.rate / (phi * b * rhoEff);
    const sTh = sigTh(vLY, p.T);
    const ky = (0.25 + 0.45 * fLock) * fmu;
    const sHP = ky / Math.sqrt(p.d * 1e-6);
    const s0 = 55 * fmu;
    const sSS = 0.35 * p.c * fmu;
    const sRho = aMmub * fmu * (Math.sqrt(rhoAnn + p.rho) - Math.sqrt(rhoAnn));
    const sLY = s0 + sSS + sTh + sHP + sRho;
    const dJG = Math.max(0, sigTh(vUY, p.T) - sTh);
    const Tdrag = Qd / (kB * Math.log(ADRAG / p.rate));
    const dragF = 1 / (1 + Math.exp((p.T - Tdrag) / 20));
    const dLock = 15 * fLock * fmu * rhoCrit / (rhoCrit + p.rho) * dragF;
    const dUY = dJG + dLock;
    const sUY = sLY + dUY;
    const Tp = Qd / (kB * Math.log(ADSA / p.rate));
    const iDSA = supply * theta * Math.exp(-Math.pow((1 / p.T - 1 / Tp) / 3e-4, 2));
    const K = (ADSA / p.rate) * Math.exp(-Qd / (kB * p.T));

    let eL = 0.0175 * Math.sqrt(25 / p.d) * Math.pow(dUY / 43, 0.6) * (1 + 0.6 * sTh / sLY) / 1.09;
    eL = Math.min(eL * (1 + 0.5 * iDSA), 0.09);
    eL *= Math.min(1, Math.max(0, (dUY - 5) / 5));

    const rhoL = 2e13 + p.rho;
    const sRho0 = aMmub * fmu * Math.sqrt(rhoL);
    const sSat = (440 - 0.11 / Math.sqrt(p.d * 1e-6)) * fmu * (1 - 6e-4 * (p.T - 298)) + 130 * iDSA;
    const Hinf = Math.max(40, sSat - sRho0);
    const ec = 0.10 * (1 - 0.25 * iDSA);
    const sCl = 0.34 * Math.exp(p.T / 90) / (ky * Math.sqrt(p.d * 1e-6));
    const sFr = Math.max(sCl, sLY);
    const eNeck = 0.12 * (1 - 0.45 * iDSA) * (1 + 0.15 * Math.max(0, (p.T - 298) / 400));
    const nBands = Math.max(1, Math.min(5, Math.round(1 + 0.9 * Math.log10(p.rate / 1e-5))));

    return {
      fmu, E, theta, supply, fLock, rhoEff, vLY, vUY, sTh, ky, sHP, s0, sSS, sRho, sLY,
      dJG, dLock, dUY, sUY, Tp, Tdrag, K, iDSA, eL, rhoL, sRho0, sSat, Hinf, ec, sCl, sFr, eNeck, nBands
    };
  }

  function bandSchedule(n, seed) {
    const R = rng(seed);
    const when = new Int32Array(NC).fill(-1);
    const fronts = [];
    const nuc = [{ at: 0, x: 0, dirs: [1] }];
    if (n >= 2) nuc.push({ at: Math.round(NC * 0.10), x: NC - 1, dirs: [-1] });
    for (let k = 2; k < n; k++) {
      nuc.push({
        at: Math.round(NC * (0.18 + 0.12 * (k - 2) + 0.05 * R())),
        x: Math.floor(NC * (0.3 + 0.4 * R())),
        dirs: [-1, 1]
      });
    }
    const log = [];
    const events = [];
    let done = 0, band = 0, rr = 0;
    while (done < NC) {
      for (const nb of nuc) {
        if (!nb.used && done >= nb.at && when[nb.x] < 0) {
          nb.used = true;
          band++;
          when[nb.x] = done++;
          events.push({ k: done - 1, x: nb.x, band });
          for (const d of nb.dirs) fronts.push({ pos: nb.x, dir: d, band, alive: true });
        }
      }
      if (done >= NC) break;
      const alive = fronts.filter(f => f.alive);
      if (!alive.length) {
        const i = when.indexOf(-1);
        when[i] = done++;
        fronts.push({ pos: i, dir: 1, band: ++band, alive: true });
        continue;
      }
      const f = alive[rr++ % alive.length];
      const nx = f.pos + f.dir;
      if (nx < 0 || nx >= NC || when[nx] >= 0) {
        f.alive = false;
        continue;
      }
      when[nx] = done++;
      f.pos = nx;
      log.push({
        k: done - 1,
        fronts: fronts.filter(q => q.alive).map(q => ({ pos: q.pos, dir: q.dir, band: q.band }))
      });
    }
    return { when, events, log };
  }

  function curve(p) {
    const D = derive(p);
    const R = rng(Math.round(p.d * 7 + p.c * 13 + p.T * 3 + Math.log10(p.rho) * 101 + Math.log10(p.rate) * 17));
    const E = [];
    const S = [];
    const push = (e, s) => { E.push(e); S.push(s); };
    let frac = null;
    const brittle = (e, s) => s * (1 + e) >= D.sFr;
    const st = { eUY: 0, ePk: 0, eP0: 0, eP1: 0, eU: 0, eF: 0, sUY: D.sUY, sLY: D.sLY, sLYmin: D.sLY, uts: 0 };
    const yp = D.eL > 0;
    const sPk = yp ? D.sUY : D.sLY;

    const e1 = 0.88 * sPk / D.E;
    const ePk = sPk / D.E + (yp ? 0.00025 : 0.0012);
    for (let i = 0; i <= 40; i++) {
      const e = e1 * i / 40;
      const s = D.E * e;
      if (brittle(e, s)) { frac = "cleavage"; break; }
      push(e, s);
    }
    if (!frac) {
      for (let i = 1; i <= 24; i++) {
        const t = i / 24;
        const h = ePk - e1;
        const s0 = 0.88 * sPk;
        const m0 = D.E * h;
        const s = (2 * Math.pow(t, 3) - 3 * t * t + 1) * s0 + (Math.pow(t, 3) - 2 * t * t + t) * m0 + (-2 * Math.pow(t, 3) + 3 * t * t) * sPk;
        const e = e1 + t * h;
        if (brittle(e, s)) { frac = "cleavage"; break; }
        push(e, s);
      }
    }
    st.ePk = ePk;
    let e = ePk;
    if (!frac && yp) {
      const sMin = D.sLY - 0.12 * D.dUY - 1;
      const dEd = 0.0006 + D.dUY / D.E;
      st.sLYmin = sMin;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        push(ePk + dEd * t, sMin + (D.sUY - sMin) * Math.exp(-5 * t) * (1 - t));
      }
      e = ePk + dEd;
      st.eP0 = e;
      const sch = bandSchedule(D.nBands, 11 + D.nBands);
      const eEnd = ePk + D.eL;
      st.eP1 = eEnd;
      const A = 1 + 0.06 * D.dUY + 4 * D.iDSA;
      const evE = sch.events.slice(1).map(ev => ePk + D.eL * ev.k / NC);
      while (e < eEnd) {
        const w = Math.min(eEnd - e, 0.0006 + 0.001 * R());
        const nucl = evE.find(x => x > e && x <= e + w);
        const a = nucl ? A + 0.35 * D.dUY : A * (0.4 + 0.6 * R());
        const drift = D.sLY * (1 + 0.012 * (e - ePk) / Math.max(D.eL, 1e-4));
        const top = drift + a / 2;
        const bot = drift - a / 2;
        push(e + 0.75 * w, top);
        if (brittle(e + 0.75 * w, top)) { frac = "cleavage"; e += 0.75 * w; break; }
        push(e + w, bot);
        e += w;
      }
      st.sched = sch;
    } else {
      st.eP0 = st.eP1 = ePk;
    }

    if (!frac) {
      const e0 = e;
      const sT0 = (yp ? D.sLY * 1.012 : D.sLY) * (1 + e0);
      const et0 = Math.log(1 + e0);
      const sTrue = x => sT0 + D.Hinf * (1 - Math.exp(-(Math.log(1 + x) - et0) / D.ec));
      let prev = -1;
      let ee = e0;
      let nextSerr = e0 + 0.012 + 0.004 * R();
      const AD = D.iDSA * (3 + 0.2 * p.c);
      while (true) {
        ee += 0.0015;
        const s = sTrue(ee) / (1 + ee);
        if (s <= prev) break;
        prev = s;
        if (brittle(ee, s)) { frac = "cleavage"; push(ee, s); break; }
        if (AD > 0.6 && ee >= nextSerr) {
          push(ee, s);
          push(ee + 0.0002, s - AD * (0.6 + 0.4 * R()));
          ee += 0.0002;
          nextSerr = ee + 0.004 + 0.004 * R();
          continue;
        }
        push(ee, s);
      }
      if (!frac) {
        st.eU = E[E.length - 1];
        st.uts = Math.max.apply(null, S.slice(-6));
      }
    }

    if (!frac) {
      const eu = st.eU;
      const ef = eu + D.eNeck;
      const su = S[S.length - 1];
      for (let i = 1; i <= 60; i++) {
        const t = i / 60;
        push(eu + t * D.eNeck, su * (1 - 0.22 * Math.pow(t, 1.7)));
      }
      frac = "ductile";
      st.eF = ef;
    } else {
      st.eF = E[E.length - 1];
      if (!st.eU) {
        st.eU = st.eF;
        st.uts = Math.max.apply(null, S);
      }
      if (st.eP1 > st.eF) st.eP1 = st.eF;
    }
    st.frac = frac;
    st.sF = S[S.length - 1];
    st.uts = st.uts || Math.max.apply(null, S);
    return { E, S, D, st };
  }

  function dbtt(p) {
    let lo = 20, hi = 900;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      const D = derive({ d: p.d, c: p.c, rho: p.rho, T: m, rate: p.rate });
      if (D.sUY >= D.sCl) lo = m;
      else hi = m;
    }
    return lo;
  }

  function finalizeRun(runObj, p, seedSalt) {
    const st = runObj.st;
    st.brittle = st.frac === "cleavage" && st.eF <= st.ePk + 1e-6;
    if (st.dbtt == null) st.dbtt = dbtt(p);
    st.ePk = Math.min(st.ePk, st.eF);
    st.eP0 = Math.min(Math.max(st.eP0, st.ePk), st.eF);
    st.eP1 = Math.min(Math.max(st.eP1, st.ePk), st.eF);
    st.eU = Math.min(Math.max(st.eU, st.eP1), st.eF);
    st.yp = runObj.D.eL > 0 && st.eP1 > st.ePk + 1e-6;

    if (st.sched) {
      const fa = new Array(NC + 1);
      const log = st.sched.log;
      let curFronts = [], j = 0;
      for (let k = 0; k <= NC; k++) {
        while (j < log.length && log[j].k <= k) curFronts = log[j++].fronts;
        fa[k] = curFronts;
      }
      st.frontsAt = fa;
    }
    const R = rnd(Math.round(p.d * 31 + p.T * 7 + p.c * 3 + (seedSalt || 0)) + 5);
    st.xFrac = L0 * (0.4 + 0.22 * R());

    const rawSegs = [
      [0, st.ePk, 0.10],
      [st.ePk, st.eP1, 0.40],
      [st.eP1, st.eU, 0.34],
      [st.eU, st.eF, 0.16]
    ].filter(s => s[1] > s[0] + 1e-7);

    if (!rawSegs.length) {
      rawSegs.push([0, Math.max(st.eF, 1e-4), 1]);
    }
    const tot = rawSegs.reduce((a, s) => a + s[2], 0);
    let acc = 0;
    runObj.segs = rawSegs.map(s => {
      const o = { a: s[0], b: s[1], u0: acc / tot, u1: (acc + s[2]) / tot };
      acc += s[2];
      return o;
    });
    runObj.P = { ...p };
    return runObj;
  }

  function buildRun(p) {
    const cObj = curve(p);
    cObj.isCustom = false;
    cObj.datasetName = null;
    return finalizeRun(cObj, p, 0);
  }

  /* Build a full YPP-compatible simulation run driven directly by a user's
     uploaded (strain, stress) curve dataset so every view animates smoothly
     along the user's exact experimental/custom trajectory. */
  function buildCustomRun(dataset, fallbackP) {
    const baseP = { ...BASE, ...(fallbackP || {}), ...(dataset.inferredParams || {}) };
    const Dbase = derive(baseP);
    const m = dataset.metrics;

    const E_arr = dataset.points.map(pt => pt.strain);
    const S_arr = dataset.points.map(pt => pt.stress);

    const hasDrop = !!m.hasDrop;
    const eL = hasDrop ? Math.max(0.002, m.eL) : 0;
    const sLY = Math.max(20, m.sLY || Dbase.sLY);
    const sUY = hasDrop ? Math.max(sLY + 5, m.sUY) : sLY;
    const dUY = Math.max(0, sUY - sLY);
    const E_mod = m.E && m.E > 10000 && m.E < 600000 ? m.E : Dbase.E;
    const uts = Math.max(sLY, m.uts || Math.max.apply(null, S_arr));
    const Hinf = Math.max(40, (uts * (1 + m.eU) - sLY * (1 + m.eP1)) * 1.15);

    const nBands = hasDrop ? clamp(m.nBands || Dbase.nBands || 2, 1, 5) : 1;
    const D = {
      ...Dbase,
      E: E_mod,
      sLY,
      sUY,
      dUY,
      dJG: dUY * 0.72,
      dLock: dUY * 0.28,
      eL,
      Hinf,
      nBands,
      fLock: hasDrop ? Math.max(0.75, Dbase.fLock) : (baseP.c < 3 ? 0.02 : Dbase.fLock)
    };

    const st = {
      eUY: m.ePk,
      ePk: m.ePk,
      eP0: m.eP0,
      eP1: m.eP1,
      eU: m.eU,
      eF: m.eF,
      sUY,
      sLY,
      sLYmin: m.sLYmin || sLY,
      uts,
      sF: S_arr[S_arr.length - 1],
      frac: m.frac || "ductile",
      sched: hasDrop ? bandSchedule(nBands, 37 + nBands + (dataset.points.length % 97)) : null
    };

    const runObj = {
      E: E_arr,
      S: S_arr,
      D,
      st,
      isCustom: true,
      datasetId: dataset.id,
      datasetName: dataset.name
    };
    return finalizeRun(runObj, baseP, dataset.points.length);
  }

  function uToE(run, u) {
    const segs = run.segs;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (u <= s.u1 + 1e-9) {
        return s.a + (s.b - s.a) * clamp((u - s.u0) / Math.max(s.u1 - s.u0, 1e-12), 0, 1);
      }
    }
    return run.st.eF;
  }

  function eToU(run, e) {
    const segs = run.segs;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (e <= s.b + 1e-12) {
        return s.u0 + (s.u1 - s.u0) * clamp((e - s.a) / Math.max(s.b - s.a, 1e-12), 0, 1);
      }
    }
    return 1;
  }

  function sAt(run, e) {
    const E = run.E;
    const S = run.S;
    let lo = 0, hi = E.length - 1;
    if (hi < 0) return 0;
    if (e <= E[0]) return S[0];
    if (e >= E[hi]) return S[hi];
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (E[m] <= e) lo = m;
      else hi = m;
    }
    const t = (e - E[lo]) / Math.max(E[hi] - E[lo], 1e-12);
    return S[lo] + (S[hi] - S[lo]) * t;
  }

  function field(run, e, u) {
    const st = run.st;
    const D = run.D;
    const eps = new Float32Array(NC);
    let k = 0, f = 0;
    const fr = u >= 0.9995;
    if (st.yp && e > st.ePk && (e < st.eP1 || (st.frac === "cleavage" && st.eF <= st.eP1 + 1e-12))) {
      f = clamp((e - st.ePk) / Math.max(D.eL, 1e-6), 0, 1);
      k = Math.floor(f * NC);
      const w = st.sched.when;
      for (let i = 0; i < NC; i++) eps[i] = w[i] < k ? D.eL : 0;
    } else if (e > st.ePk) {
      f = 1;
      k = NC;
      const up = (st.yp ? D.eL : 0) + Math.max(0, Math.min(e, st.eU) - st.eP1);
      eps.fill(up);
      if (e > st.eU && st.frac === "ductile") {
        const ex = (e - st.eU) * L0;
        const wN = 3.2;
        for (let i = 0; i < NC; i++) {
          const x = (i + 0.5) * L0 / NC;
          eps[i] += ex * Math.exp(-Math.pow(x - st.xFrac, 2) / (2 * wN * wN)) / (wN * Math.sqrt(2 * Math.PI));
        }
      }
    }
    return { eps, k, f, fr };
  }

  function stageOf(run, e, u) {
    const st = run.st;
    if (u >= 0.9995) return "fracture";
    if (st.brittle) return e >= 0.85 * st.eF ? "prebrittle" : "elastic";
    if (e < st.ePk * 0.9) return "elastic";
    if (e <= st.ePk) return st.yp ? "upper" : "smooth";
    if (st.yp && e < st.eP0) return "drop";
    if (st.yp && e < st.eP1) return "luders";
    if (e < st.eU) return "hardening";
    return "necking";
  }

  function rhoAt(run, e) {
    const D = run.D;
    const st = run.st;
    const et = Math.log(1 + Math.max(e, st.eP1)) - Math.log(1 + st.eP1);
    const sr = D.sRho0 + D.Hinf * (1 - Math.exp(-et / Math.max(D.ec, 1e-4)));
    return Math.pow(sr / (aMmub * D.fmu), 2);
  }

  function frontsNow(run, fl) {
    return run.st.frontsAt ? (run.st.frontsAt[Math.min(fl.k, NC)] || []) : [];
  }

  function nFronts(n) {
    return Math.min(n, 2) + 2 * Math.max(0, n - 2);
  }

  function story(run, stage, e, s, fl) {
    const D = run.D;
    const st = run.st;
    const P = run.P;
    const sub = (a, subT) => `${a}<sub>${subT}</sub>`;
    const lock = D.dLock > 1 ? `, plus ${Math.round(D.dLock)} MPa to tear the rest from their C/N atmospheres` : "";
    const dsa = D.iDSA > 0.25 ? " The serrations are dynamic strain ageing: at this temperature carbon diffuses fast enough to re-pin dislocations while they wait at obstacles (blue brittleness)." : "";
    const nb = D.nBands;
    const fs = (P.rate * L0 / (Math.max(D.eL, 1e-4) * nFronts(nb))).toPrecision(2);
    const dsTag = run.isCustom ? ` (from dataset “${run.datasetName}”)` : "";

    switch (stage) {
      case "elastic":
        return [
          "Elastic loading",
          `Stress rises along <i>E</i> ≈ ${Math.round(D.E / 1000)} GPa${dsTag} with no permanent strain. ` +
            (D.fLock > 0.05
              ? `${Math.round(D.fLock * 100)}% of dislocations sit in Cottrell atmospheres of C and N; only ${sci(D.rhoEff)} m⁻² are free to glide.`
              : "With almost no free C or N, nothing locks the dislocations.")
        ];
      case "upper":
        return [
          "Upper yield point A",
          `${sub("σ", "UY")} = ${Math.round(D.sUY)} MPa${dsTag}. To deliver ${rateTxt(P.rate)} with only ${sci(D.rhoEff)} m⁻² free dislocations, each must glide at about ${vel(D.vUY)}, which costs ${Math.round(D.dJG)} MPa of extra stress${lock}. Dislocations at the shoulder fillet break free and the first band nucleates.`
        ];
      case "smooth": {
        const why = run.isCustom
          ? `This uploaded curve yields smoothly near ${Math.round(D.sLY)} MPa with no yield drop.`
          : P.c < 3
            ? `Too little free C+N (${P.c} ppm) to lock the dislocations.`
            : (P.T > D.Tdrag - 30 || D.fLock < 0.7)
              ? `At ${tC(P.T)} carbon and nitrogen leave the dislocations (only ${Math.round(D.fLock * 100)}% locked) or diffuse fast enough to travel with them, so nothing has to tear free.`
              : `Enough free dislocations (${sci(D.rhoEff)} m⁻²) already carry the imposed strain rate at the normal flow stress. Temper rolling uses this to avoid stretcher strains.`;
        return ["Smooth yielding", `${why} No upper yield point and no Lüders band.`];
      }
      case "drop":
        return [
          "Yield drop A to B",
          `Freed dislocations multiply to about 10¹³ m⁻², so each needs to move only ${vel(D.vLY)}. The load falls by ${Math.round(D.dUY)} MPa to the lower yield stress${dsTag}.`
        ];
      case "luders":
        return [
          "Lüders bands propagating",
          `Deformation is confined to the bands at ${sub("σ", "LY")} ≈ ${Math.round(D.sLY)} MPa${dsTag}. Metal inside has strained by ${sub("ε", "L")} = ${pct(D.eL)}; the rest is still elastic. Fronts move at about ${fs} mm/s as pile-ups at grain boundaries unlock sources in the next grain (${sub("k", "y")} = ${D.ky.toFixed(2)} MPa·m½). Each serration is a burst of unlocking. ${Math.round(fl.f * 100)}% of the gauge has yielded.${dsa}`
        ];
      case "hardening":
        return [
          st.yp ? "Uniform strain hardening, C to M" : "Uniform strain hardening",
          `${st.yp ? "The bands have united and the whole gauge" : "The whole gauge"} deforms evenly${dsTag}. Dislocations multiply and tangle (ρ ≈ ${sci(rhoAt(run, e))} m⁻²), and Taylor hardening lifts the flow stress to ${Math.round(s)} MPa.${dsa}`
        ];
      case "necking":
        return [
          "Necking after M",
          `Past the tensile strength (${Math.round(st.uts)} MPa at ${pct(st.eU)})${dsTag}, hardening no longer offsets the shrinking cross-section (Considère). Strain gathers in one neck, where microvoids open at carbide particles.`
        ];
      case "prebrittle":
        return [
          "Below the transition temperature",
          `Here ${tC(P.T)} is below the DBTT of ${tC(st.dbtt)} for these settings. Unlocking dislocations would take ${sub("σ", "UY")} ≈ ${Math.round(D.sUY)} MPa, more than the ${Math.round(D.sCl)} MPa a cleavage crack needs. The first local slip or twin at a grain boundary or carbide opens a microcrack, and it runs before any Lüders band can form.`
        ];
      default:
        return st.frac === "ductile"
          ? ["Ductile fracture F", `Voids coalesce and the neck tears at ${pct(st.eF)} elongation${dsTag}, leaving a cup-and-cone break.`]
          : st.brittle
            ? ["Brittle fracture F, no yielding", `The bar cleaves at ${Math.round(st.sF)} MPa after only ${pct(st.eF)} strain, all of it elastic. No upper yield point, no Lüders band, no necking. Cracks run straight across grains along {100} cleavage planes; the thin lenses are deformation twins, which nucleate cracks in cold iron.`]
            : ["Brittle cleavage F", `This is the transition range, just above the DBTT (${tC(st.dbtt)}). The bar yielded and the bands ran, but work hardening lifted the stress to the cleavage strength ${sub("σ", "f")} = ${Math.round(D.sCl)} MPa at ${pct(st.eF)} strain, and a crack ran straight across the grains.`];
    }
  }

  root.LudersYPP = {
    kB, b, phi, v0, dG0, sHat, rhoAnn, rhoLY, rhoCrit, Ub, cStar, aMmub, Qd, L0, NC, SLOPE, ADSA, ADRAG,
    BASE, PRESETS,
    sci, sciHtml, sup, rateTxt, rateHtml, pct, fmtD, vel, dFromS, sFromD, clamp, tC, fmtDur, rng, rnd,
    sigTh, derive, bandSchedule, curve, dbtt,
    buildRun, buildCustomRun,
    uToE, eToU, sAt, field, stageOf, rhoAt, frontsNow, nFronts, story
  };
})(typeof window !== "undefined" ? window : globalThis);
