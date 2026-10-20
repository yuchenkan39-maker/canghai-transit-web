import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupOf, matchRoutes, menuSections, TABS } from "../site/js/routemenu.js";

const r = (id, name, title) => ({ id, name, title });
const fixture = [
  r("T7900", "T790", "Stesen LRT Paramount ~ Mid Valley"),
  r("T7880", "T788", "Stesen LRT Universiti ~ Mid Valley"),
  r("T2000", "T200", "Stesen LRT Gombak ~ UIA Gombak"),
  r("P0020", "PJ02", "Stesen LRT Taman Jaya ~ PPUM via SS2 PJ"),
  r("P1010", "P101", "Kompleks F ~ Presint 5"),
  r("U7800", "780", "Kota Damansara ~ Hab Pasar Seni"),
  r("S0030", "KJ01", "Hentian Kajang ~ Bandar Kajang"),
  r("B1000", "SUNWAY LINE", "BRT USJ 7 - BRT Setia Jaya"),
];

test("routes fall into the menu groups by their public name", () => {
  assert.deepEqual(fixture.map((x) => groupOf(x.name)), ["T", "T", "T", "P", "P", "U", "other", "other"]);
  assert.equal(groupOf(" pj01 "), "P");
  assert.equal(groupOf(""), "other");
});

test("the full menu lists every route once, grouped, in natural order", () => {
  const sections = menuSections(fixture);
  assert.deepEqual(sections.map((s) => s.key), ["T", "P", "U", "other"]);
  assert.deepEqual(sections[0].routes.map((x) => x.name), ["T200", "T788", "T790"]);
  assert.match(sections[0].label, /T 接驳线 · 3/);
  assert.equal(sections.flatMap((s) => s.routes).length, fixture.length);
});

test("a group tab, the picked tab and search each list the right routes", () => {
  assert.deepEqual(menuSections(fixture, { tab: "P" }).flatMap((s) => s.routes.map((x) => x.name)), ["P101", "PJ02"]);
  const picked = menuSections(fixture, { tab: "picked", shown: new Set(["U7800", "T7900"]) })[0].routes.map((x) => x.id);
  assert.deepEqual(picked, ["U7800", "T7900"]);
  assert.deepEqual(menuSections(fixture, { tab: "picked" })[0].routes, []);
  // Search ignores the tab, matches place names word by word, and puts an exact route name first.
  assert.deepEqual(menuSections(fixture, { tab: "P", query: "mid valley" })[0].routes.map((x) => x.name), ["T788", "T790"]);
  assert.equal(matchRoutes(fixture, "pj02")[0].id, "P0020");
  assert.equal(matchRoutes([r("A", "T7901", ""), r("B", "T790", "")], "t790")[0].name, "T790");
  assert.deepEqual(matchRoutes(fixture, "   "), []);
  assert.ok(TABS.some(([k]) => k === "picked"));
});

test("every real Rapid KL route appears exactly once in the full menu", () => {
  const catalog = JSON.parse(readFileSync(new URL("../site/network/catalog.json", import.meta.url)));
  const routes = catalog.routes.filter((x) => x.category === "rapid-bus-kl");
  const listed = menuSections(routes).flatMap((s) => s.routes.map((x) => x.id));
  assert.equal(listed.length, routes.length);
  assert.equal(new Set(listed).size, routes.length);
  for (const id of ["T7900", "T7860", "P0010", "P0020"]) assert.ok(listed.includes(id), id);
});
