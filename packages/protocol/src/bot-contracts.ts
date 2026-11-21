import { zodToJsonSchema } from 'zod-to-json-schema';
import { NewsMacroResponseSchema } from './news-macro.js';
import { BotDepthResponseSchema } from './bot-depth.js';
import { BotMarketResponseSchema } from './bot-market.js';
import { NewsEventsResponseSchema, NewsStreamMessageSchema } from './bot-news.js';

export function botDataJsonSchemas() {
  return {
    market: zodToJsonSchema(BotMarketResponseSchema),
    depth: zodToJsonSchema(BotDepthResponseSchema),
    macroHeadlines: zodToJsonSchema(NewsMacroResponseSchema),
    newsEvents: zodToJsonSchema(NewsEventsResponseSchema),
    newsWebSocket: zodToJsonSchema(NewsStreamMessageSchema),
  };
}
