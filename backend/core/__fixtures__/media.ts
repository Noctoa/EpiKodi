import { execFile } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Médias de test générés par ffmpeg plutôt que commités : le dépôt reste sans binaire, et les
 * fichiers sont reconstruits à l'identique. Mis en cache dans le dossier temporaire du système.
 */
export interface MediaFixtures {
  /** mp3 taggé (titre, artiste, album, année, piste, genre) avec pochette embarquée */
  taggedMp3: string
  /** petite vidéo h264 muette, 160x90, 2 s */
  tinyMp4: string
  /** mkv à deux pistes audio (fre, eng) et une piste de sous-titres interne */
  multiMkv: string
  /** sous-titres externes au format SRT */
  srt: string
}

const SRT = [
  '1',
  '00:00:00,500 --> 00:00:02,000',
  'Bonjour <i>le monde</i>',
  '',
  '2',
  '00:00:02,500 --> 00:00:05,000',
  'Deuxième ligne',
  'sur deux lignes',
  ''
].join('\n')

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

let cache: Promise<MediaFixtures> | null = null

export function mediaFixtures(): Promise<MediaFixtures> {
  cache ??= build()
  return cache
}

async function build(): Promise<MediaFixtures> {
  const dir = join(tmpdir(), 'epikodi-test-fixtures')
  await mkdir(dir, { recursive: true })
  const f: MediaFixtures = {
    taggedMp3: join(dir, 'tagged.mp3'),
    tinyMp4: join(dir, 'tiny.mp4'),
    multiMkv: join(dir, 'multi.mkv'),
    srt: join(dir, 'sample.srt')
  }
  await writeFile(f.srt, SRT)

  const cover = join(dir, 'cover.png')
  if (!(await exists(cover))) {
    await ff(['-f', 'lavfi', '-i', 'testsrc=size=300x300:rate=1', '-frames:v', '1', cover])
  }

  if (!(await exists(f.tinyMp4))) {
    await ff([
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x90:rate=10',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      f.tinyMp4
    ])
  }

  if (!(await exists(f.taggedMp3))) {
    await ff([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-i',
      cover,
      '-t',
      '3',
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c:a',
      'libmp3lame',
      '-c:v',
      'mjpeg',
      '-disposition:v',
      'attached_pic',
      '-metadata',
      'title=Around the World',
      '-metadata',
      'artist=Daft Punk',
      '-metadata',
      'album=Homework',
      '-metadata',
      'date=1997',
      '-metadata',
      'track=7',
      '-metadata',
      'genre=House',
      f.taggedMp3
    ])
  }

  if (!(await exists(f.multiMkv))) {
    await ff([
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880',
      '-i',
      f.srt,
      '-t',
      '6',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-map',
      '3:s',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-c:s',
      'srt',
      '-metadata:s:a:0',
      'language=fre',
      '-metadata:s:a:0',
      'title=Français',
      '-metadata:s:a:1',
      'language=eng',
      '-metadata:s:a:1',
      'title=English',
      '-metadata:s:s:0',
      'language=fre',
      f.multiMkv
    ])
  }
  return f
}

const ff = (args: string[]): Promise<unknown> => exec('ffmpeg', ['-y', '-v', 'error', ...args])
