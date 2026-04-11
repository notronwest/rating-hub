-- =============================================================
-- WMPC Rating Hub — Initial PostgreSQL Schema (Supabase)
-- =============================================================

-- 1. ORGANIZATIONS
-- Multi-tenant root. Every other table references this.
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. PLAYERS
-- Org-scoped player roster. One row per person per org.
CREATE TABLE players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    pbvision_names  TEXT[] NOT NULL DEFAULT '{}',
    avatar_url      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    is_public       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (org_id, slug)
);

CREATE INDEX idx_players_org ON players(org_id);
CREATE INDEX idx_players_pbvision_names ON players USING GIN (pbvision_names);

-- 3. GAMES
-- One row per analyzed PB Vision session.
CREATE TABLE games (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- PB Vision identifiers
    pbvision_video_id   TEXT NOT NULL,
    session_index       SMALLINT NOT NULL DEFAULT 0,
    session_name        TEXT,

    -- Game metadata
    played_at           TIMESTAMPTZ,
    session_type        SMALLINT NOT NULL DEFAULT 0,  -- 0=game, 1=drill, 2=practice
    num_players         SMALLINT NOT NULL DEFAULT 4,  -- 2 or 4
    scoring_type        TEXT,                         -- "side_out" or "rally"
    min_points          SMALLINT,                     -- 11, 15, 21, 25

    -- Outcome
    team0_score         SMALLINT,
    team1_score         SMALLINT,
    winning_team        SMALLINT,

    -- Aggregate game stats
    avg_shots_per_rally NUMERIC(5,2),
    total_rallies       SMALLINT,
    kitchen_rallies     SMALLINT,
    longest_rally_shots SMALLINT,
    team0_kitchen_pct   NUMERIC(5,3),
    team1_kitchen_pct   NUMERIC(5,3),

    -- PB Vision engine metadata
    ai_engine_version   SMALLINT,
    pbvision_bucket     TEXT,

    -- Full gd object for forward compatibility
    raw_game_data       JSONB,

    imported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (org_id, pbvision_video_id, session_index)
);

CREATE INDEX idx_games_org ON games(org_id);
CREATE INDEX idx_games_played_at ON games(org_id, played_at DESC);

-- 4. GAME_PLAYERS
-- Per-player per-game performance. Core analytics table.
CREATE TABLE game_players (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Position in PB Vision data
    player_index    SMALLINT NOT NULL,
    team            SMALLINT NOT NULL,
    won             BOOLEAN,

    -- Basic stats
    shot_count              SMALLINT,
    left_side_percentage    NUMERIC(5,2),
    total_team_shot_pct     NUMERIC(5,3),

    -- Court coverage
    distance_covered        NUMERIC(8,2),
    x_coverage_pct          NUMERIC(5,2),

    -- Ratings (DUPR-scale 2-8)
    rating_overall      NUMERIC(5,3),
    rating_serve        NUMERIC(5,3),
    rating_return       NUMERIC(5,3),
    rating_offense      NUMERIC(5,3),
    rating_defense      NUMERIC(5,3),
    rating_agility      NUMERIC(5,3),
    rating_consistency  NUMERIC(5,3),

    -- Rally counts
    num_rallies         SMALLINT,
    num_rallies_won     SMALLINT,

    -- Kitchen arrival (nested structure)
    kitchen_arrival_pct     JSONB,
    kitchen_arrivals_summary JSONB,

    -- Role data
    role_data           JSONB,

    -- Shot distributions
    serve_depth         JSONB,
    return_depth        JSONB,
    serve_speed_dist    JSONB,
    shot_quality        JSONB,
    shot_selection      JSONB,
    shot_accuracy       JSONB,

    -- Coaching advice
    coaching_advice     JSONB,

    -- Full raw pd entry for forward compatibility
    raw_player_data     JSONB,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (game_id, player_index),
    UNIQUE (game_id, player_id)
);

CREATE INDEX idx_game_players_player ON game_players(player_id);
CREATE INDEX idx_game_players_org ON game_players(org_id);
CREATE INDEX idx_game_players_game ON game_players(game_id);
CREATE INDEX idx_game_players_ratings ON game_players(player_id, rating_overall);

-- 5. RALLIES
-- Rally-level summaries (no shot-level detail).
CREATE TABLE rallies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    rally_index     SMALLINT NOT NULL,

    start_ms        INTEGER NOT NULL,
    end_ms          INTEGER NOT NULL,
    duration_ms     INTEGER GENERATED ALWAYS AS (end_ms - start_ms) STORED,
    winning_team    SMALLINT,
    shot_count      SMALLINT,

    -- Running score after this rally
    score_team0     SMALLINT,
    score_team1     SMALLINT,
    server_number   SMALLINT,

    -- Player positions at rally start
    player_positions JSONB,

    UNIQUE (game_id, rally_index)
);

CREATE INDEX idx_rallies_game ON rallies(game_id);

-- 6. PLAYER_RATING_SNAPSHOTS
-- Narrow denormalized table for time-series rating charts.
CREATE TABLE player_rating_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    played_at       TIMESTAMPTZ NOT NULL,

    rating_overall      NUMERIC(5,3),
    rating_serve        NUMERIC(5,3),
    rating_return       NUMERIC(5,3),
    rating_offense      NUMERIC(5,3),
    rating_defense      NUMERIC(5,3),
    rating_agility      NUMERIC(5,3),
    rating_consistency  NUMERIC(5,3),

    won             BOOLEAN,
    team_score      SMALLINT,
    opponent_score  SMALLINT,

    UNIQUE (player_id, game_id)
);

CREATE INDEX idx_rating_snapshots_player_time
    ON player_rating_snapshots(player_id, played_at DESC);
CREATE INDEX idx_rating_snapshots_org
    ON player_rating_snapshots(org_id, played_at DESC);

-- 7. PLAYER_AGGREGATES
-- Running aggregates per player, refreshed after each import.
CREATE TABLE player_aggregates (
    player_id           UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    games_played        INTEGER NOT NULL DEFAULT 0,
    games_won           INTEGER NOT NULL DEFAULT 0,
    win_rate            NUMERIC(5,3),

    -- Latest ratings
    latest_rating_overall       NUMERIC(5,3),
    latest_rating_serve         NUMERIC(5,3),
    latest_rating_return        NUMERIC(5,3),
    latest_rating_offense       NUMERIC(5,3),
    latest_rating_defense       NUMERIC(5,3),
    latest_rating_agility       NUMERIC(5,3),
    latest_rating_consistency   NUMERIC(5,3),

    -- Averages across all games
    avg_rating_overall      NUMERIC(5,3),
    avg_rating_serve        NUMERIC(5,3),
    avg_rating_return       NUMERIC(5,3),
    avg_rating_offense      NUMERIC(5,3),
    avg_rating_defense      NUMERIC(5,3),
    avg_rating_agility      NUMERIC(5,3),
    avg_rating_consistency  NUMERIC(5,3),

    -- Peak
    peak_rating_overall     NUMERIC(5,3),

    -- Aggregate stats
    total_shots             INTEGER DEFAULT 0,
    total_rallies           INTEGER DEFAULT 0,
    total_rallies_won       INTEGER DEFAULT 0,
    avg_distance_per_game   NUMERIC(8,2),

    last_played_at          TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_player_agg_org_rating
    ON player_aggregates(org_id, latest_rating_overall DESC NULLS LAST);

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE rallies ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_rating_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_aggregates ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Public read orgs"
    ON organizations FOR SELECT USING (true);

CREATE POLICY "Public read players"
    ON players FOR SELECT USING (is_public = true);

CREATE POLICY "Public read games"
    ON games FOR SELECT USING (true);

CREATE POLICY "Public read game_players"
    ON game_players FOR SELECT USING (true);

CREATE POLICY "Public read rallies"
    ON rallies FOR SELECT USING (true);

CREATE POLICY "Public read rating snapshots"
    ON player_rating_snapshots FOR SELECT USING (true);

CREATE POLICY "Public read player aggregates"
    ON player_aggregates FOR SELECT USING (true);

-- Authenticated write policies
CREATE POLICY "Authenticated insert games"
    ON games FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert game_players"
    ON game_players FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert rallies"
    ON rallies FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert rating snapshots"
    ON player_rating_snapshots FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated upsert player aggregates"
    ON player_aggregates FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert players"
    ON players FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update players"
    ON players FOR UPDATE USING (auth.role() = 'authenticated');

-- =============================================================
-- VIEWS
-- =============================================================

-- Leaderboard
CREATE VIEW v_leaderboard AS
SELECT
    p.id AS player_id,
    p.org_id,
    p.display_name,
    p.slug AS player_slug,
    pa.games_played,
    pa.games_won,
    pa.win_rate,
    pa.latest_rating_overall,
    pa.latest_rating_serve,
    pa.latest_rating_return,
    pa.latest_rating_offense,
    pa.latest_rating_defense,
    pa.latest_rating_agility,
    pa.latest_rating_consistency,
    pa.avg_rating_overall,
    pa.peak_rating_overall,
    pa.last_played_at
FROM players p
JOIN player_aggregates pa ON pa.player_id = p.id
WHERE p.is_active = true AND p.is_public = true;

-- Player game history
CREATE VIEW v_player_game_history AS
SELECT
    gp.player_id,
    gp.org_id,
    g.id AS game_id,
    g.pbvision_video_id,
    g.session_name,
    g.played_at,
    g.num_players,
    gp.team,
    gp.won,
    g.team0_score,
    g.team1_score,
    gp.rating_overall,
    gp.rating_serve,
    gp.rating_return,
    gp.rating_offense,
    gp.rating_defense,
    gp.rating_agility,
    gp.rating_consistency,
    gp.shot_count,
    gp.num_rallies,
    gp.num_rallies_won,
    gp.distance_covered,
    gp.shot_quality,
    gp.shot_selection,
    gp.coaching_advice
FROM game_players gp
JOIN games g ON g.id = gp.game_id
ORDER BY g.played_at DESC;

-- =============================================================
-- FUNCTION: Refresh player aggregates after import
-- =============================================================

CREATE OR REPLACE FUNCTION refresh_player_aggregates(p_player_id UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO player_aggregates (
        player_id, org_id,
        games_played, games_won, win_rate,
        latest_rating_overall, latest_rating_serve, latest_rating_return,
        latest_rating_offense, latest_rating_defense,
        latest_rating_agility, latest_rating_consistency,
        avg_rating_overall, avg_rating_serve, avg_rating_return,
        avg_rating_offense, avg_rating_defense,
        avg_rating_agility, avg_rating_consistency,
        peak_rating_overall,
        total_shots, total_rallies, total_rallies_won,
        avg_distance_per_game, last_played_at, updated_at
    )
    SELECT
        gp.player_id,
        gp.org_id,
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (WHERE gp.won = true)::INTEGER,
        ROUND(COUNT(*) FILTER (WHERE gp.won = true)::NUMERIC
              / NULLIF(COUNT(*), 0), 3),
        -- Latest ratings (from most recent game)
        (ARRAY_AGG(gp.rating_overall ORDER BY g.played_at DESC NULLS LAST))[1],
        (ARRAY_AGG(gp.rating_serve ORDER BY g.played_at DESC NULLS LAST))[1],
        (ARRAY_AGG(gp.rating_return ORDER BY g.played_at DESC NULLS LAST))[1],
        (ARRAY_AGG(gp.rating_offense ORDER BY g.played_at DESC NULLS LAST))[1],
        (ARRAY_AGG(gp.rating_defense ORDER BY g.played_at DESC NULLS LAST))[1],
        (ARRAY_AGG(gp.rating_agility ORDER BY g.played_at DESC NULLS LAST))[1],
        (ARRAY_AGG(gp.rating_consistency ORDER BY g.played_at DESC NULLS LAST))[1],
        -- Averages
        ROUND(AVG(gp.rating_overall), 3),
        ROUND(AVG(gp.rating_serve), 3),
        ROUND(AVG(gp.rating_return), 3),
        ROUND(AVG(gp.rating_offense), 3),
        ROUND(AVG(gp.rating_defense), 3),
        ROUND(AVG(gp.rating_agility), 3),
        ROUND(AVG(gp.rating_consistency), 3),
        -- Peak
        MAX(gp.rating_overall),
        -- Totals
        COALESCE(SUM(gp.shot_count), 0)::INTEGER,
        COALESCE(SUM(gp.num_rallies), 0)::INTEGER,
        COALESCE(SUM(gp.num_rallies_won), 0)::INTEGER,
        ROUND(AVG(gp.distance_covered), 2),
        MAX(g.played_at),
        now()
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE gp.player_id = p_player_id
    GROUP BY gp.player_id, gp.org_id
    ON CONFLICT (player_id) DO UPDATE SET
        games_played = EXCLUDED.games_played,
        games_won = EXCLUDED.games_won,
        win_rate = EXCLUDED.win_rate,
        latest_rating_overall = EXCLUDED.latest_rating_overall,
        latest_rating_serve = EXCLUDED.latest_rating_serve,
        latest_rating_return = EXCLUDED.latest_rating_return,
        latest_rating_offense = EXCLUDED.latest_rating_offense,
        latest_rating_defense = EXCLUDED.latest_rating_defense,
        latest_rating_agility = EXCLUDED.latest_rating_agility,
        latest_rating_consistency = EXCLUDED.latest_rating_consistency,
        avg_rating_overall = EXCLUDED.avg_rating_overall,
        avg_rating_serve = EXCLUDED.avg_rating_serve,
        avg_rating_return = EXCLUDED.avg_rating_return,
        avg_rating_offense = EXCLUDED.avg_rating_offense,
        avg_rating_defense = EXCLUDED.avg_rating_defense,
        avg_rating_agility = EXCLUDED.avg_rating_agility,
        avg_rating_consistency = EXCLUDED.avg_rating_consistency,
        peak_rating_overall = EXCLUDED.peak_rating_overall,
        total_shots = EXCLUDED.total_shots,
        total_rallies = EXCLUDED.total_rallies,
        total_rallies_won = EXCLUDED.total_rallies_won,
        avg_distance_per_game = EXCLUDED.avg_distance_per_game,
        last_played_at = EXCLUDED.last_played_at,
        updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;
