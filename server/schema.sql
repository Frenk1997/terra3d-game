-- Terra 3D: таблицы базы D1. Хранятся только ник и игровой прогресс (e-mail и имя из Google не запрашиваются).
-- Файл можно выполнять повторно: существующие данные не трогаются.

CREATE TABLE IF NOT EXISTS players (
  sub              TEXT PRIMARY KEY,           -- внутренний идентификатор аккаунта Google
  nickname         TEXT NOT NULL,
  nickname_lc      TEXT NOT NULL UNIQUE,       -- ник в нижнем регистре: уникальность без учёта регистра
  score            INTEGER NOT NULL DEFAULT 0, -- перерождения*10 + эпоха
  rebirths         INTEGER NOT NULL DEFAULT 0,
  era              INTEGER NOT NULL DEFAULT 0,
  save             TEXT,                       -- JSON прогресса
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  score_updated_at INTEGER NOT NULL DEFAULT 0  -- когда набран текущий счёт (при равенстве выше тот, кто раньше)
);
CREATE INDEX IF NOT EXISTS idx_players_rank ON players (score DESC, score_updated_at ASC);

-- Незавершённые входы через Google (живут 10 минут)
CREATE TABLE IF NOT EXISTS logins (
  state      TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,       -- SHA-256 от секрета, который знает только игра, начавшая вход
  app        INTEGER NOT NULL DEFAULT 0,
  code       TEXT,                -- одноразовый код после ответа Google
  sub        TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logins_created ON logins (created_at);

-- Топы планет: лучший результат игрока на планете за всё время (этап * 100000 + число построек)
CREATE TABLE IF NOT EXISTS planet_scores (
  sub     TEXT NOT NULL,
  planet  TEXT NOT NULL,
  best    INTEGER NOT NULL DEFAULT 0,
  best_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sub, planet)
);
CREATE INDEX IF NOT EXISTS idx_planet_scores_board ON planet_scores (planet, best DESC, best_at ASC);

-- Недельные топы: board = 'all' (прирост общего счёта с начала недели) или планета (лучший результат за неделю)
CREATE TABLE IF NOT EXISTS weekly_scores (
  week  INTEGER NOT NULL,             -- номер недели (с понедельника 00:00 МСК)
  board TEXT NOT NULL,
  sub   TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  base  INTEGER NOT NULL DEFAULT 0,   -- общий счёт на начало недели (для board = 'all')
  at    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week, board, sub)
);
CREATE INDEX IF NOT EXISTS idx_weekly_board ON weekly_scores (week, board, score DESC, at ASC);

-- Промокоды: кто какой код активировал, и неудачные попытки (защита от перебора)
CREATE TABLE IF NOT EXISTS promo_uses (
  code_id TEXT NOT NULL,
  sub     TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promo_uses ON promo_uses (code_id, sub);
CREATE TABLE IF NOT EXISTS promo_fails (
  sub TEXT NOT NULL,
  at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promo_fails ON promo_fails (sub, at);

-- ===== Друзья и альянсы =====
-- Код для добавления в друзья, засчитанные тапы (для топа альянсов), альянс и последняя активность
CREATE TABLE IF NOT EXISTS player_meta (
  sub         TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,        -- код, по которому добавляют в друзья
  taps        INTEGER NOT NULL DEFAULT 0,  -- тапы, засчитанные сервером (с ограничением скорости)
  taps_seen   INTEGER NOT NULL DEFAULT 0,  -- последний счётчик тапов из сохранения игрока
  taps_at     INTEGER NOT NULL DEFAULT 0,
  alliance_id INTEGER,
  ally_taps   INTEGER NOT NULL DEFAULT 0,  -- тапы, принесённые нынешнему альянсу
  ally_at     INTEGER NOT NULL DEFAULT 0,  -- когда вступил
  seen_at     INTEGER NOT NULL DEFAULT 0,  -- последняя активность (для «в сети»)
  ally_gems   INTEGER NOT NULL DEFAULT 0,  -- кристаллы, вложенные в нынешний альянс
  admin       INTEGER NOT NULL DEFAULT 0,  -- 1 — администратор (чит-меню, модерация чата)
  muted_until INTEGER NOT NULL DEFAULT 0   -- до какого времени игроку закрыт чат
);
CREATE INDEX IF NOT EXISTS idx_meta_alliance ON player_meta (alliance_id, ally_taps DESC);

CREATE TABLE IF NOT EXISTS friends (
  a  TEXT NOT NULL,
  b  TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (a, b)                       -- дружба хранится в обе стороны
);

CREATE TABLE IF NOT EXISTS alliances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  name_lc    TEXT NOT NULL UNIQUE,
  emblem     TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,         -- код приглашения
  leader     TEXT NOT NULL,
  open       INTEGER NOT NULL DEFAULT 1,   -- 1 — вступить может любой из списка
  taps       INTEGER NOT NULL DEFAULT 0,   -- все тапы альянса за всё время
  created_at INTEGER NOT NULL,
  gems       INTEGER NOT NULL DEFAULT 0    -- вложенные кристаллы (мощь = тапы + кристаллы × 500)
);
CREATE INDEX IF NOT EXISTS idx_alliances_taps ON alliances (taps DESC);

CREATE TABLE IF NOT EXISTS alliance_weekly (
  week        INTEGER NOT NULL,
  alliance_id INTEGER NOT NULL,
  taps        INTEGER NOT NULL DEFAULT 0,
  at          INTEGER NOT NULL DEFAULT 0,
  gems        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week, alliance_id)
);
CREATE INDEX IF NOT EXISTS idx_alliance_weekly ON alliance_weekly (week, taps DESC);

-- Twitch: зритель (opaque id «U…» из расширения) привязан к аккаунту игры
CREATE TABLE IF NOT EXISTS twitch_links (
  twitch_id  TEXT PRIMARY KEY,
  sub        TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS twitch_links_sub ON twitch_links (sub);

-- одноразовые коды привязки (живут 10 минут)
CREATE TABLE IF NOT EXISTS link_codes (
  code       TEXT PRIMARY KEY,
  sub        TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS link_codes_sub ON link_codes (sub);

-- ===== Чат =====
-- channel: 'g' — общий, 'a:<id альянса>', 'd:<sub1>|<sub2>' — личные сообщения друзей. Хранится 30 дней.
-- (В старых базах столбцы admin, muted_until, ally_gems, gems сервер добавляет сам при запуске — см. ensureSchema в worker.js.)
CREATE TABLE IF NOT EXISTS chat_messages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  channel  TEXT NOT NULL,
  sub      TEXT NOT NULL,
  nickname TEXT NOT NULL,
  text     TEXT NOT NULL,
  at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages (channel, id);
CREATE INDEX IF NOT EXISTS idx_chat_sub ON chat_messages (sub, id);
