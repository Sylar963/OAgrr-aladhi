import { useCallback, useMemo, useState } from 'react';

export function useQuoteSources(availableVenues: string[]) {
  const [selection, setSelection] = useState<string[] | null>(null);
  const quoteVenues = useMemo(
    () => availableVenues.filter((venue) => selection == null || selection.includes(venue)),
    [availableVenues, selection],
  );
  const toggleQuoteVenue = useCallback(
    (venue: string) => {
      setSelection((current) => {
        const selected = current ?? availableVenues;
        return selected.includes(venue)
          ? selected.filter((id) => id !== venue)
          : [...selected, venue];
      });
    },
    [availableVenues],
  );
  const selectAllQuoteVenues = useCallback(() => setSelection(null), []);
  const clearQuoteVenues = useCallback(() => setSelection([]), []);
  return { quoteVenues, toggleQuoteVenue, selectAllQuoteVenues, clearQuoteVenues };
}
