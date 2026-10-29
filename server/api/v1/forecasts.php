<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    bri_require_method('POST');
    $database = bri_database();
    $player = bri_authenticated_player($database);
    $payload = bri_request_json();
    $predictionId = bri_uuid($payload['prediction_id'] ?? null, 'prediction_id');
    $sessionId = bri_uuid($payload['session_id'] ?? null, 'session_id');
    $spinNumber = $payload['spin_number'] ?? null;
    $observations = $payload['observation_count'] ?? null;
    $selectedStreet = $payload['selected_street'] ?? null;
    $modelVersion = $payload['model_version'] ?? null;
    if (!is_int($spinNumber) || $spinNumber < 1 || !is_int($observations) || $observations < 10) throw new InvalidArgumentException('Forecast requires at least ten prior observations and a valid session spin number.');
    if (!is_int($selectedStreet) || $selectedStreet < 0 || $selectedStreet > 11) throw new InvalidArgumentException('selected_street must be between 0 and 11.');
    if (!is_string($modelVersion) || !preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/i', $modelVersion)) throw new InvalidArgumentException('model_version is invalid.');

    $probabilities = bri_validate_probabilities($payload['probabilities'] ?? null);
    $selectedProbability = $probabilities[$selectedStreet];
    $candidateModels = $payload['candidate_models'] ?? null;
    if (!is_array($candidateModels) || count($candidateModels) < 1 || count($candidateModels) > 8) throw new InvalidArgumentException('candidate_models must contain 1 to 8 model forecasts.');
    $validatedModels = [];
    foreach ($candidateModels as $candidate) {
        if (!is_array($candidate) || !is_string($candidate['model_version'] ?? null) || !preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/i', $candidate['model_version'])) throw new InvalidArgumentException('Candidate model identifier is invalid.');
        $validatedModels[] = ['model_version' => $candidate['model_version'], 'probabilities' => bri_validate_probabilities($candidate['probabilities'] ?? null)];
    }
    $selectedModel = null;
    foreach ($validatedModels as $candidate) {
        if ($candidate['model_version'] === $modelVersion) $selectedModel = $candidate;
    }
    if ($selectedModel === null || $selectedModel['probabilities'] !== $probabilities) throw new InvalidArgumentException('Selected model forecast must match its recorded candidate distribution.');
    $parameters = $payload['parameters'] ?? new stdClass();
    if (!is_array($parameters) && !$parameters instanceof stdClass) throw new InvalidArgumentException('parameters must be an object.');
    $parametersJson = json_encode($parameters, JSON_THROW_ON_ERROR);
    if (strlen($parametersJson) > 16000) throw new InvalidArgumentException('parameters is too large.');

    $database->beginTransaction();
    try {
        $sessionLookup = $database->prepare('SELECT table_id, data_origin, next_spin_number FROM research_sessions WHERE session_id = :session_id AND player_id = :player_id FOR UPDATE');
        $sessionLookup->execute(['session_id' => $sessionId, 'player_id' => $player['player_id']]);
        $session = $sessionLookup->fetch();
        if (!$session) throw new BriHttpException(404, 'Research session not found.');
        if ((int) $session['next_spin_number'] !== $spinNumber) throw new BriHttpException(409, 'Forecast is not for the next unobserved spin.');
        $tableCount = $database->prepare('SELECT spin_count, statistics_valid FROM table_observation_totals WHERE table_id = :table_id AND data_origin = :data_origin FOR UPDATE');
        $tableCount->execute(['table_id' => $session['table_id'], 'data_origin' => $session['data_origin']]);
        $tableState = $tableCount->fetch();
        if (!$tableState || !(bool) $tableState['statistics_valid']) throw new BriHttpException(409, 'Table statistics require a rebuild after a correction.');
        if ((int) $tableState['spin_count'] !== $observations) throw new BriHttpException(409, 'Forecast observation count does not match the stored table memory.');

        $existing = $database->prepare('SELECT prediction_id, request_hash FROM predictions WHERE session_id = :session_id AND spin_number = :spin_number');
        $existing->execute(['session_id' => $sessionId, 'spin_number' => $spinNumber]);
        $existingForecast = $existing->fetch();
        $requestHash = hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
        if ($existingForecast) {
            if ($existingForecast['prediction_id'] !== $predictionId || !hash_equals($existingForecast['request_hash'], $requestHash)) throw new BriHttpException(409, 'A different forecast is already recorded for this spin.');
            $database->commit();
            bri_respond(200, ['prediction_id' => $predictionId, 'created' => false]);
        }

        $statement = $database->prepare('INSERT INTO predictions (prediction_id, session_id, table_id, player_id, spin_number, observation_count, selected_street, selected_probability, probabilities_json, candidate_models_json, model_version, parameters_json, request_hash) VALUES (:prediction_id, :session_id, :table_id, :player_id, :spin_number, :observation_count, :selected_street, :selected_probability, :probabilities_json, :candidate_models_json, :model_version, :parameters_json, :request_hash)');
        $statement->execute([
            'prediction_id' => $predictionId,
            'session_id' => $sessionId,
            'table_id' => $session['table_id'],
            'player_id' => $player['player_id'],
            'spin_number' => $spinNumber,
            'observation_count' => $observations,
            'selected_street' => $selectedStreet,
            'selected_probability' => $selectedProbability,
            'probabilities_json' => json_encode($probabilities, JSON_THROW_ON_ERROR),
            'candidate_models_json' => json_encode($validatedModels, JSON_THROW_ON_ERROR),
            'model_version' => $modelVersion,
            'parameters_json' => $parametersJson,
            'request_hash' => $requestHash,
        ]);
        $database->commit();
    } catch (Throwable $exception) {
        if ($database->inTransaction()) $database->rollBack();
        throw $exception;
    }

    bri_respond(201, ['prediction_id' => $predictionId, 'created' => true]);
});