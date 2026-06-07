/* global React, Icon, cx, Crest, StatusBadge, SportChip, SPORTS, bigScore, segLabel, subLine, lastEvent, winnerSide */
// Sportagon — compact score card (third scoring surface; evolves MatchRow).
const { createElement: mc } = React;

function CompactScoreCard({ m, onOpen, cta, accentTop }) {
  const sp = SPORTS[m.sportKey];
  const score = bigScore(m);
  const live = m.status === "live";
  const done = m.status === "completed" || m.status === "confirmed";
  const win = done ? winnerSide(m) : null;
  return mc("div", { className: cx("msc card", live && "msc-live", onOpen && "card-hover"), onClick: onOpen, style: accentTop ? { "--accent": sp.accent } : null },
    accentTop && mc("span", { className: "msc-accent", style: { background: sp.accent } }),
    mc("div", { className: "msc-top" },
      mc("div", { className: "msc-sport" }, mc(SportChip, { sportKey: m.sportKey, size: 26, radius: 8 }),
        mc("div", { style: { minWidth: 0 } },
          mc("div", { className: "msc-tour" }, sp.name),
          mc("div", { className: "msc-round" }, m.round))),
      live ? mc(StatusBadge, { status: "live" }) : mc(StatusBadge, { status: m.status })
    ),
    mc("div", { className: "msc-teams" },
      mc("div", { className: cx("msc-team", win === "B" && "lost") },
        mc(Crest, { name: m.teamA.name, size: 30, hue: m.teamA.hue }),
        mc("span", { className: "msc-name" }, m.teamA.short),
        mc("span", { className: "msc-score tnum" }, score.a)),
      mc("div", { className: cx("msc-team", win === "A" && "lost") },
        mc(Crest, { name: m.teamB.name, size: 30, hue: m.teamB.hue }),
        mc("span", { className: "msc-name" }, m.teamB.short),
        mc("span", { className: "msc-score tnum" }, score.b))
    ),
    mc("div", { className: "msc-foot" },
      mc("span", { className: "msc-meta tnum" }, live ? segLabel(m) : done ? "Full Time" : `${m.startTime} · ${m.court}`),
      cta
        ? mc("span", { className: "msc-cta" }, cta, mc(Icon, { name: "arrowRight", size: 14 }))
        : mc("span", { className: "msc-meta", style: { color: "var(--text-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, live && lastEvent(m) ? lastEvent(m) : `${m.venue}`)
    )
  );
}

// Slim row variant for dense lists
function MatchRow({ m, onOpen }) {
  const score = bigScore(m), live = m.status === "live", win = (m.status === "completed" || m.status === "confirmed") ? winnerSide(m) : null;
  return mc("button", { className: cx("mrow", live && "mrow-live"), onClick: onOpen },
    mc(SportChip, { sportKey: m.sportKey, size: 28, radius: 8 }),
    mc("div", { className: "mrow-teams" },
      mc("div", { className: cx("mrow-t", win === "B" && "lost") }, mc("span", null, m.teamA.short), mc("span", { className: "tnum mrow-s" }, score.a)),
      mc("div", { className: cx("mrow-t", win === "A" && "lost") }, mc("span", null, m.teamB.short), mc("span", { className: "tnum mrow-s" }, score.b))
    ),
    mc("div", { className: "mrow-meta" },
      live ? mc(StatusBadge, { status: "live" }) : mc("span", { className: "sm text-muted tnum" }, m.status === "scheduled" ? m.startTime : "FT"),
      mc("span", { className: "xs text-muted hide-mobile" }, m.round)
    ),
    mc(Icon, { name: "chevronRight", size: 16, className: "text-muted" })
  );
}

Object.assign(window, { CompactScoreCard, MatchRow });
