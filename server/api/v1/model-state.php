<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    $database = bri_database();
    $player = bri_authenticated_player($database);

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        // Upload a model checkpoint rebuilt from the effective outcome
        // history after a correction. Forecasting resumes only when the
        // checkpoint matches the rebuilt observation ledger exactly.
        $payload = bri_request_json();
        $tableId = bri_uuid($payload['table_id'] ?? null, 'table_id');
        $origin = $payload['data_origin'] ?? null;
        if (!is_string($origin) || !in_array($origin, ['observed', 'synthetic'], true)) throw new InvalidArgumentException('data_origin must be observed or synthetic.');
        $modelState = bri_validate_model_state($payload['model_state'] ?? null);

        $database->beginTransaction();
        try {
            $tableCheck = $database->prepare('SELECT table_id FROM roulette_tables WHERE table_id = :table_id AND owner_player_id = :player_id FOR UPDATE');
            $tableCheck->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
            if (!$tableCheck->fetch()) throw new BriHttpException(404, 'Table profile not found.');
            $totalsQuery = $database->prepare('SELECT spin_count, statistics_valid FROM table_observation_totals WHERE table_id = :table_id AND data_origin = :data_origin FOR UPDATE');
            $totalsQuery->execute(['table_id' => $tableId, 'data_origin' => $origin]);
            $totals = $totalsQuery->fetch();
            if (!$totals) throw new BriHttpException(409, 'Table observation totals are not initialized.');
            if (!(bool) $totals['statistics_valid']) throw new BriHttpException(409, 'Rebuild the table statistics before uploading a model checkpoint.');
            if ($modelState['tracker']['totalObservations'] !== (int) $totals['spin_count']) throw new BriHttpException(409, 'Model checkpoint does not match the committed table observation count.');
            $saveModelState = $database->prepare('INSERT INTO table_model_states (table_id, data_origin, state_version, state_json, observation_count, state_valid) VALUES (:table_id, :data_origin, :state_version, :state_json, :observation_count, 1) ON DUPLICATE KEY UPDATE state_version = VALUES(state_version), state_json = VALUES(state_json), observation_count = VALUES(observation_count), state_valid = 1');
            $saveModelState->execute([
                'table_id' => $tableId,
                'data_origin' => $origin,
                'state_version' => $modelState['version'],
                'state_json' => json_encode($modelState, JSON_THROW_ON_ERROR),
                'observation_count' => (int) $totals['spin_count'],
            ]);
            $database->commit();
        } catch (Throwable $exception) {
            if ($database->inTransaction()) $database->rollBack();
            throw $exception;
        }
        bri_respond(200, ['stored' => true, 'observation_count' => (int) $totals['spin_count'], 'state_valid' => true]);
    }

    bri_require_method('GET');
    $tableId = bri_uuid($_GET['table_id'] ?? null, 'table_id');
    $origin = $_GET['data_origin'] ?? null;
    if (!is_string($origin) || !in_array($origin, ['observed', 'synthetic'], true)) throw new InvalidArgumentException('data_origin must be observed or synthetic.');

    $tableCheck = $database->prepare('SELECT roulette_tables.table_id, COALESCE(table_observation_totals.statistics_valid, 1) AS statistics_valid FROM roulette_tables LEFT JOIN table_observation_totals USING (table_id) WHERE roulette_tables.table_id = :table_id AND roulette_tables.owner_player_id = :player_id');
    $tableCheck->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
    $table = $tableCheck->fetch();
    if (!$table) throw new BriHttpException(404, 'Table profile not found.');
    if (!(bool) $table['statistics_valid']) throw new BriHttpException(409, 'A correction invalidated this table checkpoint; rebuild is required before learning can resume.');
    $totalQuery = $database->prepare('SELECT COALESCE(spin_count, 0), statistics_valid FROM table_observation_totals WHERE table_id = :table_id AND data_origin = :data_origin');
    $totalQuery->execute(['table_id' => $tableId, 'data_origin' => $origin]);
    $totalRow = $totalQuery->fetch(PDO::FETCH_NUM);
    $tableObservationCount = (int) ($totalRow[0] ?? 0);
    if (isset($totalRow[1]) && !(bool) $totalRow[1]) throw new BriHttpException(409, 'A correction invalidated this table checkpoint; rebuild is required before learning can resume.');

    $statement = $database->prepare('SELECT table_model_states.state_version, table_model_states.state_json, table_model_states.observation_count, table_model_states.state_valid FROM table_model_states JOIN roulette_tables USING (table_id) WHERE table_model_states.table_id = :table_id AND roulette_tables.owner_player_id = :player_id AND table_model_states.data_origin = :data_origin');
    $statement->execute(['table_id' => $tableId, 'player_id' => $player['player_id'], 'data_origin' => $origin]);
    $row = $statement->fetch();
    if (!$row) {
        bri_respond(200, ['state' => null, 'state_version' => null, 'observation_count' => $tableObservationCount]);
    }
    if (!(bool) $row['state_valid']) throw new BriHttpException(409, 'A correction invalidated this model state; rebuild is required before learning can resume.');
    if ((int) $row['observation_count'] !== $tableObservationCount) throw new BriHttpException(409, 'Stored BRI checkpoint is out of sync with the observation ledger.');

    bri_respond(200, [
        'state' => json_decode($row['state_json'], true, 64, JSON_THROW_ON_ERROR),
        'state_version' => (int) $row['state_version'],
        'observation_count' => (int) $row['observation_count'],
    ]);
});