import { zodToJsonSchema } from 'zod-to-json-schema';
import { BotMarketResponseSchema } from './bot-market.js';
import { NewsEventsResponseSchema, NewsStreamMessageSchema } from './bot-news.js';

export function botDataJsonSchemas() {
  return {
    market: zodToJsonSchema(BotMarketResponseSchema),
    newsEvents: zodToJsonSchema(NewsEventsResponseSchema),
    newsWebSocket: zodToJsonSchema(NewsStreamMessageSchema),
  };
}
