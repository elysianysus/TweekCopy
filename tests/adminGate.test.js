import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import { isAdmin, getAdminUserIds } from "../server/auth.js";

const ORIGINAL_ADMIN_USER_IDS = process.env.ADMIN_USER_IDS;

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function makeReq({ session, headers } = {}) {
  return { session: session || {}, headers: headers || {} };
}

beforeEach(() => {
  delete process.env.ADMIN_USER_IDS;
});

afterEach(() => {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) {
    delete process.env.ADMIN_USER_IDS;
  } else {
    process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS;
  }
});

after(async () => {
  try {
    const { pool } = await import("../server/db.js");
    await pool.end();
  } catch {
    /* ignore */
  }
});

test("getAdminUserIds returns empty set when env is unset or empty", () => {
  delete process.env.ADMIN_USER_IDS;
  assert.equal(getAdminUserIds().size, 0);
  process.env.ADMIN_USER_IDS = "";
  assert.equal(getAdminUserIds().size, 0);
  process.env.ADMIN_USER_IDS = "   ";
  assert.equal(getAdminUserIds().size, 0);
});

test("getAdminUserIds parses comma-separated positive integers", () => {
  process.env.ADMIN_USER_IDS = "1, 42 ,7";
  const ids = getAdminUserIds();
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 7, 42]);
});

test("getAdminUserIds rejects non-integer or non-positive values", () => {
  process.env.ADMIN_USER_IDS = "1, abc, -5, 0, 3.5, 9";
  const ids = getAdminUserIds();
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 9]);
});

test("isAdmin denies unauthenticated callers with 401", () => {
  process.env.ADMIN_USER_IDS = "1";
  const req = makeReq();
  const res = makeRes();
  let nextCalled = false;
  isAdmin(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
  assert.deepEqual(res.body, { error: "Not authenticated" });
});

test("isAdmin denies authenticated non-admin callers with 403", () => {
  process.env.ADMIN_USER_IDS = "1";
  const req = makeReq({ session: { userId: 99 } });
  const res = makeRes();
  let nextCalled = false;
  isAdmin(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
  assert.deepEqual(res.body, { error: "Forbidden" });
});

test("isAdmin denies all callers with 403 when ADMIN_USER_IDS is unset (deny-by-default)", () => {
  delete process.env.ADMIN_USER_IDS;
  const req = makeReq({ session: { userId: 1 } });
  const res = makeRes();
  let nextCalled = false;
  isAdmin(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("isAdmin allows admin user through and sets req.userId", () => {
  process.env.ADMIN_USER_IDS = "1,42";
  const req = makeReq({ session: { userId: 42 } });
  const res = makeRes();
  let nextCalled = false;
  isAdmin(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.userId, 42);
});
