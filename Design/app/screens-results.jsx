/* global React, Icon, cx, Card, Button, Badge, StatusBadge, Crest, SportChip, PageHeader, Segmented, MatchRow, TEAMS, STANDINGS, MEDALS, SPORTS */
// Sportagon — results surfaces: Standings, Medal tally, Schedule.
const { createElement: r, useState: rst } = React;

const teamName = (k) => (TEAMS[k] ? TEAMS[k].name : k);
const teamHue = (k) => (TEAMS[k] ? TEAMS[k].hue : 256);

/* =================== STANDINGS =================== */
function FormGuide({ form }) {
  return r("div", { className: "form-guide" },
    form.map((f, i) => r("span", { key: i, className: cx("form-pip", f === "W" ? "w" : f === "D" ? "d" : "l"), title: f }, f)));
}
function Standings() {
  const [view, setView] = rst("table");
  return r("div", { className: "content-pad content-max fade-up" },
    r(PageHeader, {
      eyebrow: "Results", title: "Championship Standings",
      sub: "Win = 3 · Draw = 1 · computed live from confirmed fixtures.",
      actions: r(Segmented, { value: view, onChange: setView, items: [{ value: "table", label: "Table", icon: "list" }, { value: "form", label: "Form", icon: "bolt" }] }),
    }),
    r("div", { className: "kpi-grid", style: { marginBottom: 20 } },
      r(Card, { pad: true, className: "stat" }, r("span", { className: "stat-label" }, "Leader"), r("div", { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 6 } }, r(Crest, { name: teamName("IITB"), size: 36, hue: teamHue("IITB") }), r("span", { className: "h3" }, "IIT Bombay"))),
      r(Card, { pad: true, className: "stat" }, r("span", { className: "stat-label" }, "Matches completed"), r("span", { className: "stat-value tnum", style: { marginTop: 6 } }, "72")),
      r(Card, { pad: true, className: "stat" }, r("span", { className: "stat-label" }, "Institutions scoring"), r("span", { className: "stat-value tnum", style: { marginTop: 6 } }, "8"))
    ),
    r(Card, { className: "table-card" },
      r("div", { className: "tbl-scroll" },
        r("table", { className: "tbl standings-tbl" },
          r("thead", null, r("tr", null,
            r("th", { className: "tbl-rank" }, "#"),
            r("th", { style: { textAlign: "left" } }, "Institution"),
            r("th", { className: "tnum" }, "P"), r("th", { className: "tnum" }, "W"), r("th", { className: "tnum" }, "D"), r("th", { className: "tnum" }, "L"),
            r("th", { className: "tnum hide-mobile" }, "GD"),
            r("th", { className: "hide-mobile" }, "Form"),
            r("th", { className: "tnum tbl-pts" }, "Pts"))),
          r("tbody", null,
            STANDINGS.map((row, i) => r(React.Fragment, { key: row.team },
              r("tr", { className: cx(i < 4 && "qual") },
                r("td", { className: "tbl-rank tnum" }, i + 1),
                r("td", null, r("div", { className: "tbl-team" }, r(Crest, { name: teamName(row.team), size: 30, hue: teamHue(row.team) }), r("span", null, teamName(row.team)))),
                r("td", { className: "tnum" }, row.P), r("td", { className: "tnum" }, row.W), r("td", { className: "tnum" }, row.D), r("td", { className: "tnum" }, row.L),
                r("td", { className: "tnum hide-mobile", style: { color: row.gd[0] === "+" ? "var(--success)" : "var(--danger)" } }, row.gd),
                r("td", { className: "hide-mobile" }, r(FormGuide, { form: row.form })),
                r("td", { className: "tnum tbl-pts" }, row.pts)),
              i === 3 && r("tr", { className: "qual-line" }, r("td", { colSpan: 9 }, r("span", null, "Knockout qualification")))
            ))
          )
        )
      )
    )
  );
}

/* =================== MEDAL TALLY =================== */
function Medals() {
  const sorted = [...MEDALS].sort((a, b) => b.g - a.g || b.s - a.s || b.b - a.b);
  const top3 = sorted.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
  return r("div", { className: "content-pad content-max fade-up" },
    r(PageHeader, { eyebrow: "Results", title: "Medal Tally", sub: "Across all sports · ranked by gold, then silver, then bronze." }),
    r("div", { className: "podium" },
      podiumOrder.map((m, i) => {
        const rank = sorted.indexOf(m) + 1;
        return r("div", { key: m.team, className: cx("podium-col", `p${rank}`) },
          r(Crest, { name: teamName(m.team), size: 54, hue: teamHue(m.team) }),
          r("div", { className: "podium-name" }, m.team),
          r("div", { className: "podium-medals tnum" }, "🥇", m.g, " 🥈", m.s, " 🥉", m.b),
          r("div", { className: cx("podium-block") }, r("span", { className: "podium-rank" }, rank)));
      })
    ),
    r(Card, { className: "table-card", style: { marginTop: 20 } },
      r("div", { className: "tbl-scroll" },
        r("table", { className: "tbl medal-tbl" },
          r("thead", null, r("tr", null,
            r("th", { className: "tbl-rank" }, "#"), r("th", { style: { textAlign: "left" } }, "Institution"),
            r("th", { className: "tnum medal-g" }, "Gold"), r("th", { className: "tnum medal-s" }, "Silver"), r("th", { className: "tnum medal-b" }, "Bronze"),
            r("th", { className: "tnum tbl-pts" }, "Total"))),
          r("tbody", null, sorted.map((m, i) => r("tr", { key: m.team, className: cx(i < 3 && "qual") },
            r("td", { className: "tbl-rank tnum" }, i + 1),
            r("td", null, r("div", { className: "tbl-team" }, r(Crest, { name: teamName(m.team), size: 30, hue: teamHue(m.team) }), r("span", null, teamName(m.team)))),
            r("td", { className: "tnum medal-cell medal-g" }, m.g), r("td", { className: "tnum medal-cell medal-s" }, m.s), r("td", { className: "tnum medal-cell medal-b" }, m.b),
            r("td", { className: "tnum tbl-pts" }, m.g + m.s + m.b))))
        )
      )
    )
  );
}

/* =================== SCHEDULE / AGENDA =================== */
function Schedule({ matches, openScoreboard }) {
  const [venue, setVenue] = rst("all");
  const venues = ["all", ...new Set(matches.map((m) => m.venue))];
  const slots = {};
  matches.forEach((m) => { (slots[m.startTime] = slots[m.startTime] || []).push(m); });
  const times = Object.keys(slots).sort();
  const shown = (list) => venue === "all" ? list : list.filter((m) => m.venue === venue);
  return r("div", { className: "content-pad content-max fade-up" },
    r(PageHeader, { eyebrow: "Day 4 · Saturday", title: "Schedule",
      actions: r(Segmented, { value: "day", onChange: () => {}, items: [{ value: "day", label: "Day" }, { value: "week", label: "Week" }] }) }),
    r("div", { className: "filter-bar no-scrollbar" },
      venues.map((v) => r("button", { key: v, className: cx("chip", venue === v && "active"), onClick: () => setVenue(v) }, v === "all" ? "All venues" : v))),
    r("div", { className: "agenda" },
      times.map((t) => { const list = shown(slots[t]); if (!list.length) return null;
        return r("div", { key: t, className: "agenda-slot" },
          r("div", { className: "agenda-time mono" }, t),
          r("div", { className: "agenda-rows" }, list.map((m) => r(MatchRow, { key: m.id, m, onOpen: () => openScoreboard(m.id) }))));
      })
    )
  );
}

Object.assign(window, { Standings, Medals, Schedule });
