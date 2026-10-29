<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

/**
 * Correction rebuild processor.
 *
 * GET  — reports rebuild status and pages the effective (corrected) outcome
 *        history in chronological order so the client can reconstruct model
 *        state without duplicating model mathematics on the server.
 * POST — recomputes every derived observation statistic for a table and data
 *        origin from the effective outcomes. The recomputation is calculated
 *        from scratch inside one transaction, so running it twice converges to
 *        the same result (idempotent) and an interrupted run leaves claimed
 *        requests in "processing" where they remain claimable on retry.
 *        Original events, predictions and evaluations are never rewritten.
 */
bri_run_api(static function (): void {
    $database = bri_database();
    $player = bri_authenticated_player($database);

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        $tableId = bri_uuid($_GET['table_id'] ?? null, 'table_id');
        $origin = $_GET['data_origin'] ?? null;
        if (!is_string($origin) || !in_array($origin, ['observed', 'synthetic'], true)) throw new InvalidArgumentException('data_origin must be observed or synthetic.');
        $offset = filter_var($_GET['offset'] ?? '0', FILTER_VALIDATE_INT);
        $limit = filter_var($_GET['limit'] ?? '500', FILTER_VALIDATE_INT);
        if ($offset === false || $offset < 0) throw new InvalidArgumentException('offset must be a non-negative integer.');
        if ($limit === false || $limit < 1 || $limit > 1000) throw new InvalidArgumentException('limit must be between 1 and 1000.');

        $tableCheck = $database->prepare('SELECT table_id FROM roulette_tables WHERE table_id = :table_id AND owner_player_id = :player_id');
        $tableCheck->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
        if (!$tableCheck->fetch()) throw new BriHttpException(404, 'Table profile not found.');

        $statusQuery = $database->prepare("SELECT COALESCE(SUM(status IN ('pending', 'processing')), 0) AS open_requests, COALESCE(SUM(status = 'completed'), 0) AS completed_requests FROM integrity_rebuild_requests WHERE table_id = :table_id AND data_origin = :data_origin");
        $statusQuery->execute(['table_id' => $tableId, 'data_origin' => $origin]);
        $status = $statusQuery->fetch();
        $validityQuery = $database->prepare('SELECT statistics_valid, spin_count FROM table_observation_totals WHERE table_id = :table_id AND data_origin = :data_origin');
        $validityQuery->execute(['table_id' => $tableId, 'data_origin' => $origin]);
        $validity = $validityQuery->fetch();
        $modelQuery = $database->prepare('SELECT state_valid FROM table_model_states WHERE table_id = :table_id AND data_origin = :data_origin');
        $modelQuery->execute(['table_id' => $tableId, 'data_origin' => $origin]);
        $modelRow = $modelQuery->fetch();

        $eventsQuery = $database->prepare('SELECT spin_events.event_id, spin_events.session_id, spin_events.spin_number, spin_events.outcome, (SELECT spin_corrections.corrected_outcome FROM spin_corrections WHERE spin_corrections.event_id = spin_events.event_id ORDER BY spin_corrections.revision DESC LIMIT 1) AS corrected_outcome, predictions.prediction_id, predictions.observation_count, predictions.selected_street, predictions.selected_probability, predictions.probabilities_json, predictions.candidate_models_json, predictions.model_version, predictions.parameters_json, predictions.created_at AS forecasted_at FROM spin_events JOIN research_sessions USING (session_id) LEFT JOIN predictions ON predictions.session_id = spin_events.session_id AND predictions.spin_number = spin_events.spin_number WHERE spin_events.table_id = :table_id AND research_sessions.data_origin = :data_origin ORDER BY research_sessions.created_at ASC, spin_events.session_id ASC, spin_events.spin_number ASC LIMIT :limit OFFSET :offset');
        $eventsQuery->bindValue('table_id', $tableId, PDO::PARAM_STR);
        $eventsQuery->bindValue('data_origin', $origin, PDO::PARAM_STR);
        $eventsQuery->bindValue('limit', $limit, PDO::PARAM_INT);
        $eventsQuery->bindValue('offset', $offset, PDO::PARAM_INT);
        $eventsQuery->execute();
        $events = array_map(static function (array $row): array {
            $candidateModels = $row['candidate_models_json'] === null ? [] : json_decode($row['candidate_models_json'], true, 32, JSON_THROW_ON_ERROR);
            $forecast = $row['prediction_id'] === null ? null : [
                'predictionId' => $row['prediction_id'],
                'observationCount' => (int) $row['observation_count'],
                'street' => (int) $row['selected_street'],
                'probability' => (float) $row['selected_probability'],
                'modelVersion' => $row['model_version'],
                'candidateModels' => array_map(static fn (array $candidate): array => [
                    'modelVersion' => $candidate['model_version'],
                    'probabilities' => $candidate['probabilities'],
                ], $candidateModels),
                'forecastedAt' => $row['forecasted_at'],
                'parameters' => json_decode($row['parameters_json'], true, 32, JSON_THROW_ON_ERROR),
            ];
            return [
                'event_id' => $row['event_id'],
                'session_id' => $row['session_id'],
                'spin_number' => (int) $row['spin_number'],
                'original_outcome' => (int) $row['outcome'],
                'effective_outcome' => $row['corrected_outcome'] === null ? (int) $row['outcome'] : (int) $row['corrected_outcome'],
                'forecast' => $forecast,
            ];
        }, $eventsQuery->fetchAll());

        bri_respond(200, [
            'open_requests' => (int) $status['open_requests'],
            'completed_requests' => (int) $status['completed_requests'],
            'statistics_valid' => $validity ? (bool) $validity['statistics_valid'] : true,
            'spin_count' => $validity ? (int) $validity['spin_count'] : 0,
            'model_state_valid' => $modelRow === false ? null : (bool) $modelRow['state_valid'],
            'events' => $events,
            'next_offset' => $offset + count($events),
            'has_more' => count($events) === $limit,
        ]);
    }

    bri_require_method('POST');
    $payload = bri_request_json();
    $tableId = bri_uuid($payload['table_id'] ?? null, 'table_id');
    $origin = $payload['data_origin'] ?? null;
    if (!is_string($origin) || !in_array($origin, ['observed', 'synthetic'], true)) throw new InvalidArgumentException('data_origin must be observed or synthetic.');

    $database->beginTransaction();
    try {
        $tableCheck = $database->prepare('SELECT table_id FROM roulette_tables WHERE table_id = :table_id AND owner_player_id = :player_id FOR UPDATE');
        $tableCheck->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
        if (!$tableCheck->fetch()) throw new BriHttpException(404, 'Table profile not found.');

        $claimQuery = $database->prepare("SELECT request_id FROM integrity_rebuild_requests WHERE table_id = :table_id AND data_origin = :data_origin AND status IN ('pending', 'processing') FOR UPDATE");
        $claimQuery->execute(['table_id' => $tableId, 'data_origin' => $origin]);
        $claimedRequests = array_column($claimQuery->fetchAll(), 'request_id');

        $validityQuery = $database->prepare('SELECT statistics_valid FROM table_observation_totals WHERE table_id = :table_id AND data_origin = :data_origin FOR UPDATE');
        $validityQuery->execute(['table_id' => $tableId, 'data_origin' => $origin]);
        $validity = $validityQuery->fetch();
        if ($claimedRequests === [] && ($validity === false || (bool) $validity['statistics_valid'])) {
            $database->commit();
            bri_respond(200, ['rebuilt' => false, 'already_valid' => true, 'requests_completed' => 0]);
        }

        // An interrupted rebuild leaves these rows in "processing"; the claim
        // above picks them up again, so retrying is always safe.
        if ($claimedRequests !== []) {
            $markProcessing = $database->prepare("UPDATE integrity_rebuild_requests SET status = 'processing' WHERE request_id = :request_id");
            foreach ($claimedRequests as $requestId) $markProcessing->execute(['request_id' => $requestId]);
        }

        $sessionsQuery = $database->prepare('SELECT session_id FROM research_sessions WHERE table_id = :table_id AND data_origin = :data_origin ORDER BY created_at ASC, session_id ASC FOR UPDATE');
        $sessionsQuery->execute(['table_id' => $tableId, 'data_origin' => $origin]);
        $sessionIds = array_column($sessionsQuery->fetchAll(), 'session_id');

        $eventsQuery = $database->prepare('SELECT spin_events.spin_number, spin_events.outcome, (SELECT spin_corrections.corrected_outcome FROM spin_corrections WHERE spin_corrections.event_id = spin_events.event_id ORDER BY spin_corrections.revision DESC LIMIT 1) AS corrected_outcome FROM spin_events WHERE spin_events.session_id = :session_id ORDER BY spin_events.spin_number ASC');
        $resetStreet = $database->prepare('UPDATE session_street_statistics SET appearances = :appearances, current_absence = :current_absence, longest_absence = :longest_absence, interval_total = :interval_total, interval_count = :interval_count, last_seen_spin = :last_seen_spin, consecutive_appearances = :consecutive_appearances WHERE session_id = :session_id AND street = :street');

        $tableStreetCounts = array_fill(0, 12, 0);
        $tableSpinCount = 0;
        $eventsReplayed = 0;
        $correctionsApplied = 0;

        foreach ($sessionIds as $sessionId) {
            $appearances = array_fill(0, 12, 0);
            $currentAbsence = array_fill(0, 12, 0);
            $longestAbsence = array_fill(0, 12, 0);
            $intervalTotal = array_fill(0, 12, 0);
            $intervalCount = array_fill(0, 12, 0);
            $lastSeenSpin = array_fill(0, 12, null);
            $consecutive = array_fill(0, 12, 0);
            $previousStreet = null;
            $previousSpin = 0;

            $eventsQuery->execute(['session_id' => $sessionId]);
            while (($row = $eventsQuery->fetch()) !== false) {
                $spinNumber = (int) $row['spin_number'];
                $effective = $row['corrected_outcome'] === null ? (int) $row['outcome'] : (int) $row['corrected_outcome'];
                if ($row['corrected_outcome'] !== null) $correctionsApplied++;
                $category = bri_outcome_category($effective);
                for ($street = 0; $street < 12; $street++) {
                    if ($street === $category) {
                        if ($lastSeenSpin[$street] !== null) {
                            $intervalTotal[$street] += $spinNumber - $lastSeenSpin[$street];
                            $intervalCount[$street]++;
                        }
                        $appearances[$street]++;
                        $currentAbsence[$street] = 0;
                        $consecutive[$street] = ($previousStreet === $street && $previousSpin === $spinNumber - 1) ? $consecutive[$street] + 1 : 1;
                        $lastSeenSpin[$street] = $spinNumber;
                    } else {
                        $currentAbsence[$street]++;
                        $longestAbsence[$street] = max($longestAbsence[$street], $currentAbsence[$street]);
                        $consecutive[$street] = 0;
                    }
                }
                if ($category < 12) {
                    $tableStreetCounts[$category]++;
                    $previousStreet = $category;
                } else {
                    $previousStreet = null;
                }
                $previousSpin = $spinNumber;
                $tableSpinCount++;
                $eventsReplayed++;
            }

            for ($street = 0; $street < 12; $street++) {
                $resetStreet->execute([
                    'appearances' => $appearances[$street],
                    'current_absence' => $currentAbsence[$street],
                    'longest_absence' => $longestAbsence[$street],
                    'interval_total' => $intervalTotal[$street],
                    'interval_count' => $intervalCount[$street],
                    'last_seen_spin' => $lastSeenSpin[$street],
                    'consecutive_appearances' => $consecutive[$street],
                    'session_id' => $sessionId,
                    'street' => $street,
                ]);
            }
        }

        $deleteStreetCounts = $database->prepare('DELETE FROM table_street_counts WHERE table_id = :table_id AND data_origin = :data_origin');
        $deleteStreetCounts->execute(['table_id' => $tableId, 'data_origin' => $origin]);
        $insertStreetCount = $database->prepare('INSERT INTO table_street_counts (table_id, data_origin, street, appearance_count) VALUES (:table_id, :data_origin, :street, :appearance_count)');
        for ($street = 0; $street < 12; $street++) {
            if ($tableStreetCounts[$street] > 0) {
                $insertStreetCount->execute(['table_id' => $tableId, 'data_origin' => $origin, 'street' => $street, 'appearance_count' => $tableStreetCounts[$street]]);
            }
        }
        $updateTotals = $database->prepare('INSERT INTO table_observation_totals (table_id, data_origin, spin_count, statistics_valid) VALUES (:table_id, :data_origin, :spin_count, 1) ON DUPLICATE KEY UPDATE spin_count = VALUES(spin_count), statistics_valid = 1');
        $updateTotals->execute(['table_id' => $tableId, 'data_origin' => $origin, 'spin_count' => $tableSpinCount]);

        // Model mathematics lives in the browser modules; the stored
        // checkpoint stays invalid until the client replays the effective
        // history and uploads a freshly rebuilt checkpoint.
        $modelQuery = $database->prepare('SELECT state_valid FROM table_model_states WHERE table_id = :table_id AND data_origin = :data_origin FOR UPDATE');
        $modelQuery->execute(['table_id' => $tableId, 'data_origin' => $origin]);
        $modelRow = $modelQuery->fetch();
        $modelRebuildRequired = $modelRow !== false && !(bool) $modelRow['state_valid'];

        if ($claimedRequests !== []) {
            $markCompleted = $database->prepare("UPDATE integrity_rebuild_requests SET status = 'completed' WHERE request_id = :request_id");
            foreach ($claimedRequests as $requestId) $markCompleted->execute(['request_id' => $requestId]);
        }
        $database->commit();
    } catch (Throwable $exception) {
        if ($database->inTransaction()) $database->rollBack();
        throw $exception;
    }

    bri_respond(200, [
        'rebuilt' => true,
        'already_valid' => false,
        'requests_completed' => count($claimedRequests),
        'sessions_rebuilt' => count($sessionIds),
        'events_replayed' => $eventsReplayed,
        'corrections_applied' => $correctionsApplied,
        'spin_count' => $tableSpinCount,
        'model_rebuild_required' => $modelRebuildRequired,
    ]);
});
