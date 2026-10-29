ALTER TABLE roulette_tables
    ADD COLUMN shared_cohort_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER table_type,
    ADD KEY ix_tables_shared_cohort (shared_cohort_id, table_type, owner_player_id);