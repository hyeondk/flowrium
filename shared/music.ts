export interface MusicEntry {
  id: string;
  kind: "playlist" | "video";
  url: string;
  title: string;
  lyrics: string;
}
export interface MusicState {
  lists: MusicEntry[];
  selected: string;
  volume: number;
  time: number;
  index: number;
  muted: boolean;
  shuffle: boolean;
  loop: boolean;
  repeatOne: boolean;
}
export interface MusicAPI {
  musicState(): Promise<MusicState>;
  saveMusic(state: MusicState): Promise<MusicState>;
  musicPlayer(): Promise<{ url: string }>;
}
