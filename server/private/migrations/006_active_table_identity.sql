ALTER TABLE players
    ADD COLUMN active_table_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER share_research,
    ADD KEY ix_players_active_table (active_table_id);