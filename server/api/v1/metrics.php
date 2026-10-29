<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

bri_run_api(static function (): void {
    bri_require_method('GET');
    $database = bri_database();
    $player = bri_authenticated_player($database);
    $tableId = bri_uuid($_GET['table_id'] ?? null, 'table_id');
    $tableLookup = $database->prepare('SELECT table_id FROM roulette_tables WHERE table_id = :table_id AND owner_player_id = :player_id');
    $tableLookup->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
    if (!$tableLookup->fetch()) throw new BriHttpException(404, 'Table profile not found.');

    $observations = $database->prepare('SELECT data_origin, spin_count, statistics_valid FROM table_observation_totals WHERE table_id = :table_id');
    $observations->execute(['table_id' => $tableId]);
    $observationCounts = ['observed' => 0, 'synthetic' => 0];
    $statisticsValid = true;
    foreach ($observations->fetchAll() as $row){
        $observationCounts[$row['data_origin']] = (int) $row['spin_count'];
        $statisticsValid = $statisticsValid && (bool) $row['statistics_valid'];
    }
    $streetCounts = $database->prepare('SELECT data_origin, street, appearance_count FROM table_street_counts WHERE table_id = :table_id ORDER BY data_origin, street');
    $streetCounts->execute(['table_id' => $tableId]);
    $prediction = $database->prepare('SELECT COUNT(*) AS total, COUNT(CASE WHEN prediction_evaluations.prediction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prediction_evaluation_impacts WHERE prediction_evaluation_impacts.prediction_id = predictions.prediction_id) THEN 1 END) AS evaluated, SUM(CASE WHEN prediction_evaluations.prediction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prediction_evaluation_impacts WHERE prediction_evaluation_impacts.prediction_id = predictions.prediction_id) THEN prediction_evaluations.selected_hit ELSE 0 END) AS hits, AVG(CASE WHEN NOT EXISTS (SELECT 1 FROM prediction_evaluation_impacts WHERE prediction_evaluation_impacts.prediction_id = predictions.prediction_id) THEN prediction_evaluations.brier_score ELSE NULL END) AS mean_brier FROM predictions LEFT JOIN prediction_evaluations USING (prediction_id) WHERE predictions.table_id = :table_id AND predictions.player_id = :player_id');
    $prediction->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
    $modelScores = $database->prepare('SELECT model_score_events.model_version, research_sessions.data_origin, COUNT(*) AS evaluated, AVG(model_score_events.brier_score) AS mean_brier FROM model_score_events JOIN predictions USING (prediction_id) JOIN research_sessions USING (session_id) WHERE model_score_events.table_id = :table_id AND predictions.player_id = :player_id AND NOT EXISTS (SELECT 1 FROM prediction_evaluation_impacts WHERE prediction_evaluation_impacts.prediction_id = predictions.prediction_id) GROUP BY model_score_events.model_version, research_sessions.data_origin ORDER BY research_sessions.data_origin, mean_brier');
    $modelScores->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
    $correctionCount = $database->prepare('SELECT COUNT(*) FROM spin_corrections WHERE table_id = :table_id AND player_id = :player_id');
    $correctionCount->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);
    $integrityReportCount = $database->prepare('SELECT COUNT(*) FROM integrity_reports WHERE table_id = :table_id AND player_id = :player_id');
    $integrityReportCount->execute(['table_id' => $tableId, 'player_id' => $player['player_id']]);

    $predictionSummary = $prediction->fetch();
    $evaluated = (int) $predictionSummary['evaluated'];
    bri_respond(200, [
        'table_id' => $tableId,
        'statistics_valid' => $statisticsValid,
        'correction_count' => (int) $correctionCount->fetchColumn(),
        'statistical_integrity_reports' => (int) $integrityReportCount->fetchColumn(),
        'observations' => [
            'total' => $observationCounts['observed'] + $observationCounts['synthetic'],
            'observed' => $observationCounts['observed'],
            'synthetic' => $observationCounts['synthetic'],
            'street_counts' => array_map(static fn (array $row): array => [
                'data_origin' => $row['data_origin'],
                'street' => (int) $row['street'],
                'appearances' => (int) $row['appearance_count'],
            ], $streetCounts->fetchAll()),
        ],
        'predictions' => [
            'total' => (int) $predictionSummary['total'],
            'evaluated' => $evaluated,
            'hits' => (int) $predictionSummary['hits'],
            'accuracy' => $evaluated > 0 ? (int) $predictionSummary['hits'] / $evaluated : null,
            'mean_brier' => $predictionSummary['mean_brier'] === null ? null : (float) $predictionSummary['mean_brier'],
        ],
        'models' => array_map(static fn (array $row): array => [
            'model_version' => $row['model_version'],
            'data_origin' => $row['data_origin'],
            'evaluated' => (int) $row['evaluated'],
            'mean_brier' => (float) $row['mean_brier'],
        ], $modelScores->fetchAll()),
    ]);
});