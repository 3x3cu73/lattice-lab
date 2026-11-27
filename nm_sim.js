/* Lattice Lab: nm-scale prototype for the Lüders Band Simulator.
   Physics inputs come from ypp_physics.js (LudersYPP.derive), exactly as on the site.
   The look and the core motion follow the tec-science yield-point animation:
   matte square lattice, columns beside the core pushed sideways above the slip plane,
   continuous glide with a linear half-plane crossfade, glowing solute clouds, 16-spacing camera pans.
   Lengths are in lattice spacings b, stresses in MPa, time in animation seconds. */
(function () {
  "use strict";

  const Y = window.LudersYPP;
  const $ = id => document.getElementById(id);
  const clamp = Y.clamp;
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const UB = 0.5;
  const G_MPA = 80000;
  const SHEAR_GAIN = 20;
  const TAU_V = 0.08;
  const TAU_PARAM = 0.35;
  const EXIT_X = 25;
  const SPAWN_X = -10;
  const PAN_TIME = 2.0;
  const CLOUD_PIN = 0.25;
  // Share of the Burgers vector taken up as stretching below the slip plane on each side of the
  // core (0.25 = the symmetric elastic solution: half compression above, half tension below).
  const HSPLIT = 0.25;

  const COL = {
    bg: "#86949f",
    bond: "#282d34",
    fe: ["#dc5546", "#c83c2d", "#b51d10"],
    half: ["#e29d48", "#d58d37", "#b0661c"],
    cn: ["#3a86dc", "#1464b9", "#0d4688"],
    glow: "70,145,230",
    pillText: "#004cff",
    pillWarm: "#c25e00",
    form: "120,245,255",
    brk: "255,196,64"
  };

  // ---------- parameters: P = slider targets, Pe = eased values the sim uses ----------
  const P = { ...Y.BASE };
  const Pe = { ...Y.BASE };
  let M = null;

  function easeParams(dt) {
    const k = 1 - Math.exp(-dt / TAU_PARAM);
    for (const key of ["d", "rho", "rate"]) {
      const a = Math.log(Pe[key]), b = Math.log(P[key]);
      Pe[key] = Math.abs(b - a) < 1e-4 ? P[key] : Math.exp(a + (b - a) * k);
    }
    for (const key of ["c", "T"]) {
      Pe[key] = Math.abs(P[key] - Pe[key]) < 1e-3 ? P[key] : Pe[key] + (P[key] - Pe[key]) * k;
    }
  }

  function bestSites(x0, n) {
    const out = [];
    for (let p = Math.round(2 * x0) - 5; p <= Math.round(2 * x0) + 5; p++) {
      for (const q of [-1, -2, -3]) {
        if (((p + q) & 1) !== 0) continue;
        const X = p / 2, Yq = q / 2;
        out.push([p, q, (1.09 * Yq) / ((X - x0) * (X - x0) + Yq * Yq + 0.3)]);
      }
    }
    return out.sort((a, b) => a[2] - b[2]).slice(0, n);
  }

  const smaxCache = new Map();
  function smaxFor(n) {
    if (smaxCache.has(n)) return smaxCache.get(n);
    const ref = bestSites(0, n).map(([p, q]) => [p / 2, q / 2]);
    const f = xx => ref.reduce((E, [X, Yq]) => E + (UB * 1.09 * Yq) / ((X - xx) * (X - xx) + Yq * Yq + 0.3), 0);
    let sm = 0;
    for (let x = 0; x < 4; x += 0.05) sm = Math.max(sm, (f(x + 0.05) - f(x)) / 0.05);
    sm = Math.max(sm, 0.04);
    smaxCache.set(n, sm);
    return sm;
  }

  function model() {
    const D = Y.derive(Pe);
    const Dref = Y.derive({ ...Pe, rho: 5e11 });
    const nAtm = Math.round(11 * D.supply * D.theta);
    const vScale = 0.6 + 0.25 * Math.log10(Math.max(Pe.rate, 1e-6) / 1e-5);
    const kT = Y.kB * Pe.T;
    const cat = (Pe.c * 1e-6 * 55.85) / 12.01;
    const cv = Math.max(nAtm, 1) / (2 * 30 * 12);
    const pinRef = Math.max(0, Dref.dUY);
    M = {
      D,
      sLY: D.sLY,
      sUY: D.sUY,
      pinRef,
      pinScale: pinRef / smaxFor(Math.max(1, nAtm)),
      nAtm,
      nFreeC: Pe.c > 0.5 ? Math.round((front() ? 0.35 : 0.12) * Pe.c) : 0,
      nFree: Math.round((3 * D.rhoEff) / (D.rhoEff + D.fLock * Y.rhoAnn)),
      K: D.K,
      vib: reduceMotion ? 0 : 0.018 * Math.sqrt(Pe.T / 298),
      nPile: clamp(Math.round(2 + 1.5 * Math.log2(Math.max(2, Pe.d) / 5)), 1, 7),
      vScale,
      vAnim: 2 * vScale,
      kT,
      Ueff: cat > 0 ? Math.max(0.05, UB - kT * Math.log(cv / cat)) : UB,
      tFull: 7 * 86400 * Math.pow(30 / Math.max(Pe.c, 1), 1.5) * Math.exp((Y.Qd / Y.kB) * (1 / Pe.T - 1 / 298)) * (Pe.T / 298),
      tauTh: 0.35 * Math.pow(298 / Pe.T, 1.2)
    };
  }

  // ---------- simulation state ----------
  const S = {
    mode: "test",
    playing: true,
    speed: 1,
    t: 0,
    dis: [],
    car: [],
    stress: 0,
    sManTarget: 0,
    ageOn: false,
    srcT: 0,
    srcFreed: false,
    transT: 0,
    flash: 0,
    pile: 0,
    seed: 1,
    nid: 0,
    cid: 0,
    cT: 0,
    hist: [],
    histT: 0,
    homeRel: 0,
    panStep: 16,
    nextCloud: 0,
    camX: 0,
    pan: null,
    upShift: 0,
    g: 0,
    D0: null,
    brokeFree: false,
    breakT: -99,
    pinnedT: 0,
    pinned: false,
    repins: 0,
    switches: 0,
    caps: {}
  };
  const G = { W: 0, H: 0, a: 40, NC: 23, NR: 14, ox: 0, cy: 0, obs: [], xg: 0 };
  const opt = { scene: "focus", obs: true, gb: true, shear: false, labels: true, rerun: true, hiBonds: false };
  function front() { return opt.scene === "front"; }
  const obsOn = () => front() && opt.obs;
  const gbOn = () => front() && opt.gb;
  let rand = Y.rnd(7919);
  let fadeCanvas = null, fadeA = 0;

  function geom() {
    const cv = $("atom");
    const W = cv.clientWidth || 900, H = cv.clientHeight || 506;
    const a = clamp(W / 23.3, 22, 70);
    const NC = Math.max(14, Math.floor(W / a));
    const NR = 2 * Math.ceil((H / a + 3) / 2);
    Object.assign(G, { W, H, a, NC, NR, ox: (W - (NC - 1) * a) / 2, cy: H / 2, xg: NC - 3.5 });
    G.obs = [];
    const home = Math.round(NC * 0.36) + 0.5;
    for (let x = 4.5; x < NC - 6; x += 7) if (Math.abs(x - home) >= 3) G.obs.push(x);
  }

  const siteOK = (p, q) => q !== 0 && ((p + q) & 1) === 0 && Math.abs(q) <= G.NR - 1;
  const labX = c => c.p / 2;
  const rel = x => x - S.camX;

  function mkDis(x, o) {
    if (x < S.camX - 3) { S.upShift++; S.g -= HSPLIT; }
    const d = { id: S.nid++, x, v: 0, w: 1, L: 0, ci: Math.floor(x), trans: false, ok: -1, ow: 0, main: false, ...(o || {}) };
    S.dis.push(d);
    return d;
  }

  function mkCar(p, q, alpha, extra) {
    S.car.push({
      p, q, rp: p, rq: q, a: alpha, dying: false, pw: 1, kind: "free", cid: -1,
      side: rand() < 0.5 ? -1 : 1, jx: (rand() - 0.5) * 0.18, jy: (rand() - 0.5) * 0.16, ...(extra || {})
    });
  }

  // Drawn position of a solute: physics sites lie on bond midpoints; nudge them into the
  // openings between atoms so the cloud reads like the video's loose interstitial cluster.
  function carDraw(cn) {
    const odd = (Math.round(cn.rq) & 1) !== 0;
    const toPlane = cn.rq < 0 ? 1 : -1;
    const dx = odd ? 0 : 0.32 * cn.side;
    const dy = odd ? 0.38 * toPlane : 0;
    return [cn.rp / 2 + dx + cn.jx, cn.rq / 2 + dy + cn.jy];
  }

  function makeCloud(xc, pw, kind) {
    const cid = S.cid++;
    for (const [p, q] of bestSites(xc, M.nAtm)) {
      if (S.car.some(c => c.p === p && c.q === q)) continue;
      mkCar(p, q, 1, { pw, kind, cid });
    }
    return cid;
  }

  function randomCar(alpha) {
    for (let guard = 0; guard < 400; guard++) {
      let p = Math.floor(2 * (S.camX + rand() * G.NC));
      const q = (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * (G.NR - 1)));
      if (((p + q) & 1) !== 0) p += 1;
      if (!siteOK(p, q)) continue;
      const X = p / 2;
      if (S.car.some(c => Math.abs(c.p - p) <= 1 && Math.abs(c.q - q) <= 1)) continue;
      if (S.dis.some(d => Math.abs(X - d.x) < 4.5 && Math.abs(q / 2) < 3)) continue;
      if (S.car.some(c => c.kind !== "free" && Math.abs(labX(c) - X) < 3 && Math.abs(q / 2) < 3)) continue;
      mkCar(p, q, alpha);
      return;
    }
  }

  function snapshot() {
    const cv = $("atom");
    if (!cv.width) return;
    if (!fadeCanvas) fadeCanvas = document.createElement("canvas");
    fadeCanvas.width = cv.width;
    fadeCanvas.height = cv.height;
    fadeCanvas.getContext("2d").drawImage(cv, 0, 0);
    fadeA = 1;
  }

  function reset(aged) {
    snapshot();
    geom();
    rand = Y.rnd(++S.seed * 7919);
    Object.assign(S, {
      dis: [], car: [], t: 0, hist: [], histT: 0, camX: 0, pan: null, upShift: 0, g: 0,
      srcT: 0.5, transT: 0, flash: 0, srcFreed: M.nFree >= 1, brokeFree: false, breakT: -99,
      pinnedT: 0, pinned: false, repins: 0, switches: 0, caps: {}
    });
    if (S.mode === "test") S.stress = 0;
    const x0 = Math.round(G.NC * (front() ? 0.36 : 0.2)) + 0.5;
    S.homeRel = x0;
    S.panStep = Math.round(G.NC * 0.68);
    S.D0 = mkDis(x0, { main: true });
    const fp = [x0 + 6, x0 + 10, x0 - 7];
    for (let i = 0; i < Math.min(M.nFree, 3); i++) mkDis(fp[i]);
    if (aged) makeCloud(x0, 1, "home");
    if (!front()) {
      makeCloud(x0 + S.panStep, CLOUD_PIN, "cloud");
      S.nextCloud = x0 + 2 * S.panStep;
    }
    let guard = 0;
    while (S.car.filter(c => c.kind === "free").length < M.nFreeC && guard++ < 200) randomCar(1);
  }

  // ---------- energetics ----------
  function eSum(X, Yq) {
    let E = 0;
    for (const d of S.dis) {
      const dx = X - d.x;
      if (dx > -9 && dx < 9) E += (1.09 * Yq) / (dx * dx + Yq * Yq + 0.3);
    }
    return E;
  }

  function atmE(x) {
    let E = 0;
    for (const c of S.car) {
      if (c.q < -4 || c.q > -1) continue;
      const Yq = c.q / 2, dx = labX(c) - x;
      E += (c.a * c.pw * 1.09 * Yq) / (dx * dx + Yq * Yq + 0.3);
    }
    return UB * E;
  }

  function atmF(x) {
    let g = 0;
    for (const c of S.car) {
      if (c.q < -4 || c.q > -1) continue;
      const Yq = c.q / 2, dx = labX(c) - x;
      const D = dx * dx + Yq * Yq + 0.3;
      g += (c.a * c.pw * 2.18 * Yq * dx) / (D * D);
    }
    return -M.pinScale * UB * g;
  }

  function obsF(d) {
    if (!obsOn()) return 0;
    let F = 0;
    const tau0 = 0.06 * M.sLY;
    G.obs.forEach((xo, k) => {
      const u = (d.x - xo) / 0.5;
      if (u < -4 || u > 4) return;
      const tau = tau0 * Math.exp(-(d.ok === k ? d.ow : 0) / M.tauTh);
      F += tau * Math.exp(0.5) * u * Math.exp(-0.5 * u * u);
    });
    return F;
  }

  function hop(c) {
    let p2 = c.p + (rand() < 0.5 ? -1 : 1);
    let q2 = c.q + (rand() < 0.5 ? -1 : 1);
    if (q2 === 0) q2 = -c.q;
    if (!siteOK(p2, q2)) return;
    const X2 = p2 / 2;
    if (rel(X2) < -4 || rel(X2) > G.NC + 3) return;
    const dE = M.Ueff * (eSum(X2, q2 / 2) - eSum(c.p / 2, c.q / 2));
    if (dE <= 0 || rand() < Math.exp(-dE / Math.max(M.kT, 1e-5))) {
      c.p = p2;
      c.q = q2;
    }
  }

  function near(d) {
    let n = 0;
    for (const c of S.car) if (!c.dying && c.q < 0 && c.q >= -4 && Math.abs(labX(c) - d.x) <= 1.6) n++;
    return n;
  }

  function breakaway(d) {
    let mx = 0;
    for (let x = d.x; x <= d.x + 3; x += 0.05) mx = Math.max(mx, -atmF(x));
    return M.sLY + mx;
  }

  const inWin = d => rel(d.x) > -1 && rel(d.x) < G.NC + 1;

  // ---------- dynamics ----------
  function step(dt) {
    const fr = M.sLY;
    const mob = M.vAnim / (0.03 * fr);
    const vMax = (front() ? 8 : 2.2) * M.vAnim;
    const demand = (front() ? 2.5 : 1.15) * M.vAnim;

    if (S.mode === "test") {
      let pl = 0;
      for (const d of S.dis) if (inWin(d)) pl += Math.max(0, d.v);
      const load = (M.sUY / 4) * M.vScale * (S.stress > fr ? 0.4 : 1);
      S.stress = clamp(S.stress + load * dt * (1 - pl / demand), 0, 1.6 * Math.max(M.sUY, fr + M.pinRef));
    } else {
      S.stress += (S.sManTarget - S.stress) * (1 - Math.exp(-dt / 0.15));
    }
    const s = S.stress;

    // Dislocation source on the left: locked like everything else until the first breakaway.
    const srcPin = S.srcFreed ? 0 : 1.05 * M.pinRef * Math.min(1, M.nAtm / 5);
    S.srcT -= dt;
    const nIn = S.dis.filter(d => rel(d.x) < G.NC + 1).length;
    const maxIn = front() ? 7 : 1;
    if (s > fr * 1.01 + srcPin && S.srcT <= 0 && nIn < maxIn && !S.dis.some(d => rel(d.x) < 1.5)) {
      mkDis(S.camX + SPAWN_X, { w: 0 });
      S.srcFreed = true;
      S.srcT = 1.0 / M.vScale;
    }

    // Pile-up at the grain boundary; the lead dislocation crosses once enough push on it.
    S.pile = 0;
    if (gbOn()) {
      let lead = null;
      for (const d of S.dis) {
        if (d.trans || d.x < G.xg - 12 || d.x > G.xg + 0.5) continue;
        S.pile++;
        if (!lead || d.x > lead.x) lead = d;
      }
      if (lead && S.pile >= M.nPile && s > fr) {
        S.transT += dt;
        if (S.transT > 0.5) {
          lead.trans = true;
          S.transT = 0;
          S.flash = 1;
          toast("Pile-up pushed slip across the grain boundary");
        }
      } else {
        S.transT = Math.max(0, S.transT - dt);
      }
    }
    S.flash = Math.max(0, S.flash - dt * 1.5);

    const Aint = 0.15 * fr;
    const kv = 1 - Math.exp(-dt / TAU_V);
    for (const d of S.dis) {
      let F = s + atmF(d.x) + obsF(d);
      for (const o of S.dis) {
        if (o === d) continue;
        const dx = d.x - o.x;
        if (dx > -10 && dx < 10) F += (o.w * Aint * dx) / (dx * dx + 0.5);
        if (dx > -2 && dx < 2) F += Math.sign(dx) * 0.6 * fr * Math.pow(1 - Math.abs(dx) / 2, 2);
      }
      if (gbOn() && !d.trans) F -= (4 * fr) / (1 + Math.exp(-(d.x - (G.xg - 0.7)) / 0.18));

      const ex = Math.abs(F) - fr;
      let vt = ex > 0 ? Math.sign(F) * Math.min(vMax, mob * ex) : 0;
      if (rel(d.x) < -0.6) vt = Math.max(vt, 10);
      if (rel(d.x) > G.NC + 1.5 && (d.trans || !gbOn())) vt = Math.max(vt, 10);
      d.v += (vt - d.v) * kv;
      d.x += d.v * dt;
      d.w = Math.min(1, d.w + dt / 0.35);

      const ci = Math.floor(d.x);
      if (ci > d.ci && inWin(d)) S.switches += ci - d.ci;
      d.ci = ci;

      let k = -1;
      if (obsOn()) G.obs.forEach((xo, i) => { if (Math.abs(d.x - xo) < 1.5) k = i; });
      if (k !== d.ok) { d.ok = k; d.ow = 0; }
      if (k >= 0 && Math.abs(d.v) < 0.1 * M.vAnim) d.ow += dt;

      if (d.main && !S.brokeFree && Math.abs(d.x - S.homeRel) > 1.2 && d.v > 0.3 * M.vAnim) {
        S.brokeFree = true;
        S.srcFreed = true;
        S.breakT = S.t;
        toast(M.nAtm && M.pinRef > 5
          ? `Tore free of its Cottrell atmosphere at ${Math.round(s)} MPa`
          : `Started gliding at ${Math.round(s)} MPa: no atmosphere to tear free from`);
      }
    }

    // Re-pinning by solute clusters after the first breakaway.
    if (S.D0 && S.brokeFree) {
      const slow = Math.abs(S.D0.v) < 0.1 * M.vAnim;
      S.pinnedT = slow ? S.pinnedT + dt : 0;
      const nowPinned = S.pinnedT > 0.3 && near(S.D0) > 0;
      if (nowPinned && !S.pinned) {
        S.repins++;
        toast(`Pinned again by a C/N cluster: stress climbs to tear it free`);
      }
      S.pinned = nowPinned;
    }

    // Camera: in the one-dislocation scene, follow the core in 16-spacing smoothstep pans.
    if (!front()) {
      if (S.pan) {
        S.pan.t += dt;
        const u = clamp(S.pan.t / PAN_TIME, 0, 1);
        S.camX = S.pan.from + (S.pan.to - S.pan.from) * u * u * (3 - 2 * u);
        if (u >= 1) S.pan = null;
      } else if (S.D0 && rel(S.D0.x) >= S.homeRel + S.panStep - 0.3) {
        S.pan = { from: S.camX, to: S.camX + S.panStep, t: 0 };
        makeCloud(S.nextCloud, CLOUD_PIN, "cloud");
        S.nextCloud += S.panStep;
      }
    }

    for (let i = S.dis.length - 1; i >= 0; i--) {
      const d = S.dis[i];
      if (rel(d.x) > G.NC + EXIT_X) {
        S.dis.splice(i, 1);
        S.g -= HSPLIT;
        if (d === S.D0) S.D0 = null;
      }
    }

    // C/N: thermally activated hops, plus fade in/out to follow the C+N slider.
    const rate = S.ageOn ? 45 : Math.min(60, M.K * 1.2 * M.vScale);
    const kr = 1 - Math.exp(-dt / 0.1);
    const span = 2 * (G.NC + 12);
    for (const c of S.car) {
      if (rate > 1e-4 && !c.dying) {
        let h = rate * dt;
        while (h >= 1) { hop(c); h--; }
        if (rand() < h) hop(c);
      }
      const X = rel(labX(c));
      if (c.kind === "free") {
        if (X > G.NC + 6) { c.p -= span; c.rp -= span; }
        else if (X < -6) { c.p += span; c.rp += span; }
      } else if (X < -8) {
        c.dying = true;
        c.a = 0;
      }
      c.rp += (c.p - c.rp) * kr;
      c.rq += (c.q - c.rq) * kr;
      c.a = c.dying ? c.a - dt / 0.4 : Math.min(1, c.a + dt / 0.4);
    }
    S.car = S.car.filter(c => c.a > 0 || !c.dying);

    S.cT -= dt;
    if (S.cT <= 0) {
      const free = S.car.filter(c => !c.dying && c.kind === "free");
      if (free.length < M.nFreeC) { randomCar(0); S.cT = 0.06; }
      else if (free.length > M.nFreeC) {
        free[Math.floor(rand() * free.length)].dying = true;
        S.cT = 0.06;
      }
    }

    S.t += dt;
    S.histT -= dt;
    if (S.histT <= 0) {
      S.hist.push([S.t, s]);
      S.histT = 0.05;
      while (S.hist.length && S.hist[0][0] < S.t - 30) S.hist.shift();
    }
  }

  // ---------- core geometry: edge-dislocation displacement profile ----------
  // Each half takes up its share of the Burgers vector through an arctangent step (the shape of
  // the elastic solution), compressed above the slip plane and stretched below it. The step
  // widens with distance from the slip plane, so columns fan out instead of staying rigid.
  const phi = (s, w) => 0.5 + Math.atan(s / w) / Math.PI;
  const widthAt = Yq => 0.7 + 0.45 * (Math.abs(Yq) - 0.5);

  function rankDis() {
    const sorted = S.dis.slice().sort((a, b) => a.x - b.x);
    sorted.forEach((d, i) => { d.L = i; });
  }

  // Signed distance (in columns) of upper-half index mp from each core; 0 = the inserted half-plane.
  function upperS(mp) {
    let sBest = 99, right = 0;
    for (const d of S.dis) {
      const s = mp - d.x - 0.5 - d.L;
      if (s > 0) right++;
      if (Math.abs(s) < Math.abs(sBest)) sBest = s;
    }
    return [sBest, right - (sBest > 0 ? 1 : 0)];
  }

  function upperX(mp, Yq) {
    const w = widthAt(Yq);
    let x = mp + S.g;
    for (const d of S.dis) x += -HSPLIT - (1 - 2 * HSPLIT) * phi(mp - d.x - 0.5 - d.L, w);
    return x;
  }

  function lowerX(X, Yq) {
    const w = widthAt(Yq);
    let x = X + S.g;
    for (const d of S.dis) x += -HSPLIT + 2 * HSPLIT * phi(X - d.x, w);
    return x;
  }

  // ---------- rendering ----------
  const sprites = {};
  function discSprite(key, cols, r, dpr) {
    const id = key + r.toFixed(2) + dpr;
    if (sprites[id]) return sprites[id];
    const s = Math.ceil((r * 2 + 2) * dpr);
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    const R = r * dpr, m = s / 2;
    const gr = g.createRadialGradient(m + R * 0.3, m - R * 0.45, R * 0.05, m, m, R);
    gr.addColorStop(0, cols[0]);
    gr.addColorStop(0.55, cols[1]);
    gr.addColorStop(1, cols[2]);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(m, m, R, 0, 7);
    g.fill();
    sprites[id] = c;
    return c;
  }

  function shadowSprite(r, a, dpr) {
    const id = "sh" + r.toFixed(2) + dpr;
    if (sprites[id]) return sprites[id];
    const blur = 0.13 * a;
    const s = Math.ceil((r * 2 + blur * 4) * dpr);
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    g.filter = `blur(${blur * dpr}px)`;
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.beginPath();
    g.ellipse(s / 2, s / 2, r * 1.02 * dpr, r * 0.96 * dpr, 0, 0, 7);
    g.fill();
    sprites[id] = c;
    return c;
  }

  function phase(i, j) {
    const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
    return (s - Math.floor(s)) * 6.2832;
  }

  function vibXY(i, j, t) {
    if (!M.vib) return [0, 0];
    const p = phase(i, j), q = phase(j + 17, i - 5);
    return [
      M.vib * (0.65 * Math.sin(t * 11.3 + p) + 0.35 * Math.sin(t * 17.9 + q)),
      M.vib * (0.65 * Math.sin(t * 12.7 + q) + 0.35 * Math.sin(t * 15.1 + p))
    ];
  }

  function smooth01(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function setupCanvas(cv) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return null;
    const rw = Math.round(W * dpr), rh = Math.round(H * dpr);
    if (cv.width !== rw || cv.height !== rh) { cv.width = rw; cv.height = rh; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W, H, dpr };
  }

  function pill(ctx, txt, x, y, col, alpha) {
    if (alpha <= 0.01) return;
    const a = G.a;
    ctx.font = `700 ${Math.round(clamp(a * 0.36, 12, 22))}px Inter, "Segoe UI", system-ui, sans-serif`;
    const w = ctx.measureText(txt).width + a * 0.5, h = a * 0.56;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, x, y + 1);
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  }

  function capAlpha(key, on, dt) {
    const v = S.caps[key] || 0;
    const nv = v + ((on ? 1 : 0) - v) * (1 - Math.exp(-dt / 0.25));
    S.caps[key] = nv;
    return nv;
  }

  function drawAtoms(t, dt, dtR) {
    const cv = $("atom");
    const c = setupCanvas(cv);
    if (!c) return;
    const { ctx, W, H, dpr } = c;
    const a = G.a;
    const X2p = X => G.ox + (X - S.camX) * a;
    const Y2p = Yq => G.cy - Yq * a;
    const gam = opt.shear ? (S.stress / G_MPA) * SHEAR_GAIN : 0;
    rankDis();

    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);
    if (gbOn()) {
      ctx.fillStyle = "rgba(20,24,30,0.10)";
      ctx.fillRect(X2p(lowerX(G.xg - 0.35, 0)), 0, W - X2p(lowerX(G.xg - 0.35, 0)), H);
    }

    // Lattice positions: compression above the slip plane, tension below, around every core.
    const nD = S.dis.length;
    const half = G.NR / 2;
    const lo0 = Math.floor(S.camX - 5), lo1 = Math.ceil(S.camX + G.NC + 5);
    const up0 = Math.floor(S.camX - 5 - S.upShift), up1 = Math.ceil(S.camX + G.NC + 5 - S.upShift + nD);
    const upS = [], upK = [], hw = [];
    for (let m = up0; m <= up1; m++) {
      const [s, k] = upperS(m + S.upShift);
      upS.push(s);
      upK.push(k);
      hw.push(clamp(1 - Math.abs(s), 0, 1));
    }

    const rows = [];
    for (let jr = 0; jr < G.NR; jr++) {
      const Yq = jr - half + 0.5;
      const up = Yq > 0;
      const row = [];
      if (up) {
        for (let k = 0; k < upS.length; k++) {
          const m = up0 + k;
          const xb = upperX(m + S.upShift, Yq);
          const [vx, vy] = vibXY(m, jr, t);
          row.push({ i: m, k, xb, px: X2p(xb + vx + gam * Yq), py: Y2p(Yq + vy) });
        }
      } else {
        for (let n = lo0; n <= lo1; n++) {
          const xb = lowerX(n, Yq);
          const [vx, vy] = vibXY(n, jr, t);
          row.push({ i: n, xb, px: X2p(xb + vx + gam * Yq), py: Y2p(Yq + vy) });
        }
      }
      rows.push({ Yq, up, row, i0: up ? up0 : lo0 });
    }

    // Solute positions follow the same displacement field as the host atoms around them.
    for (const cn of S.car) {
      const [X, Yq] = carDraw(cn);
      const xr = cn.q > 0 ? upperX(X + S.upShift, Yq) : lowerX(X, Yq);
      cn.px = X2p(xr + gam * Yq);
      cn.py = Y2p(Yq);
    }

    // Cloud glow behind everything.
    const glowR = 1.65 * a;
    for (const cn of S.car) {
      if (cn.px < -glowR || cn.px > W + glowR) continue;
      const g = ctx.createRadialGradient(cn.px, cn.py, 0, cn.px, cn.py, glowR);
      const al = (cn.kind === "free" ? 0.12 : 0.17) * cn.a;
      g.addColorStop(0, `rgba(${COL.glow},${al})`);
      g.addColorStop(0.55, `rgba(${COL.glow},${al * 0.55})`);
      g.addColorStop(1, `rgba(${COL.glow},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cn.px - glowR, cn.py - glowR, glowR * 2, glowR * 2);
    }

    // Drop shadows, down-right.
    const r = a * 0.236;
    const sh = shadowSprite(r, a, dpr);
    const shS = sh.width / dpr, shx = a * 0.11, shy = a * 0.15;
    ctx.globalAlpha = 0.9;
    for (const { row } of rows) {
      for (const A of row) {
        if (A.px < -a || A.px > W + a || A.py < -a || A.py > H + a) continue;
        ctx.drawImage(sh, A.px + shx - shS / 2, A.py + shy - shS / 2, shS, shS);
      }
    }
    ctx.globalAlpha = 1;

    // Bonds: straight segments. Across the slip plane every atom keeps exactly one partner,
    // chosen by lattice topology (one fewer partner index per core passed); the last atom of the
    // extra half-plane has none, which is the dangling bond at the core. As the core glides, the
    // lower atom under it hands its single bond from one upper column to the next.
    const lowTop = rows[half - 1], upBot = rows[half];
    const lowAt = n => lowTop.row[n - lowTop.i0];
    const partial = [];
    ctx.strokeStyle = COL.bond;
    ctx.lineWidth = Math.max(1.5, a * 0.04);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let jr = 0; jr < rows.length; jr++) {
      const R = rows[jr].row;
      for (let k = 1; k < R.length; k++) { ctx.moveTo(R[k - 1].px, R[k - 1].py); ctx.lineTo(R[k].px, R[k].py); }
      const nx = rows[jr + 1];
      if (!nx || nx.up !== rows[jr].up) continue;
      for (const A of R) {
        const B = nx.row[A.i - nx.i0];
        if (B) { ctx.moveTo(A.px, A.py); ctx.lineTo(B.px, B.py); }
      }
    }
    for (const U of upBot.row) {
      const s = upS[U.k];
      const mp = U.i + S.upShift - upK[U.k];
      const aRight = smooth01(0.25, 0.75, s);
      const aLeft = smooth01(0.25, 0.75, -s);
      for (const [n, al, kind] of [[mp - 1, aRight, "brk"], [mp, aLeft, "form"]]) {
        if (al <= 0.01) continue;
        const L = lowAt(n);
        if (!L) continue;
        if (al >= 0.99) { ctx.moveTo(U.px, U.py); ctx.lineTo(L.px, L.py); }
        else partial.push([U, L, al, kind]);
      }
    }
    ctx.stroke();
    for (const [U, L, al, kind] of partial) {
      ctx.strokeStyle = opt.hiBonds ? `rgba(${kind === "form" ? COL.form : COL.brk},${0.35 + 0.65 * al})` : COL.bond;
      ctx.globalAlpha = opt.hiBonds ? 1 : al;
      ctx.lineWidth = Math.max(1.5, a * (opt.hiBonds ? 0.06 : 0.04));
      ctx.beginPath();
      ctx.moveTo(U.px, U.py);
      ctx.lineTo(L.px, L.py);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Atoms; the half-plane colour crossfades linearly between the two columns at the core.
    const sFe = discSprite("fe", COL.fe, r, dpr), sHalf = discSprite("half", COL.half, r, dpr);
    const sz = sFe.width / dpr;
    for (const { up, row } of rows) {
      for (const A of row) {
        if (A.px < -a || A.px > W + a || A.py < -a || A.py > H + a) continue;
        const base = gbOn() && A.xb > lowerX(G.xg + 0.4, 0) ? 0.6 : 1;
        ctx.globalAlpha = base;
        ctx.drawImage(sFe, A.px - sz / 2, A.py - sz / 2, sz, sz);
        const h = up ? hw[A.k] : 0;
        if (h > 0.01) {
          ctx.globalAlpha = base * h;
          ctx.drawImage(sHalf, A.px - sz / 2, A.py - sz / 2, sz, sz);
        }
      }
    }
    ctx.globalAlpha = 1;

    if (obsOn()) {
      for (const xo of G.obs) {
        const px = X2p(lowerX(xo, -0.5));
        ctx.strokeStyle = "rgba(40,45,52,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, G.cy, a * 0.18, 0, 7);
        ctx.stroke();
        ctx.fillStyle = "rgba(40,45,52,0.8)";
        ctx.beginPath();
        ctx.arc(px, G.cy, a * 0.07, 0, 7);
        ctx.fill();
      }
    }

    // Solute discs, then a faint glow pass on top so atoms inside the cloud pick up the tint.
    const cr = a * 0.11;
    const sC = discSprite("cn", COL.cn, cr, dpr);
    const cs = sC.width / dpr;
    for (const cn of S.car) {
      ctx.globalAlpha = cn.a;
      ctx.drawImage(sC, cn.px - cs / 2, cn.py - cs / 2, cs, cs);
    }
    ctx.globalAlpha = 1;
    for (const cn of S.car) {
      if (cn.px < -a || cn.px > W + a) continue;
      const g = ctx.createRadialGradient(cn.px, cn.py, 0, cn.px, cn.py, a);
      g.addColorStop(0, `rgba(${COL.glow},${0.05 * cn.a})`);
      g.addColorStop(1, `rgba(${COL.glow},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cn.px - a, cn.py - a, 2 * a, 2 * a);
    }

    if (gbOn() && S.pile >= Math.max(1, M.nPile - 1)) {
      const k = Math.min(1, S.pile / M.nPile);
      const px = X2p(lowerX(G.xg + 0.1, 0));
      ctx.strokeStyle = `rgba(255,236,120,${0.25 + 0.45 * k + 0.3 * S.flash})`;
      ctx.lineWidth = 2.5;
      for (const rr of [10, 18, 26]) {
        ctx.beginPath();
        ctx.arc(px, G.cy, rr * (0.7 + 0.3 * k) + 8 * S.flash, -0.9, 0.9);
        ctx.stroke();
      }
    }

    // Captions in the video's style: white pills with bold coloured text.
    const D0 = S.D0 && inWin(S.D0) ? S.D0 : null;
    const restingHome = D0 && !S.brokeFree;
    const aDis = capAlpha("dis", opt.labels && restingHome && !S.ageOn, dtR);
    const aAtm = capAlpha("atm", opt.labels && (restingHome || S.ageOn), dtR);
    const aRe = capAlpha("re", opt.labels && D0 && S.pinned, dtR);
    if (D0) {
      pill(ctx, "dislocation", X2p(lowerX(D0.x, 0)), Y2p(3.0), COL.pillWarm, aDis);
      pill(ctx, "pinned again", X2p(lowerX(D0.x, 0)), Y2p(3.0), COL.pillWarm, aRe);
    }
    const home = S.car.filter(cn => cn.kind === "home" && !cn.dying);
    if (home.length) {
      const hx = home.reduce((acc, cn) => acc + cn.px, 0) / home.length;
      pill(ctx, "Cottrell atmosphere", clamp(hx, a * 2.5, W - a * 2.5), Y2p(-2.5), COL.pillText, aAtm);
    }
    let ahead = null;
    if (D0 && S.brokeFree && !S.pinned) {
      for (const cn of S.car) {
        if (cn.kind !== "cloud" || cn.dying || labX(cn) < D0.x + 1.5) continue;
        if (!ahead || labX(cn) < ahead.x) ahead = { x: labX(cn), cid: cn.cid };
      }
    }
    const aCl = capAlpha("cl", opt.labels && !!ahead && X2p(ahead ? ahead.x : 0) < W - a, dtR);
    if (ahead || aCl > 0.01) {
      if (ahead) S.caps.clX = ahead.x;
      pill(ctx, "C/N cluster", clamp(X2p(lowerX(S.caps.clX || 0, -1)), a * 2, W - a * 2), Y2p(-2.5), COL.pillText, aCl);
    }

    if (fadeA > 0 && fadeCanvas) {
      ctx.globalAlpha = fadeA;
      ctx.drawImage(fadeCanvas, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  function focusDis() {
    if (S.D0 && inWin(S.D0)) return S.D0;
    let best = null;
    for (const d of S.dis) {
      if (!inWin(d)) continue;
      if (!best || Math.abs(rel(d.x) - G.NC / 2) < Math.abs(rel(best.x) - G.NC / 2)) best = d;
    }
    return best;
  }

  function drawChart() {
    const c = setupCanvas($("chart"));
    if (!c) return;
    const { ctx, W, H } = c;
    ctx.clearRect(0, 0, W, H);
    const m = { l: 38, r: 10, t: 10, b: 20 };
    const top = 1.2 * Math.max(M.sUY, M.sLY + M.pinRef, ...S.hist.map(h => h[1]), 50);
    const t1 = Math.max(S.t, 30), t0 = t1 - 30;
    const X = t => m.l + ((t - t0) / 30) * (W - m.l - m.r);
    const Yp = s => m.t + (1 - s / top) * (H - m.t - m.b);

    ctx.strokeStyle = "rgba(148,163,184,0.12)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#7d8a9c";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    const stepS = top > 600 ? 200 : top > 300 ? 100 : 50;
    for (let s = 0; s <= top; s += stepS) {
      ctx.beginPath();
      ctx.moveTo(m.l, Yp(s));
      ctx.lineTo(W - m.r, Yp(s));
      ctx.stroke();
      ctx.fillText(String(s), m.l - 6, Yp(s) + 4);
    }
    ctx.textAlign = "left";
    ctx.fillText("MPa", 4, m.t + 4);
    ctx.textAlign = "right";
    ctx.fillText("last 30 s →", W - m.r, H - 5);

    const ref = (s, txt, col) => {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(m.l, Yp(s));
      ctx.lineTo(W - m.r, Yp(s));
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = col;
      ctx.textAlign = "left";
      ctx.fillText(txt, m.l + 6, Yp(s) - 4);
    };
    if (M.sUY - M.sLY > 3) ref(M.sUY, `σUY ${Math.round(M.sUY)}`, "#fbbf24");
    ref(M.sLY, `σLY ${Math.round(M.sLY)}`, "#60a5fa");

    if (S.hist.length > 1) {
      const grad = ctx.createLinearGradient(0, m.t, 0, H - m.b);
      grad.addColorStop(0, "rgba(45,212,191,0.28)");
      grad.addColorStop(1, "rgba(45,212,191,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(X(S.hist[0][0]), Yp(0));
      for (const [t, s] of S.hist) ctx.lineTo(X(t), Yp(s));
      ctx.lineTo(X(S.hist[S.hist.length - 1][0]), Yp(0));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#2dd4bf";
      ctx.lineWidth = 2;
      ctx.beginPath();
      S.hist.forEach(([t, s], i) => (i ? ctx.lineTo(X(t), Yp(s)) : ctx.moveTo(X(t), Yp(s))));
      ctx.stroke();
      const [tl, sl] = S.hist[S.hist.length - 1];
      ctx.fillStyle = "#2dd4bf";
      ctx.beginPath();
      ctx.arc(X(tl), Yp(sl), 3.5, 0, 7);
      ctx.fill();
    }
  }

  function drawLand() {
    const c = setupCanvas($("land"));
    if (!c) return;
    const { ctx, W, H } = c;
    ctx.clearRect(0, 0, W, H);
    const f = focusDis();
    ctx.font = "12px Inter, system-ui, sans-serif";
    if (!f) {
      ctx.fillStyle = "#7d8a9c";
      ctx.fillText("No dislocation in view", 8, 20);
      return;
    }
    const fr = M.sLY;
    const tilt = Math.max(0, S.stress - fr);
    const x0 = f.x - 3, x1 = f.x + 12, N = 160;
    const AP = 0.012 * fr;
    const E = x => AP * Math.pow(Math.sin(Math.PI * (x - 0.5)), 2) + M.pinScale * atmE(x) - tilt * (x - f.x);
    const pts = [];
    for (let i = 0; i <= N; i++) { const x = x0 + ((x1 - x0) * i) / N; pts.push([x, E(x)]); }
    const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
    const m = { l: 8, r: 8, t: 10, b: 18 };
    const X = x => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Yp = e => m.t + ((hi - e) / Math.max(hi - lo, 1e-6)) * (H - m.t - m.b);
    const grad = ctx.createLinearGradient(0, m.t, 0, H);
    grad.addColorStop(0, "rgba(96,165,250,0.18)");
    grad.addColorStop(1, "rgba(96,165,250,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    pts.forEach(([x, e], i) => (i ? ctx.lineTo(X(x), Yp(e)) : ctx.moveTo(X(x), Yp(e))));
    ctx.lineTo(X(x1), H);
    ctx.lineTo(X(x0), H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([x, e], i) => (i ? ctx.lineTo(X(x), Yp(e)) : ctx.moveTo(X(x), Yp(e))));
    ctx.stroke();
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(X(f.x), Yp(E(f.x)) - 7, 6, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#7d8a9c";
    ctx.textAlign = "right";
    ctx.fillText("position along slip plane →", W - m.r, H - 4);
    ctx.textAlign = "left";
  }

  // ---------- narrative, HUD, readouts ----------
  let toastT = 0;
  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("show"), 2800);
  }

  const PHASES = ["elastic", "locked", "break", "flow"];
  function currentPhase(f, nn, bk) {
    if (S.ageOn) return "locked";
    if (S.brokeFree && S.pinned) return "locked";
    if (S.brokeFree && S.t - S.breakT < 1.6) return "break";
    if (S.brokeFree) return "flow";
    if (S.stress < M.sLY) return "elastic";
    if (f && nn > 0 && bk > S.stress) return "locked";
    return "flow";
  }

  function story(ph, f, bk, nn) {
    const fr = Math.round(M.sLY);
    if (S.ageOn) return "Ageing: C and N diffuse into the dilatation zone under the core and lock it again. This is strain ageing, which brings the yield point back.";
    if (gbOn() && S.pile >= Math.max(2, M.nPile - 1)) return `${S.pile} dislocations are piled up at the grain boundary. With ${Math.round(Pe.d)} μm grains about ${M.nPile} are needed before the stress at the head of the pile-up starts slip in the next grain.`;
    switch (ph) {
      case "elastic":
        return `Below the lattice friction stress (${fr} MPa) nothing moves. The C/N atoms sit in the dilatation zone under the extra half-plane: a Cottrell atmosphere.`;
      case "locked":
        return S.brokeFree
          ? `Pinned again by a C/N cluster. The stress has to climb to about ${Math.round(bk)} MPa before it tears free; each of these is one zigzag in the stress trace.`
          : nn
            ? `Pinned. ${nn} C/N atoms hold the core; it only tears free at about ${Math.round(bk)} MPa (friction ${fr} + pinning ${Math.round(bk - M.sLY)} MPa). That peak is the upper yield point.`
            : "Waiting: the stress is just at the friction level.";
      case "break":
        return "Breakaway: the dislocation leaves its atmosphere behind. Once moving it only needs the lower stress, so the load drops.";
      default:
        if (!f) return "No dislocation in view. A new one enters from the source on the left.";
        if (M.K > 60) return "Gliding with C/N mobile enough to travel along, so there is no sharp breakaway: smooth yielding.";
        if (M.K > 0.02) return "Gliding, but C/N diffuse fast enough to catch the core whenever it slows and lock it again: dynamic strain ageing (Portevin–Le Chatelier serrations).";
        return "Gliding at the lower yield stress. At every step the inserted half-plane hands over to the next column: two slanted bonds let go and re-form one atom further on.";
    }
  }

  function regime() {
    return M.nAtm === 0 && M.nFreeC === 0 ? "none present" : M.K < 0.02 ? "left behind" : M.K < 60 ? "catch slow cores" : "move with the core";
  }

  function effects() {
    const D = M.D;
    $("eD").textContent = `Pile-up of ${M.nPile} crosses a boundary · Hall–Petch +${Math.round(D.sHP)} MPa`;
    $("eC").textContent = M.nAtm ? `${M.nAtm}-atom atmosphere · pinning +${Math.round(M.pinRef)} MPa` : "No atmosphere → no yield point";
    $("eR").textContent = M.nFree ? `${M.nFree} free dislocation${M.nFree > 1 ? "s" : ""} at start → smooth yielding` : "All locked at start → sharp yield point";
    $("eT").textContent = `Friction ${Math.round(M.sLY)} MPa · C/N ${regime()}`;
    $("eE").textContent = `Loading ×${M.vScale.toFixed(2)} · σUY ${Math.round(M.sUY)} MPa`;
  }

  function hud() {
    const sref = 1.25 * Math.max(M.sUY, M.sLY + M.pinRef, 1);
    $("hudS").textContent = Math.round(S.stress);
    $("gFill").style.width = `${clamp(S.stress / sref, 0, 1) * 100}%`;
    $("gLY").style.left = `${(M.sLY / sref) * 100}%`;
    $("gUY").style.left = `${(M.sUY / sref) * 100}%`;
    $("gUY").hidden = M.sUY - M.sLY < 3;
    $("hudB").textContent = S.switches;
  }

  function readouts() {
    const f = focusDis();
    const nn = f ? near(f) : 0;
    const bk = f ? breakaway(f) : M.sLY;
    const ph = currentPhase(f, nn, bk);
    const idx = PHASES.indexOf(ph);
    document.querySelectorAll("#phases li").forEach((li, i) => {
      li.classList.toggle("on", i === idx);
      li.classList.toggle("done", i < idx);
    });
    $("story").textContent = story(ph, f, bk, nn);
    $("tBreak").textContent = f && nn ? Math.round(bk) : Math.round(M.sLY);
    $("tUY").textContent = Math.round(M.sUY);
    $("tLY").textContent = Math.round(M.sLY);
    $("tHold").textContent = `${nn}`;
    const slow = (M.D.vLY / 2.48e-10) / M.vAnim;
    const rows = [
      ["C/N atoms", regime()],
      ["C/N hops per spacing glided", M.K < 0.01 ? Y.sciHtml(M.K) : M.K.toPrecision(2)],
      ["Atmosphere re-forms in", Y.fmtDur(M.tFull)],
      ["Re-pinned by clusters", String(S.repins)],
      ["Real glide speed", Y.vel(M.D.vLY)],
      ["Animation slowed by", slow > 1 ? `≈ ${Y.sciHtml(slow)}×` : "≈ real time"]
    ];
    $("read").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    effects();
  }

  // ---------- UI ----------
  const astm = d => (-6.6457 * Math.log10(d / 1000) - 3.298).toFixed(1);
  function outputs() {
    $("oD").textContent = `${Y.fmtD(P.d)} μm · ASTM ${astm(P.d)}`;
    $("oC").textContent = `${Math.round(P.c)} ppm`;
    $("oR").innerHTML = `${Y.sciHtml(P.rho)} m<sup>−2</sup>`;
    $("oT").textContent = `${Y.tC(P.T)} · ${Math.round(P.T)} K`;
    $("oE").innerHTML = Y.rateHtml(P.rate);
    document.querySelectorAll("#presets button").forEach(b => {
      const over = { ...Y.BASE, ...JSON.parse(b.dataset.over) };
      b.setAttribute("aria-pressed", String(["d", "c", "rho", "T", "rate"].every(k => Math.abs(over[k] - P[k]) / Math.max(Math.abs(over[k]), 1e-9) < 0.02)));
    });
  }

  function slidersFromP() {
    $("sD").value = Y.sFromD(P.d);
    $("sC").value = P.c;
    $("sR").value = Math.log10(P.rho);
    $("sT").value = P.T;
    $("sE").value = Math.log10(P.rate);
    outputs();
  }

  function stressSliderTop() {
    return 1.3 * Math.max(M.sUY, M.sLY + M.pinRef, 100);
  }

  function pressGroup(sel, btn) {
    document.querySelectorAll(sel).forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  }

  function setMode(m) {
    S.mode = m;
    pressGroup("[data-mode]", document.querySelector(`[data-mode="${m}"]`));
    $("manualCtl").hidden = m !== "manual";
    S.ageOn = false;
    $("age").setAttribute("aria-pressed", "false");
    $("age").textContent = "Age";
    if (m === "manual") {
      S.sManTarget = Math.min(S.stress, stressSliderTop());
      $("sS").value = Math.round((S.sManTarget / stressSliderTop()) * 1000);
      $("oS").textContent = `${Math.round(S.sManTarget)} MPa`;
    } else {
      reset(true);
    }
  }

  function setScene(sc) {
    opt.scene = sc;
    pressGroup("[data-scene]", document.querySelector(`[data-scene="${sc}"]`));
    $("frontOpts").hidden = sc !== "front";
    model();
    reset(true);
  }

  function init() {
    model();
    geom();
    reset(true);
    fadeA = 0;

    const pr = $("presets");
    for (const [name, over] of Y.PRESETS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.dataset.over = JSON.stringify(over);
      b.addEventListener("click", () => {
        Object.assign(P, Y.BASE, over);
        Object.assign(Pe, P);
        slidersFromP();
        model();
        reset(true);
      });
      pr.appendChild(b);
    }

    const bind = (id, fn) => {
      const el = $(id);
      el.addEventListener("input", () => { fn(+el.value); outputs(); });
      el.addEventListener("change", () => { if (opt.rerun && S.mode === "test") { Object.assign(Pe, P); model(); reset(true); } });
    };
    bind("sD", v => { P.d = Y.dFromS(v); });
    bind("sC", v => { P.c = v; });
    bind("sR", v => { P.rho = Math.pow(10, v); });
    bind("sT", v => { P.T = v; });
    bind("sE", v => { P.rate = Math.pow(10, v); });
    slidersFromP();

    document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
    document.querySelectorAll("[data-scene]").forEach(b => b.addEventListener("click", () => setScene(b.dataset.scene)));
    document.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => {
      S.speed = +b.dataset.speed;
      pressGroup("[data-speed]", b);
    }));
    $("restart").addEventListener("click", () => reset(true));
    const setPlaying = on => {
      S.playing = on;
      $("play").setAttribute("aria-pressed", String(on));
      $("play").setAttribute("aria-label", on ? "Pause" : "Play");
      $("icoPause").style.display = on ? "" : "none";
      $("icoPlay").style.display = on ? "none" : "";
    };
    $("play").addEventListener("click", () => setPlaying(!S.playing));
    document.addEventListener("keydown", ev => {
      if (ev.target.tagName === "INPUT") return;
      if (ev.code === "Space") { ev.preventDefault(); setPlaying(!S.playing); }
      if (ev.key === "r") reset(true);
    });
    $("sS").addEventListener("input", ev => {
      S.sManTarget = (+ev.target.value / 1000) * stressSliderTop();
      $("oS").textContent = `${Math.round(S.sManTarget)} MPa`;
    });
    $("fresh").addEventListener("click", () => { if (!S.dis.some(d => rel(d.x) < 1.5)) mkDis(S.camX + SPAWN_X, { w: 0 }); });
    $("age").addEventListener("click", () => {
      S.ageOn = !S.ageOn;
      $("age").setAttribute("aria-pressed", String(S.ageOn));
      $("age").textContent = S.ageOn ? "Stop ageing" : "Age";
    });
    for (const [id, key] of [["tObs", "obs"], ["tGB", "gb"], ["tShear", "shear"], ["tLabels", "labels"], ["tRerun", "rerun"], ["tHi", "hiBonds"]]) {
      $(id).addEventListener("change", ev => { opt[key] = ev.target.checked; });
    }

    let rt = 0;
    new ResizeObserver(() => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const cv = $("atom");
        if (Math.abs(cv.clientWidth - G.W) > 2 || Math.abs(cv.clientHeight - G.H) > 2) reset(true);
      }, 150);
    }).observe($("atom"));

    let last = 0, infoT = 0;
    const frame = now => {
      const dtR = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      let dtSim = 0;
      if (S.playing && dtR > 0) {
        easeParams(dtR);
        model();
        dtSim = dtR * S.speed;
        const n = Math.max(1, Math.ceil(dtSim / (1 / 120)));
        for (let i = 0; i < n; i++) step(dtSim / n);
      }
      fadeA = Math.max(0, fadeA - dtR / 0.45);
      drawAtoms(now / 1000, dtSim, dtR);
      hud();
      infoT -= dtR;
      if (infoT <= 0) {
        infoT = 0.15;
        drawChart();
        drawLand();
        readouts();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
