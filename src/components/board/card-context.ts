import { createContext, useContext } from "react";

export interface BoardCard {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  /** Absent on cards that came from a search hit rather than the board load. */
  note?: string | null;
  url: string | null;
  props: unknown;
}

export interface CardContextValue {
  cards: Record<string, BoardCard>;
  onOpen: (cardId: string) => void;
}

export const CardContext = createContext<CardContextValue>({
  cards: {},
  onOpen: () => {},
});

export function useCardContext(): CardContextValue {
  return useContext(CardContext);
}
