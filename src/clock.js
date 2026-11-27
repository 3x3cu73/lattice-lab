/* Shared simulation clock adapter bridging the unified YPP engine
   to the mm (1.2 mm) grain-scale view so cm, mm, and nm stay 100% in sync. */
(function (root) {
  "use strict";

  let host = null;
  let boxPosition = 0;
  const listeners = [];

  function emit() {
    for (let i = 0; i < listeners.length; i++) listeners[i]();
  }

  function mapPhase(stage) {
    switch (stage) {
      case "elastic": return "elastic";
      case "upper": return "upper_yield";
      case "smooth": return "luders";
      case "drop": return "drop";
      case "luders": return "luders";
      case "hardening": return "hardening";
      case "necking": return "hardening";
      case "prebrittle": return "elastic";
      case "fracture": return "hardening";
      default: return "elastic";
    }
  }

  function phaseTitle(stage, cur) {
    if (stage === "elastic") return "Elastic loading";
    if (stage === "upper") return "Upper yield point A";
    if (stage === "smooth") return "Smooth yielding";
    if (stage === "drop") return "Yield drop A → B";
    if (stage === "luders") return "Lüders plateau";
    if (stage === "hardening") return "Work hardening";
    if (stage === "necking") return "Necking";
    if (stage === "prebrittle") return "Approaching cleavage";
    if (stage === "fracture") return cur && cur.st.frac === "cleavage" ? "Cleavage fracture" : "Ductile fracture";
    return stage;
  }

  function state() {
    const Y = root.LudersYPP;
    const snap = host && host.getSnapshot ? host.getSnapshot() : null;
    if (!snap || !snap.run || !Y) {
      return {
        strain: 0, stress: 0, phase: "elastic", stage: "elastic", phaseName: "Elastic loading",
        bandFront: 0, frontMm: 0, windowStartMm: 0, frontAwayMm: 0,
        progress: 0, k: 0, branch: null, dUm: 25, agingOn: true, L0: 50,
        flow: { stress: 260, strain: 0.02, upper: 300, lower: 260 }
      };
    }
    const { run, u, e, s, fl, stage } = snap;
    const st = run.st;
    const D = run.D;
    const L0 = Y.L0;
    const NC = Y.NC;

    let frontMm = 0;
    if (fl.f >= 1) {
      frontMm = L0;
    } else if (fl.f > 0) {
      const fronts = Y.frontsNow(run, fl);
      const primary = fronts.slice().sort((a, b) => a.band - b.band || b.dir - a.dir)[0];
      if (primary) {
        frontMm = ((primary.pos + (primary.dir > 0 ? 1 : 0)) * L0) / NC;
      } else {
        frontMm = fl.f * L0;
      }
    }
    const bandFront = Y.clamp(frontMm / L0, 0, 1);
    const win = 1.2;
    const x0 = boxPosition * Math.max(0, L0 - win);

    return {
      strain: e,
      stress: s,
      phase: u <= 1e-4 ? "intro" : mapPhase(stage),
      stage,
      phaseName: phaseTitle(stage, run),
      bandFront,
      frontMm,
      windowStartMm: x0,
      frontAwayMm: Math.max(0, x0 - frontMm),
      progress: u,
      k: Math.round(u * 1000),
      branch: null,
      dUm: run.P.d,
      cPpm: run.P.c,
      T: run.P.T,
      rate: run.P.rate,
      agingOn: st.yp,
      brittle: st.brittle,
      frac: st.frac,
      ePk: st.ePk,
      eP1: st.eP1,
      eU: st.eU,
      eF: st.eF,
      L0,
      sLy: D.sLY,
      sUy: D.sUY,
      eL: D.eL,
      flow: {
        stress: D.sLY,
        strain: st.eP1,
        upper: D.sUY,
        lower: D.sLY
      }
    };
  }

  function curve() {
    const snap = host && host.getSnapshot ? host.getSnapshot() : null;
    if (!snap || !snap.run) return [];
    const E = snap.run.E;
    const S = snap.run.S;
    const out = [];
    const step = Math.max(1, Math.floor(E.length / 180));
    for (let i = 0; i < E.length; i += step) {
      out.push({ strain: E[i], stress: S[i] });
    }
    if (E.length) out.push({ strain: E[E.length - 1], stress: S[S.length - 1] });
    return out;
  }

  root.LudersClock = {
    attach(h) { host = h; },
    notify: emit,
    state,
    curve,
    toggle() { return host && host.togglePlay ? host.togglePlay() : false; },
    setPlaying(on) { if (host && host.setPlaying) host.setPlaying(!!on); },
    isPlaying() { return host && host.isPlaying ? host.isPlaying() : false; },
    speed() { return host && host.getSpeed ? host.getSpeed() : 1; },
    setBox(p) { boxPosition = Math.max(0, Math.min(1, p)); emit(); },
    box() { return boxPosition; },
    storyEndK() { return 1000; },
    onChange(fn) { listeners.push(fn); }
  };
})(typeof window !== "undefined" ? window : globalThis);
