<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    bri_require_method('POST');
    $registrationKey = bri_setting('BANKROLL_REGISTRATION_KEY');
    $providedKey = $_SERVER['HTTP_X_BANKROLL_REGISTRATION_KEY'] ?? '';
    if (!$registrationKey || !is_string($providedKey) || !hash_equals($registrationKey, $providedKey)) {
        throw new BriHttpException(403, 'Player registration is unavailable.');
    }

    $payload = bri_request_json();
    $displayName = trim((string) ($payload['display_name'] ?? ''));
    if ($displayName === '' || strlen($displayName) > 80) {
        throw new InvalidArgumentException('display_name must contain 1 to 80 characters.');
    }
    $shareResearch = $payload['share_research'] ?? false;
    if (!is_bool($shareResearch)) {
        throw new InvalidArgumentException('share_research must be a boolean.');
    }

    $playerId = bri_new_uuid();
    $token = 'brp_' . bin2hex(random_bytes(32));
    $database = bri_database();
    $statement = $database->prepare('INSERT INTO players (player_id, display_name, token_hash, share_research) VALUES (:player_id, :display_name, :token_hash, :share_research)');
    $statement->execute([
        'player_id' => $playerId,
        'display_name' => $displayName,
        'token_hash' => hash('sha256', $token),
        'share_research' => $shareResearch ? 1 : 0,
    ]);

    bri_respond(201, ['player_id' => $playerId, 'token' => $token, 'share_research' => $shareResearch]);
});