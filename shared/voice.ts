export interface VoiceAPI {
  voiceStatus(): Promise<{ configured: boolean }>;
  configureVoice(key: string | null): Promise<void>;
  allowVoiceCapture(): Promise<boolean>;
  transcribeVoice(input: { base64: string; mime: string }): Promise<string>;
}
