export type PrivateReadPhase = "locked" | "awaiting-signature" | "decrypting" | "revealed";

export type PrivateRead = {
  scope: string;
  phase: PrivateReadPhase;
};

export function mockPaymentPrivateReadScope(viewerScope: string, paymentId: string) {
  return `${viewerScope}:payment:${paymentId}`;
}

export function isCurrentMockPrivateRead(privateRead: PrivateRead, scope: string, requestVersion: number, currentVersion: number) {
  return privateRead.scope === scope && privateRead.phase === "decrypting" && requestVersion === currentVersion;
}
