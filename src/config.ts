import "dotenv/config";

export interface PearConfig {
  baseUrl: string;
  clientId: string;
  address: string;
  apiKey?: string;
  accessToken?: string;
  readOnly: boolean;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function loadConfig(): PearConfig {
  const baseUrl = (process.env.PEAR_API_BASE_URL ?? "https://hl-v2.pearprotocol.io").replace(/\/+$/, "");
  return {
    baseUrl,
    clientId: process.env.PEAR_CLIENT_ID ?? "APITRADER",
    address: process.env.PEAR_ADDRESS ?? "",
    apiKey: process.env.PEAR_API_KEY || undefined,
    accessToken: process.env.PEAR_ACCESS_TOKEN || undefined,
    // Default to read-only: mutating funds should be an explicit opt-in.
    readOnly: bool(process.env.PEAR_READ_ONLY, true),
  };
}
