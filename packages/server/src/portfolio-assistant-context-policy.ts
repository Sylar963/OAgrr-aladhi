import type { PortfolioAssistantIntent } from '@oggregator/protocol';
import type { PortfolioAssistantContext } from './portfolio-assistant-context-builder.js';

export interface AssistantContextPolicy {
  intent: PortfolioAssistantIntent;
  market: boolean;
  history: boolean;
  scenarios: boolean;
}

export function selectAssistantContextPolicy(question?: string): AssistantContextPolicy {
  const text = (question ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const full = { intent: 'portfolio', market: true, history: true, scenarios: true } as const;
  if (!text.trim()) return full;
  if (/last review|previous review|since (?:my |the )?last|ultima revision|revision anterior/.test(text)) {
    return { ...full, intent: 'comparison' };
  }
  const complex = /\b(hedge|trade|buy|sell|roll|scenario|stress|recommend|alternative|strategy|strategies|compare|risk|outlook|price|iv|volatility|cobertura|comprar|vender|escenario|riesgo|alternativas|estrategia|precio|volatilidad)\b/;
  if (/\b(equity|cash|ledger|fees|funding|deposit|withdrawal|balance|saldo|comisiones|retiro|deposito|patrimonio)\b/.test(text) && !complex.test(text)) {
    return { intent: 'accounting', market: false, history: true, scenarios: false };
  }
  if (/^(?:what (?:is|are)|define|explain|que es|que son|define|explica)\s+(?:the |el |la )?(?:delta|gamma|theta|vega|vanna|volga)(?:\s+(?:in (?:simple|plain) (?:terms|english)|en palabras simples))?[?.!\s]*$/.test(text)) {
    return { intent: 'theory', market: false, history: false, scenarios: false };
  }
  if (/\b(delta|gamma|theta|vega|vanna|volga)\b/.test(text) &&
      /\b(which|largest|most|highest|lowest|net|total|expiry|expiries|cual|mayor|menor|vencimiento|neta|neto)\b/.test(text) &&
      !complex.test(text) && !/\b(and|also|why|because|y|tambien|por que)\b/.test(text)) {
    return { intent: 'exposure', market: false, history: false, scenarios: false };
  }
  return full;
}

export function shapeAssistantContext(context: PortfolioAssistantContext, policy: AssistantContextPolicy): PortfolioAssistantContext {
  return {
    ...context,
    contextSelection: {
      intent: policy.intent,
      omittedSections: [
        ...(!policy.market ? ['marketFacts', 'bookVsMarketFacts'] : []),
        ...(!policy.history ? ['tradeHistoryFacts', 'accountEquityFacts'] : []),
        ...(!policy.scenarios ? ['horizonScenarios', 'shockFacts', 'payoffFacts.points'] : []),
      ],
    },
    marketFacts: policy.market ? context.marketFacts : { underlyings: [], unavailable: [] },
    bookVsMarketFacts: policy.market ? context.bookVsMarketFacts : null,
    tradeHistoryFacts: policy.history ? context.tradeHistoryFacts : null,
    accountEquityFacts: policy.history ? context.accountEquityFacts : null,
    horizonScenarios: policy.scenarios ? context.horizonScenarios : null,
    shockFacts: policy.scenarios ? context.shockFacts : null,
    payoffFacts: policy.scenarios ? context.payoffFacts : { ...context.payoffFacts, points: [] },
  };
}
