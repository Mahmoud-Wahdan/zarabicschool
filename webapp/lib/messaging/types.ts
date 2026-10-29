export type MessagingSendResult = {
  ok: boolean;
  error?: string;
  /** Provider message id on success (OpenWA `messageId`) — used to match delivery webhooks. */
  providerMessageId?: string;
  /**
   * true = the failure may succeed later (network error, provider busy/paced,
   * engine not ready, 5xx). false/undefined = permanent (bad number, auth,
   * not configured) — retrying would only repeat the same failure.
   */
  transient?: boolean;
};

export type MessagingCredentials = {
  username: string;
  tempPassword: string;
  /** Academy display name from the database (never a hardcoded brand). */
  academyName?: string;
};

export type MessagingRecipient = {
  userId: string;
  phone: string | null;
};

export type MessagingSendOptions = {
  /** Forwarded as OpenWA's `Idempotency-Key` so a retried send is never delivered twice. */
  idempotencyKey?: string;
};

export interface MessagingProvider {
  sendCredentials(
    recipient: MessagingRecipient,
    credentials: MessagingCredentials
  ): Promise<MessagingSendResult>;
  sendText(
    recipient: MessagingRecipient,
    message: string,
    options?: MessagingSendOptions,
  ): Promise<MessagingSendResult>;
}
