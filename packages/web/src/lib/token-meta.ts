import btcLogo from "@/assets/tokens/btc.svg";
import ethLogo from "@/assets/tokens/eth.svg";
import solLogo from "@/assets/tokens/sol.svg";
import bnbLogo from "@/assets/tokens/bnb.svg";
import xrpLogo from "@/assets/tokens/xrp.svg";
import dogeLogo from "@/assets/tokens/doge.svg";
import hypeLogo from "@/assets/tokens/hype.svg";

export interface TokenMeta {
  symbol: string;
  name:   string;
  logo:   string;
}

const TOKEN_MAP: Record<string, TokenMeta> = {
  BTC:  { symbol: "BTC",  name: "Bitcoin",     logo: btcLogo },
  ETH:  { symbol: "ETH",  name: "Ethereum",    logo: ethLogo },
  SOL:  { symbol: "SOL",  name: "Solana",      logo: solLogo },
  BNB:  { symbol: "BNB",  name: "BNB",         logo: bnbLogo },
  XRP:  { symbol: "XRP",  name: "XRP",         logo: xrpLogo },
  DOGE: { symbol: "DOGE", name: "Dogecoin",    logo: dogeLogo },
  HYPE: { symbol: "HYPE", name: "Hyperliquid", logo: hypeLogo },
};

export function getTokenMeta(symbol: string): TokenMeta | undefined {
  const upper = symbol.toUpperCase();
  return TOKEN_MAP[upper] ?? TOKEN_MAP[upper.split("_")[0]!];
}

export function getTokenLogo(symbol: string): string | undefined {
  // Try exact match first, then extract base from "BTC_USDC" → "BTC"
  const upper = symbol.toUpperCase();
  return TOKEN_MAP[upper]?.logo ?? TOKEN_MAP[upper.split("_")[0]!]?.logo;
}
