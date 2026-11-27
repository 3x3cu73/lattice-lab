/* Shared crystal, kinetics and curve contract for the grain and atomic views.
   The macro tensile test still owns stress. Branch curves below are elastic
   continuations of that curve (same flow stress, same modulus), not a second model. */
(function (root) {
  "use strict";

  var A_NM = 0.2866;
  var B_NM = A_NM * Math.sqrt(3) / 2;
  var NU = 0.29;
  var G_MPA = 80000;
  var E_MPA = 210000;
  var EPS_DOT = 1e-3;
  var CORE_NM = B_NM;

  var S3 = Math.sqrt(3);
  var S2 = Math.sqrt(2);
  var S6 = Math.sqrt(6);

  function clamp01(u) {
    if (u < 0) return 0;
    if (u > 1) return 1;
    return u;
  }

  function volterra(x, y) {
    var r2s = x * x + y * y + CORE_NM * CORE_NM;
    var pref = B_NM / (2 * Math.PI);
    var om = 1 - NU;
    var ang = Math.atan2(y, x);
    var ux = pref * (ang + (x * y) / (2 * om * r2s));
    var uy = -pref * (((1 - 2 * NU) / (4 * om)) * Math.log(r2s) + (x * x - y * y) / (4 * om * r2s));
    var c = (G_MPA * B_NM * (1 + NU)) / (3 * Math.PI * om);
    var sh = -c * y / r2s;
    return { ux: ux, uy: uy, sh: sh };
  }

  /* Closure failure of a Burgers circuit around the core: the jump in u_x
     across the cut on the negative x side. That jump is a/2[111]. */
  function burgersClosure() {
    var above = volterra(-1.2, 0.015);
    var below = volterra(-1.2, -0.015);
    var bx = above.ux - below.ux;
    var by = above.uy - below.uy;
    return { bx: bx, by: by, b: Math.abs(bx) };
  }

  function toBox(rx, ry, rz) {
    return {
      x: (rx + ry + rz) / S3,
      y: (-rx + ry) / S2,
      z: (rx + ry - 2 * rz) / S6
    };
  }

  function toCrystal(x, y, z) {
    return [
      x / S3 - y / S2 + z / S6,
      x / S3 + y / S2 + z / S6,
      x / S3 - 2 * z / S6
    ];
  }

  var OCTA = [
    [0.5, 0, 0],
    [0, 0.5, 0],
    [0, 0, 0.5],
    [0.5, 0.5, 0],
    [0.5, 0, 0.5],
    [0, 0.5, 0.5]
  ];

  function nearInt(v) {
    return Math.abs(v - Math.round(v)) < 1e-4;
  }

  function nearHalf(v) {
    return Math.abs(v - Math.round(v) - 0.5) < 1e-4 || Math.abs(v - Math.round(v) + 0.5) < 1e-4;
  }

  function isBccLatticePoint(fx, fy, fz) {
    var ix = nearInt(fx) && nearInt(fy) && nearInt(fz);
    var hx = nearHalf(fx) && nearHalf(fy) && nearHalf(fz);
    return ix || hx;
  }

  function isOctahedralFrac(fx, fy, fz) {
    var k, o, qx, qy, qz;
    for (k = 0; k < OCTA.length; k++) {
      o = OCTA[k];
      qx = fx - o[0];
      qy = fy - o[1];
      qz = fz - o[2];
      if (isBccLatticePoint(qx, qy, qz)) return true;
    }
    return false;
  }

  function isLatticeFrac(fx, fy, fz) {
    return isBccLatticePoint(fx, fy, fz);
  }

  function variantOf(ox, oy, oz) {
    if (Math.abs(ox - 0.5) < 1e-6 && Math.abs(oy) < 1e-6 && Math.abs(oz) < 1e-6) return "x";
    if (Math.abs(oy - 0.5) < 1e-6 && Math.abs(ox) < 1e-6 && Math.abs(oz) < 1e-6) return "y";
    if (Math.abs(oz - 0.5) < 1e-6 && Math.abs(ox) < 1e-6 && Math.abs(oy) < 1e-6) return "z";
    if (Math.abs(ox - 0.5) < 1e-6 && Math.abs(oy - 0.5) < 1e-6) return "z";
    if (Math.abs(ox - 0.5) < 1e-6 && Math.abs(oz - 0.5) < 1e-6) return "y";
    return "x";
  }

  function buildCrystal(opts) {
    opts = opts || {};
    var hx = opts.hx == null ? 5 : opts.hx;
    var hy = opts.hy == null ? 3 : opts.hy;
    var hz = opts.hz == null ? 2 : opts.hz;
    var n1, n2, n3, b, p, box;
    var fe = [];
    var half = [];
    var core = [];
    var span = Math.ceil((hx + hy + hz) / A_NM) + 3;
    for (n1 = -span; n1 <= span; n1++) {
      for (n2 = -span; n2 <= span; n2++) {
        for (n3 = -span; n3 <= span; n3++) {
          for (b = 0; b < 2; b++) {
            var fx = n1 + (b ? 0.5 : 0);
            var fy = n2 + (b ? 0.5 : 0);
            var fz = n3 + (b ? 0.5 : 0);
            p = toBox(fx * A_NM, fy * A_NM, fz * A_NM);
            if (p.x < -hx || p.x > hx || p.y < -hy || p.y > hy || p.z < -hz || p.z > hz) continue;
            var i = fe.length;
            fe.push(p.x, p.y, p.z);
            var onHalf = p.y > 0.12 && Math.abs(p.x) <= 0.083 * 1.5 + 0.02;
            var onCore = Math.hypot(p.x, p.y) < 0.42 && p.y > -0.05;
            half.push(onHalf ? 1 : 0);
            core.push(onCore && !onHalf ? 1 : 0);
            if (onHalf) core[i] = 0;
          }
        }
      }
    }

    var sol = [];
    var solVar = [];
    for (n1 = -span; n1 <= span; n1++) {
      for (n2 = -span; n2 <= span; n2++) {
        for (n3 = -span; n3 <= span; n3++) {
          var oi;
          for (oi = 0; oi < OCTA.length; oi++) {
            var o = OCTA[oi];
            p = toBox((n1 + o[0]) * A_NM, (n2 + o[1]) * A_NM, (n3 + o[2]) * A_NM);
            if (p.y > -0.22 || p.y < -2.15) continue;
            if (p.x < -1.7 || p.x > 1.7) continue;
            if (p.z < -hz + 0.05 || p.z > hz - 0.05) continue;
            sol.push(p.x, p.y, p.z);
            solVar.push(variantOf(o[0], o[1], o[2]));
          }
        }
      }
    }
    var keep = sol.length / 3;
    var maxSol = opts.maxSol == null ? 320 : opts.maxSol;
    var sx = [], sy = [], sz = [], sv = [];
    if (keep > maxSol) {
      var stride = Math.ceil(keep / maxSol);
      var s;
      for (s = 0; s < keep; s += stride) {
        sx.push(sol[s * 3]);
        sy.push(sol[s * 3 + 1]);
        sz.push(sol[s * 3 + 2]);
        sv.push(solVar[s]);
      }
    } else {
      var s2;
      for (s2 = 0; s2 < keep; s2++) {
        sx.push(sol[s2 * 3]);
        sy.push(sol[s2 * 3 + 1]);
        sz.push(sol[s2 * 3 + 2]);
        sv.push(solVar[s2]);
      }
    }

    return {
      a: A_NM,
      b: B_NM,
      fe: fe,
      half: half,
      core: core,
      nFe: fe.length / 3,
      solX: sx,
      solY: sy,
      solZ: sz,
      solVar: sv,
      nSol: sx.length,
      box: { hx: hx, hy: hy, hz: hz }
    };
  }

  function hallPetch(dUm) {
    var d = dUm * 1e-6;
    return 100 + 0.7 / Math.sqrt(d);
  }

  function ludersStrainOf(dUm) {
    return 0.02 * Math.sqrt(20 / dUm);
  }

  /* Stated hop rates for carbon, Arrhenius in 1/T between 25 °C and 170 °C.
     Nitrogen is faster (lower barrier), same sites. */
  function hopRate(tempC, solute) {
    var r25 = solute === "N" ? 0.2 : 1 / 40;
    var r170 = solute === "N" ? 8000 : 1000;
    var T = tempC + 273.15;
    var inv1 = 1 / 298.15;
    var inv2 = 1 / 443.15;
    var ln = Math.log(r25) + (Math.log(r170) - Math.log(r25)) * ((1 / T) - inv1) / (inv2 - inv1);
    return Math.exp(ln);
  }

  function tSat(tempC, solute) {
    return 1200 * hopRate(170, "C") / hopRate(tempC, solute);
  }

  function segregation(tSec, tempC, solute) {
    var ts = tSat(tempC, solute);
    if (ts <= 0) return 1;
    var f = Math.pow(Math.max(0, tSec) / ts, 2 / 3);
    return f > 1 ? 1 : f;
  }

  function formatSimTime(sec) {
    if (sec < 90) return Math.round(sec) + " s";
    if (sec < 5400) return (sec / 60).toFixed(sec < 600 ? 1 : 0) + " min";
    if (sec < 172800) return (sec / 3600).toFixed(1) + " h";
    return (sec / 86400).toFixed(1) + " d";
  }

  var RHO0 = 1e10;
  var RHO1 = 1e13;

  function mobileDensity(phase, u) {
    u = clamp01(u);
    if (phase === "intro" || phase === "elastic") return RHO0;
    if (phase === "upper_yield") return RHO0 * Math.pow(10, 0.5 * u);
    if (phase === "drop") return RHO0 * Math.pow(10, 0.5 + 2.5 * u);
    if (phase === "luders") return RHO1;
    if (phase === "hardening") return RHO1 * Math.pow(10, 0.3 * u);
    if (phase === "unload" || phase === "aging") return RHO1;
    if (phase === "reload_now") return RHO1 * Math.pow(10, 0.15 * u);
    if (phase === "reload_aged") {
      if (u < 0.32) return RHO0 * Math.pow(10, 0.5 * (u / 0.32));
      return RHO0 * Math.pow(10, 0.5 + 2.5 * clamp01((u - 0.32) / 0.68));
    }
    return RHO0;
  }

  function orowanVelocity(rho) {
    var bM = B_NM * 1e-9;
    if (rho <= 0) return 0;
    return EPS_DOT / (rho * bM);
  }

  function branchPoint(flow, upper, e0, kind, u) {
    u = clamp01(u);
    var gap = Math.max(15, upper - flow);
    var de = flow / E_MPA;
    var eLow = e0 - de;
    if (kind === "unload" || kind === "skin") {
      return { strain: e0 - de * u, stress: flow * (1 - u) };
    }
    if (kind === "age") {
      return { strain: eLow, stress: 0 };
    }
    if (kind === "reload_now") {
      if (u < 0.4) {
        var t = u / 0.4;
        return { strain: eLow + de * t, stress: flow * t };
      }
      var t2 = (u - 0.4) / 0.6;
      return { strain: e0 + 0.012 * t2, stress: flow * (1 + 0.06 * t2) };
    }
    var peak = flow + gap;
    if (u < 0.28) {
      var t3 = u / 0.28;
      return { strain: eLow + de * t3, stress: peak * t3 };
    }
    if (u < 0.48) {
      var t4 = (u - 0.28) / 0.2;
      return { strain: e0 + 0.0015 * t4, stress: peak - gap * t4 };
    }
    var t5 = (u - 0.48) / 0.52;
    return { strain: e0 + 0.0015 + 0.012 * t5, stress: flow * (1 + 0.06 * t5) };
  }

  function curveHasPeak(samples) {
    var i, maxI = 0;
    for (i = 1; i < samples.length; i++) if (samples[i].stress > samples[maxI].stress) maxI = i;
    if (maxI < 2 || maxI > samples.length - 3) return false;
    var after = samples[samples.length - 1].stress;
    return samples[maxI].stress > after + 8 && samples[maxI].stress > samples[0].stress + 8;
  }

  function bandFrontOf(frame, L0) {
    if (!frame) return 0;
    var fronts = frame.fronts || [];
    var max = 0;
    var i;
    for (i = 0; i < fronts.length; i++) {
      var p = fronts[i] && fronts[i].pos != null ? Number(fronts[i].pos) : NaN;
      if (isFinite(p) && p > max) max = p;
    }
    if (max > 0) return Math.max(0, Math.min(1, max / L0));
    var pin = frame.pinned;
    if (!pin || !pin.length) return 0;
    var free = 0;
    for (i = 0; i < pin.length; i++) if (!pin[i]) free++;
    if (free === 0) return 0;
    if (free === pin.length) return 1;
    var lead = 0;
    for (i = 0; i < pin.length; i++) if (!pin[i]) lead = i;
    return Math.max(0, Math.min(1, (lead + 1) / pin.length));
  }

  function phaseAt(k, marks, branch) {
    if (branch === "unload" || branch === "skin") return "unload";
    if (branch === "age") return "aging";
    if (branch === "reload_now") return "reload_now";
    if (branch === "reload_aged") return "reload_aged";
    if (!marks || !marks.hasDrop) {
      if (k <= 1) return "elastic";
      return "hardening";
    }
    var iA = marks.iA;
    if (k < iA - 3) return "elastic";
    if (k <= iA) return "upper_yield";
    if (k < marks.iB) return "drop";
    if (k < marks.iC) return "luders";
    return "hardening";
  }

  function phaseProgress(k, marks, phase) {
    if (!marks || !marks.hasDrop) return 0;
    if (phase === "upper_yield") {
      var a0 = Math.max(0, marks.iA - 3);
      return clamp01((k - a0) / Math.max(1, marks.iA - a0));
    }
    if (phase === "drop") return clamp01((k - marks.iA) / Math.max(1, marks.iB - marks.iA));
    if (phase === "luders") return clamp01((k - marks.iB) / Math.max(1, marks.iC - marks.iB));
    if (phase === "hardening") return clamp01((k - marks.iC) / Math.max(1, (marks.iM || marks.iC + 1) - marks.iC));
    if (phase === "elastic") return clamp01(k / Math.max(1, marks.iA));
    return 0;
  }

  root.LudersScalePhysics = {
    A_NM: A_NM,
    B_NM: B_NM,
    NU: NU,
    G_MPA: G_MPA,
    E_MPA: E_MPA,
    EPS_DOT: EPS_DOT,
    RHO0: RHO0,
    RHO1: RHO1,
    volterra: volterra,
    burgersClosure: burgersClosure,
    toBox: toBox,
    toCrystal: toCrystal,
    isOctahedralFrac: isOctahedralFrac,
    isLatticeFrac: isLatticeFrac,
    buildCrystal: buildCrystal,
    hallPetch: hallPetch,
    ludersStrainOf: ludersStrainOf,
    hopRate: hopRate,
    tSat: tSat,
    segregation: segregation,
    formatSimTime: formatSimTime,
    mobileDensity: mobileDensity,
    orowanVelocity: orowanVelocity,
    branchPoint: branchPoint,
    curveHasPeak: curveHasPeak,
    bandFrontOf: bandFrontOf,
    phaseAt: phaseAt,
    phaseProgress: phaseProgress,
    clamp01: clamp01
  };
})(typeof window !== "undefined" ? window : globalThis);
