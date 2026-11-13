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
  findMusicLyrics(input: { title: string; author: string; duration: number }): Promise<MusicLyrics | null>;
  musicState(): Promise<MusicState>;
  saveMusic(state: MusicState): Promise<MusicState>;
  musicPlayer(): Promise<{ url: string }>;
}
export interface MusicLyrics { track: string; artist: string; instrumental: boolean; plain: string; lines: {time:number;text:string}[]; source: string }
