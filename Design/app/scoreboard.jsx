/* global React, Icon, SPORTS, SportChip, Crest, bigScore, segLabel, subLine, lastEvent, clockStr, tennisPoint */
// Sportagon — Live Public Scoreboard (broadcast-grade, dark default).
const { createElement: c, useState: uss, useEffect: uef, useRef: uref } = React;

function TeamBlock({ team, side, score, won, lost }) {
  return c("div", { className: `sb-team sb-${side}` },
    c(Crest, { name: team.name, size: 88, hue: team.hue, radius: 20 }),
    c("div", { className: "sb-team-meta" },
      c("div", { className: "sb-team-name" }, team.name),
      c("div", { className: "sb-team-short mono" }, team.short)
    )
  );
}

// Sport-specific detail strip under the score
function SportDetail({ m }) {
  const sp = SPORTS[m.sportKey], s = m.state || {};
  if (sp.key === "cricket") {
    return c("div", { className: "sb-detail" },
      c("div", { className: "sb-detail-row" },
        c("span", { className: "sb-chip" }, c("span", { className: "sb-chip-k" }, "Striker"), c("span", { className: "tnum" }, s.striker || "—")),
        c("span", { className: "sb-chip" }, c("span", { className: "sb-chip-k" }, "Non-striker"), s.nonStriker || "—"),
        c("span", { className: "sb-chip" }, c("span", { className: "sb-chip-k" }, "Bowler"), s.bowler || "—")
      ),
      c("div", { className: "sb-over" },
        c("span", { className: "sb-chip-k" }, "This over"),
        (s.thisOver || []).map((b, i) => c("span", { key: i, className: `sb-ball ${b === "W" ? "w" : b === "6" || b === "4" ? "boundary" : ""}` }, b))
      )
    );
  }
  if (sp.key === "football") {
    return c("div", { className: "sb-scorers" },
      c("div", null, c("span", { className: "sb-chip-k" }, "⚽ ", m.teamA.short), (s.scorersA || []).map((x, i) => c("span", { key: i, className: "sb-scorer tnum" }, x))),
      c("div", { style: { textAlign: "right" } }, c("span", { className: "sb-chip-k" }, m.teamB.short, " ⚽"), (s.scorersB || []).map((x, i) => c("span", { key: i, className: "sb-scorer tnum" }, x)))
    );
  }
  // sets / rally / clock — set-by-set line
  const sub = subLine(m);
  if (!sub || sub === "—") return null;
  return c("div", { className: "sb-setline tnum" }, sub);
}

function Scoreboard({ m, big, onExit }) {
  const sp = SPORTS[m.sportKey];
  const score = bigScore(m);
  const live = m.status === "live";
  const done = m.status === "completed" || m.status === "confirmed";
  const winner = done ? (parseInt(score.a) === parseInt(score.b) ? null : parseInt(score.a) > parseInt(score.b) ? "A" : "B") : null;

  return c("div", { className: `scoreboard ${big ? "sb-big" : ""}`, style: { "--sb-accent": sp.accent } },
    c("div", { className: "sb-glow" }),
    c("header", { className: "sb-head" },
      c("div", { className: "sb-head-l" },
        c(SportChip, { sportKey: m.sportKey, size: 34, radius: 10 }),
        c("div", null,
          c("div", { className: "sb-event" }, m.event),
          c("div", { className: "sb-round" }, sp.name, " · ", m.round)
        )
      ),
      c("div", { className: "sb-head-r" },
        live && c("span", { className: "sb-live" }, c("span", { className: "sb-live-dot" }), "LIVE"),
        done && c("span", { className: "sb-ft" }, "FULL TIME"),
        c("span", { className: "sb-seg tnum" }, segLabel(m))
      )
    ),
    c("div", { className: "sb-body" },
      c(TeamBlock, { team: m.teamA, side: "a", won: winner === "A" }),
      c("div", { className: "sb-score" },
        c("div", { className: `sb-num tnum ${winner === "A" ? "win" : winner === "B" ? "dim" : ""}` }, score.a),
        c("div", { className: "sb-colon" }, ":"),
        c("div", { className: `sb-num tnum ${winner === "B" ? "win" : winner === "A" ? "dim" : ""}` }, score.b)
      ),
      c(TeamBlock, { team: m.teamB, side: "b", won: winner === "B" })
    ),
    c(SportDetail, { m }),
    c("footer", { className: "sb-foot" },
      c("div", { className: "sb-last" }, lastEvent(m) && [c("span", { key: "k", className: "sb-chip-k" }, "Last"), c("span", { key: "v" }, lastEvent(m))]),
      c("div", { className: "sb-venue" }, c(Icon, { name: "pin", size: 14 }), m.venue, " · ", m.court)
    ),
    onExit && c("button", { className: "sb-exit", onClick: onExit }, c(Icon, { name: "x", size: 20 }))
  );
}

// Big-screen mode: auto-rotate across live matches
function BigScreen({ matches, onExit }) {
  const live = matches.filter((m) => m.status === "live");
  const [i, setI] = uss(0);
  const [paused, setPaused] = uss(false);
  uef(() => {
    if (paused || live.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % live.length), 8000);
    return () => clearInterval(t);
  }, [paused, live.length]);
  const cur = live[i % live.length] || matches[0];
  return c("div", { className: "bigscreen" },
    c(Scoreboard, { m: cur, big: true }),
    c("div", { className: "bs-controls" },
      c("button", { className: "bs-btn", onClick: () => setPaused((p) => !p), title: paused ? "Resume" : "Pause rotation" }, c(Icon, { name: paused ? "play" : "pause", size: 18 })),
      c("div", { className: "bs-rail" },
        live.map((m, idx) => c("button", { key: m.id, className: `bs-dot ${idx === i ? "active" : ""}`, onClick: () => setI(idx), title: `${m.teamA.short} v ${m.teamB.short}` },
          c(SportChip, { sportKey: m.sportKey, size: 24, radius: 7 }),
          c("span", { className: "bs-dot-label" }, m.teamA.short, " v ", m.teamB.short))),
      ),
      c("button", { className: "bs-btn", onClick: onExit, title: "Exit" }, c(Icon, { name: "x", size: 18 }))
    ),
    c("div", { className: "bs-progress", key: i }, c("span", { className: paused ? "" : "run" }))
  );
}

Object.assign(window, { Scoreboard, BigScreen });
