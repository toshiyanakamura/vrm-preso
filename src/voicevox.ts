import type { TTSParams } from './types'

export async function fetchVoiceFromVOICEVOX(
  text: string,
  speaker: number = 1,
  params: TTSParams = {}
): Promise<Blob> {
  if (!text || text.trim() === '') return new Blob()

  // 1) クエリ生成
  const qRes = await fetch(`http://127.0.0.1:50021/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, {
    method: 'POST',
    headers: { accept: 'application/json' }
  })
  if (!qRes.ok) throw new Error(`audio_query: ${qRes.status} ${qRes.statusText}`)
  const query = await qRes.json()

  // 2) パラメータ上書き（存在するキーだけ）
  const merged = { ...query, ...params }

  // 3) 合成
  const sRes = await fetch(`http://127.0.0.1:50021/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(merged)
  })
  if (!sRes.ok) throw new Error(`synthesis: ${sRes.status} ${sRes.statusText}`)

  return await sRes.blob()
}

export async function fetchVoicevoxSpeakers() {
  const res = await fetch('http://127.0.0.1:50021/speakers')
  if (!res.ok) throw new Error(`speakers: ${res.status}`)
  return await res.json() as Array<{ name: string; styles: { id: number; name: string }[] }>
}
