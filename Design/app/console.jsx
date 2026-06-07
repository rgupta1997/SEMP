/* global React, Icon, cx, Crest, Button, SPORTS, SportChip, bigScore, segLabel, clockStr */
// Sportagon — Official Match Console (mobile/tablet-first live scoring input).
const { createElement: n, useState: ust, useEffect: uft } = React;

// ---- per-sport scoring control rows ----
function ScoreControls({ m, side, dispatch }) {
  const sp = SPORTS[m.sportKey];
  const big = (lbl, action, cls) => n("button", { className: cx("score-btn", cls), onClick: () => dispatch(action) }, lbl);
  switch (sp.archetype) {
    case "clock":
      if (sp.key === "football") return n("div", { className: "ctrl-col" },
        big(n("span", null, n(Icon, { name: "plusCircle", size: 18 }), " Goal"), { type: "POINT", team: side, pts: 1, label: "Goal" }, "score-btn-primary"),
        n("div", { className: "ctrl-row" },
          n("button", { className: "score-btn sm warn", onClick: () => dispatch({ type: "CARD", team: side, card: "Yellow" }) }, "Yellow"),
          n("button", { className: "score-btn sm danger", onClick: () => dispatch({ type: "CARD", team: side, card: "Red" }) }, "Red"))
      );
      return n("div", { className: "ctrl-row3" },
        big("+1", { type: "POINT", team: side, pts: 1 }),
        big("+2", { type: "POINT", team: side, pts: 2 }, "score-btn-primary"),
        big("+3", { type: "POINT", team: side, pts: 3 }),
        n("button", { className: "score-btn wide ghost", onClick: () => dispatch({ type: "FOUL", team: side }) }, "Team foul")
      );
    case "sets": case "rally": case "tennis":
      return n("div", { className: "ctrl-col" }, big(n("span", null, n(Icon, { name: "plus", size: 20 }), " Point"), { type: "POINT", team: side }, "score-btn-primary tall"));
    default: return null;
  }
}

// Cricket has a single batting-team control deck (not per-side)
function CricketDeck({ m, dispatch }) {
  const runs = [0, 1, 2, 3, 4, 6];
  return n("div", { className: "cricket-deck" },
    n("div", { className: "ctrl-label" }, "Runs off the bat"),
    n("div", { className: "run-grid" },
      runs.map((r) => n("button", { key: r, className: cx("run-btn", (r === 4 || r === 6) && "boundary"), onClick: () => dispatch({ type: "POINT", pts: r }) }, r))
    ),
    n("div", { className: "ctrl-row", style: { marginTop: 10 } },
      n("button", { className: "score-btn sm ghost", onClick: () => dispatch({ type: "EXTRA", kind: "Wide" }) }, "Wide"),
      n("button", { className: "score-btn sm ghost", onClick: () => dispatch({ type: "EXTRA", kind: "No-ball" }) }, "No ball"),
      n("button", { className: "score-btn sm danger", onClick: () => dispatch({ type: "WICKET", how: "bowled" }) }, n(Icon, { name: "alert", size: 16 }), " Wicket")
    )
  );
}

function MatchConsole({ m, dispatch, onUndo, canUndo, onExit, syncOffline }) {
  const sp = SPORTS[m.sportKey];
  const score = bigScore(m);
  const s = m.state || {};
  const [confirmEnd, setConfirm] = ust(false);
  const isCricket = sp.key === "cricket";
  const timed = sp.archetype === "clock";
  const live = m.status === "live";
  const segMax = sp.segMax;
  const segNow = isCricket ? s.inn : (s.seg || 1);

  return n("div", { className: "console" },
    // header
    n("header", { className: "con-head" },
      n("button", { className: "iconbtn", onClick: onExit, "aria-label": "Back" }, n(Icon, { name: "chevronLeft", size: 22 })),
      n("div", { className: "con-head-mid" },
        n("div", { className: "con-title" }, n(SportChip, { sportKey: m.sportKey, size: 22, radius: 7 }), sp.name, " · ", m.round),
        n("div", { className: "con-seg tnum" }, segLabel(m))
      ),
      n("div", { className: "con-head-r" },
        syncOffline
          ? n("span", { className: "sync-badge offline" }, n(Icon, { name: "wifiOff", size: 14 }), "Offline · 2 queued")
          : n("span", { className: "sync-badge" }, n(Icon, { name: "wifi", size: 14 }), "Synced"),
        live && n("span", { className: "con-live" }, n("span", { className: "dot" }), "LIVE")
      )
    ),

    // scoreline
    n("div", { className: "con-score" },
      n("div", { className: "con-team" },
        n(Crest, { name: m.teamA.name, size: 46, hue: m.teamA.hue }),
        n("div", { className: "con-team-name" }, m.teamA.short),
        n("div", { className: "con-big tnum tick", key: "a" + score.a }, score.a)
      ),
      n("div", { className: "con-vs" }, isCricket ? (s.battingTeam === "A" ? "batting" : "") : "vs"),
      n("div", { className: "con-team" },
        n(Crest, { name: m.teamB.name, size: 46, hue: m.teamB.hue }),
        n("div", { className: "con-team-name" }, m.teamB.short),
        n("div", { className: "con-big tnum tick", key: "b" + score.b }, score.b)
      )
    ),

    // controls
    isCricket
      ? n(CricketDeck, { m, dispatch })
      : sp.archetype === "time"
        ? n("div", { className: "con-note" }, n(Icon, { name: "clock", size: 18 }), "Timed event — enter ranked results in the Results sheet.")
        : n("div", { className: "ctrl-split" },
            n("div", { className: "ctrl-side" }, n("div", { className: "ctrl-label" }, m.teamA.short), n(ScoreControls, { m, side: "A", dispatch })),
            n("div", { className: "ctrl-divider" }),
            n("div", { className: "ctrl-side" }, n("div", { className: "ctrl-label" }, m.teamB.short), n(ScoreControls, { m, side: "B", dispatch }))
          ),

    // segment + clock control
    n("div", { className: "con-segbar" },
      timed && n("button", { className: cx("clock-btn", s.running && "running"), onClick: () => dispatch({ type: "TOGGLE_CLOCK" }) },
        n(Icon, { name: s.running ? "pause" : "play", size: 18 }), sp.key === "football" ? `${s.minute || 0}′` : clockStr(s.clock || 600)),
      n("div", { className: "seg-info" }, n("span", { className: "ctrl-label" }, sp.segLabel === "INN" ? "Innings" : sp.segLabel === "SET" ? "Set" : sp.segLabel === "GAME" ? "Game" : sp.key === "football" ? "Half" : "Quarter"),
        n("span", { className: "seg-now tnum" }, segNow, " of ", segMax)),
      n("button", { className: "score-btn sm secondary", onClick: () => dispatch({ type: "NEXT_SEGMENT" }) },
        sp.archetype === "sets" ? "End set" : sp.archetype === "rally" ? "End game" : sp.key === "football" ? (segNow === 1 ? "Half time" : "End") : "End quarter")
    ),

    // event log
    n("div", { className: "con-log" },
      n("div", { className: "log-head" },
        n("span", { className: "ctrl-label" }, "Event log"),
        n("button", { className: "undo-btn", disabled: !canUndo, onClick: onUndo }, n(Icon, { name: "undo", size: 15 }), "Undo last")
      ),
      n("div", { className: "log-list no-scrollbar" },
        (m.log || []).length === 0 && n("div", { className: "sm text-muted", style: { padding: "10px 2px" } }, "No events yet — start scoring."),
        (m.log || []).map((e, i) => n("div", { key: i, className: cx("log-row", i === 0 && "newest") },
          n("span", { className: "log-t mono" }, e.t || "—"),
          e.team && n("span", { className: "log-team", style: { color: e.team === "A" ? "var(--brand-500)" : "var(--text-secondary)" } }, e.team === "A" ? m.teamA.short : m.teamB.short),
          n("span", { className: "log-txt" }, e.txt)
        ))
      )
    ),

    // guarded end
    n("div", { className: "con-foot" },
      m.status === "confirmed"
        ? n("div", { className: "signed" }, n(Icon, { name: "checkCircle", size: 18 }), "Result confirmed & signed by ", n("b", null, m.official))
        : n("button", { className: "end-btn", onClick: () => setConfirm(true) }, n(Icon, { name: "signature", size: 18 }), "End match & sign off")
    ),

    confirmEnd && n(ConfirmEnd, { m, score, onCancel: () => setConfirm(false), onConfirm: () => { dispatch({ type: "SIGN_OFF" }); setConfirm(false); } })
  );
}

function ConfirmEnd({ m, score, onCancel, onConfirm }) {
  return n("div", { className: "confirm-scrim", onClick: onCancel },
    n("div", { className: "confirm-sheet", onClick: (e) => e.stopPropagation() },
      n("div", { className: "confirm-icon" }, n(Icon, { name: "signature", size: 24 })),
      n("h3", { className: "h2", style: { textAlign: "center" } }, "Confirm final result"),
      n("p", { className: "sm text-secondary", style: { textAlign: "center", marginTop: 4 } }, "This signs off the match and updates standings. Corrections after this require a review."),
      n("div", { className: "confirm-result" },
        n("span", null, m.teamA.short), n("span", { className: "tnum confirm-score" }, score.a, " – ", score.b), n("span", null, m.teamB.short)),
      n("div", { className: "confirm-actions" },
        n(Button, { variant: "outline", block: true, onClick: onCancel }, "Cancel"),
        n(Button, { variant: "primary", block: true, icon: "check", onClick: onConfirm }, "Sign off result"))
    )
  );
}

Object.assign(window, { MatchConsole });
