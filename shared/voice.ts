export interface VoicePreferences {
  provider: "api" | "local";
  localWhisper: string;
  tts: "system" | "local";
  localTts: string;
  ttsReferencePath: string;
  ttsPromptText: string;
  ttsSpeed: number;
  continuous: boolean;
  wakeEnabled: boolean;
  wakeWord: string;
  autoSubmit: boolean;
  silenceMs: number;
  maxSpeechSeconds: number;
}
export interface VoiceAPI {
  voiceStatus(): Promise<{ configured: boolean }>;
  configureVoice(key: string | null): Promise<void>;
  allowVoiceCapture(): Promise<boolean>;
  voicePreferences(): Promise<VoicePreferences>;
  configureVoicePreferences(value: VoicePreferences): Promise<VoicePreferences>;
  cancelVoiceCapture(): Promise<{ cancelled: boolean }>;
  transcribeVoice(input: { base64: string; mime: string; requestId?: string }): Promise<string>;
  speakVoice(input: { text: string; requestId?: string }): Promise<{ base64: string; mime: string }>;
}
