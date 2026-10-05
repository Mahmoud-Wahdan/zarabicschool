export type MessagingSendResult = {
  ok: boolean;
  error?: string;
};

export type MessagingCredentials = {
  username: string;
  tempPassword: string;
};

export type MessagingRecipient = {
  userId: string;
  phone: string | null;
};

export interface MessagingProvider {
  sendCredentials(
    recipient: MessagingRecipient,
    credentials: MessagingCredentials
  ): Promise<MessagingSendResult>;
}
