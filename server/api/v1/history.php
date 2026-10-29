<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    bri_require_method('GET');
    $database = bri_database();
    $player = bri_authenticated_player($database);
    $sessionId = bri_uuid($_GET['session_id'] ?? null, 'session_id');
    $afterSpin = filter_var($_GET['after_spin'] ?? '0', FILTER_VALIDATE_INT);
    $limit = filter_var($_GET['limit'] ?? '250', FILTER_VALIDATE_INT);
    if ($afterSpin === false || $afterSpin < 0) throw new InvalidArgumentException('after_spin must be a non-negative integer.');
    if ($limit === false || $limit < 1 || $limit > 500) throw new InvalidArgumentException('limit must be between 1 and 500.');

    $sessionQuery = $database->prepare('SELECT session_id, table_id, data_source, data_origin, next_spin_number FROM research_sessions WHERE session_id = :session_id AND player_id = :player_id');
    $sessionQuery->execute(['session_id' => $sessionId, 'player_id' => $player['player_id']]);
    $session = $sessionQuery->fetch();
    if (!$session) throw new BriHttpException(404, 'Research session not found.');

    $eventsQuery = $database->prepare('SELECT spin_events.event_id, spin_events.spin_number, spin_events.outcome, spin_events.occurred_at, spin_events.recorded_at, (SELECT spin_corrections.corrected_outcome FROM spin_corrections WHERE spin_corrections.event_id = spin_events.event_id ORDER BY spin_corrections.revision DESC LIMIT 1) AS corrected_outcome, (SELECT MAX(spin_corrections.revision) FROM spin_corrections WHERE spin_corrections.event_id = spin_events.event_id) AS correction_revision, EXISTS(SELECT 1 FROM prediction_evaluation_impacts WHERE prediction_evaluation_impacts.prediction_id = predictions.prediction_id) AS evaluation_affected, predictions.prediction_id, predictions.observation_count, predictions.selected_street, predictions.selected_probability, predictions.probabilities_json, predictions.candidate_models_json, predictions.model_version, predictions.parameters_json, prediction_evaluations.selected_hit, prediction_evaluations.brier_score FROM spin_events LEFT JOIN predictions ON predictions.session_id = spin_events.session_id AND predictions.spin_number = spin_events.spin_number LEFT JOIN prediction_evaluations USING (prediction_id) WHERE spin_events.session_id = :session_id AND spin_events.spin_number > :after_spin ORDER BY spin_events.spin_number ASC LIMIT :limit');
    $eventsQuery->bindValue('session_id', $sessionId, PDO::PARAM_STR);
    $eventsQuery->bindValue('after_spin', $afterSpin, PDO::PARAM_INT);
    $eventsQuery->bindValue('limit', $limit, PDO::PARAM_INT);
    $eventsQuery->execute();
    $events = array_map(static function (array $row): array {
        $prediction = $row['prediction_id'] === null ? null : [
            'prediction_id' => $row['prediction_id'],
            'observation_count' => (int) $row['observation_count'],
            'selected_street' => (int) $row['selected_street'],
            'selected_probability' => (float) $row['selected_probability'],
            'probabilities' => json_decode($row['probabilities_json'], true, 32, JSON_THROW_ON_ERROR),
            'candidate_models' => json_decode($row['candidate_models_json'], true, 32, JSON_THROW_ON_ERROR),
            'model_version' => $row['model_version'],
            'parameters' => json_decode($row['parameters_json'], true, 32, JSON_THROW_ON_ERROR),
            'hit' => $row['selected_hit'] === null ? null : (bool) $row['selected_hit'],
            'brier_score' => $row['brier_score'] === null ? null : (float) $row['brier_score'],
            'affected_by_correction' => (bool) $row['evaluation_affected'],
        ];
        return [
            'event_id' => $row['event_id'],
            'spin_number' => (int) $row['spin_number'],
            'outcome' => (int) $row['outcome'],
            'original_outcome' => (int) $row['outcome'],
            'effective_outcome' => $row['corrected_outcome'] === null ? (int) $row['outcome'] : (int) $row['corrected_outcome'],
            'correction_revision' => $row['correction_revision'] === null ? 0 : (int) $row['correction_revision'],
            'occurred_at' => $row['occurred_at'],
            'recorded_at' => $row['recorded_at'],
            'prediction' => $prediction,
        ];
    }, $eventsQuery->fetchAll());
    $lastSpin = $events ? $events[array_key_last($events)]['spin_number'] : $afterSpin;

    bri_respond(200, [
        'session' => [
            'session_id' => $session['session_id'],
            'table_id' => $session['table_id'],
            'source' => $session['data_source'],
            'data_origin' => $session['data_origin'],
            'next_spin_number' => (int) $session['next_spin_number'],
        ],
        'events' => $events,
        'next_after_spin' => $lastSpin,
        'has_more' => count($events) === $limit,
    ]);
});