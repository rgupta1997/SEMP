/* global React, Icon, cx, Card, StatCard, Button, Badge, StatusBadge, Crest, SportChip, PageHeader, EmptyState, Segmented, CompactScoreCard, MatchRow, SPORTS, bigScore, segLabel, lastEvent */
// Sportagon — operational screens: Organiser Live Ops, Official, Spectator Live.
const { createElement: g, useState: gst } = React;

/* =================== ORGANISER · LIVE OPS =================== */
function LiveOps({ matches, openScoreboard, openBigScreen }) {
  const live = matches.filter((m) => m.status === "live");
  const completedToday = matches.filter((m) => m.status === "completed" || m.status === "confirmed").length;
  const alerts = [
    { icon: "alert", tone: "danger", txt: "Venue clash — Court A double-booked 19:30", act: "Resolve" },
    { icon: "whistle", tone: "warning", txt: "2 fixtures at 18:00 have no assigned official", act: "Assign" },
    { icon: "checkCircle", tone: "warning", txt: "12 institution enrollments awaiting approval", act: "Review" },
  ];
  return g("div", { className: "content-pad content-max fade-up" },
    g(PageHeader, {
      eyebrow: "Event Operations", title: "Live Ops", sub: "Mission control — everything happening right now across venues.",
      actions: g(Button, { variant: "primary", icon: "tv", onClick: openBigScreen }, "Big-screen mode"),
    }),
    g("div", { className: "kpi-grid" },
      g(StatCard, { label: "Live now", value: live.length, icon: "broadcast", accent: "var(--live)" }),
      g(StatCard, { label: "Completed today", value: completedToday, icon: "checkCircle", accent: "var(--success)" }),
      g(StatCard, { label: "Venues active", value: "6", icon: "pin" }),
      g(StatCard, { label: "Officials on duty", value: "18", icon: "whistle" }),
      g(StatCard, { label: "Readiness", value: "92%", icon: "shield", delta: "+4%", deltaDir: "up" })
    ),
    g("div", { className: "ops-grid" },
      g("div", null,
        g("div", { className: "section-head" }, g("h2", { className: "h2" }, "Live now"), g("span", { className: "live-count" }, g("span", { className: "dot" }), live.length, " matches")),
        g("div", { className: "card-grid-3" },
          live.map((m) => g(CompactScoreCard, { key: m.id, m, accentTop: true, onOpen: () => openScoreboard(m.id), cta: "View" }))
        )
      ),
      g("aside", { className: "ops-aside" },
        g(Card, { pad: true },
          g("div", { className: "section-head", style: { marginBottom: 12 } }, g("h3", { className: "h3" }, "Needs your attention"), g(Badge, { tone: "danger" }, alerts.length)),
          g("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
            alerts.map((a, i) => g("div", { key: i, className: "alert-row" },
              g("span", { className: cx("alert-ic", a.tone) }, g(Icon, { name: a.icon, size: 16 })),
              g("span", { className: "alert-txt" }, a.txt),
              g("button", { className: "alert-act" }, a.act)))
          )
        ),
        g(Card, { pad: true, style: { marginTop: 16 } },
          g("h3", { className: "h3", style: { marginBottom: 12 } }, "Up next · 18:00"),
          g("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
            matches.filter((m) => m.status === "scheduled").slice(0, 3).map((m) => g(MatchRow, { key: m.id, m, onOpen: () => openScoreboard(m.id) }))
          )
        )
      )
    )
  );
}

/* =================== OFFICIAL · MY MATCHES =================== */
function OfficialMatches({ matches, openConsole }) {
  const mine = matches.filter((m) => m.official === "R. Mehta" || ["live", "scheduled"].includes(m.status));
  const live = mine.filter((m) => m.status === "live");
  const upcoming = mine.filter((m) => m.status === "scheduled");
  const done = matches.filter((m) => m.status === "confirmed");
  const Section = (title, list, hint) => list.length > 0 && g("div", { style: { marginBottom: 24 } },
    g("div", { className: "section-head" }, g("h2", { className: "h2" }, title), hint),
    g("div", { className: "card-grid-3" },
      list.map((m) => g(CompactScoreCard, { key: m.id, m, accentTop: true, onOpen: () => openConsole(m.id), cta: m.status === "live" ? "Resume scoring" : "Open console" })))
  );
  return g("div", { className: "content-pad content-max fade-up" },
    g(PageHeader, { eyebrow: "Match Day · R. Mehta", title: "My Matches", sub: "Fixtures assigned to you. Tap a live match to keep scoring." }),
    g("div", { className: "kpi-grid", style: { marginBottom: 24 } },
      g(StatCard, { label: "Live", value: live.length, icon: "broadcast", accent: "var(--live)" }),
      g(StatCard, { label: "Upcoming today", value: upcoming.length, icon: "clock", accent: "var(--warning)" }),
      g(StatCard, { label: "Completed", value: done.length, icon: "checkCircle", accent: "var(--success)" })
    ),
    Section("Live — needs scoring", live, g(StatusBadge, { status: "live" })),
    Section("Up next", upcoming),
    done.length > 0 && Section("Completed & signed", done)
  );
}

/* =================== SPECTATOR · LIVE NOW =================== */
function SpectatorLive({ matches, openScoreboard, openBigScreen }) {
  const live = matches.filter((m) => m.status === "live");
  const [feat, ...rest] = live;
  return g("div", { className: "content-pad content-max fade-up" },
    g(PageHeader, {
      eyebrow: "Mumbai University Games 2026", title: "Live Now", sub: `${live.length} matches in progress across 6 venues.`,
      actions: g(Button, { variant: "secondary", icon: "tv", onClick: openBigScreen }, "Big screen"),
    }),
    feat && g("div", { className: "feat-live", onClick: () => openScoreboard(feat.id) },
      g("div", { className: "feat-scoreboard" },
        g("div", { className: "feat-head" },
          g("span", { className: "sb-live" }, g("span", { className: "sb-live-dot" }), "LIVE"),
          g("span", { className: "feat-meta" }, SPORTS[feat.sportKey].name, " · ", feat.round, " · ", feat.venue)),
        g("div", { className: "feat-body" },
          g("div", { className: "feat-team" }, g(Crest, { name: feat.teamA.name, size: 56, hue: feat.teamA.hue }), g("span", null, feat.teamA.short)),
          g("div", { className: "feat-score tnum" }, bigScore(feat).a, g("span", { className: "feat-colon" }, ":"), bigScore(feat).b),
          g("div", { className: "feat-team" }, g(Crest, { name: feat.teamB.name, size: 56, hue: feat.teamB.hue }), g("span", null, feat.teamB.short))),
        g("div", { className: "feat-foot tnum" }, segLabel(feat), lastEvent(feat) && g("span", { style: { color: "rgba(255,255,255,.6)" } }, " · ", lastEvent(feat))))
    ),
    g("div", { className: "card-grid-3", style: { marginTop: 18 } },
      rest.map((m) => g(CompactScoreCard, { key: m.id, m, accentTop: true, onOpen: () => openScoreboard(m.id), cta: "Watch" })))
  );
}

Object.assign(window, { LiveOps, OfficialMatches, SpectatorLive });
