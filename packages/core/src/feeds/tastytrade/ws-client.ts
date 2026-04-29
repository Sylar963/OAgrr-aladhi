import type { ChainRequest, VenueOptionChain } from '../../core/types.js';
import { BaseAdapter } from '../shared/base.js';
import type { AssetClass, VenueCapabilities } from '../shared/types.js';
import type { VenueId } from '../../types/common.js';
import { TastytradeRestClient } from './rest.js';
import { createTastytradeHealthState, type TastytradeHealthState } from './health.js';
import { createTastytradeState, type TastytradeState } from './state.js';
import { createTastytradeSubscriptionState, type TastytradeSubscriptionState } from './planner.js';

export class TastytradeWsAdapter extends BaseAdapter {
  readonly venue: VenueId = 'tastytrade';
  override readonly assetClass: AssetClass = 'tradfi';
  readonly capabilities: VenueCapabilities = {
    optionChain: true,
    greeks: true,
    websocket: true,
  };

  private readonly rest: TastytradeRestClient;
  private readonly state: TastytradeState = createTastytradeState();
  private readonly subs: TastytradeSubscriptionState = createTastytradeSubscriptionState();
  private readonly health: TastytradeHealthState = createTastytradeHealthState();

  constructor(restClient?: TastytradeRestClient) {
    super();
    this.rest = restClient ?? new TastytradeRestClient();
  }

  async loadMarkets(_force?: boolean): Promise<void> {
    // 1. Login (POST /sessions) using TASTYTRADE_USERNAME/PASSWORD or REMEMBER_TOKEN.
    // 2. Fetch /option-chains/{symbol}/nested for each TASTYTRADE_DEFAULT_UNDERLYINGS entry.
    // 3. Populate state.contracts with canonical/OCC/streamer triples.
    void this.rest;
    void this.state;
    void this.subs;
    void this.health;
    throw new Error('TastytradeWsAdapter.loadMarkets not implemented');
  }

  async listUnderlyings(): Promise<string[]> {
    return [];
  }

  async listExpiries(_underlying: string): Promise<string[]> {
    return [];
  }

  async fetchOptionChain(_request: ChainRequest): Promise<VenueOptionChain> {
    throw new Error('TastytradeWsAdapter.fetchOptionChain not implemented');
  }

  async dispose(): Promise<void> {
    // Tear down DXLink WS, clear timers.
  }
}
