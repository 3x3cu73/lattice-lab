/* Equiaxed Voronoi polycrystal (Lloyd-relaxed exact vector polygons),
   two-phase mild steel (α-ferrite + pearlite colonies), BCC crystal orientations,
   Luster–Morris slip transmission (m'), inclined ~54.7° Lüders front propagation,
   work hardening (cross-slip, <110> rotation, grain elongation), necking microvoids,
   and cryogenic Neumann twins / {001} transgranular cleavage.
   Preserves full LudersGrainModel API compatibility with check_scales.js. */
(function (root) {
  "use strict";

  var P = root.LudersScalePhysics;
  var WIN_L = 1.2;
  var WIN_W = 0.4;
  var TAN_LUDERS = Math.SQRT2; // ~54.74 deg uniaxial-tension shear front

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildSlipSystems() {
    var dirs = [[1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]];
    var planes = [];
    var signs = [1, -1];
    var a, s1, s2, s3;
    var base110 = [[1, 1, 0], [1, 0, 1], [0, 1, 1]];
    for (a = 0; a < base110.length; a++) {
      for (s1 = 0; s1 < 2; s1++) {
        for (s2 = 0; s2 < 2; s2++) {
          planes.push({
            n: [base110[a][0] * signs[s1], base110[a][1] * signs[s2], base110[a][2]],
            fam: 110
          });
        }
      }
    }
    var base112 = [[1, 1, 2], [1, 2, 1], [2, 1, 1]];
    for (a = 0; a < base112.length; a++) {
      for (s1 = 0; s1 < 2; s1++) {
        for (s2 = 0; s2 < 2; s2++) {
          for (s3 = 0; s3 < 2; s3++) {
            planes.push({
              n: [base112[a][0] * signs[s1], base112[a][1] * signs[s2], base112[a][2] * signs[s3]],
              fam: 112
            });
          }
        }
      }
    }
    var out = [];
    var pi, di, n, d, dot, nn, dd;
    for (pi = 0; pi < planes.length; pi++) {
      n = planes[pi].n;
      nn = Math.hypot(n[0], n[1], n[2]);
      for (di = 0; di < dirs.length; di++) {
        d = dirs[di];
        dot = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
        if (dot !== 0) continue;
        dd = Math.hypot(d[0], d[1], d[2]);
        out.push({
          nx: n[0] / nn, ny: n[1] / nn, nz: n[2] / nn,
          dx: d[0] / dd, dy: d[1] / dd, dz: d[2] / dd,
          fam: planes[pi].fam
        });
      }
    }
    return out;
  }

  var SLIP = buildSlipSystems();
  var CLEAVE_PLANES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  function quatRandom(rng) {
    var u1 = rng();
    var u2 = rng() * 2 * Math.PI;
    var u3 = rng() * 2 * Math.PI;
    var s1 = Math.sqrt(1 - u1);
    var s2 = Math.sqrt(u1);
    return [s1 * Math.sin(u2), s1 * Math.cos(u2), s2 * Math.sin(u3), s2 * Math.cos(u3)];
  }

  /* Rotation matrix crystal -> lab (columns are crystal axes in lab frame).
     Lab x = tensile axis, lab y = transverse axis, lab z = viewing normal. */
  function rotMat(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
      [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
    ];
  }

  function matVec(R, vx, vy, vz) {
    return [
      R[0][0] * vx + R[0][1] * vy + R[0][2] * vz,
      R[1][0] * vx + R[1][1] * vy + R[1][2] * vz,
      R[2][0] * vx + R[2][1] * vy + R[2][2] * vz
    ];
  }

  /* Trace angle of a crystal plane (lab normal N) on the z = 0 viewing surface. */
  function planeTraceAngle(nl) {
    // Line of intersection with z=0 is perpendicular to (nl[0], nl[1]): (-nl[1], nl[0])
    var a = Math.atan2(nl[0], -nl[1]);
    if (a < -Math.PI / 2) a += Math.PI;
    if (a > Math.PI / 2) a -= Math.PI;
    return a;
  }

  /* Standard cubic [001]-[011]-[111] IPF RGB color from tensile axis in crystal frame. */
  function ipfRgbFromAxis(tx, ty, tz, rotToward101) {
    var a = [Math.abs(tx), Math.abs(ty), Math.abs(tz)];
    a.sort(function (u, v) { return u - v; });
    // a[0] <= a[1] <= a[2]: standard triangle vertices:
    // [001] -> (0,0,1), [011] -> (0,1,1)/sqrt2, [111] -> (1,1,1)/sqrt3
    var x = a[0], y = a[1], z = a[2];
    if (rotToward101 > 0) {
      // BCC uniaxial tension rotates crystal axis toward <101> (0, 0.707, 0.707)
      var f = Math.min(0.72, rotToward101);
      x = x * (1 - f);
      y = y * (1 - f) + 0.70710678 * f;
      z = z * (1 - f) + 0.70710678 * f;
      var inv = 1 / Math.max(1e-6, Math.hypot(x, y, z));
      x *= inv; y *= inv; z *= inv;
    }
    var r = Math.max(0, z - y);
    var g = Math.max(0, y - x);
    var b = Math.max(0, x);
    var mx = Math.max(r, g, b, 1e-6);
    // Apply gentle gamma for authentic vibrant TSL/MTEX EBSD look
    r = Math.pow(r / mx, 0.72);
    g = Math.pow(g / mx, 0.72);
    b = Math.pow(b / mx, 0.72);
    return [
      Math.round(32 + 212 * r),
      Math.round(36 + 198 * g),
      Math.round(44 + 206 * b)
    ];
  }

  function analyzeOrientation(q) {
    var R = rotMat(q);
    // Tensile axis [1,0,0] in crystal coordinates is row 0 of R: (R[0][0], R[0][1], R[0][2])
    var tx = R[0][0], ty = R[0][1], tz = R[0][2];
    var best1 = -1, sys1 = null;
    var best2 = -1, sys2 = null;
    var bestTwin = -1, twinSys = null;
    var i, s, cp, cl, m;

    for (i = 0; i < SLIP.length; i++) {
      s = SLIP[i];
      cp = Math.abs(s.nx * tx + s.ny * ty + s.nz * tz);
      cl = Math.abs(s.dx * tx + s.dy * ty + s.dz * tz);
      m = cp * cl;
      if (m > best1) {
        best1 = m;
        sys1 = s;
      }
      if (s.fam === 112 && m > bestTwin) {
        bestTwin = m;
        twinSys = s;
      }
    }

    var n1Lab = matVec(R, sys1.nx, sys1.ny, sys1.nz);
    var b1Lab = matVec(R, sys1.dx, sys1.dy, sys1.dz);
    var ang1 = planeTraceAngle(n1Lab);

    // Find best independent secondary / conjugate slip system with distinct trace angle
    for (i = 0; i < SLIP.length; i++) {
      s = SLIP[i];
      var ndot = Math.abs(s.nx * sys1.nx + s.ny * sys1.ny + s.nz * sys1.nz);
      if (ndot > 0.85) continue;
      cp = Math.abs(s.nx * tx + s.ny * ty + s.nz * tz);
      cl = Math.abs(s.dx * tx + s.dy * ty + s.dz * tz);
      m = cp * cl;
      if (m > best2) {
        best2 = m;
        sys2 = s;
      }
    }
    var n2Lab = sys2 ? matVec(R, sys2.nx, sys2.ny, sys2.nz) : [-n1Lab[1], n1Lab[0], 0];
    var ang2 = planeTraceAngle(n2Lab);

    // Most tensile-loaded {001} cleavage plane
    var bestC = -1, cleavNLab = [1, 0, 0];
    for (i = 0; i < 3; i++) {
      var c = CLEAVE_PLANES[i];
      var proj = Math.abs(c[0] * tx + c[1] * ty + c[2] * tz);
      if (proj > bestC) {
        bestC = proj;
        cleavNLab = matVec(R, c[0], c[1], c[2]);
      }
    }
    var cleavAngle = planeTraceAngle(cleavNLab);
    var twinNLab = twinSys ? matVec(R, twinSys.nx, twinSys.ny, twinSys.nz) : n1Lab;
    var twinAngle = planeTraceAngle(twinNLab);

    return {
      mRaw: best1,
      m2: best2 > 0 ? best2 : best1 * 0.75,
      tx: tx, ty: ty, tz: tz,
      n1Lab: n1Lab,
      b1Lab: b1Lab,
      slip1Angle: ang1,
      slip2Angle: ang2,
      cleavAngle: cleavAngle,
      twinAngle: twinAngle,
      twinSchmid: bestTwin
    };
  }

  function clipHalf(poly, mx, my, nx, ny) {
    var out = [];
    var n = poly.length;
    var i, j, a, b, da, db, t;
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      a = poly[i];
      b = poly[j];
      da = (a[0] - mx) * nx + (a[1] - my) * ny;
      db = (b[0] - mx) * nx + (b[1] - my) * ny;
      if (da <= 1e-11) out.push(a);
      if ((da > 1e-11 && db < -1e-11) || (da < -1e-11 && db > 1e-11)) {
        t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  }

  function polyStats(poly) {
    var n = poly.length;
    if (n < 3) return { area: 0, cx: 0, cy: 0 };
    var a2 = 0, cx = 0, cy = 0, i, j, cross;
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      cross = poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
      a2 += cross;
      cx += (poly[i][0] + poly[j][0]) * cross;
      cy += (poly[i][1] + poly[j][1]) * cross;
    }
    if (Math.abs(a2) < 1e-12) {
      var sx = 0, sy = 0;
      for (i = 0; i < n; i++) { sx += poly[i][0]; sy += poly[i][1]; }
      return { area: 0, cx: sx / n, cy: sy / n };
    }
    return {
      area: Math.abs(a2) * 0.5,
      cx: cx / (3 * a2),
      cy: cy / (3 * a2)
    };
  }

  /* Fast spatial-grid-accelerated exact Voronoi polygon computation. */
  function computeVoronoi(sites, winL, winW, cellSize) {
    var n = sites.length;
    var gxN = Math.max(1, Math.ceil(winL / cellSize));
    var gyN = Math.max(1, Math.ceil(winW / cellSize));
    var buckets = new Array(gxN * gyN);
    var i, bx, by, bi;
    for (i = 0; i < buckets.length; i++) buckets[i] = [];
    for (i = 0; i < n; i++) {
      bx = Math.max(0, Math.min(gxN - 1, Math.floor(sites[i][0] / cellSize)));
      by = Math.max(0, Math.min(gyN - 1, Math.floor(sites[i][1] / cellSize)));
      buckets[by * gxN + bx].push(i);
    }

    var rect = [[0, 0], [winL, 0], [winL, winW], [0, winW]];
    var polys = new Array(n);
    var nbrs = new Array(n);
    var reach2 = Math.pow(3.2 * cellSize, 2);

    for (i = 0; i < n; i++) {
      var sx = sites[i][0], sy = sites[i][1];
      bx = Math.max(0, Math.min(gxN - 1, Math.floor(sx / cellSize)));
      by = Math.max(0, Math.min(gyN - 1, Math.floor(sy / cellSize)));

      // Gather nearby candidates sorted by squared distance (nearest first clips fastest!)
      var cands = [];
      var dy, dx, jj, ii, bList, k, j, vx, vy, d2;
      for (dy = -2; dy <= 2; dy++) {
        jj = by + dy;
        if (jj < 0 || jj >= gyN) continue;
        for (dx = -2; dx <= 2; dx++) {
          ii = bx + dx;
          if (ii < 0 || ii >= gxN) continue;
          bList = buckets[jj * gxN + ii];
          for (k = 0; k < bList.length; k++) {
            j = bList[k];
            if (j === i) continue;
            vx = sites[j][0] - sx;
            vy = sites[j][1] - sy;
            d2 = vx * vx + vy * vy;
            if (d2 <= reach2) cands.push([j, d2, vx, vy]);
          }
        }
      }
      cands.sort(function (u, v) { return u[1] - v[1]; });

      var poly = rect;
      for (k = 0; k < cands.length; k++) {
        j = cands[k][0];
        vx = cands[k][2];
        vy = cands[k][3];
        // Quick bounding radius reject: if max vertex distance from site i is < 0.5*dist(i,j), stop!
        var maxR2 = 0, vi;
        for (vi = 0; vi < poly.length; vi++) {
          var rx = poly[vi][0] - sx, ry = poly[vi][1] - sy;
          var r2 = rx * rx + ry * ry;
          if (r2 > maxR2) maxR2 = r2;
        }
        if (4 * maxR2 < cands[k][1] - 1e-12) break;
        var mx = sx + vx * 0.5;
        var my = sy + vy * 0.5;
        poly = clipHalf(poly, mx, my, vx, vy);
        if (poly.length < 3) break;
      }
      polys[i] = poly;
      nbrs[i] = [];
    }

    // Identify true shared-edge neighbors and shared boundary segments
    var edges = [];
    var tol = cellSize * 1e-3;
    for (i = 0; i < n; i++) {
      var pa = polys[i];
      if (!pa || pa.length < 3) continue;
      bx = Math.max(0, Math.min(gxN - 1, Math.floor(sites[i][0] / cellSize)));
      by = Math.max(0, Math.min(gyN - 1, Math.floor(sites[i][1] / cellSize)));
      for (var dy2 = -2; dy2 <= 2; dy2++) {
        var jj2 = by + dy2;
        if (jj2 < 0 || jj2 >= gyN) continue;
        for (var dx2 = -2; dx2 <= 2; dx2++) {
          var ii2 = bx + dx2;
          if (ii2 < 0 || ii2 >= gxN) continue;
          var bList2 = buckets[jj2 * gxN + ii2];
          for (var k2 = 0; k2 < bList2.length; k2++) {
            var j2 = bList2[k2];
            if (j2 <= i) continue;
            var pb = polys[j2];
            if (!pb || pb.length < 3) continue;
            var shared = [];
            for (var ia = 0; ia < pa.length; ia++) {
              for (var ib = 0; ib < pb.length; ib++) {
                if (Math.hypot(pa[ia][0] - pb[ib][0], pa[ia][1] - pb[ib][1]) < tol) {
                  shared.push(pa[ia]);
                  break;
                }
              }
            }
            if (shared.length >= 2) {
              nbrs[i].push(j2);
              nbrs[j2].push(i);
              edges.push({ a: i, b: j2, p1: shared[0], p2: shared[1] });
            }
          }
        }
      }
    }

    return { polys: polys, nbrs: nbrs, edges: edges };
  }

  function build(dUm, seed, aging, upperGap, opts) {
    opts = opts || {};
    var winL = opts.winL || WIN_L;
    var winW = opts.winW || WIN_W;
    var rng = mulberry32(seed || 1);
    var dMm = dUm / 1000;
    var nTarget = Math.max(12, Math.round((winL * winW) / (dMm * dMm)));
    var cols = Math.max(3, Math.round(Math.sqrt(nTarget * (winL / winW))));
    var rows = Math.max(2, Math.round(nTarget / cols));
    var dx = winL / cols;
    var dy = winW / rows;
    var cellSize = Math.max(dx, dy);

    // Random jittered seeds (full 0.85 jitter + odd-row hex offset before Lloyd relaxation!)
    var sites = [];
    var r, c;
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var hx = (r & 1) ? 0.25 : -0.25;
        var sx = (c + 0.5 + hx * 0.4 + (rng() - 0.5) * 0.85) * dx;
        var sy = (r + 0.5 + (rng() - 0.5) * 0.85) * dy;
        sites.push([
          Math.max(0.02 * dx, Math.min(winL - 0.02 * dx, sx)),
          Math.max(0.02 * dy, Math.min(winW - 0.02 * dy, sy))
        ]);
      }
    }

    // 2 passes of Lloyd's centroidal Voronoi relaxation -> authentic equiaxed grains & ~120 deg triple junctions!
    var relaxPasses = opts.relaxPasses != null ? opts.relaxPasses : 2;
    var vor = null;
    for (var pass = 0; pass < relaxPasses; pass++) {
      vor = computeVoronoi(sites, winL, winW, cellSize);
      for (var si = 0; si < sites.length; si++) {
        var stP = polyStats(vor.polys[si]);
        if (stP.area > 0) {
          // Relax 75% toward centroid so grains stay organic (not a rigid hex honeycomb)
          sites[si][0] = sites[si][0] * 0.25 + stP.cx * 0.75;
          sites[si][1] = sites[si][1] * 0.25 + stP.cy * 0.75;
        }
      }
    }
    vor = computeVoronoi(sites, winL, winW, cellSize);

    var n = sites.length;
    var sLy = P.hallPetch(dUm);
    var gap = upperGap == null ? 40 : upperGap;
    if (gap < 20) gap = 20;
    var sUy = sLy + gap;
    var epsL = P.ludersStrainOf(dUm);

    // Mild steel pearlite colony fraction scales with carbon (0% for IF steel; ~12% at 30 ppm mild steel)
    var pearliteFrac = 0;
    if (opts.cPpm != null) {
      pearliteFrac = opts.cPpm <= 2 ? 0 : Math.min(0.18, 0.04 + 0.0028 * opts.cPpm);
    }

    var grains = new Array(n);
    var i;
    for (i = 0; i < n; i++) {
      var q = quatRandom(rng);
      var ori = analyzeOrientation(q);
      var stG = polyStats(vor.polys[i]);
      var eqD = stG.area > 0 ? Math.sqrt((4 * stG.area) / Math.PI) : dMm;

      var mUse = 0.44 + Math.max(0, Math.min(1, (ori.mRaw - 0.36) / 0.14)) * 0.06;
      var scatter = 1 + (rng() - 0.5) * 0.1;
      var tauU = aging ? (0.9 * sLy - 26) * scatter : 0.42 * sLy;
      var isPearlite = pearliteFrac > 0 && rng() < pearliteFrac;

      grains[i] = {
        id: i,
        x: stG.area > 0 ? stG.cx : sites[i][0],
        y: stG.area > 0 ? stG.cy : sites[i][1],
        area: stG.area,
        eqD: eqD,
        m: mUse,
        mRaw: ori.mRaw,
        m2: ori.m2,
        ipf: [Math.abs(ori.tx), Math.abs(ori.ty), Math.abs(ori.tz)],
        ipfRgb: ipfRgbFromAxis(ori.tx, ori.ty, ori.tz, 0),
        n1Lab: ori.n1Lab,
        b1Lab: ori.b1Lab,
        slip1Angle: ori.slip1Angle,
        slip2Angle: ori.slip2Angle,
        cleavAngle: ori.cleavAngle,
        twinAngle: ori.twinAngle,
        twinSchmid: ori.twinSchmid,
        isPearlite: isPearlite,
        lamAngle: rng() * Math.PI,
        etchShade: 0.91 + 0.11 * rng(),
        rand1: rng(),
        rand2: rng(),
        tauU: tauU,
        poly: vor.polys[i],
        nbr: vor.nbrs[i],
        S: 0.8
      };
    }

    // Compute Luster–Morris geometric compatibility factor m' across every shared grain boundary
    var edges = vor.edges;
    for (i = 0; i < edges.length; i++) {
      var e = edges[i];
      var ga = grains[e.a];
      var gb = grains[e.b];
      var cPsi = Math.abs(ga.n1Lab[0] * gb.n1Lab[0] + ga.n1Lab[1] * gb.n1Lab[1] + ga.n1Lab[2] * gb.n1Lab[2]);
      var cKap = Math.abs(ga.b1Lab[0] * gb.b1Lab[0] + ga.b1Lab[1] * gb.b1Lab[1] + ga.b1Lab[2] * gb.b1Lab[2]);
      e.mPrime = cPsi * cKap;
      e.mx = 0.5 * (e.p1[0] + e.p2[0]);
      e.my = 0.5 * (e.p1[1] + e.p2[1]);
      e.len = Math.hypot(e.p2[0] - e.p1[0], e.p2[1] - e.p1[1]);
      e.isFP = (ga.isPearlite !== gb.isPearlite);
    }

    // Precompute grain-scale front propagation offsets using Schmid factor, grain size, pearlite, and m'
    var frontLead = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var gr = grains[i];
      if (gr.isPearlite) {
        frontLead[i] = -1.65 * dMm; // harder pearlite colonies resist initial slip behind front
      } else {
        var schmidBoost = ((gr.mRaw - 0.43) / 0.07) * 0.75 * dMm;
        var sizeBoost = ((gr.eqD / Math.max(dMm, 1e-4)) - 1.0) * 0.55 * dMm;
        frontLead[i] = schmidBoost + sizeBoost + (gr.rand1 - 0.5) * 0.55 * dMm;
      }
    }
    // Smooth via Luster-Morris m' neighbor coupling (compatible neighbors pull each other forward)
    var smoothed = new Float32Array(n);
    for (i = 0; i < n; i++) {
      if (grains[i].isPearlite) { smoothed[i] = frontLead[i]; continue; }
      var sum = frontLead[i], wSum = 1;
      for (var k = 0; k < edges.length; k++) {
        // Skip global edge loop per grain; compute directly via nbr below
      }
      smoothed[i] = sum / wSum;
    }
    // Build fast per-grain edge adjacency list
    var grainEdges = new Array(n);
    for (i = 0; i < n; i++) grainEdges[i] = [];
    for (i = 0; i < edges.length; i++) {
      grainEdges[edges[i].a].push(i);
      grainEdges[edges[i].b].push(i);
    }
    for (i = 0; i < n; i++) {
      if (grains[i].isPearlite) { smoothed[i] = frontLead[i]; continue; }
      var ge = grainEdges[i];
      var acc = frontLead[i] * 1.2, wt = 1.2;
      for (var k = 0; k < ge.length; k++) {
        var ed = edges[ge[k]];
        var other = ed.a === i ? ed.b : ed.a;
        if (grains[other].isPearlite) continue;
        var w = 0.65 * ed.mPrime;
        acc += frontLead[other] * w;
        wt += w;
      }
      smoothed[i] = Math.max(-1.6 * dMm, Math.min(1.6 * dMm, acc / wt));
    }

    // Precompute candidate microvoid sites (ferrite-pearlite interfaces & triple junctions)
    var voidSites = [];
    for (i = 0; i < edges.length; i++) {
      var edv = edges[i];
      if (edv.isFP) {
        voidSites.push({ x: edv.mx, y: edv.my, rank: rng() * 0.55, isFP: true, rScale: 0.9 + 0.6 * rng() });
      } else if (edv.mPrime < 0.28 && rng() < 0.35) {
        voidSites.push({ x: edv.p1[0], y: edv.p1[1], rank: 0.35 + rng() * 0.65, isFP: false, rScale: 0.65 + 0.5 * rng() });
      }
    }
    voidSites.sort(function (u, v) { return u.rank - v.rank; });

    return {
      dUm: dUm,
      dMm: dMm,
      seed: seed || 1,
      aging: !!aging,
      cPpm: opts.cPpm != null ? opts.cPpm : 30,
      n: n,
      grains: grains,
      edges: edges,
      grainEdges: grainEdges,
      frontLead: smoothed,
      voidSites: voidSites,
      sLy: sLy,
      sUy: sUy,
      epsL: epsL,
      S: 0.8,
      W: winL,
      H: winW
    };
  }

  /* Rich physical microstructural state at current macro clock state st. */
  function evaluateMicroState(model, st, aging) {
    var n = model.n;
    var g = model.grains;
    var edges = model.edges;
    var d = model.dMm;
    var yielded = new Uint8Array(n);
    var frontGrain = new Uint8Array(n);
    var eps = new Float32Array(n);
    var rate = new Float32Array(n);
    var kam = new Float32Array(n);
    var slip1 = new Float32Array(n);
    var slip2 = new Float32Array(n);

    var stage = st.stage || "elastic";
    var eMacro = st.strain || 0;
    var sMacro = st.stress || 0;
    var eL = Math.max(st.eL || model.epsL || 0.018, 0.005);
    var sLy = st.sLy || model.sLy || 240;
    var sUy = st.sUy || model.sUy || (sLy + 40);
    var brittle = !!st.brittle;

    // 1. Determine which grains have yielded & their local plastic strain
    if (brittle || stage === "elastic" || stage === "prebrittle" || (st.phase === "intro")) {
      // Elastic only: no macroscopic yielding yet
    } else if (!aging) {
      // Diffuse yielding (IF steel / temper-rolled / locking OFF):
      // Sweeps smoothly from 0% -> 100% of grains ordered by Schmid factor & size (zero stuck regions!)
      var ePkRef = st.ePk || 0.0012;
      var diffSpan = st.plateauFrac != null && st.plateauFrac > 0 && st.plateauFrac < 1
        ? st.plateauFrac
        : Math.max(0, Math.min(1, (eMacro - ePkRef * 0.7) / Math.max(0.024, eL * 1.15)));
      var postDiff = (stage === "hardening" || stage === "necking" || stage === "fracture") && diffSpan >= 0.99;
      var hardenEps = Math.max(0, eMacro - ePkRef * 0.8);
      for (var i = 0; i < n; i++) {
        var gr = g[i];
        // Soft high-Schmid, large ferrite grains yield first; pearlite yields later
        var schmidNorm = Math.max(0, Math.min(1, (gr.mRaw - 0.34) / 0.16));
        var threshNorm = gr.isPearlite
          ? (0.68 + 0.25 * gr.rand1)
          : Math.max(0.02, Math.min(0.92, 0.88 - 0.78 * schmidNorm + (gr.rand1 - 0.5) * 0.14));
        if (postDiff || diffSpan >= threshNorm) {
          yielded[i] = 1;
          var mWeight = gr.isPearlite ? 0.36 : (0.68 + 1.35 * schmidNorm);
          var localRamp = postDiff ? 1 : Math.max(0.18, Math.min(1, (diffSpan - threshNorm) / 0.18));
          var neckMult = 1;
          if (stage === "necking" || stage === "fracture") {
            var dxN0 = (gr.x - model.W * 0.5) / (model.W * 0.28);
            neckMult = 1 + 0.55 * Math.exp(-dxN0 * dxN0);
          }
          eps[i] = Math.max(0.0025, hardenEps * mWeight * localRamp * neckMult);
          if (!postDiff && diffSpan < threshNorm + 0.16) {
            frontGrain[i] = 1;
            rate[i] = 1 - (diffSpan - threshNorm) / 0.16;
          }
        }
      }
    } else {
      // Inclined ~54.7 deg ragged Lüders band front sweeping continuously from left edge to right edge!
      var localFront = st.localFrontMm != null ? st.localFrontMm : (st.frontMm - (st.windowStartMm || 0));
      var postPlateau = (stage === "hardening" || stage === "necking" || stage === "fracture");
      var extraHard = postPlateau ? Math.max(0, eMacro - eL) : 0;

      for (var j = 0; j < n; j++) {
        var gr2 = g[j];
        // Inclined 54.74 deg front slanted top-right to bottom-left (matching macro specimen)
        var xFrontAtY = localFront + ((model.H * 0.5 - gr2.y) / TAN_LUDERS);
        var behind = (xFrontAtY + model.frontLead[j]) - gr2.x;

        if (postPlateau || behind >= 0) {
          // Harder pearlite colonies lag ~1.3 grain diameters behind the ferrite front, then yield as front passes
          if (gr2.isPearlite && !postPlateau && behind < 1.25 * d) {
            yielded[j] = 0;
          } else {
            yielded[j] = 1;
            var ramp = postPlateau ? 1 : Math.max(0.14, Math.min(1, behind / (2.5 * d)));
            var ani = gr2.isPearlite ? 0.34 : (0.72 + 1.25 * Math.max(0, gr2.mRaw - 0.34));
            var baseEps = eL * ramp * ani + extraHard * (gr2.isPearlite ? 0.42 : ani);
            // Necking strain localization toward center of FOV
            if (stage === "necking" || stage === "fracture") {
              var dxN = (gr2.x - model.W * 0.5) / (model.W * 0.28);
              var neckBoost = Math.exp(-dxN * dxN);
              baseEps += Math.max(0, extraHard - 0.10) * 1.45 * neckBoost * (gr2.isPearlite ? 0.45 : 1.0);
            }
            eps[j] = baseEps;
            if (!postPlateau && behind >= 0 && behind < 2.4 * d) {
              frontGrain[j] = 1;
              rate[j] = Math.exp(-Math.pow((behind - 0.7 * d) / (1.05 * d), 2));
            }
          }
        } else if (stage === "upper" && gr2.x < 0.22 * model.W && !gr2.isPearlite && gr2.mRaw > 0.44) {
          // Precursor yielding of softest high-Schmid ferrite grains along left edge at Upper Yield Point A
          yielded[j] = 1;
          frontGrain[j] = 1;
          eps[j] = 0.004;
          rate[j] = 0.85;
        }
      }
    }

    // 2. Compute primary & secondary slip intensity and KAM/GND per grain
    var iDSA = (st.T && st.T >= 410 && st.T <= 580 && model.cPpm >= 5) ? 1 : 0;
    for (var k = 0; k < n; k++) {
      if (!yielded[k]) continue;
      var ep = eps[k];
      if (!g[k].isPearlite) {
        slip1[k] = Math.min(1, ep / Math.max(eL * 0.85, 0.01));
        // Secondary / conjugate cross-slip activates once strain exceeds ~1.3 * Lüders strain
        slip2[k] = ep > eL * 1.15 ? Math.min(1, (ep - eL * 1.15) / 0.12) : 0;
      }
      // Base intragranular KAM (degrees) grows with sqrt(rho) ~ sqrt(eps)
      var baseKam = Math.min(4.2, 0.45 + 5.8 * Math.sqrt(Math.max(0, ep)));
      if (frontGrain[k]) baseKam += 0.85 * rate[k];
      // Blue-brittle PLC slip burst modulation during hardening
      if (iDSA && (stage === "hardening" || stage === "luders")) {
        var burst = Math.sin(eMacro * 320 + g[k].x * 18 + g[k].rand2 * 6.28);
        if (burst > 0.72) {
          rate[k] = Math.max(rate[k], 0.7);
          baseKam += 0.6;
        }
      }
      kam[k] = Math.min(4.8, baseKam);
    }

    // 3. Collect dislocation pile-ups on blocking grain boundaries (yielded -> unyielded or low m')
    var pileups = [];
    for (var ei = 0; ei < edges.length; ei++) {
      var ed = edges[ei];
      var ya = yielded[ed.a], yb = yielded[ed.b];
      if (ya !== yb) {
        var yId = ya ? ed.a : ed.b;
        var uId = ya ? ed.b : ed.a;
        if (g[yId].isPearlite) continue;
        // Boost KAM on the yielded grain piled up against the blocking boundary
        kam[yId] = Math.min(5.0, kam[yId] + 0.65 * (1.15 - ed.mPrime));
        var dxB = g[uId].x - g[yId].x;
        var dyB = g[uId].y - g[yId].y;
        var dist = Math.max(1e-5, Math.hypot(dxB, dyB));
        pileups.push({
          x: ed.mx - (dxB / dist) * (0.22 * d),
          y: ed.my - (dyB / dist) * (0.22 * d),
          bx: ed.mx,
          by: ed.my,
          nx: dxB / dist,
          ny: dyB / dist,
          angle: g[yId].slip1Angle,
          mPrime: ed.mPrime,
          grainA: yId,
          grainB: uId,
          strength: Math.max(0.3, 1.0 - ed.mPrime)
        });
      } else if (ya && yb && ed.isFP) {
        // Ferrite-pearlite incompatibility accumulates GNDs during hardening & necking
        var fId = g[ed.a].isPearlite ? ed.b : ed.a;
        kam[fId] = Math.min(5.0, kam[fId] + 0.9 * Math.min(1, eps[fId] / 0.10));
      }
    }
    if (pileups.length > 42) {
      pileups.sort(function (u, v) { return v.strength - u.strength; });
      pileups = pileups.slice(0, 42);
    }

    // 4. Microvoid nucleation & growth in necking / ductile fracture
    var neckQ = 0;
    if (st.frac !== "cleavage" && (stage === "necking" || stage === "fracture")) {
      neckQ = stage === "fracture" ? 1 : Math.max(0.08, Math.min(1, (eMacro - (st.eU || 0.2)) / Math.max(0.06, (st.eF || 0.32) - (st.eU || 0.2))));
    }
    var activeVoids = [];
    if (neckQ > 0) {
      var nV = Math.floor(neckQ * Math.min(model.voidSites.length, 65));
      for (var vi = 0; vi < nV; vi++) {
        var vs = model.voidSites[vi];
        var env = Math.exp(-Math.pow((vs.x - model.W * 0.5) / (model.W * 0.28), 2));
        var rad = (0.0018 + 0.0054 * neckQ * vs.rScale) * env;
        if (rad > 0.0014) activeVoids.push({ x: vs.x, y: vs.y, r: rad, isFP: vs.isFP });
      }
    }

    // 5. Cryogenic Neumann deformation twins when cold / approaching cleavage
    var twinQ = 0;
    if (st.frac === "cleavage" && (st.T || 298) < 210) {
      if (stage === "fracture") twinQ = 1;
      else if (stage === "prebrittle" || (brittle && sMacro > 0.72 * sUy)) twinQ = Math.max(0.25, Math.min(1, (sMacro - 0.65 * sUy) / Math.max(0.35 * sUy, 20)));
    }
    var twins = [];
    if (twinQ > 0) {
      for (var ti = 0; ti < n; ti++) {
        if (g[ti].isPearlite || g[ti].twinSchmid < 0.41 || g[ti].rand1 > 0.55 * twinQ) continue;
        twins.push({ grain: ti, angle: g[ti].twinAngle, count: g[ti].rand2 > 0.5 ? 2 : 1 });
      }
    }

    // 6. Fracture crack path (transgranular {001} cleavage vs ductile void-coalescence tear)
    var crack = null;
    if (stage === "fracture") {
      crack = buildCrackPath(model, st.frac === "cleavage");
    }

    // Mean plastic strain for affine grain elongation
    var epsSum = 0;
    for (var si2 = 0; si2 < n; si2++) epsSum += eps[si2];
    var epsMean = n ? epsSum / n : 0;

    return {
      yielded: yielded,
      frontGrain: frontGrain,
      eps: eps,
      rate: rate,
      kam: kam,
      slip1: slip1,
      slip2: slip2,
      pileups: pileups,
      voids: activeVoids,
      twins: twins,
      crack: crack,
      epsMean: epsMean,
      neckQ: neckQ
    };
  }

  function buildCrackPath(model, isCleavage) {
    var pts = [];
    var R = mulberry32(model.seed * 31 + (isCleavage ? 7 : 19));
    var x = model.W * 0.5;
    var y = 0;
    var step = isCleavage ? model.dMm * 0.85 : model.dMm * 0.5;
    var g = model.grains;
    pts.push([x, -0.02]);
    while (y < model.H + 0.02) {
      // Find nearest grain center
      var bestI = 0, bestD = 1e9;
      for (var i = 0; i < g.length; i++) {
        var d2 = (g[i].x - x) * (g[i].x - x) + (g[i].y - y) * (g[i].y - y);
        if (d2 < bestD) { bestD = d2; bestI = i; }
      }
      var dy = step;
      var dx;
      if (isCleavage) {
        // Follow this grain's {001} cleavage plane trace (deflects sharply at each grain boundary!)
        var a = g[bestI].cleavAngle;
        var slope = Math.tan(a * 0.65);
        dx = Math.max(-dy * 0.9, Math.min(dy * 0.9, slope * dy));
      } else {
        // Fibrous void-coalescence zigzag biased toward center
        dx = (R() - 0.5) * dy * 1.1 + (model.W * 0.5 - x) * 0.18;
      }
      x = Math.max(model.W * 0.18, Math.min(model.W * 0.82, x + dx));
      y += dy;
      pts.push([x, y]);
    }
    return { pts: pts, isCleavage: isCleavage };
  }

  // ---------- Original cellular automaton & check_scales.js API (preserved 100%) ----------

  function tauFlow(model, ep, aging) {
    if (!aging) return 0.42 * model.sLy * (1 + 7 * Math.pow(Math.max(ep, 0), 0.4));
    if (ep < model.epsL) return 36;
    return 0.5 * model.sLy * (1 + 0.45 * (ep / model.epsL - 1));
  }

  function simulate(model) {
    var g = model.grains;
    var n = g.length;
    var aging = model.aging;
    var ep = new Float64Array(n);
    var yielded = new Uint8Array(n);
    var bornAt = new Float64Array(n);
    bornAt.fill(-1);
    var sigma = 1;
    var strain = 0;
    var t = 0;
    var dt = 0.04;
    var steps = aging ? 1100 : 500;
    var M = 110000;
    var perRow = Math.max(4, Math.round(n * model.dMm / model.W));
    var frames = [];
    var bursts = [];
    var i, step, pass, guard;
    var scfCut = 1.6 * model.dMm;

    function sample() {
      var epC = new Float32Array(n);
      var yC = new Uint8Array(n);
      var bC = new Float32Array(n);
      for (i = 0; i < n; i++) {
        epC[i] = ep[i];
        yC[i] = yielded[i];
        bC[i] = bornAt[i];
      }
      frames.push({
        t: t, strain: strain, stress: sigma,
        ep: epC, yielded: yC, bornAt: bC, newCount: 0
      });
    }

    sample();
    for (step = 0; step < steps; step++) {
      var fresh = 0;
      var passes = aging ? 2 : 1;
      for (pass = 0; pass < passes; pass++) {
        var pile = new Float64Array(n);
        for (i = 0; i < n; i++) {
          if (!yielded[i]) continue;
          if (aging && ep[i] < 0.18 * model.epsL) continue;
          var tf = tauFlow(model, ep[i], aging);
          var excess = g[i].m * sigma - tf;
          if (excess < 0) excess = 0;
          var pj = excess * g[i].S;
          var nb = g[i].nbr;
          for (var k = 0; k < nb.length; k++) {
            var j = nb[k];
            if (!yielded[j] && pj > pile[j]) pile[j] = pj;
          }
        }
        var ready = [];
        var nBand = 8;
        var bandFront = [];
        var b;
        for (b = 0; b < nBand; b++) bandFront[b] = -1;
        if (aging) {
          for (i = 0; i < n; i++) {
            if (!yielded[i]) continue;
            b = Math.max(0, Math.min(nBand - 1, Math.floor(g[i].y / model.H * nBand)));
            if (g[i].x > bandFront[b]) bandFront[b] = g[i].x;
          }
        }
        var slow = Infinity;
        var anyBand = false;
        for (b = 0; b < nBand; b++) {
          if (bandFront[b] >= 0) anyBand = true;
          var bf = bandFront[b] < 0 ? 0 : bandFront[b];
          if (bf < slow) slow = bf;
        }
        var capX = anyBand ? slow + 2.4 * model.dMm : scfCut + model.dMm;
        for (i = 0; i < n; i++) {
          if (yielded[i]) continue;
          if (aging && anyBand && g[i].x > capX) continue;
          var scf = aging && g[i].x < scfCut ? 1.18 : 1;
          var tau = g[i].m * sigma * scf;
          var drive = tau + pile[i] - g[i].tauU;
          if (drive >= 0) ready.push(i);
          else if (aging && anyBand) {
            b = Math.max(0, Math.min(nBand - 1, Math.floor(g[i].y / model.H * nBand)));
            if (bandFront[b] >= 0 && g[i].x < bandFront[b] - 1.15 * model.dMm) ready.push(i);
          }
        }
        if (!ready.length) break;
        if (aging && ready.length > perRow) {
          ready.sort(function (a, b2) { return g[a].x - g[b2].x; });
          ready = ready.slice(0, perRow);
        }
        for (i = 0; i < ready.length; i++) {
          yielded[ready[i]] = 1;
          bornAt[ready[i]] = t;
          fresh++;
        }
      }
      var sumRate = 0;
      for (i = 0; i < n; i++) {
        if (!yielded[i]) continue;
        var rate;
        if (!aging) {
          var over = g[i].m * sigma - tauFlow(model, ep[i], false);
          rate = over > 0 ? over / 2800 : 0;
        } else if (ep[i] < model.epsL) {
          rate = (model.epsL - ep[i]) / 0.16;
        } else {
          var over2 = g[i].m * sigma - tauFlow(model, ep[i], true);
          rate = over2 > 0 ? over2 / 16000 : 0;
        }
        if (rate > 0.5) rate = 0.5;
        ep[i] += rate * dt;
        sumRate += rate;
      }
      var mean = sumRate / n;
      sigma += M * (P.EPS_DOT - mean) * dt;
      if (sigma < 0) sigma = 0;
      strain += P.EPS_DOT * dt;
      t += dt;
      bursts.push(fresh);
      sample();
      frames[frames.length - 1].newCount = fresh;
      var nY = 0;
      for (guard = 0; guard < n; guard++) if (yielded[guard]) nY++;
      if (nY > 0.97 * n && strain > model.epsL * 0.8) break;
      if (!aging && strain > 0.06) break;
    }
    sample();
    return { frames: frames, bursts: bursts, model: model };
  }

  function plateauStats(sim) {
    var frames = sim.frames, model = sim.model, i, n = frames.length;
    var yieldedFrac = [];
    for (i = 0; i < n; i++) {
      var y = frames[i].yielded, c = 0;
      for (var k = 0; k < y.length; k++) if (y[k]) c++;
      yieldedFrac.push(c / y.length);
    }
    var stresses = [];
    for (i = 0; i < n; i++) if (yieldedFrac[i] > 0.22 && yieldedFrac[i] < 0.78) stresses.push(frames[i].stress);
    if (stresses.length < 4) {
      for (i = 0; i < n; i++) if (yieldedFrac[i] > 0.1 && yieldedFrac[i] < 0.95) stresses.push(frames[i].stress);
    }
    stresses.sort(function (a, b) { return a - b; });
    var mid = stresses.length ? stresses[Math.floor(stresses.length / 2)] : frames[n - 1].stress;
    var e0 = null, e1 = null;
    for (i = 0; i < n; i++) {
      if (yieldedFrac[i] >= 0.08 && e0 == null) e0 = frames[i].strain;
      if (yieldedFrac[i] >= 0.92) e1 = frames[i].strain;
    }
    var epsMeas = e0 != null && e1 != null ? Math.max(0, e1 - e0) : 0;
    var peak = frames[0].stress, peakI = 0;
    for (i = 1; i < n; i++) if (frames[i].stress > peak) { peak = frames[i].stress; peakI = i; }
    var minAfter = peak;
    for (i = peakI; i < n; i++) if (frames[i].stress < minAfter) minAfter = frames[i].stress;
    return {
      plateau: mid, epsMeas: epsMeas, peak: peak, drop: peak - minAfter,
      sLy: model.sLy, sUy: model.sUy, epsL: model.epsL
    };
  }

  function firstYieldsAreHighSchmid(sim) {
    var frames = sim.frames, g = sim.model.grains, i, seen = null;
    for (i = 0; i < frames.length; i++) {
      var c = 0;
      for (var k = 0; k < frames[i].yielded.length; k++) if (frames[i].yielded[k]) c++;
      if (c >= 8) { seen = frames[i]; break; }
    }
    if (!seen) return false;
    var ms = [], mean = 0;
    for (i = 0; i < g.length; i++) mean += g[i].m;
    mean /= g.length;
    for (i = 0; i < seen.yielded.length; i++) if (seen.yielded[i]) ms.push(g[i].m);
    ms.sort(function (a, b) { return b - a; });
    var top = 0, take = Math.min(8, ms.length);
    for (i = 0; i < take; i++) top += ms[i];
    top /= take;
    var xs = [];
    for (i = 0; i < seen.yielded.length; i++) if (seen.yielded[i]) xs.push(g[i].x);
    return top > mean + 0.008 && (Math.max.apply(null, xs) - Math.min.apply(null, xs)) > 0.35 * sim.model.W;
  }

  function contiguousBehindFront(sim) {
    var frames = sim.frames, g = sim.model.grains, d = sim.model.dMm, i;
    for (i = 0; i < frames.length; i++) {
      var y = frames[i].yielded, c = 0, k;
      for (k = 0; k < y.length; k++) if (y[k]) c++;
      var frac = c / y.length;
      if (frac < 0.2 || frac > 0.8) continue;
      var nBand = 8, bf = [], b;
      for (b = 0; b < nBand; b++) bf[b] = -1;
      for (k = 0; k < y.length; k++) {
        if (!y[k]) continue;
        b = Math.max(0, Math.min(nBand - 1, Math.floor(g[k].y / sim.model.H * nBand)));
        if (g[k].x > bf[b]) bf[b] = g[k].x;
      }
      var slow = Infinity, fast = -1;
      for (b = 0; b < nBand; b++) {
        if (bf[b] < 0) return false;
        if (bf[b] < slow) slow = bf[b];
        if (bf[b] > fast) fast = bf[b];
      }
      if (fast - slow > 3.2 * d) return false;
      var stack = [], seen = new Uint8Array(y.length);
      for (k = 0; k < y.length; k++) if (y[k] && g[k].x < 2.2 * d) { stack.push(k); seen[k] = 1; }
      while (stack.length) {
        var u = stack.pop(), nb = g[u].nbr;
        for (var j = 0; j < nb.length; j++) if (y[nb[j]] && !seen[nb[j]]) { seen[nb[j]] = 1; stack.push(nb[j]); }
      }
      for (k = 0; k < y.length; k++) if (y[k] && !seen[k]) return false;
      var holes = 0, behind = 0;
      for (k = 0; k < y.length; k++) {
        b = Math.max(0, Math.min(nBand - 1, Math.floor(g[k].y / sim.model.H * nBand)));
        if (g[k].x >= bf[b] - 1.6 * d) continue;
        behind++;
        if (!y[k]) holes++;
      }
      if (behind > 8 && holes / behind > 0.08) return false;
      return true;
    }
    return false;
  }

  function serrationsLineUp(sim) {
    var frames = sim.frames, events = 0, lined = 0, i = 8;
    while (i < frames.length - 4) {
      if (frames[i].stress >= frames[i - 1].stress && frames[i].stress > frames[i + 1].stress) {
        var maxS = frames[i].stress, j = i + 1, minS = maxS, minJ = i;
        while (j < frames.length && j < i + 14 && frames[j].stress <= frames[j - 1].stress + 0.4) {
          if (frames[j].stress < minS) { minS = frames[j].stress; minJ = j; }
          j++;
        }
        if (maxS - minS >= 6 && frames[i].t > 3.2) {
          events++;
          var burst = false;
          for (var k = Math.max(0, i - 5); k <= minJ; k++) if (frames[k].newCount >= 3) burst = true;
          if (burst) lined++;
        }
        i = minJ + 1;
      } else i++;
    }
    return events >= 3 && lined / events >= 0.65;
  }

  function syncedMask(model, localFrontMm, nucleating) {
    var g = model.grains, n = g.length, d = model.dMm, y = new Uint8Array(n);
    var order = new Array(n), i;
    for (i = 0; i < n; i++) order[i] = i;
    order.sort(function (a, b) { return g[a].x - g[b].x; });
    if (localFrontMm < -0.02 && !nucleating) return y;
    for (i = 0; i < n; i++) {
      var id = order[i];
      var favour = Math.max(-1, Math.min(1, (g[id].m - 0.34) / 0.12));
      var lead = Math.min(2 * d, (0.15 + 0.85 * (favour + 1) * 0.5) * d);
      var allow = g[id].x <= localFrontMm + lead;
      if (nucleating && g[id].x < 1.7 * d && localFrontMm < 2 * d) allow = true;
      if (!allow) continue;
      if (g[id].x <= Math.max(localFrontMm, 0) + 0.2 * d || (nucleating && g[id].x < 1.7 * d)) {
        y[id] = 1;
        continue;
      }
      var nb = g[id].nbr, behind = false;
      for (var j = 0; j < nb.length; j++) if (y[nb[j]] && g[nb[j]].x <= g[id].x + 1e-6) { behind = true; break; }
      if (behind) y[id] = 1;
    }
    return y;
  }

  function aheadOfFront(model, mask, localFrontMm) {
    var d = model.dMm, worst = 0;
    for (var i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      var ahead = model.grains[i].x - localFrontMm;
      if (ahead > worst) worst = ahead;
    }
    return worst / d;
  }

  root.LudersGrainModel = {
    WIN_L: WIN_L,
    WIN_W: WIN_W,
    TAN_LUDERS: TAN_LUDERS,
    build: build,
    evaluateMicroState: evaluateMicroState,
    ipfRgbFromAxis: ipfRgbFromAxis,
    simulate: simulate,
    plateauStats: plateauStats,
    firstYieldsAreHighSchmid: firstYieldsAreHighSchmid,
    contiguousBehindFront: contiguousBehindFront,
    serrationsLineUp: serrationsLineUp,
    syncedMask: syncedMask,
    aheadOfFront: aheadOfFront,
    tauFlow: tauFlow
  };
})(typeof window !== "undefined" ? window : globalThis);
