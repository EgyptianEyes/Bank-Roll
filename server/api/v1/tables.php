<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    $database = bri_database();
    $player = bri_authenticated_player($database);
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'POST') {
        $payload = bri_request_json();
        $tableId = bri_uuid($payload['table_id'] ?? null, 'table_id');
        $tableName = trim((string) ($payload['table_name'] ?? ''));
        $tableType = $payload['table_type'] ?? null;
        $sharedCohortId = ($payload['shared_cohort_id'] ?? null) === null || ($payload['shared_cohort_id'] ?? '') === ''
            ? null
            : bri_uuid($payload['shared_cohort_id'], 'shared_cohort_id');
        if ($tableName === '' || strlen($tableName) > 120) throw new InvalidArgumentException('table_name must contain 1 to 120 characters.');
        if (!in_array($tableType, ['physical', 'electronic', 'online_rng', 'simulated', 'imported'], true)) throw new InvalidArgumentException('Unsupported table_type.');

        $database->beginTransaction();
        try {
            if ($sharedCohortId !== null) {
                $cohortTypes = $database->prepare('SELECT DISTINCT table_type FROM roulette_tables WHERE shared_cohort_id = :shared_cohort_id AND table_type <> :table_type');
                $cohortTypes->execute(['shared_cohort_id' => $sharedCohortId, 'table_type' => $tableType]);
                if ($cohortTypes->fetch()) throw new BriHttpException(409, 'A shared cohort cannot combine different roulette table types.');
            }
            $insert = $database->prepare('INSERT INTO roulette_tables (table_id, owner_player_id, table_name, table_type, shared_cohort_id) VALUES (:table_id, :player_id, :table_name, :table_type, :shared_cohort_id)');
            $insert->execute([
                'table_id' => $tableId,
                'player_id' => $player['player_id'],
                'table_name' => $tableName,
                'table_type' => $tableType,
                'shared_cohort_id' => $sharedCohortId,
            ]);
            $active = $database->prepare('UPDATE players SET active_table_id = :table_id WHERE player_id = :player_id');
            $active->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
            $database->commit();
        } catch (Throwable $exception) {
            if ($database->inTransaction()) $database->rollBack();
            throw $exception;
        }
        bri_respond(201, ['table_id' => $tableId, 'active_table_id' => $tableId, 'created' => true]);
    }
    if ($method === 'PUT') {
        $payload = bri_request_json();
        $tableId = bri_uuid($payload['table_id'] ?? null, 'table_id');
        $owned = $database->prepare('SELECT table_id FROM roulette_tables WHERE table_id = :table_id AND owner_player_id = :player_id');
        $owned->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
        if (!$owned->fetch()) throw new BriHttpException(404, 'Table profile not found.');
        $select = $database->prepare('UPDATE players SET active_table_id = :table_id WHERE player_id = :player_id');
        $select->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
        bri_respond(200, ['active_table_id' => $tableId]);
    }
    if ($method !== 'GET') bri_require_method('GET');

    $active = $database->prepare('SELECT active_table_id FROM players WHERE player_id = :player_id');
    $active->execute(['player_id' => $player['player_id']]);
    $activeTableId = $active->fetchColumn() ?: null;
    $statement = $database->prepare('SELECT roulette_tables.table_id, roulette_tables.table_name, roulette_tables.table_type, roulette_tables.shared_cohort_id, roulette_tables.created_at, COALESCE((SELECT spin_count FROM table_observation_totals WHERE table_id = roulette_tables.table_id AND data_origin = \'observed\'), 0) AS observed_spins, COALESCE((SELECT spin_count FROM table_observation_totals WHERE table_id = roulette_tables.table_id AND data_origin = \'synthetic\'), 0) AS synthetic_spins, COALESCE((SELECT MIN(statistics_valid) FROM table_observation_totals WHERE table_id = roulette_tables.table_id), 1) AS statistics_valid, (SELECT research_sessions.session_id FROM research_sessions WHERE research_sessions.table_id = roulette_tables.table_id AND research_sessions.player_id = roulette_tables.owner_player_id ORDER BY research_sessions.created_at DESC LIMIT 1) AS latest_session_id FROM roulette_tables WHERE roulette_tables.owner_player_id = :player_id ORDER BY roulette_tables.created_at DESC');
    $statement->execute(['player_id' => $player['player_id']]);
    $tables = array_map(static fn (array $row): array => [
        'table_id' => $row['table_id'],
        'table_name' => $row['table_name'],
        'table_type' => $row['table_type'],
        'shared_cohort_id' => $row['shared_cohort_id'],
        'created_at' => $row['created_at'],
        'observed_spins' => (int) $row['observed_spins'],
        'synthetic_spins' => (int) $row['synthetic_spins'],
        'spin_count' => (int) $row['observed_spins'] + (int) $row['synthetic_spins'],
        'statistics_valid' => (bool) $row['statistics_valid'],
        'latest_session_id' => $row['latest_session_id'],
    ], $statement->fetchAll());

    bri_respond(200, ['tables' => $tables, 'active_table_id' => $activeTableId]);
});