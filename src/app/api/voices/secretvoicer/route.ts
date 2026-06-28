import { NextRequest, NextResponse } from 'next/server'
import previews from '@/data/secretvoicer-previews.json'

// Language annotations derived from the SV catalog (XTTS multilingual model).
// Voices not listed here default to 'en'.
const VOICE_LANG: Record<string, string> = {
  // Russian
  txnCCHHGKmYIwrn7HfHQ: 'ru',
  rQOBu7YxCDxGiFdTm28w: 'ru',
  hU3rD0Yk7DoiYULTX1pD: 'ru',
  m0OQuJtWCw1V23P0pQmG: 'ru',
  MYw0upsxdtxs1n97djly: 'ru',
  eLDtXX7z65CuLasDRxrP: 'ru',
  WczBIOau2qV9z7nLeDqq: 'ru',
  BTL5iDLqtiUxgJtpekus: 'ru',
  // Spanish
  l1zE9xgNpUTaQCZzpNJa: 'es',
  JH302OKVzGGJc47f08ex: 'es',
  Wl3O9lmFSMgGFTTwuS6f: 'es',
  '6sFKzaJr574YWVu4UuJF': 'es',
  // Portuguese
  '80lPKtzJMPh1vjYMUgwe': 'pt',
  x6uRgOliu4lpcrqMH3s1: 'pt',
  '4r3G9XKliGgVZLKMgjik': 'pt',
  cyD08lEy76q03ER1jZ7y: 'pt',
  // German
  Cqbq4nsuUe1we6J45miU: 'de',
  v3V1d2rk6528UrLKRuy8: 'de',
  // French
  tKaoyJLW05zqV0tIH9FD: 'fr',
  // Polish
  g8ZOdhoD9R6eYKPTjKbE: 'pl',
  // Japanese
  G3EZ8O36A0x9lmeOtr0f: 'ja',
}

interface SvVoice {
  voice_id: string
  name: string
  gender: 'M' | 'F'
  language: string
  preview_url: string | null
  available?: false
}

// Full catalog — order preserved from the SV API response
const CATALOG: SvVoice[] = [
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'IRHApOXLvnW57QJPQH2P', name: 'Adam - Brooding, Dark, Tough American', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'l1zE9xgNpUTaQCZzpNJa', name: 'Alberto Rodríguez - Serious, Narrative', gender: 'M', language: 'es', preview_url: null },
  { voice_id: 'CQcj2MsUgZyAgfHH6yJV', name: 'Alexander - Smooth, Deep and Round', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'txnCCHHGKmYIwrn7HfHQ', name: 'Alexandr Vlasov - Professional Voiceover', gender: 'M', language: 'ru', preview_url: null },
  { voice_id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'xGDJhCwcqw94ypljc95Z', name: 'Archer - Meditative, Relaxing and Calm', gender: 'M', language: 'en', preview_url: null },
  { voice_id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'rQOBu7YxCDxGiFdTm28w', name: 'Artem Lebedev - Captivating and Engaging', gender: 'M', language: 'ru', preview_url: null },
  { voice_id: 'LHi3adMlU7AICv8Yxpmm', name: 'Artspace - Engaging, Warm and Pleasant', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'oaGwHLz3csUaSnc2NBD4', name: 'Benedict - Smooth British Narrator', gender: 'M', language: 'en', preview_url: null },
  { voice_id: '80lPKtzJMPh1vjYMUgwe', name: 'Benjamin - Criovozia', gender: 'M', language: 'pt', preview_url: null },
  { voice_id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'T5cu6IU92Krx4mh43osx', name: 'Bill Oxley', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'iiidtqDt9FBdT1vfBluA', name: 'Bill Oxley - Documentary Commentator', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'si0svtk05vPEuvwAW93c', name: 'Blondie - Intense Woman', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'D11AWvkESE7DJwqIVi7L', name: 'Brian - Clean, Professional and Balanced', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'G0yjIg3xY8gEJZkHpjVm', name: 'Brian - Deep & Funny', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'bP8FJDHmWVEgXJDitdQd', name: 'Brian Nguyen', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'PGoKnSD4gKn2aS99wOR2', name: 'Brian S. - Viral Social Media Narration', gender: 'M', language: 'en', preview_url: null },
  { voice_id: '5egO01tkUjEzu7xSSE8M', name: 'Carmelo - Mature, Mysterious and Clear', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'M', language: 'en', preview_url: null },
  { voice_id: '6xPz2opT0y5qtoRh1U1Y', name: 'Christian - Serious TV Host', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'fbIG6gEosVIM95R5qOna', name: 'Clint - Old, Raspy and Experienced', gender: 'M', language: 'en', preview_url: null },
  { voice_id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde', gender: 'M', language: 'en', preview_url: null },
  { voice_id: '9F4C8ztpNUmXkdDDbz3J', name: 'Dan Dan', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave', gender: 'M', language: 'en', preview_url: null },
  { voice_id: '7i7dgyCkKt4c16dLtwT3', name: 'David - Epic Trailer', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'PcAHoDMdlTbdDxdz24IK', name: 'David Gaspar - Velvety, Clear and Warm', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'hU3rD0Yk7DoiYULTX1pD', name: 'Dmitry D', gender: 'M', language: 'ru', preview_url: null },
  { voice_id: 'ksryVoNAGZT8GxWCTiVm', name: 'Elariel - Light, Ethereal and Gentle', gender: 'F', language: 'en', preview_url: null },
  { voice_id: '2HmIg4yvRgcH2ZDgiwGz', name: 'Elderbark – Rooted and Deep', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', gender: 'M', language: 'en', preview_url: null },
  // временно недоступен на платформе SecretVoicer, вернуть когда восстановят
  { voice_id: 'm0OQuJtWCw1V23P0pQmG', name: 'Eugene - Bright, Clear & Engaging', gender: 'M', language: 'ru', preview_url: null, available: false },
  { voice_id: 'RgXx32WYOGrd7gFNifSf', name: 'Eva Dorado', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'G4Wh6MqJNTzYtuAeMqv5', name: 'Eve - Narrative & Audiobooks', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'x6uRgOliu4lpcrqMH3s1', name: 'Flavio Francisco - Narrative - Brazilian Portuguese', gender: 'M', language: 'pt', preview_url: null },
  { voice_id: 'tKaoyJLW05zqV0tIH9FD', name: 'Gaëlle - Audiobooks & Story-telling', gender: 'F', language: 'fr', preview_url: null },
  { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'MYw0upsxdtxs1n97djly', name: 'Georgy - Clear, Engaging and Confident', gender: 'M', language: 'ru', preview_url: null },
  { voice_id: 'jsCqWAovK2LkecY7zXl4', name: 'Gigi', gender: 'F', language: 'en', preview_url: null },
  { voice_id: '0lp4RIz96WD1RUtvEu3Q', name: 'Grandfather Joe - Gentle, warm & wise', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'NOpBlnGInO9m6vDvFkFC', name: 'Grandpa', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'SOYHLrjzK2X1ezoPC6cr', name: 'Harry', gender: 'M', language: 'en', preview_url: null },
  { voice_id: '4dZr8J4CBeokyRkTRpoN', name: 'Harwood - Clear, Expressive, Engaging', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'Cqbq4nsuUe1we6J45miU', name: 'Helmut - News & Anchorman', gender: 'M', language: 'de', preview_url: null },
  { voice_id: 'j210dv0vWm7fCknyQpbA', name: 'Hinata', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'fv3DhmRHJ9E0nzpEbA3f', name: 'Jacquie - Friendly, Clear and British', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'XA2bIQ92TabjGbpO2xRr', name: 'Jerry', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 't0jbNlBVZ17f02VDIeMI', name: 'Jessie', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'Cz0K1kOv9tD8l0b5Qu53', name: 'Jon - Conversational Voice', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'MFZUKuGQUsGJPQjTS4wC', name: 'Jon - Warm & Grounded Storyteller', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'WyFXw4PzMbRnp8iLMJwY', name: 'Juliet - Customer Care: Professional, Empathic, Warm', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'H6QPv2pQZDcGqLwDTIJQ', name: 'Kanika', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'G3EZ8O36A0x9lmeOtr0f', name: 'Kaori – Relatable & Friendly Japanese Voice', gender: 'F', language: 'ja', preview_url: null },
  { voice_id: 'xb0RCfp97gx711PCjTKw', name: 'Kuki - Calm, Serene Narrator', gender: 'M', language: 'en', preview_url: null },
  { voice_id: '4r3G9XKliGgVZLKMgjik', name: 'lairjose - Smooth Brazilian male voice', gender: 'M', language: 'pt', preview_url: null },
  { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'eLDtXX7z65CuLasDRxrP', name: 'Leonid Drapei - Wise, Calm Teacher', gender: 'M', language: 'ru', preview_url: null },
  { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'zp2G1GqPvAg5KDA55fjC', name: 'Loardar', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'JH302OKVzGGJc47f08ex', name: 'Manuel - Profound, Deep and Strong', gender: 'M', language: 'es', preview_url: null },
  { voice_id: '1SM7GgM6IMuvQlz2BwM3', name: 'Mark - ConvoAI', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'Wl3O9lmFSMgGFTTwuS6f', name: 'Martin Alvarez - Soothing and Hopeful', gender: 'M', language: 'es', preview_url: null },
  { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'uju3wxzG5OhpWcoi3SMy', name: 'Michael C. Vincent', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'n1PvBOwxb8X6m7tahp2h', name: 'Michael C. Vincent - Suspenseful Storyteller', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'piTKgcLEGmPE4e6mEKli', name: 'Mimi', gender: 'F', language: 'en', preview_url: null },
  { voice_id: '7S3KNdLDL7aRgBVRQb1z', name: 'Nathaniel', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'KwPhPlUeXKi2eSe2IWCY', name: 'Nathaniel C - Dramatic Suspense-Driven British', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'pFQStpMdprGFILRDrWR2', name: 'Nathaniel C – Deep Midnight Storyteller RJ Voice', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'aQROLel5sQbj1vuIVi6B', name: 'Nicolas - Narration', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'WczBIOau2qV9z7nLeDqq', name: 'Nikolay Ivanov - Warm, Joyful, and Rich', gender: 'M', language: 'ru', preview_url: null },
  { voice_id: 'ZthjuvLPty3kTMaNKVKb', name: 'Peter', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'gJEfHTTiifXEDmO687lC', name: 'Prince Nuri', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'BTL5iDLqtiUxgJtpekus', name: 'Radislav Sietov - Calm and Relaxing', gender: 'M', language: 'ru', preview_url: null },
  { voice_id: '6sFKzaJr574YWVu4UuJF', name: 'Rafael', gender: 'M', language: 'es', preview_url: null },
  { voice_id: 'srN6rA7HPBQZ1WEO6tDP', name: 'Ranger3D.pro', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'JKbdwi8BFwQlr1n3fwoT', name: 'Reel – Conversational Voice for Short Content', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'Hd8mWkf5kvyBZB0S7yXU', name: 'Ron - Older American Story Teller', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'Yko7PKHZNXotIFUBG7I9', name: 'Ryan', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'pMsXgVXv3BLzUgSXRplE', name: 'Sam', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'cyD08lEy76q03ER1jZ7y', name: 'ScheilaSMTy', gender: 'F', language: 'pt', preview_url: null },
  { voice_id: 'jBpfuIE2acCO8z3wKNLl', name: 'Serena', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'cQXj83hrwySQRlUNK0qG', name: 'Storyteller Romantic', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'v3V1d2rk6528UrLKRuy8', name: 'Susi', gender: 'F', language: 'de', preview_url: null },
  { voice_id: 'ThT5KcBeYPX3keUQqHPh', name: 'Thomas', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'g8ZOdhoD9R6eYKPTjKbE', name: 'Tomasz Zborek', gender: 'M', language: 'pl', preview_url: null },
  { voice_id: 'cicZiwk5NrFYKb3gi8in', name: 'Valory - Mysterious, Calm and Natural', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'ljo9gAlSqKOvF6D8sOsX', name: 'Viking', gender: 'M', language: 'en', preview_url: null },
  { voice_id: 'z9fAnlkpzviPz146aGWa', name: 'Vincent (Library)', gender: 'F', language: 'en', preview_url: null },
  { voice_id: 'bIHbv24MWmeRgasZH58o', name: 'Will', gender: 'M', language: 'en', preview_url: null },
]

// Merge preview URLs and language from VOICE_LANG into catalog at module load
const previewsMap = previews as Record<string, string>
const VOICES: SvVoice[] = CATALOG.map((v) => ({
  ...v,
  language: VOICE_LANG[v.voice_id] ?? v.language,
  preview_url: previewsMap[v.voice_id] ?? null,
}))

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const lang = searchParams.get('language') ?? 'en'

  const available = VOICES.filter((v) => v.available !== false)
  const langVoices = available.filter((v) => v.language === lang)
  const enVoices = available.filter((v) => v.language === 'en')

  const voices = langVoices.length > 0 ? [...langVoices, ...enVoices] : enVoices

  return NextResponse.json(
    { ok: true, data: { voices } },
    { headers: { 'Cache-Control': 'public, s-maxage=86400' } },
  )
}
