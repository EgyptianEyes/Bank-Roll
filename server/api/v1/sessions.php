<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    bri_require_method('POST');
    $database = bri_database();
    $player = bri_authenticated_player($database);
    $payload = bri_request_json();
    $tableId = bri_uuid($payload['table_id'] ?? null, 'table_id');
    $sessionId = bri_uuid($payload['session_id'] ?? null, 'session_id');
    $tableName = trim((string) ($payload['table_name'] ?? ''));
    $tableType = $payload['table_type'] ?? null;
    $sharedCohortId = ($payload['shared_cohort_id'] ?? null) === null || ($payload['shared_cohort_id'] ?? '') === ''
        ? null
        : bri_uuid($payload['shared_cohort_id'], 'shared_cohort_id');
    $source = $payload['source'] ?? null;
    $origin = $payload['data_origin'] ?? null;
    $shareConsent = $payload['share_consent'] ?? false;
    if ($tableName === '' || strlen($tableName) > 120) throw new InvalidArgumentException('table_name must contain 1 to 120 characters.');
    if (!in_array($tableType, ['physical', 'electronic', 'online_rng', 'simulated', 'imported'], true)) throw new InvalidArgumentException('Unsupported table_type.');
    if (!in_array($source, ['manual', 'physical_live', 'electronic_live', 'online_rng', 'simulation', 'imported'], true)) throw new InvalidArgumentException('Unsupported source.');
    if (!in_array($origin, ['observed', 'synthetic'], true)) throw new InvalidArgumentException('data_origin must be observed or synthetic.');
    if (($source === 'simulation' && $origin !== 'synthetic') || (in_array($source, ['physical_live', 'electronic_live', 'online_rng'], true) && $origin !== 'observed')) throw new InvalidArgumentException('data_origin conflicts with the declared source.');
    if ($origin === 'observed') bri_require_observed_submissions_enabled();
    if (!is_bool($shareConsent)) throw new InvalidArgumentException('share_consent must be a boolean.');
    if ($shareConsent && !(bool) $player['share_research']) throw new BriHttpException(403, 'Enable player research sharing before opting this session in.');

    $database->beginTransaction();
    try {
        if ($sharedCohortId !== null) {
            $cohortTypes = $database->prepare('SELECT DISTINCT table_type FROM roulette_tables WHERE shared_cohort_id = :shared_cohort_id AND table_type <> :table_type');
            $cohortTypes->execute(['shared_cohort_id' => $sharedCohortId, 'table_type' => $tableType]);
            if ($cohortTypes->fetch()) throw new BriHttpException(409, 'A shared cohort cannot combine different roulette table types.');
        }
        $tableLookup = $database->prepare('SELECT owner_player_id, table_name, table_type, shared_cohort_id FROM roulette_tables WHERE table_id = :table_id FOR UPDATE');
        $tableLookup->execute(['table_id' => $tableId]);
        $existingTable = $tableLookup->fetch();
        if ($existingTable && $existingTable['owner_player_id'] !== $player['player_id']) throw new BriHttpException(404, 'Table profile not found.');
        if ($existingTable && ($existingTable['table_name'] !== $tableName || $existingTable['table_type'] !== $tableType || $existingTable['shared_cohort_id'] !== $sharedCohortId)) throw new BriHttpException(409, 'Table identifier conflicts with an existing profile.');
        if (!$existingTable) {
            $insertTable = $database->prepare('INSERT INTO roulette_tables (table_id, owner_player_id, table_name, table_type, shared_cohort_id) VALUES (:table_id, :player_id, :table_name, :table_type, :shared_cohort_id)');
            $insertTable->execute(['table_id' => $tableId, 'player_id' => $player['player_id'], 'table_name' => $tableName, 'table_type' => $tableType, 'shared_cohort_id' => $sharedCohortId]);
        }

        $existingSession = $database->prepare('SELECT player_id, table_id, data_source, data_origin, share_consent FROM research_sessions WHERE session_id = :session_id FOR UPDATE');
        $existingSession->execute(['session_id' => $sessionId]);
        $session = $existingSession->fetch();
        if ($session && ($session['player_id'] !== $player['player_id'] || $session['table_id'] !== $tableId || $session['data_source'] !== $source || $session['data_origin'] !== $origin || (bool) $session['share_consent'] !== $shareConsent)) throw new BriHttpException(409, 'Session identifier conflicts with existing research.');
        if (!$session) {
            $insertSession = $database->prepare('INSERT INTO research_sessions (session_id, table_id, player_id, data_source, data_origin, share_consent) VALUES (:session_id, :table_id, :player_id, :data_source, :data_origin, :share_consent)');
            $insertSession->execute([
                'session_id' => $sessionId,
                'table_id' => $tableId,
                'player_id' => $player['player_id'],
                'data_source' => $source,
                'data_origin' => $origin,
                'share_consent' => $shareConsent ? 1 : 0,
            ]);
        }
        $insertStreet = $database->prepare('INSERT IGNORE INTO session_street_statistics (session_id, street) VALUES (:session_id, :street)');
        for ($street = 0; $street < 12; $street++) $insertStreet->execute(['session_id' => $sessionId, 'street' => $street]);
        $insertTotal = $database->prepare('INSERT IGNORE INTO table_observation_totals (table_id, data_origin, spin_count) VALUES (:table_id, :data_origin, 0)');
        $insertTotal->execute(['table_id' => $tableId, 'data_origin' => $origin]);
        $activateTable = $database->prepare('UPDATE players SET active_table_id = :table_id WHERE player_id = :player_id');
        $activateTable->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
        $database->commit();
    } catch (Throwable $exception) {
        if ($database->inTransaction()) $database->rollBack();
        throw $exception;
    }

    bri_respond($session ? 200 : 201, ['session_id' => $sessionId, 'table_id' => $tableId, 'created' => !$session]);
});