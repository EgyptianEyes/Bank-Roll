<?php
declare(strict_types=1);

require_once __DIR__ . '/../../private/bootstrap.php';

/**
 * Consent-based collective intelligence.
 *
 * Returns cross-player aggregate street counts for one explicit shared cohort,
 * built exclusively from sessions whose players enabled research sharing AND
 * whose sessions recorded explicit share consent. Only observed (non-synthetic)
 * data is pooled, corrections are applied, and no per-player or per-table detail
 * is exposed.
 * Access requires the requesting player to share research too (reciprocity).
 */
bri_run_api(static function (): void {
    bri_require_method('GET');
    $database = bri_database();
    $player = bri_authenticated_player($database);
    if (!(bool) $player['share_research']) {
        throw new BriHttpException(403, 'Enable research sharing to access the shared aggregates.');
    }
    $cohortId = bri_uuid($_GET['cohort_id'] ?? null, 'cohort_id');
    $membership = $database->prepare('SELECT table_type FROM roulette_tables WHERE shared_cohort_id = :cohort_id AND owner_player_id = :player_id');
    $membership->execute(['cohort_id' => $cohortId, 'player_id' => $player['player_id']]);
    $memberTable = $membership->fetch();
    if (!$memberTable) throw new BriHttpException(404, 'Shared table cohort not found.');

    $aggregateQuery = $database->prepare("SELECT COALESCE((SELECT spin_corrections.corrected_outcome FROM spin_corrections WHERE spin_corrections.event_id = spin_events.event_id ORDER BY spin_corrections.revision DESC LIMIT 1), spin_events.outcome) AS effective_outcome, COUNT(*) AS appearances FROM spin_events JOIN research_sessions USING (session_id) JOIN roulette_tables ON roulette_tables.table_id = spin_events.table_id JOIN players ON players.player_id = spin_events.player_id WHERE roulette_tables.shared_cohort_id = :cohort_id AND roulette_tables.table_type = :table_type AND research_sessions.share_consent = 1 AND players.share_research = 1 AND players.revoked_at IS NULL AND research_sessions.data_origin = 'observed' GROUP BY effective_outcome");
    $aggregateQuery->execute(['cohort_id' => $cohortId, 'table_type' => $memberTable['table_type']]);
    $streetCounts = array_fill(0, 12, 0);
    $zeroCount = 0;
    $total = 0;
    foreach ($aggregateQuery->fetchAll() as $row) {
        $outcome = (int) $row['effective_outcome'];
        $appearances = (int) $row['appearances'];
        $total += $appearances;
        $category = bri_outcome_category($outcome);
        if ($category === 12) {
            $zeroCount += $appearances;
        } else {
            $streetCounts[$category] += $appearances;
        }
    }

    $contributorQuery = $database->prepare("SELECT COUNT(DISTINCT spin_events.player_id) AS players, COUNT(DISTINCT spin_events.table_id) AS tables FROM spin_events JOIN research_sessions USING (session_id) JOIN roulette_tables ON roulette_tables.table_id = spin_events.table_id JOIN players ON players.player_id = spin_events.player_id WHERE roulette_tables.shared_cohort_id = :cohort_id AND roulette_tables.table_type = :table_type AND research_sessions.share_consent = 1 AND players.share_research = 1 AND players.revoked_at IS NULL AND research_sessions.data_origin = 'observed'");
    $contributorQuery->execute(['cohort_id' => $cohortId, 'table_type' => $memberTable['table_type']]);
    $contributors = $contributorQuery->fetch();

    bri_respond(200, [
        'data_origin' => 'observed',
        'shared_cohort_id' => $cohortId,
        'table_type' => $memberTable['table_type'],
        'total_observations' => $total,
        'zero_count' => $zeroCount,
        'street_counts' => $streetCounts,
        'contributing_players' => (int) $contributors['players'],
        'contributing_tables' => (int) $contributors['tables'],
        'note' => 'Aggregated only for this explicitly identified shared cohort and table type from explicitly consented observed sessions; corrections applied; no per-player or per-table detail is shared.',
    ]);
});
