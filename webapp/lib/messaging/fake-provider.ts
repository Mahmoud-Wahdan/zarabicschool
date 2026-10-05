import "server-only";

import type {
  MessagingCredentials,
  MessagingProvider,
  MessagingRecipient,
  MessagingSendResult,
} from "./types";

export class FakeMessagingProvider implements MessagingProvider {
  async sendCredentials(
    recipient: MessagingRecipient,
    credentials: MessagingCredentials
  ): Promise<MessagingSendResult> {
    void credentials;
    console.log(`[fake-messaging] credentials prepared for user ${recipient.userId}`);
    return { ok: true };
  }
}

export const fakeMessagingProvider: MessagingProvider = new FakeMessagingProvider();
