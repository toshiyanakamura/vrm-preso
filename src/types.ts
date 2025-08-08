// src/types.ts
export type Emotion = 'neutral' | 'happy' | 'angry' | 'sad' | 'surprised'

export type TTSParams = {
  speedScale?: number
  pitchScale?: number
  intonationScale?: number
  volumeScale?: number
}

export type NarrationItem = {
  at?: number            // 動画のこの秒で喋り出す（省略/0 で即時）
  text: string           // {nod} 等のインラインタグOK
  emotion?: Emotion
  speakerId?: number
  tts?: TTSParams
}

export type Cue = {
  slide: number
  image?: string         // 画像ファイル名（png/jpg/jpeg）
  video?: string         // 動画ファイル名（mp4/webm/mov）
  videoWait?: 'none' | 'end'  // none=かぶせて喋る, end=終わってから喋る
  subtitle?: string
  emotion?: Emotion
  speakerId?: number
  tts?: TTSParams

  // ★ 追加機能
  narration?: NarrationItem[] // 動画の特定時刻で喋る（複数可）
  duckVideo?: boolean         // 喋っている間だけ動画音量を下げる
}

export type ScriptData = {
  title: string
  defaults: {
    speakerId: number
    tts: TTSParams
  }
  cues: Cue[]
}


