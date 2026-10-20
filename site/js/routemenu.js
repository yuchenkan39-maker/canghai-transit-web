// Route picker: grouping, ordering and matching. No DOM here, so Node can test it.

export const TABS = [
  ["all", "全部"],
  ["picked", "已选"],
  ["T", "T 接驳"],
  ["P", "PJ · 布城"],
  ["U", "数字干线"],
  ["other", "其他"],
];
export const GROUP_LABEL = { T: "T 接驳线", P: "PJ 线 · 布城线", U: "数字干线", other: "其他线路" };
const ORDER = ["T", "P", "U", "other"];

/** Group by the public route name: T790 → T, PJ01 / P101 → P, 780 → U, KJ01 / SUNWAY LINE → other. */
export function groupOf(name) {
  const n = String(name ?? "").trim().toUpperCase();
  if (/^T\d/.test(n)) return "T";
  if (/^P(J\d|\d)/.test(n)) return "P";
  if (/^\d/.test(n)) return "U";
  return "other";
}

/** T200 < T790 < T1000, PJ01 < PJ02 — numbers inside names compare as numbers. */
export const byName = (a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });

const rank = (r, q) => {
  const n = r.name.toLowerCase();
  return n === q ? 0 : n.startsWith(q) ? 1 : 2;
};

/** Every word must appear in the route name, id or long name (place names live there). */
export function matchRoutes(routes, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  return routes
    .filter((r) => {
      const hay = `${r.name} ${r.id} ${r.title || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => rank(a, q) - rank(b, q) || byName(a, b));
}

/** What the open menu lists: search results, the picked routes, one group, or every group with headers. */
export function menuSections(routes, { tab = "all", query = "", shown = new Set() } = {}) {
  if (String(query).trim()) {
    const hits = matchRoutes(routes, query);
    return [{ key: "search", label: hits.length ? `搜索结果 · ${hits.length} 条` : "", routes: hits }];
  }
  if (tab === "picked") return [{ key: "picked", label: "", routes: routes.filter((r) => shown.has(r.id)).sort(byName) }];
  const keys = tab === "all" ? ORDER : ORDER.includes(tab) ? [tab] : ORDER;
  return keys
    .map((k) => {
      const list = routes.filter((r) => groupOf(r.name) === k).sort(byName);
      return { key: k, label: tab === "all" ? `${GROUP_LABEL[k]} · ${list.length}` : "", routes: list };
    })
    .filter((s) => s.routes.length);
}
