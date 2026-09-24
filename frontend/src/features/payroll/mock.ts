import { type PaymentEntry, type Token } from "./model";

export const MULTISEND_ADDRESS = "0x8Fb39444A9f23eE344A3AF85cF8FAD25Fc762b91";

export const CUSDT: Token = {
  symbol: "cUSDT",
  decimals: 6,
  address: "0x5ffb152C8D371Ae59c25689c9F0F6e8a914CcbcA",
};

export const FUNDED_SENDER = {
  address: "0x9F2e0c48911E77d0A46Ee821F011305C1A11aa01",
  balance: 10_000_000_000n,
};

export const DEMO_RECEIVER = {
  name: "Avery Stone",
  address: "0x3Ba1c4409A614A8cB4D1B52D0c3cF9fF4aC2bB02",
};

export const DEFAULT_ENTRIES: PaymentEntry[] = [
  { id: "entry-1", recipient: DEMO_RECEIVER.address, amount: "2,500.50" },
  { id: "entry-2", recipient: "0x7D3e4917aA4A9E1F0d7e3970Ae6764556eF15C03", amount: "1,800" },
];
