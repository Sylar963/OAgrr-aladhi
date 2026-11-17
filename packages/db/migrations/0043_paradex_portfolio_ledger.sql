ALTER TABLE exchange_portfolio_positions
  DROP CONSTRAINT exchange_portfolio_positions_venue_check,
  ADD CONSTRAINT exchange_portfolio_positions_venue_check CHECK (venue IN ('thalex', 'derive', 'paradex'));

ALTER TABLE exchange_portfolio_trades
  DROP CONSTRAINT exchange_portfolio_trades_venue_check,
  ADD CONSTRAINT exchange_portfolio_trades_venue_check CHECK (venue IN ('thalex', 'derive', 'paradex'));

ALTER TABLE exchange_portfolio_sync
  DROP CONSTRAINT exchange_portfolio_sync_venue_check,
  ADD CONSTRAINT exchange_portfolio_sync_venue_check CHECK (venue IN ('thalex', 'derive', 'paradex'));

ALTER TABLE exchange_portfolio_trades ADD COLUMN underlying_price_usd DOUBLE PRECISION;
