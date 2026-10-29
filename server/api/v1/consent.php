<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    $database = bri_database();
    $player = bri_authenticated_player($database);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method === 'GET') {
        bri_respond(200, ['share_research' => (bool) $player['share_research']]);
    }
    bri_require_method('PUT');
    $payload = bri_request_json();
    $shareResearch = $payload['share_research'] ?? null;
    if (!is_bool($shareResearch)) throw new InvalidArgumentException('share_research must be a boolean.');

    $update = $database->prepare('UPDATE players SET share_research = :share_research WHERE player_id = :player_id');
    $update->execute(['share_research' => $shareResearch ? 1 : 0, 'player_id' => $player['player_id']]);
    bri_respond(200, ['share_research' => $shareResearch]);
});