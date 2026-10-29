CREATE TABLE IF NOT EXISTS players (
    player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    share_research TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revoked_at DATETIME(6) NULL,
    PRIMARY KEY (player_id),
    UNIQUE KEY uq_players_token_hash (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roulette_tables (
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    owner_player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    table_name VARCHAR(120) NOT NULL,
    table_type ENUM('physical', 'electronic', 'online_rng', 'simulated', 'imported') NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (table_id),
    KEY ix_tables_owner (owner_player_id, created_at),
    CONSTRAINT fk_tables_owner FOREIGN KEY (owner_player_id) REFERENCES players (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_sessions (
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    data_source ENUM('manual', 'physical_live', 'electronic_live', 'online_rng', 'simulation', 'imported') NOT NULL,
    data_origin ENUM('observed', 'synthetic') NOT NULL,
    share_consent TINYINT(1) NOT NULL DEFAULT 0,
    next_spin_number BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    closed_at DATETIME(6) NULL,
    PRIMARY KEY (session_id),
    KEY ix_sessions_player (player_id, created_at),
    KEY ix_sessions_table (table_id, created_at),
    CONSTRAINT fk_sessions_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id),
    CONSTRAINT fk_sessions_player FOREIGN KEY (player_id) REFERENCES players (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS spin_events (
    event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    spin_number BIGINT UNSIGNED NOT NULL,
    outcome TINYINT UNSIGNED NOT NULL,
    occurred_at DATETIME(6) NULL,
    recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (event_id),
    UNIQUE KEY uq_spins_session_number (session_id, spin_number),
    KEY ix_spins_table_origin (table_id, spin_number),
    KEY ix_spins_player_time (player_id, recorded_at),
    CONSTRAINT fk_spins_session FOREIGN KEY (session_id) REFERENCES research_sessions (session_id),
    CONSTRAINT fk_spins_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id),
    CONSTRAINT fk_spins_player FOREIGN KEY (player_id) REFERENCES players (player_id),
    CONSTRAINT chk_spins_outcome CHECK (outcome BETWEEN 0 AND 36)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS table_observation_totals (
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    data_origin ENUM('observed', 'synthetic') NOT NULL,
    spin_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (table_id, data_origin),
    CONSTRAINT fk_observation_totals_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS table_street_counts (
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    data_origin ENUM('observed', 'synthetic') NOT NULL,
    street TINYINT UNSIGNED NOT NULL,
    appearance_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (table_id, data_origin, street),
    CONSTRAINT fk_table_street_counts_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id),
    CONSTRAINT chk_table_street_index CHECK (street BETWEEN 0 AND 11)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS table_model_states (
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    data_origin ENUM('observed', 'synthetic') NOT NULL,
    state_version SMALLINT UNSIGNED NOT NULL,
    state_json JSON NOT NULL,
    observation_count BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (table_id, data_origin),
    CONSTRAINT fk_model_states_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_street_statistics (
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    street TINYINT UNSIGNED NOT NULL,
    appearances BIGINT UNSIGNED NOT NULL DEFAULT 0,
    current_absence BIGINT UNSIGNED NOT NULL DEFAULT 0,
    longest_absence BIGINT UNSIGNED NOT NULL DEFAULT 0,
    interval_total BIGINT UNSIGNED NOT NULL DEFAULT 0,
    interval_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_seen_spin BIGINT UNSIGNED NULL,
    consecutive_appearances BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, street),
    CONSTRAINT fk_session_street_statistics_session FOREIGN KEY (session_id) REFERENCES research_sessions (session_id),
    CONSTRAINT chk_session_street_index CHECK (street BETWEEN 0 AND 11)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS predictions (
    prediction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    spin_number BIGINT UNSIGNED NOT NULL,
    observation_count BIGINT UNSIGNED NOT NULL,
    selected_street TINYINT UNSIGNED NOT NULL,
    selected_probability DECIMAL(12, 10) NOT NULL,
    probabilities_json JSON NOT NULL,
    candidate_models_json JSON NOT NULL,
    model_version VARCHAR(80) NOT NULL,
    parameters_json JSON NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (prediction_id),
    UNIQUE KEY uq_predictions_session_spin (session_id, spin_number),
    KEY ix_predictions_table_model (table_id, model_version, spin_number),
    CONSTRAINT fk_predictions_session FOREIGN KEY (session_id) REFERENCES research_sessions (session_id),
    CONSTRAINT fk_predictions_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id),
    CONSTRAINT fk_predictions_player FOREIGN KEY (player_id) REFERENCES players (player_id),
    CONSTRAINT chk_predictions_street CHECK (selected_street BETWEEN 0 AND 11),
    CONSTRAINT chk_predictions_probability CHECK (selected_probability BETWEEN 0 AND 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prediction_evaluations (
    prediction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actual_outcome TINYINT UNSIGNED NOT NULL,
    selected_hit TINYINT(1) NOT NULL,
    brier_score DECIMAL(14, 12) NOT NULL,
    evaluated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (prediction_id),
    UNIQUE KEY uq_evaluations_event (event_id),
    CONSTRAINT fk_evaluations_prediction FOREIGN KEY (prediction_id) REFERENCES predictions (prediction_id),
    CONSTRAINT fk_evaluations_event FOREIGN KEY (event_id) REFERENCES spin_events (event_id),
    CONSTRAINT chk_evaluations_outcome CHECK (actual_outcome BETWEEN 0 AND 36)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integrity_reports (
    report_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    classification VARCHAR(64) NOT NULL,
    verified_error TINYINT(1) NOT NULL DEFAULT 0,
    details_json JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (report_id),
    UNIQUE KEY uq_integrity_event_class (event_id, classification),
    KEY ix_integrity_table (table_id, created_at),
    CONSTRAINT fk_integrity_event FOREIGN KEY (event_id) REFERENCES spin_events (event_id),
    CONSTRAINT fk_integrity_session FOREIGN KEY (session_id) REFERENCES research_sessions (session_id),
    CONSTRAINT fk_integrity_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id),
    CONSTRAINT fk_integrity_player FOREIGN KEY (player_id) REFERENCES players (player_id),
    CONSTRAINT chk_integrity_verified CHECK (verified_error = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integrity_benchmark_runs (
    run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    benchmark_name VARCHAR(80) NOT NULL,
    benchmark_version VARCHAR(40) NOT NULL,
    source ENUM('synthetic_client_report') NOT NULL DEFAULT 'synthetic_client_report',
    verified TINYINT(1) NOT NULL DEFAULT 0,
    metrics_json JSON NOT NULL,
    cases_json JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (run_id),
    UNIQUE KEY uq_benchmark_player_run (player_id, run_id),
    KEY ix_benchmark_player_time (player_id, created_at),
    CONSTRAINT fk_integrity_benchmark_player FOREIGN KEY (player_id) REFERENCES players (player_id),
    CONSTRAINT chk_integrity_benchmark_unverified CHECK (verified = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS model_score_events (
    prediction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    model_version VARCHAR(80) NOT NULL,
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    data_origin ENUM('observed', 'synthetic') NOT NULL,
    brier_score DECIMAL(14, 12) NOT NULL,
    evaluated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (prediction_id, model_version),
    KEY ix_model_scores_table (table_id, data_origin, model_version, evaluated_at),
    CONSTRAINT fk_model_scores_prediction FOREIGN KEY (prediction_id) REFERENCES predictions (prediction_id),
    CONSTRAINT fk_model_scores_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;