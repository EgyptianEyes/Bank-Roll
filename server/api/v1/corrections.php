<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    $database = bri_database();
    $player = bri_authenticated_player($database);
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        $eventId = bri_uuid($_GET['event_id'] ?? null, 'event_id');
        $event = $database->prepare('SELECT event_id, outcome, session_id, table_id FROM spin_events WHERE event_id = :event_id AND player_id = :player_id');
        $event->execute(['event_id' => $eventId, 'player_id' => $player['player_id']]);
        $original = $event->fetch();
        if (!$original) throw new BriHttpException(404, 'Recorded event not found.');
        $corrections = $database->prepare('SELECT correction_id, revision, previous_outcome, corrected_outcome, reason, corrected_at FROM spin_corrections WHERE event_id = :event_id ORDER BY revision ASC');
        $corrections->execute(['event_id' => $eventId]);
        $correctionRows = $corrections->fetchAll();
        $impacts = $database->prepare('SELECT prediction_evaluation_impacts.correction_id, prediction_evaluation_impacts.prediction_id, prediction_evaluation_impacts.prior_hit, prediction_evaluation_impacts.prior_brier_score, prediction_evaluation_impacts.corrected_hit, prediction_evaluation_impacts.corrected_brier_score FROM prediction_evaluation_impacts JOIN spin_corrections USING (correction_id) WHERE spin_corrections.event_id = :event_id ORDER BY spin_corrections.revision ASC');
        $impacts->execute(['event_id' => $eventId]);
        $lastCorrection = $correctionRows ? $correctionRows[array_key_last($correctionRows)] : null;
        bri_respond(200, [
            'event' => [
                'event_id' => $eventId,
                'original_outcome' => (int) $original['outcome'],
                'current_outcome' => $lastCorrection ? (int) $lastCorrection['corrected_outcome'] : (int) $original['outcome'],
                'session_id' => $original['session_id'],
                'table_id' => $original['table_id'],
            ],
            'corrections' => array_map(static fn (array $row): array => ['correction_id' => $row['correction_id'], 'revision' => (int) $row['revision'], 'previous_outcome' => (int) $row['previous_outcome'], 'corrected_outcome' => (int) $row['corrected_outcome'], 'reason' => $row['reason'], 'corrected_at' => $row['corrected_at']], $correctionRows),
            'prediction_impacts' => array_map(static fn (array $row): array => ['correction_id' => $row['correction_id'], 'prediction_id' => $row['prediction_id'], 'prior_hit' => (bool) $row['prior_hit'], 'prior_brier_score' => (float) $row['prior_brier_score'], 'corrected_hit' => (bool) $row['corrected_hit'], 'corrected_brier_score' => (float) $row['corrected_brier_score']], $impacts->fetchAll()),
        ]);
    }
    bri_require_method('POST');
    $payload = bri_request_json();
    $correctionId = bri_uuid($payload['correction_id'] ?? null, 'correction_id');
    $eventId = bri_uuid($payload['event_id'] ?? null, 'event_id');
    $sessionId = bri_uuid($payload['session_id'] ?? null, 'session_id');
    $expectedOutcome = $payload['expected_current_outcome'] ?? null;
    $correctedOutcome = $payload['corrected_outcome'] ?? null;
    $reason = trim((string) ($payload['reason'] ?? ''));
    if (!is_int($expectedOutcome) || $expectedOutcome < 0 || $expectedOutcome > 36) throw new InvalidArgumentException('expected_current_outcome must be an integer from 0 to 36.');
    if (!is_int($correctedOutcome) || $correctedOutcome < 0 || $correctedOutcome > 36) throw new InvalidArgumentException('corrected_outcome must be an integer from 0 to 36.');
    if ($expectedOutcome === $correctedOutcome) throw new InvalidArgumentException('Correction must change the recorded outcome.');
    if (strlen($reason) > 300) throw new InvalidArgumentException('reason must be 300 characters or fewer.');
    $requestHash = hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));

    $database->beginTransaction();
    try {
        $existingCorrection = $database->prepare('SELECT request_hash, revision, corrected_outcome FROM spin_corrections WHERE correction_id = :correction_id');
        $existingCorrection->execute(['correction_id' => $correctionId]);
        $existing = $existingCorrection->fetch();
        if ($existing) {
            if (!hash_equals($existing['request_hash'], $requestHash)) throw new BriHttpException(409, 'Correction identifier conflicts with a previous audit record.');
            $database->commit();
            bri_respond(200, ['correction_id' => $correctionId, 'revision' => (int) $existing['revision'], 'corrected_outcome' => (int) $existing['corrected_outcome'], 'replayed' => true]);
        }

        $eventQuery = $database->prepare('SELECT spin_events.outcome, spin_events.table_id, research_sessions.data_origin FROM spin_events JOIN research_sessions USING (session_id) WHERE spin_events.event_id = :event_id AND spin_events.session_id = :session_id AND spin_events.player_id = :player_id FOR UPDATE');
        $eventQuery->execute(['event_id' => $eventId, 'session_id' => $sessionId, 'player_id' => $player['player_id']]);
        $event = $eventQuery->fetch();
        if (!$event) throw new BriHttpException(404, 'Recorded event not found.');

        $latestCorrection = $database->prepare('SELECT revision, corrected_outcome FROM spin_corrections WHERE event_id = :event_id ORDER BY revision DESC LIMIT 1 FOR UPDATE');
        $latestCorrection->execute(['event_id' => $eventId]);
        $latest = $latestCorrection->fetch();
        $currentOutcome = $latest ? (int) $latest['corrected_outcome'] : (int) $event['outcome'];
        $revision = $latest ? (int) $latest['revision'] + 1 : 1;
        if ($expectedOutcome !== $currentOutcome) throw new BriHttpException(409, 'Recorded value changed; refresh the correction history before retrying.');

        $insertCorrection = $database->prepare('INSERT INTO spin_corrections (correction_id, event_id, session_id, table_id, player_id, revision, previous_outcome, corrected_outcome, reason, request_hash) VALUES (:correction_id, :event_id, :session_id, :table_id, :player_id, :revision, :previous_outcome, :corrected_outcome, :reason, :request_hash)');
        $insertCorrection->execute([
            'correction_id' => $correctionId,
            'event_id' => $eventId,
            'session_id' => $sessionId,
            'table_id' => $event['table_id'],
            'player_id' => $player['player_id'],
            'revision' => $revision,
            'previous_outcome' => $currentOutcome,
            'corrected_outcome' => $correctedOutcome,
            'reason' => $reason === '' ? null : $reason,
            'request_hash' => $requestHash,
        ]);

        $evaluationQuery = $database->prepare('SELECT predictions.prediction_id, predictions.selected_street, predictions.probabilities_json, prediction_evaluations.selected_hit, prediction_evaluations.brier_score FROM prediction_evaluations JOIN predictions USING (prediction_id) WHERE prediction_evaluations.event_id = :event_id');
        $evaluationQuery->execute(['event_id' => $eventId]);
        $evaluation = $evaluationQuery->fetch();
        if ($evaluation) {
            // Successive corrections must be measured against the immediately
            // preceding effective revision, not always the original evaluation.
            $priorImpactQuery = $database->prepare('SELECT prediction_evaluation_impacts.corrected_hit, prediction_evaluation_impacts.corrected_brier_score FROM prediction_evaluation_impacts JOIN spin_corrections USING (correction_id) WHERE spin_corrections.event_id = :event_id ORDER BY spin_corrections.revision DESC LIMIT 1');
            $priorImpactQuery->execute(['event_id' => $eventId]);
            $priorImpact = $priorImpactQuery->fetch();
            $priorHit = $priorImpact ? (int) $priorImpact['corrected_hit'] : (int) $evaluation['selected_hit'];
            $priorBrier = $priorImpact ? (float) $priorImpact['corrected_brier_score'] : (float) $evaluation['brier_score'];
            $probabilities = json_decode($evaluation['probabilities_json'], true, 32, JSON_THROW_ON_ERROR);
            $correctedCategory = bri_outcome_category($correctedOutcome);
            $correctedHit = $correctedOutcome !== 0 && intdiv($correctedOutcome - 1, 3) === (int) $evaluation['selected_street'];
            $insertImpact = $database->prepare('INSERT INTO prediction_evaluation_impacts (correction_id, prediction_id, prior_hit, prior_brier_score, corrected_hit, corrected_brier_score) VALUES (:correction_id, :prediction_id, :prior_hit, :prior_brier_score, :corrected_hit, :corrected_brier_score)');
            $insertImpact->execute([
                'correction_id' => $correctionId,
                'prediction_id' => $evaluation['prediction_id'],
                'prior_hit' => $priorHit,
                'prior_brier_score' => $priorBrier,
                'corrected_hit' => $correctedHit ? 1 : 0,
                'corrected_brier_score' => bri_brier_score($probabilities, $correctedCategory),
            ]);
        }

        $invalidateTotals = $database->prepare('UPDATE table_observation_totals SET statistics_valid = 0 WHERE table_id = :table_id AND data_origin = :data_origin');
        $invalidateTotals->execute(['table_id' => $event['table_id'], 'data_origin' => $event['data_origin']]);
        $invalidateModel = $database->prepare('UPDATE table_model_states SET state_valid = 0 WHERE table_id = :table_id AND data_origin = :data_origin');
        $invalidateModel->execute(['table_id' => $event['table_id'], 'data_origin' => $event['data_origin']]);
        $queueRebuild = $database->prepare('INSERT INTO integrity_rebuild_requests (request_id, table_id, data_origin, player_id, triggering_correction_id) VALUES (:request_id, :table_id, :data_origin, :player_id, :correction_id)');
        $queueRebuild->execute([
            'request_id' => bri_new_uuid(),
            'table_id' => $event['table_id'],
            'data_origin' => $event['data_origin'],
            'player_id' => $player['player_id'],
            'correction_id' => $correctionId,
        ]);
        $database->commit();
    } catch (Throwable $exception) {
        if ($database->inTransaction()) $database->rollBack();
        throw $exception;
    }

    bri_respond(201, ['correction_id' => $correctionId, 'revision' => $revision, 'previous_outcome' => $currentOutcome, 'corrected_outcome' => $correctedOutcome, 'rebuild_required' => true]);
});