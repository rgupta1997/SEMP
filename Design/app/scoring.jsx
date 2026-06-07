/* global window, SPORTS */
// Sportagon — scoring engine: formatters + reducer (sport-specific logic).

const pad = (n) => String(n).padStart(2, "0");
const clockStr = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

// Tennis point ladder
const TP = ["0", "15", "30", "40"];
function tennisPoint(p, o) {
  if (p >= 3 && o >= 3) { if (p === o) return "40"; return p > o ? "Ad" : "40"; }
  return TP[Math.min(p, 3)];
}

// ---- Big score shown on console / scoreboard ----
function bigScore(m) {
  const s = m.state || {};
  switch (SPORTS[m.sportKey].archetype) {
    case "sets": return { a: s.setsA ?? 0, b: s.setsB ?? 0 };
    case "rally": return { a: s.gamesA ?? 0, b: s.gamesB ?? 0 };
    case "tennis": return { a: (s.sets || []).filter((x) => x[0] > x[1]).length, b: (s.sets || []).filter((x) => x[1] > x[0]).length };
    case "cricket": return { a: `${s.a ?? 0}/${s.wA ?? 0}`, b: `${s.b ?? 0}/${s.wB ?? 0}` };
    default: return { a: s.a ?? 0, b: s.b ?? 0 };
  }
}

// ---- Current segment label (+ clock for timed sports) ----
function segLabel(m) {
  const sp = SPORTS[m.sportKey], s = m.state || {};
  if (m.status === "completed" || m.status === "confirmed") return "Full Time";
  switch (sp.archetype) {
    case "clock": {
      const seg = s.seg ?? 1;
      const lbl = sp.key === "football" ? `${seg === 1 ? "1st" : "2nd"} Half` : `Quarter ${seg}`;
      if (sp.key === "football") return `${lbl} · ${s.minute ?? 0}′`;
      return `${lbl} · ${clockStr(s.clock ?? 600)}`;
    }
    case "sets": return `Set ${s.seg ?? 1}`;
    case "rally": return `Game ${s.seg ?? 1}`;
    case "tennis": return `Set ${(s.sets || []).length + 1}`;
    case "cricket": return `Innings ${s.inn ?? 1} · ${(((s.battingTeam === "A" ? s.oversA : s.ballsB / 6) || 0)).toFixed(1)} ov`;
    case "time": return "Final";
    default: return "";
  }
}

// ---- Secondary line: set-by-set, quarter line, overs, etc. ----
function subLine(m) {
  const sp = SPORTS[m.sportKey], s = m.state || {};
  switch (sp.archetype) {
    case "sets": {
      const cur = (m.status === "live") ? [`${s.a ?? 0}–${s.b ?? 0}`] : [];
      const prev = (s.setScores || []).map((x) => `${x[0]}–${x[1]}`);
      return [...prev, ...cur].join("  ·  ") || "—";
    }
    case "rally": {
      const prev = (s.gameScores || []).map((x) => `${x[0]}–${x[1]}`);
      const cur = (m.status === "live") ? [`${s.a ?? 0}–${s.b ?? 0}`] : [];
      return [...prev, ...cur].join("  ·  ") || "—";
    }
    case "clock": {
      const qs = s.segScores || [];
      if (sp.key === "football") return `Scorers · ${[...(s.scorersA || []), ...(s.scorersB || [])].length} goals`;
      const line = qs.map((x) => `${x[0]}–${x[1]}`).join("  ·  ");
      return line ? `By ${sp.segLabel}: ${line}` : "—";
    }
    case "cricket": {
      const rr = s.rr ? `RR ${s.rr.toFixed(2)}` : "";
      const need = s.target ? `Need ${s.target - (s.b ?? 0)} off ${(20 * 6) - (s.ballsB ?? 0)}` : "";
      return [need, rr].filter(Boolean).join("  ·  ");
    }
    default: return "";
  }
}

function lastEvent(m) {
  const e = (m.log || [])[0];
  return e ? `${e.team === "A" ? m.teamA.short : e.team === "B" ? m.teamB.short : ""} — ${e.txt}`.trim() : "";
}

// ---- Winner / result string for completed ----
function resultStr(m) {
  const b = bigScore(m);
  return `${b.a}–${b.b}`;
}
function winnerSide(m) {
  const b = bigScore(m);
  const av = parseInt(b.a), bv = parseInt(b.b);
  if (av === bv) return null;
  return av > bv ? "A" : "B";
}

// ================= REDUCER =================
function nowTag(m) {
  const sp = SPORTS[m.sportKey], s = m.state;
  if (sp.archetype === "clock" && sp.key !== "football") return `Q${s.seg} ${clockStr(s.clock)}`;
  if (sp.key === "football") return `${s.minute}'`;
  if (sp.archetype === "sets") return `S${s.seg} ${s.a}-${s.b}`;
  if (sp.archetype === "rally") return `G${s.seg} ${s.a}-${s.b}`;
  return "";
}

function scoreReducer(m, action) {
  const sp = SPORTS[m.sportKey];
  const s = { ...m.state };
  let logEntry = null;
  const A = m.teamA.short, B = m.teamB.short;

  switch (action.type) {
    case "POINT": {
      const { team, pts = 1, label } = action;
      if (sp.archetype === "clock") {
        if (team === "A") s.a = (s.a || 0) + pts; else s.b = (s.b || 0) + pts;
        logEntry = { t: nowTag(m), team, txt: `+${pts}${label ? ` — ${label}` : ""}`, pts, undo: { type: "POINT", team, pts } };
      } else if (sp.archetype === "sets" || sp.archetype === "rally") {
        if (team === "A") s.a = (s.a || 0) + 1; else s.b = (s.b || 0) + 1;
        s.serving = team;
        logEntry = { t: nowTag(m), team, txt: `Point${label ? ` — ${label}` : ""}` };
      } else if (sp.archetype === "cricket") {
        s.b = (s.b || 0) + pts; s.ballsB = (s.ballsB || 0) + 1;
        s.thisOver = [...(s.thisOver || []), String(pts)].slice(-6);
        logEntry = { t: `${(s.ballsB / 6).toFixed(1)}`, team: "B", txt: `${pts} run${pts !== 1 ? "s" : ""}` };
      }
      break;
    }
    case "WICKET": {
      s.wB = (s.wB || 0) + 1; s.ballsB = (s.ballsB || 0) + 1;
      s.thisOver = [...(s.thisOver || []), "W"].slice(-6);
      logEntry = { t: `${(s.ballsB / 6).toFixed(1)}`, team: "B", txt: `WICKET — ${action.how || "bowled"}` };
      break;
    }
    case "EXTRA": {
      s.b = (s.b || 0) + 1;
      logEntry = { t: `${((s.ballsB || 0) / 6).toFixed(1)}`, team: "B", txt: `${action.kind || "Wide"} +1` };
      break;
    }
    case "FOUL": {
      const k = action.team === "A" ? "foulsA" : "foulsB";
      s[k] = (s[k] || 0) + 1;
      if (s[k] >= 7) { if (action.team === "A") s.bonus = { ...s.bonus, b: true }; else s.bonus = { ...s.bonus, a: true }; }
      logEntry = { t: nowTag(m), team: action.team, txt: `Team foul (${s[k]})` };
      break;
    }
    case "CARD": {
      const k = action.team === "A" ? "cardsA" : "cardsB";
      s[k] = [...(s[k] || []), `${s.minute}' ${action.card} — ${action.player || "Player"}`];
      logEntry = { t: `${s.minute}'`, team: action.team, txt: `${action.card} card` };
      break;
    }
    case "TOGGLE_CLOCK": s.running = !s.running; break;
    case "TICK": {
      if (sp.key === "football") { if (s.running) s.minute = (s.minute || 0) + 1; }
      else if (s.running && s.clock > 0) s.clock = s.clock - 1;
      return { ...m, state: s };
    }
    case "NEXT_SEGMENT": {
      if (sp.archetype === "clock" && sp.key !== "football") {
        s.segScores = [...(s.segScores || []), [s.a || 0, s.b || 0]];
        s.seg = Math.min((s.seg || 1) + 1, sp.segMax);
        s.clock = 600; s.running = false; s.foulsA = 0; s.foulsB = 0; s.bonus = { a: false, b: false };
        logEntry = { t: `Q${s.seg}`, team: "", txt: `Start of Quarter ${s.seg}` };
      } else if (sp.key === "football") {
        s.seg = 2; s.minute = 45; s.running = false;
        logEntry = { t: "HT", team: "", txt: "Half time" };
      } else if (sp.archetype === "sets" || sp.archetype === "rally") {
        const aw = (s.a || 0) > (s.b || 0);
        if (sp.archetype === "sets") { if (aw) s.setsA = (s.setsA || 0) + 1; else s.setsB = (s.setsB || 0) + 1; s.setScores = [...(s.setScores || []), [s.a, s.b]]; }
        else { if (aw) s.gamesA = (s.gamesA || 0) + 1; else s.gamesB = (s.gamesB || 0) + 1; s.gameScores = [...(s.gameScores || []), [s.a, s.b]]; }
        s.seg = (s.seg || 1) + 1; s.a = 0; s.b = 0;
        logEntry = { t: "", team: "", txt: `${aw ? A : B} take the ${sp.archetype === "sets" ? "set" : "game"}` };
      }
      break;
    }
    case "SET_STATUS": return { ...m, status: action.status };
    case "SIGN_OFF": return { ...m, status: "confirmed", state: { ...s, signedBy: m.official, signedAt: "now" } };
    case "RESET": return action.match;
    default: return m;
  }
  const log = logEntry ? [logEntry, ...(m.log || [])] : m.log;
  return { ...m, state: s, log };
}

Object.assign(window, { bigScore, segLabel, subLine, lastEvent, resultStr, winnerSide, clockStr, tennisPoint, scoreReducer });
