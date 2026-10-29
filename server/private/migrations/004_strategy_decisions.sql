CREATE TABLE IF NOT EXISTS strategy_decisions (
    decision_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    spin_number BIGINT UNSIGNED NOT NULL,
    action ENUM('continue', 'switch', 'spread', 'stop', 'observe') NOT NULL,
    model_version VARCHAR(80) NULL,
    snapshot_json JSON NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (decision_id),
    UNIQUE KEY uq_decisions_session_spin (session_id, spin_number),
    KEY ix_decisions_player_session (player_id, session_id, spin_number),
    CONSTRAINT fk_decisions_session FOREIGN KEY (session_id) REFERENCES research_sessions (session_id),
    CONSTRAINT fk_decisions_player FOREIGN KEY (player_id) REFERENCES players (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
