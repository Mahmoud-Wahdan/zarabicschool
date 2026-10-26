jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ar",
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn(), push: jest.fn() }),
}));
jest.mock("next-auth/react", () => ({
  signIn: jest.fn(),
}));

import { renderToStaticMarkup } from "react-dom/server";

import ChangePasswordForm from "../../app/[locale]/change-password/change-password-form";
import LoginForm from "../../app/[locale]/login/login-form";

/**
 * Credentials never appear in a URL (Phase 8, 2026-10-26). Before React hydrates,
 * a submit is a native browser form submission: without method="post" it is a GET
 * that puts every NAMED field (username, password) into the query string — browser
 * history, server/proxy logs, the Referer header. The rendered HTML must therefore
 * declare POST and no action that carries a query.
 */
function formTag(html: string) {
  const match = html.match(/<form\b[^>]*>/);
  expect(match).not.toBeNull();
  return match![0];
}

describe("credentials never appear in a URL", () => {
  it("the login form submits by POST, its password field is a named password input, and no action carries a query", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    const tag = formTag(html);
    expect(tag).toMatch(/\bmethod="post"/);
    expect(tag).not.toMatch(/\baction="[^"]*\?/);
    expect(html).toMatch(/<input[^>]*name="password"[^>]*type="password"|<input[^>]*type="password"[^>]*name="password"/);
  });

  it("the change-password form submits by POST as well", () => {
    const html = renderToStaticMarkup(<ChangePasswordForm username="demo_test_user" role="STUDENT" />);
    const tag = formTag(html);
    expect(tag).toMatch(/\bmethod="post"/);
    expect(tag).not.toMatch(/\baction="[^"]*\?/);
  });
});
