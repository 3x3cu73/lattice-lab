/* Atomic scale (2D cross-section, about 9 nm across) lattice simulation,
   Peierls + Cottrell energy landscape plot, live atomic readouts, and
   Follow-the-test vs Explore interactive mode.
   Ported faithfully from luders-band-simulator.html. */
(function (root) {
  "use strict";

  const YPP = () => root.LudersYPP;
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ATC = {
    fe: "#8f9aa6",
    feEdge: "#5f6a76",
    half: "#2347c6",
    c: "#b42318",
    mark: "#d9822b",
    bg: "#f1f3f6",
    ink: "#1d1f22"
  };

  const NU = 0.3;
  const C1 = 1 / (2 * Math.PI);
  const CA = 1 / (2 * (1 - NU));
  const CB = (1 - 2 * NU) / (4 * (1 - NU));
  const CC = 1 / (4 * (1 - NU));
  const UB = 0.5;
  const PRE = ["elastic", "upper", "smooth", "prebrittle"];
  const FLOW = ["drop", "luders", "hardening", "necking"];

  const AT = {
    mode: "follow",
    vis: false,
    raf: 0,
    last: 0,
    dis: [],
    car: [],
    offU: 0,
    offL: 0,
    mu: 0,
    ml: 0,
    steps: 0,
    e: 0,
    s: 0,
    stage: "elastic",
    prevFlow: false,
    flowed: false,
    ageOn: false,
    sMan: 0,
    sTop: 500,
    spawnT: 0,
    transT: 0,
    a: 22,
    NC: 30,
    NR: 12,
    W: 0,
    H: 0,
    ox: 0,
    cy: 0,
    nid: 0,
    infoT: 0,
    seed: 1,
    D0: null,
    homeP: 0,
    obs: [],
    key: "",
    pile: 0,
    nC: 12,
    nAtm: 5,
    nFree: 0,
    K: 0,
    sharp: 0,
    vib: 0.035,
    nPile: 4,
    vScale: 1,
    vAnim: 2,
    kT: 0.025,
    Ueff: 0.3,
    Smax: 0.1,
    tFull: 604800,
    pinRef: 40
  };

  let aR = null;
  let curRun = null;
  let els = {};

  function $(id) { return document.getElementById(id); }

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

  function siteOK(p, q) {
    return q !== 0 && ((p + q) & 1) === 0 && Math.abs(q) <= AT.NR - 1;
  }

  function labX(c) {
    return c.p / 2 + (c.q > 0 ? AT.offU : AT.offL);
  }

  function bestSites(x0, n) {
    const out = [];
    for (let p = Math.round(2 * x0) - 4; p <= Math.round(2 * x0) + 4; p++) {
      for (const q of [-1, -2, -3]) {
        if (((p + q) & 1) !== 0) continue;
        const X = p / 2, Y = q / 2;
        out.push([p, q, (1.09 * Y) / ((X - x0) * (X - x0) + Y * Y + 0.3)]);
      }
    }
    return out.sort((a, b) => a[2] - b[2]).slice(0, n);
  }

  function atomParams() {
    if (!curRun) return;
    const Y = YPP();
    const P = curRun.P;
    const D = curRun.D;
    const Dref = Y.derive({ ...P, rho: 5e11 });
    AT.pinRef = curRun.isCustom ? Math.max(D.dUY, 5) : Dref.dUY;
    AT.nC = P.c > 0 ? Math.round(2 + 0.35 * P.c) : 0;
    AT.nAtm = Math.round(Math.min(AT.nC, 5) * D.theta);
    AT.nFree = Math.round((3 * D.rhoEff) / (D.rhoEff + D.fLock * Y.rhoAnn));
    AT.K = D.K;
    AT.sharp = Y.clamp(D.sTh / 120, 0, 1);
    AT.vib = reduceMotion ? 0 : 0.035 * Math.sqrt(P.T / 298);
    AT.nPile = Y.clamp(Math.round(2 + 1.5 * Math.log2(Math.max(2, P.d) / 5)), 1, 7);
    AT.vScale = 0.6 + 0.25 * Math.log10(Math.max(P.rate, 1e-6) / 1e-5);
    AT.vAnim = 2.0 * AT.vScale;
    AT.kT = Y.kB * P.T;

    const cat = (P.c * 1e-6 * 55.85) / 12.01;
    const cv = Math.max(AT.nC, 1) / (2 * 30 * 12);
    AT.Ueff = cat > 0 ? Math.max(0.05, UB - AT.kT * Math.log(cv / cat)) : UB;

    const ref = bestSites(0, AT.nAtm).map(([p, q]) => [p / 2, q / 2]);
    let sm = 0;
    for (let x = 0; x < 4; x += 0.05) {
      const f = xx => ref.reduce((E, [X, Yp]) => E + (UB * 1.09 * Yp) / ((X - xx) * (X - xx) + Yp * Yp + 0.3), 0);
      sm = Math.max(sm, (f(x + 0.05) - f(x)) / 0.05);
    }
    AT.Smax = Math.max(sm, 0.04);
    AT.tFull = 7 * 86400 * Math.pow(30 / Math.max(P.c, 1), 1.5) * Math.exp((Y.Qd / Y.kB) * (1 / P.T - 1 / 298)) * (P.T / 298);
  }

  function atomGeom() {
    const cv = els.canvas;
    if (!cv) return;
    const W = cv.clientWidth || 720;
    const H = cv.clientHeight || 380;
    const a = YPP().clamp(W / 32, 16, 28);
    const NC = Math.max(18, Math.floor(W / a));
    const NR = Math.max(8, 2 * Math.floor((H / a - 1) / 2));
    Object.assign(AT, { W, H, a, NC, NR, ox: (W - NC * a) / 2 + a / 2, cy: H / 2 });
    AT.obs = [];
    for (let x = 3.5; x < NC - 6; x += 7) AT.obs.push(x);
  }

  function mkDis(x, main) {
    const d = { id: AT.nid++, x, xs: x, wait: 0, boost: 0, jump: 0, main, trans: false, moving: false };
    AT.dis.push(d);
    return d;
  }

  function atomReset(aged) {
    atomGeom();
    aR = YPP().rnd(++AT.seed * 7919);
    Object.assign(AT, { dis: [], car: [], offU: 0, offL: 0, steps: 0, spawnT: 0.6, transT: 0, flowed: false, prevFlow: false });
    AT.mu = AT.ml = Math.round(AT.NC * 0.16);
    const x0 = Math.round(AT.NC * 0.36);
    AT.homeP = 2 * x0;
    AT.D0 = mkDis(x0, true);
    const fp = [x0 + 6, x0 + 10, x0 - 7];
    for (let i = 0; i < AT.nFree; i++) mkDis(fp[i], false);
    const used = new Set();
    if (aged) {
      for (const [p, q] of bestSites(x0, AT.nAtm)) {
        AT.car.push({ p, q });
        used.add(p + "," + q);
      }
    }
    let guard = 0;
    while (AT.car.length < AT.nC && guard++ < 5000) {
      let p = Math.floor(aR() * 2 * AT.NC);
      const q = (aR() < 0.5 ? -1 : 1) * (1 + Math.floor(aR() * (AT.NR - 1)));
      if (((p + q) & 1) !== 0) p += 1;
      if (!siteOK(p, q) || used.has(p + "," + q) || (Math.abs(p / 2 - x0) < 3 && Math.abs(q / 2) < 3)) continue;
      used.add(p + "," + q);
      AT.car.push({ p, q });
    }
  }

  function eSum(X, Yp) {
    let E = 0;
    for (const d of AT.dis) {
      const dx = X - d.x;
      if (dx > -9 && dx < 9) E += (1.09 * Yp) / (dx * dx + Yp * Yp + 0.3);
    }
    return E;
  }

  function hop(c) {
    let p2 = c.p + (aR() < 0.5 ? -1 : 1);
    let q2 = c.q + (aR() < 0.5 ? -1 : 1);
    const offO = c.q > 0 ? AT.offU : AT.offL;
    if (q2 === 0) {
      q2 = -c.q;
      p2 = c.p + 2 * (offO - (q2 > 0 ? AT.offU : AT.offL));
    }
    if (!siteOK(p2, q2)) return;
    const off = q2 > 0 ? AT.offU : AT.offL;
    const X2 = p2 / 2 + off;
    if (X2 < -1.5 || X2 > AT.NC + 0.5) return;
    const dE = AT.Ueff * (eSum(X2, q2 / 2) - eSum(c.p / 2 + offO, c.q / 2));
    if (dE <= 0 || aR() < Math.exp(-dE / Math.max(AT.kT, 1e-5))) {
      c.p = p2;
      c.q = q2;
    }
  }

  function near(d) {
    let n = 0;
    for (const c of AT.car) {
      if (c.q < 0 && c.q >= -4 && Math.abs(labX(c) - d.x) <= 1.6) n++;
    }
    return n;
  }

  function pinOf(d) {
    return AT.nAtm > 0 ? AT.pinRef * Math.min(1, near(d) / AT.nAtm) : 0;
  }

  function snapX(x) {
    const s = AT.sharp;
    if (s < 0.05) return x;
    const f0 = Math.floor(x), f = x - f0, k = 1 + 5 * s;
    return f0 + (f < 0.5 ? 0.5 * Math.pow(2 * f, k) : 1 - 0.5 * Math.pow(2 * (1 - f), k));
  }

  function focusDis() {
    if (AT.D0 && AT.dis.includes(AT.D0)) return AT.D0;
    let best = null, bn = -1;
    for (const d of AT.dis) {
      const n = near(d);
      if (n > bn || (n === bn && best && Math.abs(d.x - AT.NC / 2) < Math.abs(best.x - AT.NC / 2))) {
        bn = n;
        best = d;
      }
    }
    return best;
  }

  function sigNow() {
    return AT.mode === "follow" ? AT.s : AT.sMan;
  }

  function atomStep(dt) {
    if (!curRun) return;
    const Y = YPP();
    const D = curRun.D;
    const st = curRun.st;
    const follow = AT.mode === "follow";
    const sLY = D.sLY;
    const sig = sigNow();
    const flowing = follow ? FLOW.includes(AT.stage) : sig >= sLY * 0.99;

    if (follow && flowing && !AT.prevFlow && st.yp && AT.D0 && AT.dis.includes(AT.D0)) {
      AT.D0.jump = 0.4;
    }
    AT.prevFlow = flowing;
    if (flowing) AT.flowed = true;

    const hard = follow && (AT.stage === "hardening" || AT.stage === "necking")
      ? Y.clamp((AT.e - st.eP1) / Math.max(st.eU - st.eP1, 1e-3), 0, 1)
      : 0;

    if (flowing && AT.dis.length < 10) {
      AT.spawnT -= dt;
      if (AT.spawnT <= 0) {
        mkDis(-3, false);
        AT.spawnT = follow
          ? ((AT.stage === "luders" || AT.stage === "drop") ? 1.5 : AT.stage === "necking" ? 0.7 : 1.0) / AT.vScale
          : 2.2;
      }
    }

    const xg = AT.NC - 2.5;
    const ds = AT.dis.slice().sort((a, b) => b.x - a.x);
    let pile = 0;
    for (const d of ds) if (!d.trans && d.x > xg - 14 && d.x < xg) pile++;
    AT.pile = pile;

    if (flowing && pile >= AT.nPile) {
      AT.transT += dt;
      if (AT.transT > 1.1) {
        const lead = ds.find(d => !d.trans && d.x < xg);
        if (lead) lead.trans = true;
        AT.transT = 0;
      }
    } else {
      AT.transT = 0;
    }

    let ahead = Infinity, j = 0;
    for (const d of ds) {
      const pn = pinOf(d);
      const nn = near(d);
      const limit = d.trans ? Infinity : (j === 0 ? xg - 0.8 : ahead - (0.9 + 0.75 * j));
      if (!d.trans) j++;
      let v = 0;
      const drag = AT.K > 50 ? 1 / (1 + 0.3 * nn) : 1;
      if (d.jump > 0) {
        d.jump -= dt;
        v = AT.vAnim * 3;
      } else if (d.wait > 0) {
        d.wait -= dt;
      } else if (flowing) {
        if (follow) {
          if (pn > 0.5) {
            d.boost += dt * Math.max(AT.pinRef, 5) * 1.2;
            if (d.boost >= pn) {
              d.boost = 0;
              d.jump = 0.35;
            }
          } else {
            v = AT.vAnim * drag * (1 - 0.45 * hard);
          }
        } else {
          const ex = sig - sLY * 0.99 - pn;
          if (ex >= 0) {
            if (pn > 0.5 && !d.moving) d.jump = 0.35;
            else v = AT.vAnim * Y.clamp(ex / (0.04 * sLY) + 0.25, 0.25, 1.6) * drag;
          }
        }
      }
      let nx = d.x + v * dt;
      if (d.jump <= 0) {
        for (const ox of AT.obs) {
          if (d.x < ox && nx >= ox) {
            nx = ox;
            d.wait = 0.45 + 0.5 * hard;
          }
        }
      }
      if (nx > limit) nx = Math.max(d.x, limit);
      d.moving = nx > d.x + 1e-6;
      d.x = nx;
      if (!d.trans) ahead = d.x;
    }

    for (let i = AT.dis.length - 1; i >= 0; i--) {
      if (AT.dis[i].x > AT.NC + 7) {
        AT.dis.splice(i, 1);
        AT.offU += 0.5;
        AT.offL -= 0.5;
        AT.steps++;
        if (Math.abs(AT.mu + AT.offU - AT.ml - AT.offL) >= 4) {
          const t0 = Math.round(AT.NC * 0.16);
          AT.mu = Math.round(t0 - AT.offU);
          AT.ml = Math.round(t0 - AT.offL);
        }
      }
    }

    for (const c of AT.car) {
      const X = labX(c);
      if (X > AT.NC + 1) c.p -= 2 * (AT.NC + 3);
      else if (X < -2) c.p += 2 * (AT.NC + 3);
    }

    for (const d of AT.dis) {
      let bow = 0;
      if (d === AT.D0 && !d.moving && d.jump <= 0) {
        const pn = pinOf(d);
        const top = follow ? Math.max(D.sUY, sLY + pn) : sLY + pn;
        if (pn > 0.5 && (follow ? PRE.includes(AT.stage) : true)) {
          bow = 0.45 * Y.clamp((sig - 0.6 * sLY) / Math.max(top - 0.6 * sLY, 1), 0, 1);
        }
      }
      d.xs = snapX(d.x) + bow;
    }

    const rate = AT.ageOn ? 45 : Math.min(60, AT.K * 1.2 * AT.vScale);
    if (rate > 1e-4) {
      for (const c of AT.car) {
        let h = rate * dt;
        while (h >= 1) { hop(c); h--; }
        if (aR() < h) hop(c);
      }
    }
  }

  function disp(X, Yp) {
    let ux = 0, uy = 0;
    for (const d of AT.dis) {
      const dx = X - d.xs;
      const r2 = dx * dx + Yp * Yp + 0.08;
      ux += C1 * (Math.atan2(Yp, dx) + (CA * dx * Yp) / r2);
      uy -= C1 * (CB * Math.log(r2 / (r2 + 60)) + (CC * (dx * dx - Yp * Yp)) / r2);
    }
    return [ux, uy];
  }

  function crackState() {
    if (AT.mode !== "follow" || !curRun) return null;
    const st = curRun.st;
    if (AT.stage === "prebrittle") {
      const q = YPP().clamp((AT.e - 0.85 * st.eF) / Math.max(0.15 * st.eF, 1e-6), 0, 1);
      return { tip: q * 0.55 * AT.NC, d: 1.4 * q, yc: 2 };
    }
    if (AT.stage === "fracture") {
      return { tip: AT.NC + 4, d: st.frac === "ductile" ? 2.8 : 2.0, yc: 2, blunt: st.frac === "ductile" };
    }
    return null;
  }

  function atomDraw(time) {
    const cv = els.canvas;
    if (!cv || !curRun) return;
    const { ctx, W, H } = setup(cv);
    if (!ctx || !W || !H) return;

    const Y = YPP();
    const cs = getComputedStyle(document.documentElement);
    const bgCol = (cs.getPropertyValue("--atom-bg") || ATC.bg).trim();
    const a = AT.a;
    const X2p = X => AT.ox + X * a;
    const Y2p = Yp => AT.cy - Yp * a;
    const ck = crackState();
    const xg = AT.NC - 2.5;

    ctx.fillStyle = bgCol;
    ctx.fillRect(0, 0, W, H);

    const crackY = (X, Yp) => {
      if (!ck) return 0;
      const dd = ck.d * Math.sqrt(Y.clamp((ck.tip - X) / (AT.NC * 0.6), 0, 1)) + (ck.blunt ? 0.4 : 0) * (ck.tip > X ? 1 : 0);
      return Yp > ck.yc ? dd / 2 : -dd / 2;
    };
    const vib = k => AT.vib * Math.sin(time * 23 + k * 2.39);

    // Grain boundary band
    ctx.fillStyle = "rgba(29,31,34,.08)";
    ctx.fillRect(X2p(xg - 0.35), 0, a * 0.7, H);

    // Fe atoms
    const r = a * 0.31;
    for (let jr = 0; jr < AT.NR; jr++) {
      const Yp = jr - AT.NR / 2 + 0.5;
      const up = Yp > 0;
      const off = up ? AT.offU : AT.offL;
      const i0 = Math.floor(-off - 3);
      const i1 = Math.ceil(AT.NC - off + 3);
      for (let i = i0; i <= i1; i++) {
        const X0 = i + off;
        const [ux, uy] = disp(X0, Yp);
        const X = X0 + ux + vib(i * 7 + jr);
        const Yd = Yp + uy + vib(i * 3 + jr * 11 + 5) + crackY(X0, Yp);
        const px = X2p(X);
        const py = Y2p(Yd);
        if (px < -a || px > W + a || py < -a || py > H + a) continue;
        let fill = ATC.fe;
        if (up ? i === AT.mu : i === AT.ml) fill = ATC.mark;
        if (up) {
          for (const d of AT.dis) {
            if (Math.abs(X0 - d.xs) < 0.5) fill = ATC.half;
          }
        }
        ctx.globalAlpha = X0 > xg + 0.4 ? 0.55 : 1;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, 7);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = ATC.feEdge;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Slip plane & obstacles
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(35,71,198,.48)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, AT.cy);
    ctx.lineTo(W, AT.cy);
    ctx.stroke();
    ctx.restore();

    for (const ox of AT.obs) {
      const px = X2p(ox), py = AT.cy;
      ctx.fillStyle = "#4a4f57";
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, 7);
      ctx.fill();
      ctx.strokeStyle = "#4a4f57";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, 7);
      ctx.stroke();
    }

    // Carbon / nitrogen atoms
    for (const c of AT.car) {
      const X0 = labX(c);
      const Yp = c.q / 2;
      const [ux, uy] = disp(X0, Yp);
      const px = X2p(X0 + ux + vib(c.p * 5 + c.q));
      const py = Y2p(Yp + uy + crackY(X0, Yp));
      const bound = c.q < 0 && c.q >= -4 && AT.dis.some(d => Math.abs(X0 - d.x) <= 1.6);
      if (bound) {
        ctx.fillStyle = "rgba(180,35,24,.18)";
        ctx.beginPath();
        ctx.arc(px, py, a * 0.32, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = ATC.c;
      ctx.beginPath();
      ctx.arc(px, py, a * 0.17, 0, 7);
      ctx.fill();
    }

    // Dislocation symbols ⊥
    for (const d of AT.dis) {
      const px = X2p(d.xs), py = AT.cy, s = a * 0.55;
      if (px < -20 || px > W + 20) continue;
      ctx.strokeStyle = ATC.half;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px - s, py);
      ctx.lineTo(px + s, py);
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - s * 1.3);
      ctx.stroke();
    }

    // Pile-up stress concentration arcs at grain boundary
    if (AT.pile >= Math.max(1, AT.nPile - 1) && FLOW.includes(AT.mode === "follow" ? AT.stage : "drop")) {
      const px = X2p(xg + 0.2);
      const k = Math.min(1, AT.pile / AT.nPile);
      ctx.strokeStyle = `rgba(180,35,24,${0.35 + 0.5 * k})`;
      ctx.lineWidth = 2.5;
      for (const rr of [10, 18, 26]) {
        ctx.beginPath();
        ctx.arc(px, AT.cy, rr * (0.7 + 0.3 * k), -0.9, 0.9);
        ctx.stroke();
      }
    }

    // Labels with crisp halo
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    const label = (t, x, y, col, al) => {
      ctx.textAlign = al || "left";
      ctx.lineWidth = 4;
      ctx.strokeStyle = bgCol;
      ctx.strokeText(t, x, y);
      ctx.fillStyle = col || ATC.ink;
      ctx.fillText(t, x, y);
    };

    label("Grain boundary", X2p(xg) - 8, H - 30, ATC.ink, "right");
    label("Slip plane", 8, AT.cy - 8, ATC.half, "left");
    if (AT.D0 && AT.dis.includes(AT.D0) && !AT.D0.moving) {
      const lx = Y.clamp(X2p(AT.D0.xs) + 10, 88, W - 120);
      label("Edge dislocation", lx, AT.cy - a * 1.1, ATC.half, "left");
    }
    const home = AT.car.filter(c => c.q < 0 && c.q >= -4 && Math.abs(labX(c) - (AT.homeP / 2 + AT.offL)) <= 2);
    if (home.length) {
      const hx = home.reduce((sum, c) => sum + labX(c), 0) / home.length;
      label("C/N atmosphere", Y.clamp(X2p(hx), 64, W - 64), Y2p(-2.6), ATC.c, "center");
    }
    if (ck && ck.d > 0.3) {
      label(curRun.st.frac === "ductile" ? "Crack" : "Cleavage crack", 8, Y2p(ck.yc) - 6, ATC.ink, "left");
    }

    // Applied shear stress arrows
    const sig = sigNow();
    const sref = Math.max(curRun.D.sUY, curRun.st.uts, 1);
    const len = 30 + 110 * Y.clamp(sig / sref, 0, 1.3);
    ctx.strokeStyle = ATC.ink;
    ctx.fillStyle = ATC.ink;
    ctx.lineWidth = 2.5;
    for (const [y, dir] of [[H - 10, -1], [12, 1]]) {
      const x0 = Math.max(W * 0.5, 175);
      const x1 = x0 + dir * len;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1 + dir * 8, y);
      ctx.lineTo(x1, y - 5.5);
      ctx.lineTo(x1, y + 5.5);
      ctx.closePath();
      ctx.fill();
    }
    label(`Shear from ${Math.round(sig)} MPa`, Math.max(W * 0.5, 175) - 10, 16, ATC.ink, "right");

    // Scale bar: 1 nm = 1 / 0.248 spacings
    const sb = a / 0.248;
    ctx.fillStyle = ATC.ink;
    ctx.fillRect(10, H - 16, sb, 3);
    label("1 nm", 10 + sb + 6, H - 10, ATC.ink, "left");
  }

  function drawLand() {
    const svg = els.land;
    if (!svg || !curRun) return;
    const W = svg.clientWidth;
    const H = svg.clientHeight;
    if (!W || !H) return;
    const f = focusDis();
    if (!f) { svg.innerHTML = ""; return; }

    const cs = getComputedStyle(document.documentElement);
    const ink = (cs.getPropertyValue("--ink") || "#e8ecef").trim();
    const mute = (cs.getPropertyValue("--mute") || "#9ba4ad").trim();
    const trace = (cs.getPropertyValue("--trace") || "#ff6b5e").trim();

    const D = curRun.D;
    const sLY = D.sLY;
    const sig = sigNow();
    const pn = pinOf(f);
    const follow = AT.mode === "follow";
    const flowingNow = follow ? FLOW.includes(AT.stage) : sig >= sLY * 0.99;
    const top = sLY + Math.max(AT.pinRef, 5);
    let F = (Math.max(0, sig - 0.6 * sLY) / Math.max(top - 0.6 * sLY, 1)) * AT.Smax;
    if (follow && flowingNow) F = 0.55 * AT.Smax;
    const Fly = (Math.max(0, 0.4 * sLY) / Math.max(top - 0.6 * sLY, 1)) * AT.Smax;
    const AP = Fly / Math.PI;
    const x0 = f.xs - 3, x1 = f.xs + 9, N = 90;
    const pts = [];
    const Ex = x => {
      let E = AP * Math.pow(Math.sin(Math.PI * x), 2) - F * (x - f.xs);
      for (const c of AT.car) {
        const Yp = c.q / 2, X = labX(c);
        E += (UB * 1.09 * Yp) / ((X - x) * (X - x) + Yp * Yp + 0.3);
      }
      return E;
    };
    for (let i = 0; i <= N; i++) {
      const x = x0 + ((x1 - x0) * i) / N;
      pts.push([x, Ex(x)]);
    }
    let xm = f.xs, e0 = Ex(f.xs);
    if (!(f.moving || f.jump > 0)) {
      for (let x = f.x - 0.6; x <= f.x + 2.2; x += 0.02) {
        const E = Ex(x);
        if (E < e0) { e0 = E; xm = x; }
      }
    }
    const lo = Math.min(...pts.map(p => p[1]), e0 - 0.3);
    const hi = Math.max(...pts.map(p => p[1]), e0 + 0.3);
    const m = { l: 12, r: 10, t: 26, b: 22 };
    const X = x => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Yp = E => m.t + ((hi - E) / Math.max(hi - lo, 1e-6)) * (H - m.t - m.b);
    let bar = 0;
    for (const [x, E] of pts) if (x > xm && x < xm + 3) bar = Math.max(bar, E - e0);
    const free = f.moving || f.jump > 0 || (flowingNow && (follow ? pn <= 0.5 : sig >= sLY * 0.99 + pn));

    const pathD = pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Yp(p[1]).toFixed(1)).join("");
    svg.innerHTML =
      `<path d="${pathD}" fill="none" stroke="${ink}" stroke-width="2"/>` +
      `<circle cx="${X(xm).toFixed(1)}" cy="${(Yp(e0) - 7).toFixed(1)}" r="6.5" fill="${trace}"/>` +
      `<text x="${m.l}" y="16" font-weight="600" fill="${ink}">${free ? "Gliding" : `Barrier ${bar < 0.01 ? "<0.01" : bar.toFixed(2)} eV`}</text>` +
      `<text x="${W - m.r}" y="${H - 6}" text-anchor="end" fill="${mute}">slip plane</text>`;
  }

  function atomInfo() {
    if (!curRun) return;
    const Y = YPP();
    const D = curRun.D;
    const f = focusDis();
    const sig = sigNow();
    const pn = f ? pinOf(f) : 0;
    const nn = f ? near(f) : 0;
    const follow = AT.mode === "follow";
    const reg = AT.nC === 0 ? "none present" : AT.K < 0.02 ? "left behind" : AT.K < 60 ? "catch waiting ones" : "move with them";

    const rows = [
      ["Stress", `${Math.round(sig)} MPa`],
      ["C/N holding", `${nn} of ${AT.nAtm}`],
      ["Unlocks at", pn > 0.5 ? `${Math.round(D.sLY + pn)} MPa` : `${Math.round(D.sLY)} MPa`],
      ["C/N", reg],
      ["Hops", AT.nC ? (AT.K < 0.01 ? Y.sciHtml(AT.K) : AT.K.toPrecision(2)) : "–"],
      ["Re-forms", Y.fmtDur(AT.tFull)],
      ["Glide speed", Y.vel(follow && PRE.includes(AT.stage) ? D.vUY : D.vLY)]
    ];
    if (!follow) {
      rows.push(["Aged", AT.nAtm ? Y.fmtDur(AT.tFull * Math.pow(Math.min(1, nn / AT.nAtm), 1.5)) : "–"]);
    }
    if (els.der) els.der.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    if (els.text) els.text.textContent = "";
    if (els.oAS) els.oAS.textContent = `${Math.round(AT.sMan)} MPa`;
  }

  function atomFrame(t) {
    const dt = AT.last ? Math.min(0.05, (t - AT.last) / 1000) : 0;
    AT.last = t;
    if (!AT.vis || document.hidden) {
      AT.raf = 0;
      AT.last = 0;
      return;
    }
    const cv = els.canvas;
    if (cv && cv.clientWidth > 0 && cv.clientHeight > 0) {
      const key = cv.clientWidth + "x" + cv.clientHeight;
      if (key !== AT.key) {
        AT.key = key;
        atomReset(true);
      }
      atomStep(dt);
      atomDraw(t / 1000);
      AT.infoT -= dt;
      if (AT.infoT <= 0) {
        AT.infoT = 0.16;
        atomInfo();
        drawLand();
      }
    }
    AT.raf = window.requestAnimationFrame(atomFrame);
  }

  function kick() {
    if (!AT.raf && AT.vis) {
      AT.last = 0;
      AT.raf = window.requestAnimationFrame(atomFrame);
    }
  }

  function setMode(m) {
    AT.mode = m;
    if (els.followBtn) els.followBtn.setAttribute("aria-pressed", m === "follow" ? "true" : "false");
    if (els.exploreBtn) els.exploreBtn.setAttribute("aria-pressed", m === "explore" ? "true" : "false");
    if (els.ctl) els.ctl.hidden = m !== "explore";
    AT.ageOn = false;
    if (els.ageBtn) {
      els.ageBtn.setAttribute("aria-pressed", "false");
      els.ageBtn.textContent = "Age";
    }
    if (m === "explore" && curRun) {
      AT.sMan = 0.9 * curRun.D.sLY;
      if (els.sSlider) els.sSlider.value = String(Math.round((AT.sMan / Math.max(AT.sTop, 1)) * 1000));
    }
    atomReset(true);
    atomInfo();
    drawLand();
  }

  function init() {
    els = {
      canvas: $("atom"),
      land: $("land"),
      der: $("aDer"),
      text: $("aText"),
      oAS: $("oAS"),
      sSlider: $("aS"),
      ctl: $("aCtl"),
      followBtn: $("aFollow"),
      exploreBtn: $("aExplore"),
      freshBtn: $("aFresh"),
      ageBtn: $("aAge")
    };
    if (els.followBtn) els.followBtn.addEventListener("click", () => setMode("follow"));
    if (els.exploreBtn) els.exploreBtn.addEventListener("click", () => setMode("explore"));
    if (els.sSlider) {
      els.sSlider.addEventListener("input", ev => {
        AT.sMan = (+ev.target.value / 1000) * AT.sTop;
        atomInfo();
        drawLand();
      });
    }
    if (els.freshBtn) {
      els.freshBtn.addEventListener("click", () => {
        atomReset(false);
        atomInfo();
        drawLand();
      });
    }
    if (els.ageBtn) {
      els.ageBtn.addEventListener("click", () => {
        AT.ageOn = !AT.ageOn;
        els.ageBtn.setAttribute("aria-pressed", AT.ageOn ? "true" : "false");
        els.ageBtn.textContent = AT.ageOn ? "Stop ageing" : "Age";
        atomInfo();
      });
    }
    document.addEventListener("visibilitychange", kick);
  }

  function setRun(run) {
    curRun = run;
    if (!curRun) return;
    atomParams();
    AT.sTop = 1.25 * Math.max(curRun.D.sUY, curRun.D.sLY + AT.pinRef, 100);
    if (!AT.sMan || AT.sMan > AT.sTop) AT.sMan = 0.9 * curRun.D.sLY;
    if (els.sSlider) els.sSlider.value = String(Math.round((AT.sMan / AT.sTop) * 1000));
    atomReset(true);
    if (AT.vis) {
      atomDraw(performance.now() / 1000);
      atomInfo();
      drawLand();
    }
  }

  function sync(e, s, stage) {
    AT.e = e;
    AT.s = s;
    if (AT.mode === "follow" && PRE.includes(stage) && AT.flowed) {
      atomReset(true);
    }
    AT.stage = stage;
    if (AT.vis) {
      AT.infoT = 0;
    }
  }

  function setVisible(vis) {
    AT.vis = !!vis;
    if (AT.vis) {
      AT.key = "";
      AT.infoT = 0;
      kick();
    } else if (AT.raf) {
      window.cancelAnimationFrame(AT.raf);
      AT.raf = 0;
      AT.last = 0;
    }
  }

  function redraw() {
    if (!curRun) return;
    if (AT.vis) {
      atomDraw(performance.now() / 1000);
      atomInfo();
      drawLand();
    } else {
      drawLand();
    }
  }

  root.LudersAtomicYPP = { init, setRun, sync, setVisible, setMode, redraw };
})(typeof window !== "undefined" ? window : globalThis);
