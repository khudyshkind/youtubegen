/**
 * Translate raw provider error strings to user-friendly text.
 * Raw strings are preserved in DB / Sentry / Telegram — this is display-layer only.
 */
export function sanitizeProviderError(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = raw.trim()

  // Content policy violations (check before provider patterns)
  if (/CENSORED|content blocked|blocked by/i.test(s)) {
    return 'Текст содержит недопустимое содержимое. Отредактируйте скрипт.'
  }

  // SecretVoicer / Voicer / ElevenLabs — audio synthesis
  if (/SecretVoicer|ElevenLabs|Voicer/i.test(s)) {
    return 'Сервис синтеза речи временно недоступен. Попробуйте позже.'
  }

  // APIHOST — audio synthesis
  if (/APIHOST/i.test(s)) {
    if (/timeout/i.test(s)) return 'Синтез речи не завершился вовремя. Попробуйте позже.'
    return 'Сервис синтеза речи недоступен. Попробуйте позже.'
  }

  // Secret Slider — image generation
  if (/secretslider/i.test(s)) {
    if (/mismatch/i.test(s)) return 'Получены не все иллюстрации. Попробуйте ещё раз.'
    if (/timed?\s*out/i.test(s)) return 'Генерация иллюстраций заняла слишком долго. Попробуйте позже.'
    return 'Генерация иллюстраций не удалась. Попробуйте позже.'
  }

  // Whisper — subtitles
  if (/Whisper/i.test(s)) {
    return 'Сервис транскрипции временно недоступен. Попробуйте позже.'
  }

  // Video render internals
  if (/ENOENT|EACCES|EPERM|watchdog|no progress|unhandled:/i.test(s)) {
    return 'Ошибка рендеринга. Попробуйте позже.'
  }

  // Unknown: generic
  return 'Сервис временно недоступен. Попробуйте позже.'
}
