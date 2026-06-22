/* global React, Icon, cx, Card, StatCard, Button, Badge, StatusBadge, Crest, SportChip, PageHeader, EmptyState, MatchRow, CompactScoreCard, SPORTS */
// Sportagon - participant dashboard, design system showcase, placeholders.
const { createElement: p } = React;

/* =================== PARTICIPANT DASHBOARD =================== */
function ParticipantDash({ matches, openScoreboard }) {
  const live = matches.filter((m) => m.status === "live").slice(0, 1);
  const recent = matches.filter((m) => m.status === "completed" || m.status === "confirmed");
  const upcoming = matches.filter((m) => m.status === "scheduled");
  return p("div", { className: "content-pad content-max fade-up" },
    p("div", { className: "welcome" },
      p("div", null, p("div", { className: "eyebrow" }, "Athlete"), p("h1", { className: "h1", style: { marginTop: 6 } }, "Welcome back, Aarav"),
        p("div", { className: "body text-secondary", style: { marginTop: 4 } }, "IIT Bombay · Basketball, Athletics")),
      p(Avatar, { name: "Aarav Sharma", size: "lg" })
    ),
    live.length > 0 && p("div", { style: { margin: "18px 0" } },
      p("div", { className: "section-head" }, p("h2", { className: "h2" }, "Your match is live"), p(StatusBadge, { status: "live" })),
      p("div", { className: "card-grid-2" }, live.map((m) => p(CompactScoreCard, { key: m.id, m, accentTop: true, onOpen: () => openScoreboard(m.id), cta: "Watch live" })))),
    p("div", { className: "kpi-grid", style: { margin: "18px 0" } },
      p(StatCard, { label: "Matches played", value: "24", icon: "whistle" }),
      p(StatCard, { label: "Win rate", value: "67%", icon: "bolt", delta: "+5%", deltaDir: "up", accent: "var(--success)" }),
      p(StatCard, { label: "Medals", value: "5", icon: "medal", accent: "var(--gold-500)" }),
      p(StatCard, { label: "Events", value: "3", icon: "trophy" })
    ),
    p("div", { className: "ops-grid" },
      p("div", null,
        p("h2", { className: "h2", style: { marginBottom: 12 } }, "Recent results"),
        p("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, recent.map((m) => p(MatchRow, { key: m.id, m, onOpen: () => openScoreboard(m.id) })))),
      p("aside", { className: "ops-aside" },
        p(Card, { pad: true },
          p("h3", { className: "h3", style: { marginBottom: 12 } }, "Your schedule"),
          p("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, upcoming.slice(0, 3).map((m) => p(MatchRow, { key: m.id, m, onOpen: () => openScoreboard(m.id) }))))
      )
    )
  );
}

/* =================== DESIGN SYSTEM SHOWCASE =================== */
function Swatch({ name, varName, dark }) {
  return p("div", { className: "swatch" }, p("span", { className: "swatch-chip", style: { background: `var(${varName})` } }), p("span", { className: "swatch-name mono" }, name));
}
function DesignSystem({ theme }) {
  const ramp = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  return p("div", { className: "content-pad content-max fade-up" },
    p(PageHeader, { eyebrow: "Foundations", title: "Design System", sub: "Token-first, light + dark, tenant-themable. Mirrors the Tailwind v4 @theme tokens for 1:1 engineering handoff." }),

    p("section", { className: "ds-section" },
      p("h2", { className: "h2" }, "Brand ramp · themable per tenant"),
      p("div", { className: "ramp" }, ramp.map((n) => p("div", { key: n, className: "ramp-step" },
        p("span", { className: "ramp-chip", style: { background: `var(--brand-${n})` } }), p("span", { className: "mono xs" }, n)))),
      p("p", { className: "sm text-muted", style: { marginTop: 8 } }, "Tenant theming overrides only the brand ramp - switch tenants in the Tweaks panel to see chrome re-skin while neutrals & semantics stay fixed.")),

    p("section", { className: "ds-section" },
      p("h2", { className: "h2" }, "Semantic & live"),
      p("div", { className: "swatch-grid" },
        p(Swatch, { name: "success", varName: "--success" }), p(Swatch, { name: "warning", varName: "--warning" }),
        p(Swatch, { name: "danger", varName: "--danger" }), p(Swatch, { name: "info", varName: "--info" }),
        p(Swatch, { name: "live", varName: "--live" }), p(Swatch, { name: "gold", varName: "--gold-500" }))),

    p("section", { className: "ds-section" },
      p("h2", { className: "h2" }, "Sport accents"),
      p("div", { className: "sport-grid" }, Object.keys(SPORTS).map((k) => p("div", { key: k, className: "sport-cell" },
        p(SportChip, { sportKey: k, size: 40, radius: 12 }), p("span", { className: "sm", style: { fontWeight: 700 } }, SPORTS[k].name))))),

    p("section", { className: "ds-section" },
      p("h2", { className: "h2" }, "Type scale · Archivo"),
      p("div", { className: "type-spec" },
        p("div", { className: "display-lg" }, "118 - Scoreboard"),
        p("div", { className: "h1" }, "Heading 1 · Page titles"),
        p("div", { className: "h2" }, "Heading 2 · Section"),
        p("div", { className: "h3" }, "Heading 3 · Card title"),
        p("div", { className: "body" }, "Body - the quick brown fox jumps over 1,234 athletes."),
        p("div", { className: "sm text-secondary" }, "Small · secondary metadata and hints"),
        p("div", { className: "eyebrow" }, "Eyebrow · uppercase label"))),

    p("section", { className: "ds-section" },
      p("h2", { className: "h2" }, "Components"),
      p("div", { className: "comp-row" },
        p(Button, { variant: "primary" }, "Primary"), p(Button, { variant: "secondary" }, "Secondary"),
        p(Button, { variant: "outline" }, "Outline"), p(Button, { variant: "ghost" }, "Ghost"),
        p(Button, { variant: "danger", icon: "alert" }, "Danger"), p(Button, { variant: "primary", loading: true }, "Loading")),
      p("div", { className: "comp-row" },
        p(StatusBadge, { status: "live" }), p(StatusBadge, { status: "completed" }), p(StatusBadge, { status: "pending" }),
        p(StatusBadge, { status: "rejected" }), p(StatusBadge, { status: "registration_open" }), p(StatusBadge, { status: "scheduled" })),
      p("div", { className: "comp-row" },
        p(Crest, { name: "IIT Bombay", size: 44 }), p(Crest, { name: "BITS Pilani", size: 44 }), p(Crest, { name: "Delhi University", size: 44 }),
        p(Avatar, { name: "Riya Mehta", size: "lg" }), p(Avatar, { name: "Aarav Sharma", size: "lg" }))
    )
  );
}

/* =================== GENERIC PLACEHOLDER =================== */
function Placeholder({ navItem, onGo }) {
  return p("div", { className: "content-pad content-max fade-up" },
    p(PageHeader, { eyebrow: "Mapped surface", title: navItem ? navItem.label : "Screen" }),
    p(Card, { pad: true },
      p(EmptyState, {
        icon: navItem ? navItem.icon : "layers",
        title: "In the full design set",
        message: "This route is mapped in the IA and inherits the same shell, tokens, and components. This prototype goes deep on the live-event experience - the scoring system, scoreboards, ops & results.",
        action: p(Button, { variant: "primary", icon: "broadcast", onClick: onGo }, "Jump to Live Ops"),
      }))
  );
}

Object.assign(window, { ParticipantDash, DesignSystem, Placeholder });
