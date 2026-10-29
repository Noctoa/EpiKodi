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
  },
  {
    version: 2,
    name: 'media-probed-at',
    // NULL = pas encore analysé par ffprobe ; remis à NULL par le scanner si le fichier change
    sql: `
      ALTER TABLE media ADD COLUMN probed_at INTEGER;
      CREATE INDEX media_probed_idx ON media(probed_at) WHERE probed_at IS NULL;
    `
  },
  {
    version: 3,
    name: 'media-search-index',
    // Index plein texte : titre, artiste, album et chemin (le tokenizer découpe sur les « / »,
    // donc le nom de fichier et les dossiers parents sont cherchables).
    sql: `
      CREATE VIRTUAL TABLE media_fts USING fts5(
        title, artist, album, path,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      INSERT INTO media_fts (rowid, title, artist, album, path)
        SELECT m.id, m.title, COALESCE(md.artist, md.album_artist, ''), COALESCE(md.album, ''), m.path
        FROM media m LEFT JOIN media_metadata md ON md.media_id = m.id;

      CREATE TRIGGER media_fts_insert AFTER INSERT ON media BEGIN
        INSERT INTO media_fts (rowid, title, artist, album, path)
        VALUES (new.id, new.title, '', '', new.path);
      END;

      CREATE TRIGGER media_fts_update AFTER UPDATE OF title, path ON media BEGIN
        UPDATE media_fts SET title = new.title, path = new.path WHERE rowid = new.id;
      END;

      CREATE TRIGGER media_fts_delete AFTER DELETE ON media BEGIN
        DELETE FROM media_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER media_meta_fts_insert AFTER INSERT ON media_metadata BEGIN
        UPDATE media_fts
           SET artist = COALESCE(new.artist, new.album_artist, ''), album = COALESCE(new.album, '')
         WHERE rowid = new.media_id;
      END;

      CREATE TRIGGER media_meta_fts_update AFTER UPDATE ON media_metadata BEGIN
        UPDATE media_fts
           SET artist = COALESCE(new.artist, new.album_artist, ''), album = COALESCE(new.album, '')
         WHERE rowid = new.media_id;
      END;
    `
  },
  {
    version: 4,
    name: 'fix-youtube-year',
    // Les tags « date » au format AAAAMMJJ avaient été lus en entier (20260920 au lieu de 2026)
    sql: `
      UPDATE media_metadata
         SET year = CAST(SUBSTR(CAST(year AS TEXT), 1, 4) AS INTEGER)
       WHERE year > 9999;

      UPDATE media_metadata SET year = NULL WHERE year IS NOT NULL AND year < 1800;
    `
  },
  {
    version: 5,
    name: 'source-credentials',
    // Chiffrés par safeStorage (trousseau du système) : jamais de mot de passe en clair en base
    sql: `ALTER TABLE sources ADD COLUMN credentials BLOB;`
  },
  {
    version: 6,
    name: 'podcasts',
    // Les épisodes vivent dans leurs propres tables plutôt que dans `media` : ils portent des
    // champs qui leur sont propres (guid, flux distant, copie téléchargée) et ne sont pas des
    // fichiers d'une source scannée.
    sql: `
      CREATE TABLE podcasts (
        id            INTEGER PRIMARY KEY,
        feed_url      TEXT    NOT NULL UNIQUE,
        title         TEXT    NOT NULL,
        description   TEXT,
        author        TEXT,
        website       TEXT,
        image_path    TEXT,                          -- pochette mise en cache sur disque
        image_url     TEXT,
        added_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        last_fetch_at INTEGER,
        last_error    TEXT
      );

      CREATE TABLE podcast_episodes (
        id           INTEGER PRIMARY KEY,
        podcast_id   INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
        guid         TEXT    NOT NULL,               -- identifiant du flux, sert à dédoublonner
        title        TEXT    NOT NULL,
        description  TEXT,
        audio_url    TEXT    NOT NULL,
        mime         TEXT,
        size         INTEGER,
        duration     REAL,
        published_at INTEGER,
        image_path   TEXT,
        local_path   TEXT,                           -- copie hors ligne, si téléchargée
        position     REAL    NOT NULL DEFAULT 0,     -- reprise de lecture
        completed    INTEGER NOT NULL DEFAULT 0,
        UNIQUE (podcast_id, guid)
      );

      CREATE INDEX podcast_episodes_feed_idx ON podcast_episodes(podcast_id, published_at DESC);
      CREATE INDEX podcast_episodes_url_idx  ON podcast_episodes(audio_url);
    `
  },
  {
    version: 7,
    name: 'external-metadata',
    // `identified_at` évite de réinterroger l'API pour un fichier déjà traité, y compris quand
    // aucune correspondance n'a été trouvée.
    sql: `
      ALTER TABLE media ADD COLUMN identified_at INTEGER;
      ALTER TABLE media_metadata ADD COLUMN backdrop_path TEXT;
      ALTER TABLE media_metadata ADD COLUMN cast_names TEXT;   -- JSON : ["Nom", ...]
      ALTER TABLE media_metadata ADD COLUMN runtime INTEGER;   -- minutes, annoncées par la source
      CREATE INDEX media_identified_idx ON media(identified_at) WHERE identified_at IS NULL;
    `
  },
  {
    version: 8,
    name: 'settings',
    // Réglages de l'application. `value` est un BLOB car certains réglages sont chiffrés
    // (clés d'API, mots de passe) par le trousseau du système.
    sql: `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value BLOB
      );
    `
  },
  {
    version: 9,
    name: 'iptv',
    // Les chaînes vivent dans leurs propres tables : ce ne sont pas des fichiers d'une source
    // scannée, elles n'ont ni taille ni date de modification, et leur flux n'existe qu'en direct.
    //
    // `channel_key` porte l'identité d'une chaîne d'un rafraîchissement à l'autre. C'est l'URL du
    // flux et non `tvg-id` : dans les listes publiques, un même `tvg-id` revient sur plusieurs
    // entrées (qualités, flux de secours), et s'en servir comme clé en perdrait une partie.
    //
    // `missing_at` plutôt qu'une suppression : une chaîne absente d'un rafraîchissement peut
    // revenir au suivant, et effacer la ligne emporterait avec elle ce que l'utilisateur en a
    // fait — son statut de favorite.
    sql: `
      CREATE TABLE iptv_sources (
        id            INTEGER PRIMARY KEY,
        location      TEXT    NOT NULL UNIQUE,     -- URL http(s) ou chemin d'un fichier local
        name          TEXT    NOT NULL,
        added_at      INTEGER NOT NULL DEFAULT (unixepoch()),
        last_fetch_at INTEGER,
        last_error    TEXT
      );

      CREATE TABLE iptv_channels (
        id          INTEGER PRIMARY KEY,
        source_id   INTEGER NOT NULL REFERENCES iptv_sources(id) ON DELETE CASCADE,
        channel_key TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        stream_url  TEXT    NOT NULL,
        logo_url    TEXT,
        logo_path   TEXT,                          -- logo mis en cache sur disque
        group_title TEXT,
        epg_id      TEXT,                          -- tvg-id, pour le guide des programmes
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,    -- ordre d'apparition dans la liste
        seen_at     INTEGER NOT NULL DEFAULT (unixepoch()),
        missing_at  INTEGER,                       -- NULL = présente au dernier rafraîchissement
        UNIQUE (source_id, channel_key)
      );

      CREATE INDEX iptv_channels_source_idx   ON iptv_channels(source_id, position);
      CREATE INDEX iptv_channels_group_idx    ON iptv_channels(group_title);
      CREATE INDEX iptv_channels_favorite_idx ON iptv_channels(favorite) WHERE favorite = 1;
    `
  },
  {
    version: 10,
    name: 'iptv-http-options',
    // En-têtes qu'un flux exige (`#EXTVLCOPT:` dans la playlist) : sans eux, certains serveurs
    // refusent la chaîne. Ils voyagent avec elle, pas dans l'URL du lecteur.
    sql: `
      ALTER TABLE iptv_channels ADD COLUMN user_agent TEXT;
      ALTER TABLE iptv_channels ADD COLUMN referrer   TEXT;
    `
  }
]
