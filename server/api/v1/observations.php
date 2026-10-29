<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    bri_require_method('POST');
    $database = bri_database();
    $player = bri_authenticated_player($database);
    $payload = bri_request_json();
    $batch = bri_validate_observation_batch($payload);
    $modelState = array_key_exists('model_state', $payload) ? bri_validate_model_state($payload['model_state']) : null;

    $database->beginTransaction();
    try {
        $sessionQuery = $database->prepare('SELECT table_id, data_source, data_origin, share_consent, next_spin_number FROM research_sessions WHERE session_id = :session_id AND player_id = :player_id FOR UPDATE');
        $sessionQuery->execute(['session_id' => $batch['session_id'], 'player_id' => $player['player_id']]);
        $session = $sessionQuery->fetch();
        if (!$session || $session['table_id'] !== $batch['table_id']) throw new BriHttpException(404, 'Research session not found.');
        if ($session['data_origin'] === 'observed') bri_require_observed_submissions_enabled();
        if ($session['data_source'] !== $batch['source'] || $session['data_origin'] !== $batch['data_origin']) throw new BriHttpException(409, 'Observation provenance does not match the session.');
        if ((bool) $session['share_consent'] !== $batch['share_consent']) throw new BriHttpException(409, 'Research-sharing consent does not match the session record.');

        $tableTotalQuery = $database->prepare('SELECT spin_count, statistics_valid FROM table_observation_totals WHERE table_id = :table_id AND data_origin = :data_origin FOR UPDATE');
        $tableTotalQuery->execute(['table_id' => $batch['table_id'], 'data_origin' => $batch['data_origin']]);
        $tableState = $tableTotalQuery->fetch();
        if (!$tableState) throw new BriHttpException(409, 'Table observation totals are not initialized.');
        if (!(bool) $tableState['statistics_valid']) throw new BriHttpException(409, 'Table statistics require a rebuild after a correction.');
        $tableTotalBefore = (int) $tableState['spin_count'];
        $nextSpin = (int) $session['next_spin_number'];
        $insertEvent = $database->prepare('INSERT INTO spin_events (event_id, session_id, table_id, player_id, spin_number, outcome, occurred_at) VALUES (:event_id, :session_id, :table_id, :player_id, :spin_number, :outcome, :occurred_at)');
        $insertIntegrityReport = $database->prepare('INSERT INTO integrity_reports (report_id, event_id, session_id, table_id, player_id, classification, verified_error, details_json) VALUES (:report_id, :event_id, :session_id, :table_id, :player_id, :classification, 0, :details_json)');
        $updateAbsentStreets = $database->prepare('UPDATE session_street_statistics SET longest_absence = GREATEST(longest_absence, current_absence + 1), current_absence = current_absence + 1, consecutive_appearances = 0 WHERE session_id = :session_id AND street <> :winning_street');
        $updateWinningStreet = $database->prepare('UPDATE session_street_statistics SET appearances = appearances + 1, interval_total = interval_total + IF(last_seen_spin IS NULL, 0, :spin_number - last_seen_spin), interval_count = interval_count + IF(last_seen_spin IS NULL, 0, 1), consecutive_appearances = IF(last_seen_spin = :previous_spin, consecutive_appearances + 1, 1), current_absence = 0, last_seen_spin = :spin_number_again WHERE session_id = :session_id_again AND street = :street');
        $updateTotals = $database->prepare('UPDATE table_observation_totals SET spin_count = spin_count + 1 WHERE table_id = :table_id AND data_origin = :data_origin');
        $updateTableStreet = $database->prepare('INSERT INTO table_street_counts (table_id, data_origin, street, appearance_count) VALUES (:table_id, :data_origin, :street, 1) ON DUPLICATE KEY UPDATE appearance_count = appearance_count + 1');
        $findPrior = $database->prepare('SELECT event_id, outcome, table_id FROM spin_events WHERE session_id = :session_id AND spin_number = :spin_number');
        $findEventId = $database->prepare('SELECT session_id, spin_number, outcome, table_id FROM spin_events WHERE event_id = :event_id');
        $findForecast = $database->prepare('SELECT prediction_id, selected_street, probabilities_json, candidate_models_json FROM predictions WHERE session_id = :session_id AND spin_number = :spin_number FOR UPDATE');
        $insertEvaluation = $database->prepare('INSERT INTO prediction_evaluations (prediction_id, event_id, actual_outcome, selected_hit, brier_score) VALUES (:prediction_id, :event_id, :actual_outcome, :selected_hit, :brier_score)');
        $insertModelScore = $database->prepare('INSERT INTO model_score_events (prediction_id, model_version, table_id, data_origin, brier_score) VALUES (:prediction_id, :model_version, :table_id, :data_origin, :brier_score)');
        $inserted = 0;
        $replayed = 0;
        $scored = 0;

        foreach ($batch['outcomes'] as $entry) {
            if ($entry['spin_number'] < $nextSpin) {
                $findPrior->execute(['session_id' => $batch['session_id'], 'spin_number' => $entry['spin_number']]);
                $prior = $findPrior->fetch();
                if ($prior && $prior['event_id'] === $entry['event_id'] && $prior['table_id'] === $batch['table_id'] && (int) $prior['outcome'] === $entry['outcome']) {
                    $replayed++;
                    continue;
                }
                throw new BriHttpException(409, 'An earlier spin conflicts with the stored research history.');
            }
            if ($entry['spin_number'] !== $nextSpin) throw new BriHttpException(409, 'Observation batch must continue from the next expected spin.');
            $findEventId->execute(['event_id' => $entry['event_id']]);
            if ($findEventId->fetch()) throw new BriHttpException(409, 'Event identifier has already been used for another record.');

            $insertEvent->execute([
                'event_id' => $entry['event_id'],
                'session_id' => $batch['session_id'],
                'table_id' => $batch['table_id'],
                'player_id' => $player['player_id'],
                'spin_number' => $entry['spin_number'],
                'outcome' => $entry['outcome'],
                'occurred_at' => $entry['occurred_at'],
            ]);
            if ($entry['integrity_assessment'] !== null) {
                $insertIntegrityReport->execute([
                    'report_id' => bri_new_uuid(),
                    'event_id' => $entry['event_id'],
                    'session_id' => $batch['session_id'],
                    'table_id' => $batch['table_id'],
                    'player_id' => $player['player_id'],
                    'classification' => $entry['integrity_assessment']['classification'],
                    'details_json' => json_encode($entry['integrity_assessment'], JSON_THROW_ON_ERROR),
                ]);
            }
            $winningStreet = bri_outcome_category($entry['outcome']);
            $updateAbsentStreets->execute(['session_id' => $batch['session_id'], 'winning_street' => $winningStreet]);
            if ($winningStreet < 12) {
                $updateWinningStreet->execute([
                    'spin_number' => $entry['spin_number'],
                    'previous_spin' => $entry['spin_number'] - 1,
                    'spin_number_again' => $entry['spin_number'],
                    'session_id_again' => $batch['session_id'],
                    'street' => $winningStreet,
                ]);
                $updateTableStreet->execute(['table_id' => $batch['table_id'], 'data_origin' => $batch['data_origin'], 'street' => $winningStreet]);
            }
            $updateTotals->execute(['table_id' => $batch['table_id'], 'data_origin' => $batch['data_origin']]);
            $findForecast->execute(['session_id' => $batch['session_id'], 'spin_number' => $entry['spin_number']]);
            $forecast = $findForecast->fetch();
            if ($forecast) {
                $actualCategory = bri_outcome_category($entry['outcome']);
                $probabilities = json_decode($forecast['probabilities_json'], true, 32, JSON_THROW_ON_ERROR);
                $selectedHit = $entry['outcome'] !== 0 && intdiv($entry['outcome'] - 1, 3) === (int) $forecast['selected_street'];
                $brierScore = bri_brier_score($probabilities, $actualCategory);
                $insertEvaluation->execute([
                    'prediction_id' => $forecast['prediction_id'],
                    'event_id' => $entry['event_id'],
                    'actual_outcome' => $entry['outcome'],
                    'selected_hit' => $selectedHit ? 1 : 0,
                    'brier_score' => $brierScore,
                ]);

                $candidateModels = json_decode($forecast['candidate_models_json'], true, 32, JSON_THROW_ON_ERROR);
                foreach ($candidateModels as $candidate) {
                    $modelScore = bri_brier_score($candidate['probabilities'], $actualCategory);
                    $insertModelScore->execute([
                        'prediction_id' => $forecast['prediction_id'],
                        'model_version' => $candidate['model_version'],
                        'table_id' => $batch['table_id'],
                        'data_origin' => $batch['data_origin'],
                        'brier_score' => $modelScore,
                    ]);
                }
                $scored++;
            }
            $nextSpin++;
            $inserted++;
        }

        if ($inserted > 0) {
            $updateSession = $database->prepare('UPDATE research_sessions SET next_spin_number = :next_spin WHERE session_id = :session_id');
            $updateSession->execute(['next_spin' => $nextSpin, 'session_id' => $batch['session_id']]);
            if ($modelState !== null) {
                $expectedObservationCount = $tableTotalBefore + $inserted;
                if ($modelState['tracker']['totalObservations'] !== $expectedObservationCount) throw new BriHttpException(409, 'Model checkpoint does not match the committed table observation count.');
                $saveModelState = $database->prepare('INSERT INTO table_model_states (table_id, data_origin, state_version, state_json, observation_count) VALUES (:table_id, :data_origin, :state_version, :state_json, :observation_count) ON DUPLICATE KEY UPDATE state_version = VALUES(state_version), state_json = VALUES(state_json), observation_count = VALUES(observation_count)');
                $saveModelState->execute([
                    'table_id' => $batch['table_id'],
                    'data_origin' => $batch['data_origin'],
                    'state_version' => $modelState['version'],
                    'state_json' => json_encode($modelState, JSON_THROW_ON_ERROR),
                    'observation_count' => $expectedObservationCount,
                ]);
            }
        }
        $database->commit();
    } catch (Throwable $exception) {
        if ($database->inTransaction()) $database->rollBack();
        throw $exception;
    }

    bri_respond(202, ['inserted' => $inserted, 'replayed' => $replayed, 'predictions_scored' => $scored, 'next_spin_number' => $nextSpin]);
});