"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { DEMO_RECEIVER } from "./mock";

export type SentPayment = {
  id: string;
  paymentId: string;
  recipient: string;
  requested: bigint;
  actual?: bigint;
  verification: "pending" | "complete";
  date: string;
};

type PaymentRecord = {
  id: string;
  recipient: string;
  requested: bigint;
};

type PayrollLedger = {
  daoPayments: SentPayment[];
  receiverPayments: SentPayment[];
  recordPayments: (paymentId: string, entries: PaymentRecord[]) => void;
  verifyPayments: (paymentId: string) => void;
};

const PayrollLedgerContext = createContext<PayrollLedger | null>(null);

function createInitialPayments(): SentPayment[] {
  return [
    {
      id: "mock-history-1",
      paymentId: "mock-history-1",
      recipient: DEMO_RECEIVER.address,
      requested: 2_400_000_000n,
      actual: 2_400_000_000n,
      verification: "complete",
      date: "Sep 18, 2026, 10:20 AM",
    },
    {
      id: "mock-history-2",
      paymentId: "mock-history-2",
      recipient: "0x7D3e4917aA4A9E1F0d7e3970Ae6764556eF15C03",
      requested: 1_800_000_000n,
      actual: 1_800_000_000n,
      verification: "complete",
      date: "Sep 12, 2026, 2:45 PM",
    },
  ];
}

function mockDate() {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

export function PayrollDemoProvider({ children }: { children: React.ReactNode }) {
  const [payments, setPayments] = useState<SentPayment[]>(createInitialPayments);

  const recordPayments = useCallback((paymentId: string, entries: PaymentRecord[]) => {
    const date = mockDate();
    setPayments((current) => [
      ...entries.map((entry) => ({
        id: `${paymentId}-${entry.id}`,
        paymentId,
        recipient: entry.recipient,
        requested: entry.requested,
        actual: entry.requested,
        verification: "pending" as const,
        date,
      })),
      ...current,
    ]);
  }, []);

  const verifyPayments = useCallback((paymentId: string) => {
    setPayments((current) => current.map((payment) => {
      if (payment.paymentId !== paymentId || payment.verification !== "pending") return payment;
      return { ...payment, actual: payment.requested, verification: "complete" as const };
    }));
  }, []);

  const value = useMemo(() => ({
    daoPayments: payments,
    receiverPayments: payments.filter((payment) => payment.recipient.toLowerCase() === DEMO_RECEIVER.address.toLowerCase()),
    recordPayments,
    verifyPayments,
  }), [payments, recordPayments, verifyPayments]);

  return <PayrollLedgerContext.Provider value={value}>{children}</PayrollLedgerContext.Provider>;
}

export function usePayrollLedger() {
  const ledger = useContext(PayrollLedgerContext);
  if (!ledger) throw new Error("PayrollDemoProvider is required.");
  return ledger;
}
