/* global React, Icon, cx, Avatar, Badge, SPORTS */
// Sportagon - app shell: logo, sidebar/rail, topbar, bottom tabs, role switcher.
const { createElement: e, useState: uState } = React;

// Logomark: three ascending bars (podium + motion) - simple geometric, scales 16px→TV.
function Logomark({ size = 30 }) {
  return e("svg", { width: size, height: size, viewBox: "0 0 32 32", "aria-hidden": true, style: { flex: "none" } },
    e("rect", { x: 3, y: 17, width: 7, height: 12, rx: 2.2, fill: "var(--brand-400)" }),
    e("rect", { x: 12.5, y: 9, width: 7, height: 20, rx: 2.2, fill: "var(--brand-500)" }),
    e("rect", { x: 22, y: 3, width: 7, height: 26, rx: 2.2, fill: "var(--gold-500)" })
  );
}

function Wordmark({ tenant }) {
  return e("div", { style: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 } },
    e(Logomark, { size: 30 }),
    e("div", { style: { minWidth: 0, lineHeight: 1.05 } },
      e("div", { style: { fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em" } }, "Sportagon"),
      e("div", { className: "xs text-muted", style: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 } }, tenant.short)
    )
  );
}

// Colored sport chip - mono letter + accent (paired w/ label elsewhere; never color alone)
function SportChip({ sportKey, size = 30, radius }) {
  const sp = SPORTS[sportKey];
  return e("span", {
    title: sp.name,
    style: {
      width: size, height: size, borderRadius: radius != null ? radius : size * 0.3, flex: "none",
      display: "grid", placeItems: "center", color: "#fff", fontWeight: 800,
      fontSize: size * 0.4, fontFamily: "var(--font-display)", letterSpacing: "-0.02em",
      background: sp.accent, boxShadow: "inset 0 1px 0 rgba(255,255,255,.18)",
    },
  }, sp.mono);
}

const ROLES = {
  organiser:   { label: "Organiser", icon: "grid", home: "liveops" },
  official:    { label: "Official", icon: "whistle", home: "mymatches" },
  participant: { label: "Athlete", icon: "user", home: "dashboard" },
  spectator:   { label: "Spectator", icon: "eye", home: "spectator" },
  admin:       { label: "Admin", icon: "shield", home: "admin" },
};

const NAV = {
  organiser: [
    { group: "Operations", items: [
      { key: "liveops", label: "Live Ops", icon: "broadcast", badge: "5" },
      { key: "schedule", label: "Schedule", icon: "calendar" },
      { key: "approvals", label: "Approvals", icon: "checkCircle", badge: "12" },
      { key: "officials", label: "Officials", icon: "whistle" },
    ] },
    { group: "Results", items: [
      { key: "standings", label: "Standings", icon: "list" },
      { key: "medals", label: "Medal Tally", icon: "medal" },
    ] },
    { group: "Setup", items: [
      { key: "events", label: "Events", icon: "trophy" },
      { key: "settings", label: "Settings", icon: "settings" },
    ] },
  ],
  official: [
    { group: null, items: [
      { key: "mymatches", label: "My Matches", icon: "whistle", badge: "3" },
      { key: "schedule", label: "Schedule", icon: "calendar" },
    ] },
  ],
  participant: [
    { group: null, items: [
      { key: "dashboard", label: "Dashboard", icon: "home" },
      { key: "mymatches_p", label: "My Matches", icon: "list" },
      { key: "standings", label: "Standings", icon: "trophy" },
    ] },
  ],
  spectator: [
    { group: null, items: [
      { key: "spectator", label: "Live Now", icon: "broadcast", badge: "5" },
      { key: "scoreboard", label: "Big Screen", icon: "tv" },
      { key: "schedule", label: "Schedule", icon: "calendar" },
      { key: "standings", label: "Standings", icon: "list" },
      { key: "medals", label: "Medals", icon: "medal" },
    ] },
  ],
  admin: [
    { group: "Platform", items: [
      { key: "admin", label: "Overview", icon: "grid" },
      { key: "tenants", label: "Tenants", icon: "building" },
    ] },
    { group: "Master data", items: [
      { key: "sports_admin", label: "Sports & Scoring", icon: "whistle" },
      { key: "design", label: "Design System", icon: "layers" },
    ] },
  ],
};

// Bottom-tab destinations per persona (mobile)
const BOTTOM = {
  organiser: ["liveops", "schedule", "standings", "approvals"],
  official: ["mymatches", "schedule"],
  participant: ["dashboard", "mymatches_p", "standings"],
  spectator: ["spectator", "scoreboard", "standings", "medals"],
  admin: ["admin", "tenants", "design"],
};

function navItemByKey(role, key) {
  for (const g of NAV[role]) { const it = g.items.find((i) => i.key === key); if (it) return it; }
  return null;
}

function Sidebar({ role, active, onNav, collapsed, tenant }) {
  return e("aside", { className: cx("sidebar", collapsed && "collapsed") },
    e("div", { className: "sidebar-head" }, collapsed ? e(Logomark, { size: 30 }) : e(Wordmark, { tenant })),
    e("nav", { className: "sidebar-nav no-scrollbar" },
      NAV[role].map((grp, gi) => e("div", { key: gi, className: "nav-group" },
        grp.group && !collapsed && e("div", { className: "nav-group-label" }, grp.group),
        grp.items.map((it) => e("button", {
          key: it.key, className: cx("nav-item", active === it.key && "active"),
          onClick: () => onNav(it.key), title: collapsed ? it.label : null,
        },
          e(Icon, { name: it.icon, size: 19 }),
          !collapsed && e("span", { className: "nav-label" }, it.label),
          !collapsed && it.badge && e("span", { className: "nav-badge tnum" }, it.badge)
        ))
      ))
    ),
    e("div", { className: "sidebar-foot" },
      !collapsed && e("div", { className: "demo-hint" },
        e(Icon, { name: "command", size: 13 }),
        e("span", null, "Press ", e("span", { className: "kbd" }, "⌘K"), " to search")
      )
    )
  );
}

Object.assign(window, { Logomark, Wordmark, SportChip, Sidebar, ROLES, NAV, BOTTOM, navItemByKey });
