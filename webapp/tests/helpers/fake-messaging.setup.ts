// Every suite gets the fake MessagingProvider: no test can reach OpenWA (owner,
// 2026-10-26). The real adapter is unit-tested on its own in
// __tests__/lib/openwa-provider.test.ts with fetch forbidden.
jest.mock("../../lib/messaging/provider", () => {
  const { fakeMessagingProvider } = jest.requireActual("./fake-messaging");
  return { getMessagingProvider: () => fakeMessagingProvider };
});
