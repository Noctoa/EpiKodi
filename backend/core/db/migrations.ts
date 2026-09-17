/**
 * Migrations du schéma SQLite, appliquées dans l'ordre au démarrage.
 * Règle : on n'édite jamais une migration déjà livrée, on en ajoute une nouvelle.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      -- Un dossier local ou un partage réseau ajouté à la bibliothèque
      CREATE TABLE sources (
        id           INTEGER PRIMARY KEY,
        type         TEXT    NOT NULL CHECK (type IN ('local', 'smb', 'nfs', 'http')),
        path         TEXT    NOT NULL UNIQUE,
        name         TEXT    NOT NULL,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        last_scan_at INTEGER
      );

      -- Un fichier média découvert par le scanner
      CREATE TABLE media (
        id         INTEGER PRIMARY KEY,
        source_id  INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        path       TEXT    NOT NULL,              -- chemin absolu
        type       TEXT    NOT NULL CHECK (type IN ('video', 'audio', 'podcast')),
        title      TEXT    NOT NULL,              -- nom de fichier sans extension, puis tag/TMDB
        size       INTEGER NOT NULL,
        mtime      INTEGER NOT NULL,              -- pour détecter les modifications au rescan
        duration   REAL,                          -- secondes, rempli par ffprobe
        added_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (source_id, path)
      );
      CREATE INDEX media_source_idx ON media(source_id);
      CREATE INDEX media_type_idx   ON media(type);
      CREATE INDEX media_title_idx  ON media(title COLLATE NOCASE);

      -- Métadonnées enrichies (ffprobe, tags, TheMovieDB) : 1 ligne par média, optionnelle
      CREATE TABLE media_metadata (
        media_id       INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        container      TEXT,
        video_codec    TEXT,
        audio_codec    TEXT,
        width          INTEGER,
        height         INTEGER,
        bitrate        INTEGER,
        artist         TEXT,
        album          TEXT,
        album_artist   TEXT,
        year           INTEGER,
        track          INTEGER,
        genre          TEXT,
        overview       TEXT,                      -- synopsis
        rating         REAL,
        external_id    TEXT,                      -- ex: "tmdb:603"
        thumbnail_path TEXT,                      -- miniature générée en cache
        poster_path    TEXT,                      -- affiche téléchargée
        updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE playlists (
        id         INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE playlist_items (
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        media_id    INTEGER NOT NULL REFERENCES media(id)     ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, media_id)
      );

      -- Reprise de lecture, favoris, historique
      CREATE TABLE playback_state (
        media_id       INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        position       REAL    NOT NULL DEFAULT 0,  -- secondes
        completed      INTEGER NOT NULL DEFAULT 0,  -- booléen
        favorite       INTEGER NOT NULL DEFAULT 0,
        play_count     INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER
      );
    `
  }
]
