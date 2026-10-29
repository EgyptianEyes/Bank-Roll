ALTER TABLE table_observation_totals
    ADD COLUMN statistics_valid TINYINT(1) NOT NULL DEFAULT 1 AFTER spin_count;

ALTER TABLE table_model_states
    ADD COLUMN state_valid TINYINT(1) NOT NULL DEFAULT 1 AFTER observation_count;

CREATE TABLE spin_corrections (
    correction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision SMALLINT UNSIGNED NOT NULL,
    previous_outcome TINYINT UNSIGNED NOT NULL,
    corrected_outcome TINYINT UNSIGNED NOT NULL,
    reason VARCHAR(300) NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    corrected_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (correction_id),
    UNIQUE KEY uq_correction_event_revision (event_id, revision),
    KEY ix_correction_session (session_id, corrected_at),
    CONSTRAINT fk_correction_event FOREIGN KEY (event_id) REFERENCES spin_events (event_id),
    CONSTRAINT fk_correction_session FOREIGN KEY (session_id) REFERENCES research_sessions (session_id),
    CONSTRAINT fk_correction_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id),
    CONSTRAINT fk_correction_player FOREIGN KEY (player_id) REFERENCES players (player_id),
    CONSTRAINT chk_correction_previous CHECK (previous_outcome BETWEEN 0 AND 36),
    CONSTRAINT chk_correction_value CHECK (corrected_outcome BETWEEN 0 AND 36)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE prediction_evaluation_impacts (
    correction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    prediction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    prior_hit TINYINT(1) NOT NULL,
    prior_brier_score DECIMAL(14, 12) NOT NULL,
    corrected_hit TINYINT(1) NOT NULL,
    corrected_brier_score DECIMAL(14, 12) NOT NULL,
    recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (correction_id),
    KEY ix_evaluation_impacts_prediction (prediction_id),
    CONSTRAINT fk_eval_impact_correction FOREIGN KEY (correction_id) REFERENCES spin_corrections (correction_id),
    CONSTRAINT fk_eval_impact_prediction FOREIGN KEY (prediction_id) REFERENCES predictions (prediction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE integrity_rebuild_requests (
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    data_origin ENUM('observed', 'synthetic') NOT NULL,
    player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    triggering_correction_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (request_id),
    KEY ix_rebuild_table_status (table_id, data_origin, status),
    CONSTRAINT fk_rebuild_table FOREIGN KEY (table_id) REFERENCES roulette_tables (table_id),
    CONSTRAINT fk_rebuild_player FOREIGN KEY (player_id) REFERENCES players (player_id),
    CONSTRAINT fk_rebuild_correction FOREIGN KEY (triggering_correction_id) REFERENCES spin_corrections (correction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;