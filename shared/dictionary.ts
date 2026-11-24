export { default as dictionaryLimits } from '../electron/dictionary-limits.json';

export interface DictionaryEntry {
  id: string;
  term: string;
  createdAt: string;
}

export interface DictionaryState {
  revision: number;
  includeInChat: boolean;
  entries: DictionaryEntry[];
}

export type DictionaryInput = Pick<DictionaryEntry, 'term'> & { id?: string };

export type DictionaryAction =
  | { action: 'save'; revision: number; entry: DictionaryInput }
  | { action: 'delete'; revision: number; id: string }
  | { action: 'settings'; revision: number; includeInChat: boolean };

export interface DictionaryAPI {
  dictionaryState(): Promise<DictionaryState>;
  dictionaryAction(input: DictionaryAction): Promise<DictionaryState>;
}
