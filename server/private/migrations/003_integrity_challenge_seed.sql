ALTER TABLE integrity_benchmark_runs
    ADD COLUMN random_seed VARCHAR(128) NOT NULL AFTER benchmark_version;