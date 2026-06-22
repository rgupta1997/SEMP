/* global React, Icon */
// Sportagon - core UI components (names mirror existing components/ui.tsx)
const { createElement: h, useState } = React;
const cx = (...a) => a.filter(Boolean).join(" ");

/* ---- Button ---- */
function Button({ variant = "secondary", size, icon, iconRight, loading, block, children, className, ...p }) {
  return h("button", {
    className: cx("btn", `btn-${variant}`, size && `btn-${size}`, block && "btn-block",
      !children && "btn-icon", className), ...p,
  },
    loading ? h(Spinner, { size: 16 }) : icon ? h(Icon, { name: icon, size: size === "sm" ? 16 : 18 }) : null,
    children,
    iconRight ? h(Icon, { name: iconRight, size: 16 }) : null
  );
}

function Spinner({ size = 20 }) {
  return h("span", {
    className: "spinner", role: "status", "aria-label": "Loading",
    style: {
      width: size, height: size, display: "inline-block", borderRadius: "50%",
      border: `${Math.max(2, size / 9)}px solid color-mix(in oklch, currentColor 25%, transparent)`,
      borderTopColor: "currentColor", animation: "spin 0.7s linear infinite",
    },
  });
}

/* ---- Badge / StatusBadge ---- */
function Badge({ tone = "neutral", dot, children, className }) {
  return h("span", { className: cx("badge", `badge-${tone}`, className) },
    dot && h("span", { className: "dot" }), children);
}

// Formalized status → tone mapping (single source of truth)
const STATUS_TONE = {
  // green
  approved: "success", completed: "success", active: "success", ongoing: "success",
  confirmed: "success", roster_locked: "success", won: "success", published: "success", verified: "success",
  // amber
  pending: "warning", forming: "warning", upcoming: "warning", submitted: "warning",
  scheduled: "warning", draft: "warning", review: "warning", provisional: "warning",
  // rose
  rejected: "danger", cancelled: "danger", lost: "danger", conflict: "danger",
  // brand
  registration_open: "brand", open: "brand",
  // live
  live: "live", in_progress: "live",
  // neutral
  draw: "neutral", tie: "neutral", unknown: "neutral",
};
const STATUS_LABEL = {
  in_progress: "Live", roster_locked: "Roster locked", registration_open: "Registration open",
  under_review: "Under review",
};
function StatusBadge({ status, className }) {
  const key = String(status || "unknown").toLowerCase();
  const tone = STATUS_TONE[key] || "neutral";
  const label = STATUS_LABEL[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (tone === "live") return h("span", { className: cx("badge badge-live", className) }, h("span", { className: "dot" }), "LIVE");
  return h("span", { className: cx("badge", `badge-${tone}`, className) }, h("span", { className: "dot" }), label);
}

/* ---- Card ---- */
function Card({ pad, hover, className, style, children, ...p }) {
  return h("div", { className: cx("card", pad && "card-pad", hover && "card-hover", className), style, ...p }, children);
}

/* ---- StatCard ---- */
function StatCard({ label, value, delta, deltaDir, icon, accent }) {
  return h(Card, { pad: true, className: "stat", style: { gap: 10 } },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
      h("span", { className: "stat-label" }, label),
      icon && h("span", { style: { color: accent || "var(--brand-500)", display: "flex" } }, h(Icon, { name: icon, size: 18 }))
    ),
    h("div", { className: "stat-value tnum" }, value),
    delta != null && h("span", { className: cx("stat-delta", deltaDir) },
      h(Icon, { name: deltaDir === "down" ? "arrowDown" : "arrowUp", size: 13 }), delta)
  );
}

/* ---- Avatar ---- */
function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();
}
const AV_HUES = [256, 145, 52, 28, 300, 122, 232, 330, 18, 195];
function hueFor(s = "") { let n = 0; for (const c of s) n += c.charCodeAt(0); return AV_HUES[n % AV_HUES.length]; }
function Avatar({ name, size = "md", src, style }) {
  const hue = hueFor(name);
  return h("span", {
    className: cx("avatar", `avatar-${size}`),
    style: { background: src ? "var(--surface-sunken)" : `oklch(0.62 0.15 ${hue})`, ...style },
    title: name,
  }, src ? h("img", { src, alt: name, style: { width: "100%", height: "100%", objectFit: "cover" } }) : initials(name));
}

/* ---- Crest (team/institution mark) ---- */
function Crest({ name, size = 44, hue, radius }) {
  const _hue = hue != null ? hue : hueFor(name);
  return h("span", {
    className: "crest",
    style: {
      width: size, height: size, borderRadius: radius != null ? radius : size * 0.28, fontSize: size * 0.42,
      background: `linear-gradient(150deg, oklch(0.6 0.16 ${_hue}), oklch(0.46 0.16 ${(_hue + 30) % 360}))`,
    },
  }, initials(name));
}

/* ---- Tabs ---- */
function Tabs({ items, value, onChange }) {
  return h("div", { className: "tabs", role: "tablist" },
    items.map((it) => h("button", {
      key: it.value, role: "tab", "aria-selected": value === it.value,
      className: cx("tab", value === it.value && "active"),
      onClick: () => onChange(it.value),
    }, it.icon && h(Icon, { name: it.icon, size: 16, style: { marginRight: 6, verticalAlign: "-3px" } }),
       it.label,
       it.count != null && h("span", { className: "tab-count tnum" }, it.count)))
  );
}

/* ---- Segmented control ---- */
function Segmented({ items, value, onChange, size }) {
  return h("div", { className: "segmented", style: size === "sm" ? { padding: 2 } : null },
    items.map((it) => h("button", {
      key: it.value, className: cx(value === it.value && "active"),
      onClick: () => onChange(it.value), "aria-pressed": value === it.value,
    }, it.icon && h(Icon, { name: it.icon, size: 15, style: { verticalAlign: "-2px", marginRight: it.label ? 5 : 0 } }), it.label))
  );
}

/* ---- Toggle ---- */
function Toggle({ checked, onChange, label }) {
  return h("button", {
    role: "switch", "aria-checked": checked, onClick: () => onChange(!checked),
    style: {
      display: "inline-flex", alignItems: "center", gap: 9, cursor: "pointer", background: "none",
    },
  },
    h("span", {
      style: {
        width: 38, height: 22, borderRadius: 99, padding: 2, flex: "none",
        background: checked ? "var(--brand-500)" : "var(--border-strong)",
        transition: "background var(--dur-base) var(--ease)", display: "flex",
        justifyContent: checked ? "flex-end" : "flex-start",
      },
    }, h("span", { style: { width: 18, height: 18, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "all var(--dur-base) var(--ease)" } })),
    label && h("span", { className: "sm" }, label)
  );
}

/* ---- EmptyState ---- */
function EmptyState({ icon = "layers", title, message, action }) {
  return h("div", {
    style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      textAlign: "center", padding: "48px 24px", gap: 6 },
  },
    h("div", {
      style: { width: 64, height: 64, borderRadius: 20, display: "grid", placeItems: "center",
        background: "var(--surface-sunken)", color: "var(--text-muted)", marginBottom: 6,
        border: "1px solid var(--border-subtle)" },
    }, h(Icon, { name: icon, size: 28 })),
    h("div", { className: "h3" }, title),
    message && h("div", { className: "sm text-muted", style: { maxWidth: 320 } }, message),
    action && h("div", { style: { marginTop: 10 } }, action)
  );
}

/* ---- PageHeader ---- */
function PageHeader({ eyebrow, title, sub, actions, children }) {
  return h("div", { style: { display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 } },
    h("div", { style: { minWidth: 0 } },
      eyebrow && h("div", { className: "eyebrow", style: { marginBottom: 7 } }, eyebrow),
      h("h1", { className: "h1" }, title),
      sub && h("div", { className: "body text-secondary", style: { marginTop: 6 } }, sub),
      children
    ),
    actions && h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, actions)
  );
}

/* ---- Field / Input / Select ---- */
function Field({ label, hint, error, required, children }) {
  return h("label", { className: "field" },
    label && h("span", { className: "label" }, label, required && h("span", { style: { color: "var(--danger)", marginLeft: 3 } }, "*")),
    children,
    error ? h("span", { className: "xs", style: { color: "var(--danger)" } }, error)
      : hint ? h("span", { className: "xs text-muted", style: { fontWeight: 500 } }, hint) : null
  );
}
function Input(p) { return h("input", { className: "input", ...p }); }
function Select({ children, ...p }) { return h("select", { className: "select", ...p }, children); }

Object.assign(window, {
  cx, Button, Spinner, Badge, StatusBadge, STATUS_TONE, Card, StatCard,
  Avatar, Crest, initials, hueFor, Tabs, Segmented, Toggle, EmptyState, PageHeader, Field, Input, Select,
});
