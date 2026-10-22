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
