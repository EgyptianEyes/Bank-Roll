<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    $database = bri_database();
    $player = bri_authenticated_player($database);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';

    if ($method === 'GET') {
        $sessionId = bri_uuid($_GET['session_id'] ?? null, 'session_id');
        $afterSpin = filter_var($_GET['after_spin'] ?? '0', FILTER_VALIDATE_INT);
        $limit = filter_var($_GET['limit'] ?? '250', FILTER_VALIDATE_INT);
        if ($afterSpin === false || $afterSpin < 0) throw new InvalidArgumentException('after_spin must be a non-negative integer.');
        if ($limit === false || $limit < 1 || $limit > 500) throw new InvalidArgumentException('limit must be between 1 and 500.');

        $session = $database->prepare('SELECT session_id FROM research_sessions WHERE session_id = :session_id AND player_id = :player_id');
        $session->execute(['session_id' => $sessionId, 'player_id' => $player['player_id']]);
        if (!$session->fetch()) throw new BriHttpException(404, 'Research session not found.');

        $query = $database->prepare('SELECT decision_id, spin_number, action, model_version, snapshot_json, created_at FROM strategy_decisions WHERE session_id = :session_id AND spin_number > :after_spin ORDER BY spin_number ASC LIMIT :limit');
        $query->bindValue('session_id', $sessionId, PDO::PARAM_STR);
        $query->bindValue('after_spin', $afterSpin, PDO::PARAM_INT);
        $query->bindValue('limit', $limit, PDO::PARAM_INT);
        $query->execute();
        $decisions = array_map(static fn (array $row): array => [
            'decision_id' => $row['decision_id'],
            'spin_number' => (int) $row['spin_number'],
            'action' => $row['action'],
            'model_version' => $row['model_version'],
            'snapshot' => json_decode($row['snapshot_json'], true, 64, JSON_THROW_ON_ERROR),
            'created_at' => $row['created_at'],
        ], $query->fetchAll());
        bri_respond(200, ['decisions' => $decisions, 'has_more' => count($decisions) === $limit]);
    }

    bri_require_method('POST');
    $payload = bri_request_json();
    $decisionId = bri_uuid($payload['decision_id'] ?? null, 'decision_id');
    $sessionId = bri_uuid($payload['session_id'] ?? null, 'session_id');
    $spinNumber = $payload['spin_number'] ?? null;
    $action = $payload['action'] ?? null;
    $modelVersion = $payload['model_version'] ?? null;
    $snapshot = $payload['snapshot'] ?? null;
    if (!is_int($spinNumber) || $spinNumber < 1) throw new InvalidArgumentException('spin_number must be a positive integer.');
    if (!in_array($action, ['continue', 'switch', 'spread', 'stop', 'observe'], true)) throw new InvalidArgumentException('Unsupported strategy decision action.');
    if ($modelVersion !== null && (!is_string($modelVersion) || !preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/i', $modelVersion))) throw new InvalidArgumentException('model_version is invalid.');
    if (!is_array($snapshot) || ($snapshot['action'] ?? null) !== $action) throw new InvalidArgumentException('snapshot must be a decision object whose action matches the request.');
    $snapshotJson = json_encode($snapshot, JSON_THROW_ON_ERROR);
    if (strlen($snapshotJson) > 64000) throw new InvalidArgumentException('Decision snapshot is too large.');

    $database->beginTransaction();
    try {
        $sessionQuery = $database->prepare('SELECT next_spin_number FROM research_sessions WHERE session_id = :session_id AND player_id = :player_id FOR UPDATE');
        $sessionQuery->execute(['session_id' => $sessionId, 'player_id' => $player['player_id']]);
        $session = $sessionQuery->fetch();
        if (!$session) throw new BriHttpException(404, 'Research session not found.');
        if ((int) $session['next_spin_number'] !== $spinNumber) throw new BriHttpException(409, 'Decision is not for the next unobserved spin.');

        $existing = $database->prepare('SELECT decision_id, request_hash FROM strategy_decisions WHERE session_id = :session_id AND spin_number = :spin_number');
        $existing->execute(['session_id' => $sessionId, 'spin_number' => $spinNumber]);
        $existingDecision = $existing->fetch();
        $requestHash = hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
        if ($existingDecision) {
            if ($existingDecision['decision_id'] !== $decisionId || !hash_equals($existingDecision['request_hash'], $requestHash)) throw new BriHttpException(409, 'A different strategy decision is already recorded for this spin.');
            $database->commit();
            bri_respond(200, ['decision_id' => $decisionId, 'created' => false]);
        }

        $insert = $database->prepare('INSERT INTO strategy_decisions (decision_id, session_id, player_id, spin_number, action, model_version, snapshot_json, request_hash) VALUES (:decision_id, :session_id, :player_id, :spin_number, :action, :model_version, :snapshot_json, :request_hash)');
        $insert->execute([
            'decision_id' => $decisionId,
            'session_id' => $sessionId,
            'player_id' => $player['player_id'],
            'spin_number' => $spinNumber,
            'action' => $action,
            'model_version' => $modelVersion,
            'snapshot_json' => $snapshotJson,
            'request_hash' => $requestHash,
        ]);
        $database->commit();
    } catch (Throwable $exception) {
        if ($database->inTransaction()) $database->rollBack();
        throw $exception;
    }

    bri_respond(201, ['decision_id' => $decisionId, 'created' => true]);
});
