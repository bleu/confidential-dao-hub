import assert from "node:assert/strict";
import test from "node:test";

import {
  grantStatusLabel,
  grantsForWorkspace,
} from "../src/features/vesting/data.ts";

test("separates DAO-created grants from Community-received grants", () => {
  assert.deepEqual(grantsForWorkspace("dao").map(({ id }) => id), ["GR-1048", "GR-1021", "GR-0971"]);
  assert.deepEqual(grantsForWorkspace("community").map(({ id }) => id), ["GR-1048", "GR-1021", "GR-0888", "GR-0971"]);
});

test("labels active and stopped grant states", () => {
  assert.equal(grantStatusLabel("active"), "Active");
  assert.equal(grantStatusLabel("stopped"), "Stopped");
});
