export interface Logger {
  write(message: string, level?: 'Info' | 'Warn' | 'Error'): void;
  close(): void;
}
