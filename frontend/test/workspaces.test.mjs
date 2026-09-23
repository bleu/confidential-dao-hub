import assert from "node:assert/strict";
import test from "node:test";

import {
  buybackHref,
  isWorkspaceLinkActive,
  reportHref,
  reportWorkspace,
  routes,
  workspaceForPath,
  workspaceLinks,
} from "../src/lib/workspaces.ts";

test("workspace selection follows route boundaries, not arbitrary prefixes", () => {
  assert.equal(workspaceForPath("/"), null);
  assert.equal(workspaceForPath("/community"), "community");
  assert.equal(workspaceForPath(routes.sell), "community");
  assert.equal(workspaceForPath(routes.dao), "dao");
  assert.equal(workspaceForPath(routes.treasury), "dao");
  assert.equal(workspaceForPath("/community-other"), null);
  assert.equal(workspaceForPath("/dao-other"), null);
  assert.equal(workspaceForPath("/unknown"), null);
});

test("public report accepts only a known scalar workspace", () => {
  assert.equal(reportWorkspace("dao"), "dao");
  assert.equal(reportWorkspace("community"), "community");
  for (const value of [undefined, null, "", "DAO", "https://example.com", "/dao", ["dao"], ["dao", "community"]]) {
    assert.equal(reportWorkspace(value), "community");
    assert.equal(buybackHref(reportWorkspace(value)), routes.sell);
  }
  assert.equal(workspaceForPath(routes.report, "dao"), "dao");
  assert.equal(workspaceForPath(routes.report), "community");
  assert.equal(buybackHref("dao"), routes.treasury);
  assert.equal(reportHref("dao"), "/buybacks/report?workspace=dao");
  assert.equal(reportHref("community"), "/buybacks/report?workspace=community");
});

test("each workspace has its own feature links and Soon destinations", () => {
  const community = workspaceLinks("community");
  const dao = workspaceLinks("dao");
  const restoredLabels = ["Payment Requests", "Token Launchpad", "Governance", "Airdrop / Staking"];
  assert.deepEqual(community.map(({ label }) => label), ["Buybacks", "My vesting", "My payroll", ...restoredLabels]);
  assert.deepEqual(dao.map(({ label }) => label), ["Overview", "Buybacks", "Vesting", "Payroll", ...restoredLabels]);
  for (const [workspace, links] of [["community", community], ["dao", dao]]) {
    const soonPaths = ["vesting", "payroll", "payment-requests", "token-launchpad", "governance", "airdrop-staking"]
      .map((feature) => `/${workspace}/${feature}`);
    assert.deepEqual(links.filter(({ soon }) => soon).map(({ href }) => href), soonPaths);
    for (const href of soonPaths) {
      assert.equal(workspaceForPath(href), workspace);
      assert.deepEqual(links.filter((link) => isWorkspaceLinkActive(href, link.href)).map((link) => link.href), [href]);
      assert.equal(isWorkspaceLinkActive(`${href}-other`, href), false);
    }
  }
});

test("active links include nested buybacks and the shared report without selecting DAO overview", () => {
  assert.equal(isWorkspaceLinkActive(routes.sell, routes.community), true);
  assert.equal(isWorkspaceLinkActive(routes.treasury, routes.dao), false);
  assert.equal(isWorkspaceLinkActive(routes.dao, routes.dao), true);
  assert.equal(isWorkspaceLinkActive(routes.report, routes.treasury), true);
  assert.equal(isWorkspaceLinkActive(routes.report, routes.community), true);
  assert.equal(isWorkspaceLinkActive(routes.report, "/dao/vesting"), false);
  assert.equal(isWorkspaceLinkActive("/community/buybacks-other", routes.community), false);
});
