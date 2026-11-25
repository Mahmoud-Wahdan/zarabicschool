import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { proxy } from "../proxy";

jest.mock("next-auth/jwt", () => ({ getToken: jest.fn() }));
jest.mock("next-intl/middleware", () => () => () => new Response(null));
jest.mock("../i18n/routing", () => ({ routing: { locales: ["ar", "en"], defaultLocale: "ar" } }));

test("the login page can validate a forced-change session against the database", async () => {
  jest.mocked(getToken).mockResolvedValue({ mustChangePassword: true } as never);
  const response = await proxy(new NextRequest("http://localhost/en/login"));
  expect(response.status).toBe(200);
});

test.each([
  ["SUPERVISOR", "/ar/admin/users", 200],
  ["ADMIN", "/en/admin/users", 200],
  ["TEACHER", "/en/admin/users", 307],
  ["SUPERVISOR", "/ar/admin/applications", 307],
])("%s requesting %s receives %i", async (role, path, status) => {
  jest.mocked(getToken).mockResolvedValue({ role } as never);
  expect((await proxy(new NextRequest("http://localhost" + path))).status).toBe(status);
});
