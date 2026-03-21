import bcrypt from "bcrypt";
import { knex } from "../../src/db/connection";
import { closeKnex } from "./helpers";
import { handleLogin, handleRefresh, handleMe } from "../../src/api/auth";
import { authenticate } from "../../src/api/middleware/auth";

const TEST_EMAIL = "authtest@example.com";
const TEST_PASSWORD = "AuthTest1!";
const DEV_API_KEY = "dev";

function mockReq(overrides: Record<string, unknown> = {}): any {
  return {
    body: {},
    headers: {},
    get: (name: string) => (mockReq(overrides).headers as Record<string, string>)[name.toLowerCase()] || "",
    ...overrides,
  };
}

function mockRes(): { status: jest.Mock; json: jest.Mock; statusCode: number; body: unknown } {
  const res: any = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn((data: unknown) => { res.body = data; return res; });
  return res;
}

let testUserId: string;

beforeAll(async () => {
  // Ensure company_settings exists
  await knex("company_settings")
    .insert({ id: 1, base_currency: "GBP", company_name: "Test Company", financial_year_start_month: 4 })
    .onConflict("id").merge();

  // Ensure period exists
  await knex("periods").insert({
    period_id: "2026-03",
    status: "OPEN",
    data_flag: "PROVISIONAL",
  }).onConflict("period_id").ignore();

  // Create active test user
  const hash = await bcrypt.hash(TEST_PASSWORD, 1);
  const existing = await knex("users").where({ email: TEST_EMAIL }).first();
  if (!existing) {
    const [row] = await knex("users")
      .insert({
        email: TEST_EMAIL,
        password_hash: hash,
        display_name: "Auth Tester",
        roles: ["VIEWER", "BOOKKEEPER"],
        is_active: true,
      })
      .returning("id");
    testUserId = (row as Record<string, string>).id;
  } else {
    testUserId = (existing as Record<string, string>).id;
    await knex("users")
      .where({ id: testUserId })
      .update({ password_hash: hash, is_active: true, roles: ["VIEWER", "BOOKKEEPER"] });
  }
});

afterAll(async () => {
  await knex("users").where({ email: TEST_EMAIL }).delete();
  await closeKnex();
});

describe("POST /api/v1/auth/login", () => {
  it("returns a JWT token on valid credentials", async () => {
    const req = mockReq({ body: { email: TEST_EMAIL, password: TEST_PASSWORD } });
    const res = mockRes();
    await handleLogin(req, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    expect(typeof data.token).toBe("string");
    expect((data.token as string).length).toBeGreaterThan(20);
    expect(data.expires_at).toBeTruthy();
    const user = data.user as Record<string, unknown>;
    expect(user.email).toBe(TEST_EMAIL);
    expect(user.display_name).toBe("Auth Tester");
  });

  it("returns 401 on wrong password", async () => {
    const req = mockReq({ body: { email: TEST_EMAIL, password: "wrongpassword" } });
    const res = mockRes();
    await handleLogin(req, res as any);
    expect(res.statusCode).toBe(401);
    const body = res.body as Record<string, unknown>;
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 401 on unknown email", async () => {
    const req = mockReq({ body: { email: "nobody@example.com", password: TEST_PASSWORD } });
    const res = mockRes();
    await handleLogin(req, res as any);
    expect(res.statusCode).toBe(401);
    const body = res.body as Record<string, unknown>;
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 401 for disabled user", async () => {
    await knex("users").where({ id: testUserId }).update({ is_active: false });
    const req = mockReq({ body: { email: TEST_EMAIL, password: TEST_PASSWORD } });
    const res = mockRes();
    await handleLogin(req, res as any);
    expect(res.statusCode).toBe(401);
    const body = res.body as Record<string, unknown>;
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("ACCOUNT_DISABLED");
    // Re-enable for subsequent tests
    await knex("users").where({ id: testUserId }).update({ is_active: true });
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns the authenticated user profile", async () => {
    // First login to get a token
    const loginReq = mockReq({ body: { email: TEST_EMAIL, password: TEST_PASSWORD } });
    const loginRes = mockRes();
    await handleLogin(loginReq, loginRes as any);
    const loginBody = loginRes.body as Record<string, unknown>;
    const token = (loginBody.data as Record<string, unknown>).token as string;

    // Now call /me with the token
    const meReq: any = {
      headers: { authorization: "Bearer " + token },
      get: (name: string) => name.toLowerCase() === "authorization" ? "Bearer " + token : "",
      body: {},
    };
    const meRes = mockRes();

    // Run authenticate middleware then handleMe
    await new Promise<void>((resolve, reject) => {
      authenticate(meReq, meRes as any, (err?: unknown) => {
        if (err) reject(err); else resolve();
      });
    });

    await handleMe(meReq, meRes as any);
    expect(meRes.statusCode).toBe(200);
    const body = meRes.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    expect(data.email).toBe(TEST_EMAIL);
    expect(data.display_name).toBe("Auth Tester");
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("returns a new token when called with a valid existing token", async () => {
    // Login first
    const loginReq = mockReq({ body: { email: TEST_EMAIL, password: TEST_PASSWORD } });
    const loginRes = mockRes();
    await handleLogin(loginReq, loginRes as any);
    const loginBody = loginRes.body as Record<string, unknown>;
    const token = (loginBody.data as Record<string, unknown>).token as string;

    // Refresh
    const refreshReq: any = {
      headers: { authorization: "Bearer " + token },
      get: (name: string) => name.toLowerCase() === "authorization" ? "Bearer " + token : "",
      body: {},
    };
    const refreshRes = mockRes();

    await new Promise<void>((resolve, reject) => {
      authenticate(refreshReq, refreshRes as any, (err?: unknown) => {
        if (err) reject(err); else resolve();
      });
    });

    await handleRefresh(refreshReq, refreshRes as any);
    expect(refreshRes.statusCode).toBe(200);
    const body = refreshRes.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    expect(typeof data.token).toBe("string");
    expect((data.token as string).length).toBeGreaterThan(20);
  });
});

describe("JWT authentication middleware", () => {
  it("rejects requests with an invalid/malformed token", async () => {
    const req: any = {
      headers: { authorization: "Bearer invalid.token.here" },
      get: (name: string) => name.toLowerCase() === "authorization" ? "Bearer invalid.token.here" : "",
      body: {},
    };
    const res = mockRes();
    let nextCalled = false;
    authenticate(req, res as any, () => { nextCalled = true; });
    // Give middleware a tick to respond
    await new Promise((r) => setTimeout(r, 10));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("accepts the dev API key header", async () => {
    const req: any = {
      headers: { "x-api-key": DEV_API_KEY },
      get: (name: string) => name.toLowerCase() === "x-api-key" ? DEV_API_KEY : "",
      body: {},
    };
    const res = mockRes();
    let nextCalled = false;
    authenticate(req, res as any, () => { nextCalled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(nextCalled).toBe(true);
  });
});
