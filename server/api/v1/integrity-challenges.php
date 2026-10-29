<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    $database = bri_database();
    $player = bri_authenticated_player($database);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method === 'GET') {
        $limit = filter_var($_GET['limit'] ?? '20', FILTER_VALIDATE_INT);
        if ($limit === false || $limit < 1 || $limit > 100) throw new InvalidArgumentException('limit must be between 1 and 100.');
        $statement = $database->prepare('SELECT run_id, benchmark_name, benchmark_version, random_seed, source, verified, metrics_json, cases_json, created_at FROM integrity_benchmark_runs WHERE player_id = :player_id ORDER BY created_at DESC LIMIT :limit');
        $statement->bindValue('player_id', $player['player_id'], PDO::PARAM_STR);
        $statement->bindValue('limit', $limit, PDO::PARAM_INT);
        $statement->execute();
        $runs = array_map(static fn (array $row): array => [
            'run_id' => $row['run_id'],
            'benchmark_name' => $row['benchmark_name'],
            'benchmark_version' => $row['benchmark_version'],
            'seed' => $row['random_seed'],
            'source' => $row['source'],
            'verified' => (bool) $row['verified'],
            'metrics' => json_decode($row['metrics_json'], true, 32, JSON_THROW_ON_ERROR),
            'cases' => json_decode($row['cases_json'], true, 32, JSON_THROW_ON_ERROR),
            'created_at' => $row['created_at'],
        ], $statement->fetchAll());
        bri_respond(200, ['runs' => $runs]);
    }
    bri_require_method('POST');
    $report = bri_validate_challenge_report(bri_request_json());
    $statement = $database->prepare('INSERT INTO integrity_benchmark_runs (run_id, player_id, benchmark_name, benchmark_version, random_seed, metrics_json, cases_json) VALUES (:run_id, :player_id, :benchmark_name, :benchmark_version, :random_seed, :metrics_json, :cases_json)');
    try {
        $statement->execute([
            'run_id' => $report['run_id'],
            'player_id' => $player['player_id'],
            'benchmark_name' => $report['benchmark_name'],
            'benchmark_version' => $report['benchmark_version'],
            'random_seed' => $report['seed'],
            'metrics_json' => json_encode(['metrics' => $report['metrics'], 'controls' => $report['controls']], JSON_THROW_ON_ERROR),
            'cases_json' => json_encode($report['cases'], JSON_THROW_ON_ERROR),
        ]);
    } catch (PDOException $exception) {
        if ($exception->getCode() === '23000') throw new BriHttpException(409, 'This benchmark run has already been recorded.');
        throw $exception;
    }

    bri_respond(201, ['run_id' => $report['run_id'], 'verified' => false]);
});