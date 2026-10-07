import "server-only";

import { fakeMessagingProvider } from "./fake-provider";
import { openWaProvider } from "./openwa-provider";
import type { MessagingProvider } from "./types";

export function getMessagingProvider(): MessagingProvider {
  return process.env.MESSAGING_PROVIDER === "fake" ? fakeMessagingProvider : openWaProvider;
}
