#!/usr/bin/env node
/**
 * Friction analysis pipeline - analyze sessions and extract antigens.
 *
 * Usage:
 *     node friction.js <sessions-directory>
 *     node friction.js ~/.claude/projects/-home-hamr-PycharmProjects-liteagents/
 *
 * Outputs (all in .factory/friction/):
 *     friction_analysis.json   - Per-session analysis
 *     friction_summary.json    - Aggregate stats
 *     friction_raw.jsonl       - Raw signals
 *     antigen_candidates.json  - Raw antigen candidates
 *     antigen_clusters.json    - Clustered antigen patterns
 *     antigen_review.md        - Clustered review file
 */

'use strict';

const fs = require('fs');
const path = require('path');

// =============================================================================
// EMBEDDED CONFIG (from friction_config.json)
// =============================================================================

const CONFIG = {
  weights: {
    exit_error: 1,
    exit_success: 0,
    user_curse: 5,
    user_negation: 0.5,
    user_intervention: 10,
    tool_loop: 6,
    false_success: 8,
    request_interrupted: 2.5,
    long_silence: 0.5,
    repeated_question: 1,
    compaction: 0.5,
    interrupt_cascade: 5,
    rapid_exit: 6,
    no_resolution: 8,
    session_abandoned: 10,
    sibling_tool_error: 0.5,
  },
  thresholds: {
    friction_peak: 15,
    intervention_predictability: 0.50,
    signal_noise_ratio: 1.5,
    long_silence_minutes: 10,
  },
  notes: {
    model: 'Threshold monitor - friction accumulates, no subtraction',
    exit_error: 'Single error = noise (+1)',
    exit_success: 'Zero weight - tracked as momentum only',
    user_intervention: 'Gold signal - user gave up (/stash)',
    user_curse: 'Reliable frustration indicator',
    false_success: 'Trust violation - LLM claimed success but failed',
    tool_loop: 'Agent stuck - same tool 3x',
    user_negation: 'Low weight - still noisy after filtering',
    request_interrupted: 'User hit Ctrl+C / Escape - impatience signal',
    long_silence: 'User walked away >10 min - disengagement',
    repeated_question: 'User asked same thing twice - confusion/frustration',
    compaction: 'Context overflow - memory loss indicator',
    interrupt_cascade: 'Multiple ESC/Ctrl+C within 60s - escalating frustration',
    rapid_exit: 'Quick quit (<3 turns) after error - immediate rejection',
    no_resolution: 'Errors without success - unresolved session',
    session_abandoned: 'High friction at end, no clean exit - gave up silently',
    sibling_tool_error: 'SDK cascade - parallel tool batch canceled when one fails',
  },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function loadConfig() {
  return CONFIG;
}

function parseISODate(s) {
  if (!s) return null;
  try {
    return new Date(s.replace('Z', '+00:00'));
  } catch {
    return null;
  }
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h${mins}m` : `${hours}h`;
}

/**
 * Glob-like file listing. Returns files matching a pattern in a directory.
 * Supports simple *.ext matching and recursive **\/*.ext matching.
 */
function globFiles(dir, pattern, recursive) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const ext = pattern.replace('*', '');
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(fullPath);
    } else if (recursive && entry.isDirectory()) {
      results.push(...globFiles(fullPath, pattern, true));
    }
  }
  return results;
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(dir, e.name));
}

// =============================================================================
// FRICTION ANALYZE - derive_session_name
// =============================================================================

function deriveSessionName(sessionFile, metadata) {
  const parent = path.basename(path.dirname(sessionFile));

  let project;
  if (parent.startsWith('-')) {
    const prefixes = [
      '-home-hamr-PycharmProjects-',
      '-home-hamr-Documents-PycharmProjects-',
      '-home-hamr-',
      '-home-',
      '-',
    ];
    let found = false;
    for (const prefix of prefixes) {
      if (parent.startsWith(prefix)) {
        project = parent.slice(prefix.length);
        found = true;
        break;
      }
    }
    if (!found) {
      project = parent.slice(1);
    }
  } else {
    project = parent;
  }

  let dateStr = '';
  if (metadata.started_at) {
    try {
      const dt = new Date(metadata.started_at.replace('Z', '+00:00'));
      if (!isNaN(dt.getTime())) {
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        const hh = String(dt.getHours()).padStart(2, '0');
        const mi = String(dt.getMinutes()).padStart(2, '0');
        dateStr = `${mm}${dd}-${hh}${mi}`;
      }
    } catch {
      // pass
    }
  }

  if (!dateStr) {
    try {
      const stat = fs.statSync(sessionFile);
      const mtime = stat.mtime;
      const mm = String(mtime.getMonth() + 1).padStart(2, '0');
      const dd = String(mtime.getDate()).padStart(2, '0');
      const hh = String(mtime.getHours()).padStart(2, '0');
      const mi = String(mtime.getMinutes()).padStart(2, '0');
      dateStr = `${mm}${dd}-${hh}${mi}`;
    } catch {
      dateStr = 'unknown';
    }
  }

  const shortId = path.basename(sessionFile, '.jsonl').slice(0, 8);
  return `${project}/${dateStr}-${shortId}`;
}

// =============================================================================
// FRICTION ANALYZE - extractToolNameFromResult
// =============================================================================

function extractToolNameFromResult(result) {
  const match = result.match(/●\s+(\w+)\(/);
  return match ? match[1] : 'unknown';
}

// =============================================================================
// FRICTION ANALYZE - extract_signals
// =============================================================================

function extractSignals(sessionFile) {
  const signals = [];
  let llmClaimedSuccess = false;
  const toolHistory = [];
  const metadata = {};

  const raw = fs.readFileSync(sessionFile, 'utf-8');
  const events = raw.split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  let turnCount = 0;
  const userMessages = [];
  let prevUserTs = null;

  for (const event of events) {
    if ('gitBranch' in event) metadata.git_branch = event.gitBranch;
    if ('cwd' in event) metadata.cwd = event.cwd;
    if ('timestamp' in event) {
      if (!('started_at' in metadata)) metadata.started_at = event.timestamp;
      metadata.ended_at = event.timestamp;
    }

    if (event.type === 'user') {
      const content = (event.message || {}).content;
      const ts = event.timestamp || '';

      if (typeof content === 'string') {
        turnCount++;
        const msgKey = content.slice(0, 100).toLowerCase().trim();
        userMessages.push([ts, msgKey]);

        if (prevUserTs && ts) {
          try {
            const t1 = new Date(prevUserTs.replace('Z', '+00:00'));
            const t2 = new Date(ts.replace('Z', '+00:00'));
            const gapMin = (t2 - t1) / 60000;
            if (gapMin > 10) {
              signals.push({
                ts,
                source: 'user',
                signal: 'long_silence',
                details: `${Math.round(gapMin)} min gap`,
                gap_minutes: gapMin,
              });
            }
          } catch {
            // pass
          }
        }
        prevUserTs = ts;
      }
    }

    // Check for compaction/summary events
    if (event.type === 'summary') {
      const summaryText = event.summary || '';
      if (summaryText && !summaryText.toLowerCase().includes('exited')) {
        const ts = event.timestamp || metadata.ended_at || '';
        signals.push({
          ts,
          source: 'system',
          signal: 'compaction',
          details: summaryText.slice(0, 50),
        });
      }
    }
  }

  metadata.turn_count = turnCount;
  const isInteractive = turnCount > 1;

  // Detect repeated questions
  const seenMessages = {};
  for (const [ts, msgKey] of userMessages) {
    if (msgKey in seenMessages && msgKey.length > 20) {
      signals.push({
        ts,
        source: 'user',
        signal: 'repeated_question',
        details: msgKey.slice(0, 50),
      });
    }
    seenMessages[msgKey] = ts;
  }

  // Extract signals from events
  for (const event of events) {
    const ts = event.timestamp || '';

    let content = null;
    if (event.type === 'user') {
      content = (event.message || {}).content;
    } else if (event.type === 'progress') {
      const data = event.data || {};
      const message = data.message || {};
      if (message.type === 'user') {
        content = (message.message || {}).content;
      }
    }

    if (content !== null && content !== undefined) {
      // Handle list of content blocks
      if (Array.isArray(content)) {
        let foundText = false;
        for (const block of content) {
          if (typeof block === 'object' && block !== null && block.type === 'tool_result') {
            const result = String(block.content || '');

            if (/Exit code 137|Request interrupted|interrupted by user/i.test(result)) {
              signals.push({
                ts,
                source: 'user',
                signal: 'request_interrupted',
                details: result.slice(0, 100),
              });
            } else if (/<tool_use_error>Sibling tool call errored<\/tool_use_error>/i.test(result)) {
              signals.push({
                ts,
                source: 'system',
                signal: 'sibling_tool_error',
                details: result.slice(0, 100),
                tool_name: extractToolNameFromResult(result),
              });
            } else if (
              (/Exit code [1-9]/.test(result) && !result.includes('Exit code 137')) ||
              /Traceback \(most recent|CalledProcessError/.test(result)
            ) {
              signals.push({
                ts,
                source: 'tool',
                signal: 'exit_error',
                details: result.slice(0, 100),
              });

              if (llmClaimedSuccess) {
                signals.push({
                  ts,
                  source: 'llm',
                  signal: 'false_success',
                  details: 'LLM claimed success but tool failed',
                });
              }
              llmClaimedSuccess = false;
            } else if (/Exit code 0/.test(result)) {
              signals.push({
                ts,
                source: 'tool',
                signal: 'exit_success',
                details: '',
              });
              llmClaimedSuccess = false;
            }
          } else if (typeof block === 'object' && block !== null && block.type === 'text') {
            const text = block.text || '';
            if (text) {
              content = text; // Fall through to user message handling below
              foundText = true;
              break;
            }
          }
        }
        if (!foundText) {
          content = null;
        }
      }

      // Handle single dict tool_result (legacy format)
      if (typeof content === 'object' && content !== null && !Array.isArray(content) && content.type === 'tool_result') {
        const result = String(content.content || '');

        if (/Exit code [1-9]|Traceback \(most recent|CalledProcessError/.test(result)) {
          signals.push({
            ts,
            source: 'tool',
            signal: 'exit_error',
            details: result.slice(0, 100),
          });

          if (llmClaimedSuccess) {
            signals.push({
              ts,
              source: 'llm',
              signal: 'false_success',
              details: 'LLM claimed success but tool failed',
            });
          }
        } else if (/Exit code 0/.test(result)) {
          signals.push({
            ts,
            source: 'tool',
            signal: 'exit_success',
            details: '',
          });
        }

        llmClaimedSuccess = false;
      }

      // User messages (GOLD)
      if (typeof content === 'string') {
        if (content.toLowerCase().includes('/stash')) {
          signals.push({
            ts,
            source: 'user',
            signal: 'user_intervention',
            details: 'stash',
          });
        }

        if (/Request interrupted|interrupted by user/i.test(content)) {
          signals.push({
            ts,
            source: 'user',
            signal: 'request_interrupted',
            details: content.slice(0, 100),
          });
        }

        if (/\b(fuck|shit|damn)\b/i.test(content)) {
          signals.push({
            ts,
            source: 'user',
            signal: 'user_curse',
            details: content.slice(0, 50),
          });
        }

        if (isInteractive && /\b(no|didn't work|still broken)\b/i.test(content)) {
          signals.push({
            ts,
            source: 'user',
            signal: 'user_negation',
            details: content.slice(0, 50),
          });
        }
      }
    }

    // Assistant messages (LLM patterns)
    if (event.type === 'assistant') {
      const assistantContent = (event.message || {}).content || [];

      if (Array.isArray(assistantContent)) {
        // Success claims
        const text = assistantContent
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join(' ');
        if (/\b(done|complete|success|✅)\b/i.test(text)) {
          llmClaimedSuccess = true;
        }

        // Tool loops
        for (const block of assistantContent) {
          if (block.type === 'tool_use') {
            const toolName = block.name;
            const sig = JSON.stringify([toolName, JSON.stringify(block.input || {})]);
            toolHistory.push(sig);

            let count = 0;
            for (const h of toolHistory) {
              if (h === sig) count++;
            }
            if (count >= 3) {
              signals.push({
                ts,
                source: 'llm',
                signal: 'tool_loop',
                details: `${toolName} called ${count}x`,
                tool: toolName,
                loop_count: count,
              });
            }
          }
        }
      }
    }
  }

  // === POST-PROCESSING SIGNALS (session-level analysis) ===

  // 0. Deduplicate sibling_tool_error batches
  const deduplicatedSignals = [];
  let siblingBatchStart = null;
  let siblingBatchCount = 0;
  let siblingBatchTools = [];

  for (const sig of signals) {
    if (sig.signal === 'sibling_tool_error') {
      const currentTs = sig.ts;

      if (siblingBatchStart === null || currentTs !== siblingBatchStart) {
        if (siblingBatchStart !== null) {
          deduplicatedSignals.push({
            ts: siblingBatchStart,
            source: 'system',
            signal: 'sibling_tool_error',
            details: `${siblingBatchCount} sibling errors in parallel batch`,
            batch_size: siblingBatchCount,
            tools_affected: siblingBatchTools,
          });
        }
        siblingBatchStart = currentTs;
        siblingBatchCount = 1;
        siblingBatchTools = [sig.tool_name || 'unknown'];
      } else {
        siblingBatchCount++;
        siblingBatchTools.push(sig.tool_name || 'unknown');
      }
    } else {
      if (siblingBatchStart !== null) {
        deduplicatedSignals.push({
          ts: siblingBatchStart,
          source: 'system',
          signal: 'sibling_tool_error',
          details: `${siblingBatchCount} sibling errors in parallel batch`,
          batch_size: siblingBatchCount,
          tools_affected: siblingBatchTools,
        });
        siblingBatchStart = null;
        siblingBatchCount = 0;
        siblingBatchTools = [];
      }
      deduplicatedSignals.push(sig);
    }
  }

  if (siblingBatchStart !== null) {
    deduplicatedSignals.push({
      ts: siblingBatchStart,
      source: 'system',
      signal: 'sibling_tool_error',
      details: `${siblingBatchCount} sibling errors in parallel batch`,
      batch_size: siblingBatchCount,
      tools_affected: siblingBatchTools,
    });
  }

  // Replace signals with deduplicated version
  const finalSignals = deduplicatedSignals;

  // 1. interrupt_cascade: 2+ request_interrupted within 60s
  const interruptTimes = [];
  for (const sig of finalSignals) {
    if (sig.signal === 'request_interrupted' && sig.ts) {
      try {
        const t = new Date(sig.ts.replace('Z', '+00:00'));
        if (!isNaN(t.getTime())) interruptTimes.push(t);
      } catch {
        // pass
      }
    }
  }

  for (let i = 1; i < interruptTimes.length; i++) {
    const gapSec = (interruptTimes[i] - interruptTimes[i - 1]) / 1000;
    if (gapSec <= 60) {
      finalSignals.push({
        ts: interruptTimes[i].toISOString(),
        source: 'user',
        signal: 'interrupt_cascade',
        details: `${Math.round(gapSec)}s between interrupts`,
        gap_seconds: gapSec,
      });
    }
  }

  // 2. Analyze signal sequence for session-end patterns
  const hasErrors = finalSignals.some(s => s.signal === 'exit_error');
  const hasSuccess = finalSignals.some(s => s.signal === 'exit_success');
  const hasIntervention = finalSignals.some(s => s.signal === 'user_intervention');

  const last5Signals = finalSignals.slice(-5).map(s => s.signal);

  const frictionWeights = {
    exit_error: 1,
    user_curse: 5,
    user_negation: 1,
    tool_loop: 6,
    false_success: 8,
    request_interrupted: 4,
    interrupt_cascade: 7,
    repeated_question: 3,
  };
  let last5Friction = 0;
  for (const s of last5Signals) {
    last5Friction += frictionWeights[s] || 0;
  }

  // 3. rapid_exit
  if (turnCount <= 3 && turnCount > 0) {
    if (last5Signals.length > 0 &&
        (last5Signals[last5Signals.length - 1] === 'exit_error' ||
         last5Signals[last5Signals.length - 1] === 'request_interrupted')) {
      finalSignals.push({
        ts: metadata.ended_at || '',
        source: 'session',
        signal: 'rapid_exit',
        details: `${turnCount} turns, ended with ${last5Signals[last5Signals.length - 1]}`,
      });
    }
  }

  // 4. no_resolution
  if (hasErrors && !hasSuccess && !hasIntervention && turnCount > 1) {
    const errorCount = finalSignals.filter(s => s.signal === 'exit_error').length;
    finalSignals.push({
      ts: metadata.ended_at || '',
      source: 'session',
      signal: 'no_resolution',
      details: `${errorCount} errors, no success`,
    });
  }

  // 5. session_abandoned
  if (last5Friction >= 8 && !hasSuccess && !hasIntervention && turnCount > 2) {
    finalSignals.push({
      ts: metadata.ended_at || '',
      source: 'session',
      signal: 'session_abandoned',
      details: `friction ${last5Friction} in last 5 signals, no resolution`,
    });
  }

  return [finalSignals, metadata];
}

// =============================================================================
// FRICTION ANALYZE - analyze_session
// =============================================================================

function analyzeSession(sessionId, signals, metadata, config) {
  const weights = config.weights;

  const bySource = {};

  function getSource(source) {
    if (!bySource[source]) {
      bySource[source] = {
        total_friction: 0,
        signal_count: 0,
        signals: {},
      };
    }
    return bySource[source];
  }

  function getSignalData(sourceObj, signalType) {
    if (!sourceObj.signals[signalType]) {
      sourceObj.signals[signalType] = { count: 0, total_weight: 0 };
    }
    return sourceObj.signals[signalType];
  }

  const frictionTrajectory = [];
  let runningFriction = 0;
  let momentum = 0;
  let errorCount = 0;
  let successCount = 0;

  for (const sig of signals) {
    const source = sig.source;
    const signalType = sig.signal;
    const weight = weights[signalType] || 0;

    if (signalType === 'exit_success') {
      successCount++;
      momentum++;
    } else if (signalType === 'exit_error') {
      errorCount++;
    }

    const sourceObj = getSource(source);
    sourceObj.total_friction += weight;
    sourceObj.signal_count += 1;
    const sigData = getSignalData(sourceObj, signalType);
    sigData.count += 1;
    sigData.total_weight += weight;

    if (weight > 0) {
      runningFriction += weight;
      frictionTrajectory.push(runningFriction);
    } else if (frictionTrajectory.length > 0) {
      frictionTrajectory.push(frictionTrajectory[frictionTrajectory.length - 1]);
    } else {
      frictionTrajectory.push(0);
    }
  }

  // Detect patterns
  const patterns = [];
  const peakFriction = frictionTrajectory.length > 0 ? Math.max(...frictionTrajectory) : 0;
  const finalFriction = frictionTrajectory.length > 0 ? frictionTrajectory[frictionTrajectory.length - 1] : 0;

  if (peakFriction >= config.thresholds.friction_peak && finalFriction < 5) {
    patterns.push({
      type: 'learning_moment',
      friction_before: peakFriction,
      friction_after: finalFriction,
    });
  }

  // Sequence detection
  const signalSeq = signals.map(s => s.signal);
  for (let i = 0; i < signalSeq.length - 2; i++) {
    const seq = [signalSeq[i], signalSeq[i + 1], signalSeq[i + 2]];
    if (seq[0] === 'exit_error' && seq[1] === 'false_success' && seq[2] === 'user_curse') {
      patterns.push({ type: 'false_success_loop', sequence: seq, count: 1 });
    }
  }

  // Calculate duration
  let durationMin = 0;
  if (metadata.started_at && metadata.ended_at) {
    try {
      const start = new Date(metadata.started_at.replace('Z', '+00:00'));
      const end = new Date(metadata.ended_at.replace('Z', '+00:00'));
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        durationMin = Math.floor((end - start) / 60000);
      }
    } catch {
      // pass
    }
  }
  metadata.duration_min = durationMin;

  // Error ratio
  const totalToolRuns = successCount + errorCount;
  const errorRatio = totalToolRuns > 0 ? errorCount / totalToolRuns : 0;

  // Session quality assessment
  const hasIntervention = signals.some(s => s.signal === 'user_intervention');
  const hasAbandoned = signals.some(s => s.signal === 'session_abandoned');
  const hasCurse = signals.some(s => s.signal === 'user_curse');
  const hasFalseSuccess = signals.some(s => s.signal === 'false_success');

  let quality;
  if (hasIntervention || hasAbandoned) {
    quality = 'BAD';
  } else if (hasCurse || hasFalseSuccess) {
    quality = 'FRICTION';
  } else if (peakFriction >= config.thresholds.friction_peak) {
    quality = 'ROUGH';
  } else if (errorRatio > 0.5 && errorCount > 3) {
    quality = 'ROUGH';
  } else if ((metadata.turn_count || 0) <= 1) {
    quality = 'ONE-SHOT';
  } else {
    quality = 'OK';
  }

  return {
    session_id: sessionId,
    session_metadata: metadata,
    friction_summary: {
      peak: peakFriction,
      final: finalFriction,
      total_signals: signals.length,
      learning_moments: patterns.filter(p => p.type === 'learning_moment').length,
    },
    momentum: {
      success_count: successCount,
      error_count: errorCount,
      error_ratio: Math.round(errorRatio * 100) / 100,
    },
    quality,
    by_source: bySource,
    friction_trajectory: frictionTrajectory,
    patterns_detected: patterns,
  };
}

// =============================================================================
// FRICTION ANALYZE - aggregate_sessions
// =============================================================================

function aggregateSessions(analyses, config) {
  const aggregateBySource = {};
  const byProject = {};
  const allPatterns = [];
  let highFrictionCount = 0;
  let interventionCount = 0;

  function getAggSource(source) {
    if (!aggregateBySource[source]) {
      aggregateBySource[source] = {
        sessions_with_signals: 0,
        total_friction: 0,
        top_signals: {},
      };
    }
    return aggregateBySource[source];
  }

  function getProject(proj) {
    if (!byProject[proj]) {
      byProject[proj] = {
        total_sessions: 0,
        interactive_sessions: 0,
        bad_sessions: 0,
        total_friction: 0,
        total_duration_min: 0,
        total_turns: 0,
      };
    }
    return byProject[proj];
  }

  for (const analysis of analyses) {
    const peak = analysis.friction_summary.peak;
    const quality = analysis.quality || 'UNKNOWN';
    const sessionId = analysis.session_id || '';
    const metadata = analysis.session_metadata || {};

    const project = sessionId.includes('/') ? sessionId.split('/')[0] : 'unknown';

    const proj = getProject(project);
    proj.total_sessions++;
    if ((metadata.turn_count || 0) > 1) proj.interactive_sessions++;
    if (quality === 'BAD') proj.bad_sessions++;
    proj.total_friction += peak;
    proj.total_duration_min += metadata.duration_min || 0;
    proj.total_turns += metadata.turn_count || 0;

    if (peak >= config.thresholds.friction_peak) highFrictionCount++;

    for (const [source, data] of Object.entries(analysis.by_source || {})) {
      const aggSrc = getAggSource(source);
      aggSrc.sessions_with_signals++;
      aggSrc.total_friction += data.total_friction;

      for (const [signalType, signalData] of Object.entries(data.signals || {})) {
        aggSrc.top_signals[signalType] = (aggSrc.top_signals[signalType] || 0) + signalData.count;
      }
    }

    allPatterns.push(...analysis.patterns_detected);

    // Interventions
    if (analysis.by_source.user && analysis.by_source.user.signals.user_intervention) {
      interventionCount++;
    }
    if (analysis.by_source.session && analysis.by_source.session.signals.session_abandoned) {
      interventionCount++;
    }
  }

  // Calculate metrics
  const interventionPred = highFrictionCount > 0 ? interventionCount / highFrictionCount : 0;

  const totalObjective = ((aggregateBySource.tool || {}).total_friction || 0) +
                          ((aggregateBySource.user || {}).total_friction || 0);
  const totalLlm = (aggregateBySource.llm || {}).total_friction || 1;
  const snr = totalLlm !== 0 ? Math.abs(totalObjective / totalLlm) : 0;

  // Verdict
  const thresholds = config.thresholds;
  const reasons = [];
  const actions = [];
  let status;

  if (snr < thresholds.signal_noise_ratio) {
    status = 'BLOAT';
    reasons.push(`Signal/noise ratio: ${snr.toFixed(1)} (threshold: ${thresholds.signal_noise_ratio})`);
  } else if (interventionPred < thresholds.intervention_predictability) {
    status = 'INCONCLUSIVE';
    reasons.push(`Intervention predictability: ${Math.round(interventionPred * 100)}% (threshold: ${Math.round(thresholds.intervention_predictability * 100)}%)`);
  } else {
    status = 'USEFUL';
    reasons.push(`Intervention predictability: ${Math.round(interventionPred * 100)}% (threshold: ${Math.round(thresholds.intervention_predictability * 100)}%)`);
    reasons.push(`Signal/noise ratio: ${snr.toFixed(1)} (threshold: ${thresholds.signal_noise_ratio})`);

    const userCurses = ((aggregateBySource.user || {}).top_signals || {}).user_curse || 0;
    if (userCurses > 5) {
      actions.push('Consider increasing user_curse weight (high occurrence)');
    }

    const falseSuccessLoops = allPatterns.filter(p => p.type === 'false_success_loop').length;
    if (falseSuccessLoops > 3) {
      actions.push('Create antigen for false_success pattern');
    }
  }

  // Convert aggregateBySource to output format
  const aggregateBySourceDict = {};
  for (const [source, data] of Object.entries(aggregateBySource)) {
    const sessionsCount = data.sessions_with_signals;
    // Sort top_signals by count descending (like Python's Counter.most_common)
    const sortedSignals = Object.entries(data.top_signals)
      .sort((a, b) => b[1] - a[1]);
    const topSignals = {};
    for (const [k, v] of sortedSignals) topSignals[k] = v;

    aggregateBySourceDict[source] = {
      sessions_with_signals: sessionsCount,
      total_friction: data.total_friction,
      avg_friction_per_session: sessionsCount > 0 ? data.total_friction / sessionsCount : 0,
      top_signals: topSignals,
    };
  }

  // Common sequences (simplified, same as Python)
  const commonSequences = [];

  // Per-project stats
  const projectStats = {};
  for (const [project, data] of Object.entries(byProject)) {
    const total = data.total_sessions;
    const interactive = data.interactive_sessions;
    projectStats[project] = {
      total_sessions: total,
      interactive_sessions: interactive,
      bad_sessions: data.bad_sessions,
      bad_rate: interactive > 0 ? Math.round(data.bad_sessions / interactive * 100) / 100 : 0,
      avg_friction: total > 0 ? Math.round(data.total_friction / total * 10) / 10 : 0,
      avg_duration_min: total > 0 ? Math.round(data.total_duration_min / total * 10) / 10 : 0,
      avg_turns: total > 0 ? Math.round(data.total_turns / total * 10) / 10 : 0,
    };
  }

  // Overall averages
  let totalInteractive = 0, totalBad = 0, totalFriction = 0, totalDuration = 0, totalTurns = 0;
  for (const d of Object.values(byProject)) {
    totalInteractive += d.interactive_sessions;
    totalBad += d.bad_sessions;
    totalFriction += d.total_friction;
    totalDuration += d.total_duration_min;
    totalTurns += d.total_turns;
  }
  const totalSessions = analyses.length;

  const overallStats = {
    total_sessions: totalSessions,
    interactive_sessions: totalInteractive,
    bad_sessions: totalBad,
    bad_rate: totalInteractive > 0 ? Math.round(totalBad / totalInteractive * 100) / 100 : 0,
    avg_friction: totalSessions > 0 ? Math.round(totalFriction / totalSessions * 10) / 10 : 0,
    avg_duration_min: totalSessions > 0 ? Math.round(totalDuration / totalSessions * 10) / 10 : 0,
    avg_turns: totalSessions > 0 ? Math.round(totalTurns / totalSessions * 10) / 10 : 0,
  };

  // Time-series: daily stats
  const byDay = {};
  for (const analysis of analyses) {
    const started = (analysis.session_metadata || {}).started_at || '';
    if (started) {
      try {
        const dt = new Date(started.replace('Z', '+00:00'));
        if (!isNaN(dt.getTime())) {
          const day = dt.toISOString().slice(0, 10);
          if (!byDay[day]) byDay[day] = { total: 0, interactive: 0, bad: 0, friction: 0 };
          byDay[day].total++;
          if ((analysis.session_metadata || {}).turn_count > 1) byDay[day].interactive++;
          if (analysis.quality === 'BAD') byDay[day].bad++;
          byDay[day].friction += (analysis.friction_summary || {}).peak || 0;
        }
      } catch {
        // pass
      }
    }
  }

  const dailyStats = Object.keys(byDay).sort().map(day => {
    const d = byDay[day];
    return {
      date: day,
      total: d.total,
      interactive: d.interactive,
      bad: d.bad,
      bad_rate: d.interactive > 0 ? Math.round(d.bad / d.interactive * 100) / 100 : 0,
      avg_friction: d.total > 0 ? Math.round(d.friction / d.total * 10) / 10 : 0,
    };
  });

  // Best and worst sessions
  const interactiveAnalyses = analyses.filter(a => (a.session_metadata || {}).turn_count > 1);

  let worstSession = null;
  let bestSession = null;

  if (interactiveAnalyses.length > 0) {
    worstSession = interactiveAnalyses.reduce((max, a) =>
      (a.friction_summary.peak > max.friction_summary.peak) ? a : max
    );

    const okSessions = interactiveAnalyses.filter(a => a.quality === 'OK');
    if (okSessions.length > 0) {
      bestSession = okSessions.reduce((min, a) =>
        (a.friction_summary.peak < min.friction_summary.peak) ? a : min
      );
    } else {
      bestSession = interactiveAnalyses.reduce((min, a) =>
        (a.friction_summary.peak < min.friction_summary.peak) ? a : min
      );
    }
  }

  return {
    analyzed_at: new Date().toISOString(),
    sessions_analyzed: analyses.length,
    config_used: config,
    aggregate_by_source: aggregateBySourceDict,
    by_project: projectStats,
    overall: overallStats,
    daily_stats: dailyStats,
    best_session: bestSession ? {
      session_id: bestSession.session_id,
      quality: bestSession.quality,
      peak_friction: (bestSession.friction_summary || {}).peak || 0,
      turns: (bestSession.session_metadata || {}).turn_count || 0,
      duration_min: (bestSession.session_metadata || {}).duration_min || 0,
    } : null,
    worst_session: worstSession ? {
      session_id: worstSession.session_id,
      quality: worstSession.quality,
      peak_friction: (worstSession.friction_summary || {}).peak || 0,
      turns: (worstSession.session_metadata || {}).turn_count || 0,
      duration_min: (worstSession.session_metadata || {}).duration_min || 0,
    } : null,
    correlations: {
      high_friction_sessions: highFrictionCount,
      intervention_sessions: interventionCount,
      intervention_predictability: Math.round(interventionPred * 100) / 100,
    },
    common_sequences: commonSequences,
    verdict: { status, reasons, recommended_actions: actions },
  };
}

// =============================================================================
// FRICTION ANALYZE - print helpers
// =============================================================================

function printBox(title, lines, width) {
  width = width || 60;
  const hr = '\u2500'.repeat(width - 2);
  console.log(`\u250C${hr}\u2510`);
  console.log(`\u2502 ${title.toUpperCase().padEnd(width - 4)} \u2502`);
  console.log(`\u251C${hr}\u2524`);
  for (let line of lines) {
    if (line.length > width - 4) line = line.slice(0, width - 7) + '...';
    console.log(`\u2502 ${line.padEnd(width - 4)} \u2502`);
  }
  console.log(`\u2514${hr}\u2518`);
}

function printTable(headers, rows, colWidths) {
  if (!colWidths) {
    colWidths = headers.map((h, i) => {
      let max = String(h).length;
      for (const row of rows) {
        const len = String(row[i]).length;
        if (len > max) max = len;
      }
      return max + 2;
    });
  }

  const topBorder = '\u250C' + colWidths.map(w => '\u2500'.repeat(w)).join('\u252C') + '\u2510';
  const headerLine = '\u2502' + headers.map((h, i) => ` ${String(h).padEnd(colWidths[i] - 2)} `).join('\u2502') + '\u2502';
  const sep = '\u251C' + colWidths.map(w => '\u2500'.repeat(w)).join('\u253C') + '\u2524';

  console.log(topBorder);
  console.log(headerLine);
  console.log(sep);

  for (const row of rows) {
    const rowLine = '\u2502' + row.map((v, i) => ` ${String(v).padEnd(colWidths[i] - 2)} `).join('\u2502') + '\u2502';
    console.log(rowLine);
  }

  const bottomBorder = '\u2514' + colWidths.map(w => '\u2500'.repeat(w)).join('\u2534') + '\u2518';
  console.log(bottomBorder);
}

// =============================================================================
// FRICTION ANALYZE - generate_detailed_report
// =============================================================================

function generateDetailedReport(outputDir, analyses, summary, config, signalCounts, multiProject) {
  const report = [];

  report.push('# Friction Analysis - Detailed Report\n\n');
  report.push(`**Generated:** ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC\n\n`);
  report.push(`**Sessions Analyzed:** ${analyses.length}\n`);
  report.push(`**Interactive Sessions:** ${summary.overall.interactive_sessions} (multi-turn conversations)\n`);
  report.push(`**BAD Sessions:** ${summary.overall.bad_sessions} (${Math.round(summary.overall.bad_rate * 100)}% of interactive)\n\n`);

  // Glossary
  report.push('## Glossary\n\n');
  report.push('**Interactive Session:** A conversation with >1 turn (multi-turn dialogue). Single-turn sessions are filtered from BAD rate calculation.\n\n');
  report.push('**BAD Session:** User gave up via `/stash`, `/exit`, or silent abandonment (high friction with no resolution).\n\n');
  report.push('**Friction:** Cumulative weight of negative signals. Higher friction = more user frustration.\n\n');
  report.push('**Peak Friction:** Maximum friction reached during a session.\n\n');
  report.push('---\n\n');

  // Executive summary
  report.push('## Executive Summary\n\n');
  const badRate = summary.overall.bad_rate;
  const overall = summary.overall;

  if (badRate > 0.5) {
    report.push(`\u26A0\uFE0F  **CRITICAL**: ${Math.round(badRate * 100)}% of interactive sessions end in failure. `);
  } else if (badRate > 0.3) {
    report.push(`\uD83D\uDFE1 **WARNING**: ${Math.round(badRate * 100)}% of interactive sessions end in failure. `);
  } else {
    report.push(`\u2705 **HEALTHY**: ${Math.round(badRate * 100)}% of interactive sessions end in failure. `);
  }

  report.push(`Average session: ${overall.avg_turns.toFixed(1)} turns, ${overall.avg_friction.toFixed(1)} friction, ${Math.round(overall.avg_duration_min)} min.\n\n`);

  // Top issues
  const topSignals = sortedEntries(signalCounts).slice(0, 3);
  report.push('**Top Issues:**\n');
  for (const [sig, count] of topSignals) {
    const weight = config.weights[sig] || 0;
    const total = count * weight;
    report.push(`- **${sig}** (${count} occurrences, ${Math.round(total)} total friction)\n`);
  }
  report.push('\n');
  report.push('---\n\n');

  // Weight system
  report.push('## Friction Weight System\n\n');
  report.push('Each signal has a weight representing its severity. Friction accumulates as signals occur.\n\n');
  report.push('| Weight | Severity | Meaning |\n');
  report.push('|--------|----------|----------|\n');
  report.push('| +10 | CRITICAL | User gave up (intervention, abandonment) |\n');
  report.push('| +8 | SEVERE | LLM false claims or no progress (false_success, no_resolution) |\n');
  report.push('| +7 | HIGH | User frustration (interrupt_cascade) |\n');
  report.push('| +6 | MEDIUM | Stuck patterns (tool_loop, rapid_exit) |\n');
  report.push('| +4-5 | LOW-MEDIUM | User signals (request_interrupted, user_curse) |\n');
  report.push('| +1 | MINOR | Technical issues (exit_error, repeated_question) |\n');
  report.push('| +0.5 | NOISE | Context signals (compaction, long_silence, user_negation) |\n\n');
  report.push('---\n\n');

  // Signal breakdown
  report.push('## Signal Breakdown\n\n');
  report.push('| Signal | Count | Weight | Total Friction | What It Means |\n');
  report.push('|--------|-------|--------|----------------|---------------|\n');

  const signalMeanings = {
    exit_error: 'Command failed (exit code != 0)',
    compaction: 'Context overflow, conversation summarized',
    repeated_question: 'User asked same question twice',
    request_interrupted: 'User hit Ctrl+C or ESC',
    long_silence: 'User paused >10 min',
    user_negation: '"no", "didn\'t work", "still broken"',
    false_success: 'LLM claimed success after error',
    user_intervention: 'User gave up (/stash, /exit)',
    interrupt_cascade: '2+ interrupts within 60s',
    session_abandoned: 'High friction, no resolution',
    no_resolution: 'Errors without subsequent success',
    exit_success: 'Command succeeded (exit code 0)',
    tool_loop: 'Same tool called 3+ times',
    rapid_exit: '<3 turns, ends with error/interrupt',
    user_curse: 'User frustration (profanity)',
    sibling_tool_error: 'Parallel tools canceled (SDK cascade)',
  };

  for (const [sigType, count] of sortedEntries(signalCounts)) {
    const weight = config.weights[sigType] || 0;
    const total = count * weight;
    const meaning = signalMeanings[sigType] || 'Unknown signal';
    const weightStr = weight >= 0 ? `+${weight.toFixed(1)}` : weight.toFixed(1);
    report.push(`| ${sigType} | ${count} | ${weightStr} | ${total.toFixed(1)} | ${meaning} |\n`);
  }
  report.push('\n');

  // Pattern analysis
  report.push('## Pattern Analysis\n\n');

  const falseSuccessCount = signalCounts.false_success || 0;
  const exitErrorCount = signalCounts.exit_error || 0;
  const interruptCount = signalCounts.request_interrupted || 0;
  const interventionCountLocal = signalCounts.user_intervention || 0;

  report.push('### Common Failure Patterns\n\n');

  if (falseSuccessCount > 0) {
    report.push(`**False Success Loop** (${falseSuccessCount} occurrences): LLM claims task is complete after command fails. `);
    report.push('This indicates the LLM is not checking exit codes properly.\n\n');
  }
  if (exitErrorCount > 50) {
    report.push(`**High Error Rate** (${exitErrorCount} errors): Many commands are failing. `);
    report.push('This suggests either environment issues or LLM choosing wrong approaches.\n\n');
  }
  if (interruptCount > 20) {
    report.push(`**User Interruptions** (${interruptCount} interrupts): Users frequently canceling operations. `);
    report.push('Commands may be too slow, stuck, or heading in wrong direction.\n\n');
  }
  if (interventionCountLocal > 0) {
    const interventionRate = interventionCountLocal / summary.overall.interactive_sessions;
    report.push(`**Abandonment Rate** (${Math.round(interventionRate * 100)}%): ${interventionCountLocal}/${summary.overall.interactive_sessions} interactive sessions ended with user giving up. `);
    if (interventionRate > 0.3) {
      report.push('This is CRITICAL - users are frequently giving up.\n\n');
    } else {
      report.push('This is acceptable for complex tasks.\n\n');
    }
  }

  // Friction level breakdown
  report.push('### Friction Level Breakdown\n\n');
  const lowFriction = analyses.filter(a => a.friction_summary.peak > 0 && a.friction_summary.peak < 15);
  const mediumFriction = analyses.filter(a => a.friction_summary.peak >= 15 && a.friction_summary.peak < 50);
  const highFriction = analyses.filter(a => a.friction_summary.peak >= 50);

  report.push(`**Low Friction (0-15):** ${lowFriction.length} sessions - Normal operation, minor errors quickly resolved\n\n`);
  report.push(`**Medium Friction (15-50):** ${mediumFriction.length} sessions - Some struggles, multiple retries, but eventually successful\n\n`);
  report.push(`**High Friction (50+):** ${highFriction.length} sessions - Severe issues, user frustration, likely gave up\n\n`);
  report.push('---\n\n');

  // High-friction sessions
  report.push('## Top Friction Sessions\n\n');
  let topFriction = analyses.slice().sort((a, b) => b.friction_summary.peak - a.friction_summary.peak).slice(0, 20);
  topFriction = topFriction.filter(a => a.friction_summary.peak > 0);

  if (multiProject) {
    report.push('| Project | Session | Quality | Peak | Turns | Duration | Top Signals |\n');
    report.push('|---------|---------|---------|------|-------|----------|-------------|\n');
  } else {
    report.push('| Session | Quality | Peak | Turns | Duration | Top Signals |\n');
    report.push('|---------|---------|------|-------|----------|-------------|\n');
  }

  for (const a of topFriction) {
    const fullSid = a.session_id;
    const project = fullSid.includes('/') ? fullSid.split('/')[0] : '?';
    const sid = fullSid.includes('/') ? fullSid.split('/').slice(-1)[0] : fullSid;
    const peak = a.friction_summary.peak;
    const turns = (a.session_metadata || {}).turn_count || 0;
    const dur = (a.session_metadata || {}).duration_min || 0;
    const durStr = dur ? formatDuration(dur) : '-';
    const quality = a.quality || '?';

    const topSigs = [];
    for (const [, data] of Object.entries(a.by_source || {})) {
      for (const [sigType, sigData] of Object.entries(data.signals || {})) {
        if (sigData.count > 0) {
          const shortName = sigType.replace('user_', '').replace('exit_', '');
          topSigs.push(`${shortName}:${sigData.count}`);
        }
      }
    }
    const sigsStr = topSigs.length > 0 ? topSigs.slice(0, 3).join(', ') : '-';

    if (multiProject) {
      report.push(`| ${project} | ${sid} | ${quality} | ${peak} | ${turns} | ${durStr} | ${sigsStr} |\n`);
    } else {
      report.push(`| ${sid} | ${quality} | ${peak} | ${turns} | ${durStr} | ${sigsStr} |\n`);
    }
  }
  report.push('\n');

  // Session quality breakdown
  report.push('## Session Quality Breakdown\n\n');
  const qualityCounts = {};
  for (const a of analyses) {
    const q = a.quality || 'UNKNOWN';
    qualityCounts[q] = (qualityCounts[q] || 0) + 1;
  }
  const qualityOrder = ['BAD', 'FRICTION', 'ROUGH', 'OK', 'ONE-SHOT'];
  const qualityDesc = {
    BAD: 'user gave up (/stash)',
    FRICTION: 'curse or false_success',
    ROUGH: 'high friction but completed',
    OK: 'no significant friction',
    'ONE-SHOT': 'single turn (filtered)',
  };

  report.push('| Quality | Count | Description |\n');
  report.push('|---------|-------|-------------|\n');
  for (const q of qualityOrder) {
    const count = qualityCounts[q] || 0;
    const desc = qualityDesc[q] || '';
    if (count > 0) {
      report.push(`| ${q} | ${count} | ${desc} |\n`);
    }
  }
  report.push('\n');

  // Per-project stats
  if (summary.by_project && Object.keys(summary.by_project).length > 0) {
    report.push('## Per-Project Statistics\n\n');
    report.push('| Project | Interactive | BAD | BAD % | Avg Friction | Avg Turns | Avg Duration |\n');
    report.push('|---------|-------------|-----|-------|--------------|-----------|-------------|\n');
    for (const proj of Object.keys(summary.by_project).sort()) {
      const stats = summary.by_project[proj];
      const badRatePct = stats.interactive_sessions > 0 ? `${Math.round(stats.bad_rate * 100)}%` : '-';
      const dur = stats.avg_duration_min || 0;
      const durStr = dur ? formatDuration(Math.round(dur)) : '-';
      report.push(`| ${proj} | ${stats.interactive_sessions} | ${stats.bad_sessions} | ${badRatePct} | ${stats.avg_friction.toFixed(1)} | ${stats.avg_turns.toFixed(1)} | ${durStr} |\n`);
    }
    report.push('\n');
  }

  // Recommendations
  report.push('## Recommendations\n\n');
  const recommendations = [];

  if (falseSuccessCount > 10) {
    recommendations.push('**High Priority:** Add CLAUDE.md rule to verify exit codes before claiming success');
  }
  if (interruptCount > 20) {
    recommendations.push('**High Priority:** Commands timing out or stuck - review for heavy operations that need optimization');
  }
  if ((signalCounts.tool_loop || 0) > 3) {
    recommendations.push('**Medium Priority:** Add CLAUDE.md rule to detect and break out of tool loops');
  }
  if (interventionCountLocal / summary.overall.interactive_sessions > 0.4) {
    recommendations.push('**Critical:** >40% abandonment rate - major UX issues, review antigens for patterns');
  }
  if ((signalCounts.repeated_question || 0) > 20) {
    recommendations.push('**Medium Priority:** Many repeated questions - LLM not understanding user intent or context issues');
  }

  if (recommendations.length > 0) {
    recommendations.forEach((rec, i) => report.push(`${i + 1}. ${rec}\n\n`));
  } else {
    report.push('No critical issues detected. Continue monitoring.\n\n');
  }

  report.push('---\n\n');

  // Daily trend
  if (summary.daily_stats && summary.daily_stats.length > 0) {
    report.push('## Daily Trend (Last 14 Days)\n\n');
    report.push('| Date | Interactive | BAD | Rate | Trend |\n');
    report.push('|------|-------------|-----|------|-------|\n');
    for (const day of summary.daily_stats.slice(-14)) {
      const dayBadRate = day.interactive > 0 ? day.bad_rate : 0;
      const badRatePct = day.interactive > 0 ? `${Math.round(dayBadRate * 100)}%` : '-';
      const barLen = Math.round(dayBadRate * 10);
      const bar = '\u2588'.repeat(barLen) + '\u2591'.repeat(10 - barLen);
      report.push(`| ${day.date} | ${day.interactive} | ${day.bad} | ${badRatePct} | ${bar} |\n`);
    }
    report.push('\n');
  }

  // Write report
  fs.writeFileSync(path.join(outputDir, 'report.md'), report.join(''));
}

/**
 * Sort object entries by value descending (like Python Counter.most_common).
 */
function sortedEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

// =============================================================================
// FRICTION ANALYZE - main
// =============================================================================

function analyzeMain(sessionsDir) {
  const inputPath = sessionsDir;
  const config = loadConfig();

  // Find sessions
  let sessionFiles = [];
  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch {
    console.log(`No sessions found in ${inputPath}`);
    return 1;
  }

  if (stat.isFile()) {
    sessionFiles = [inputPath];
  } else {
    // Try direct session files first
    sessionFiles = globFiles(inputPath, '*.jsonl', false)
      .filter(f => !path.basename(f).includes('sessions-index'));

    // If no direct session files, check subdirectories
    if (sessionFiles.length === 0) {
      const projectDirs = listDirs(inputPath)
        .filter(d => !path.basename(d).startsWith('.'));

      for (const projDir of projectDirs) {
        const projSessions = globFiles(projDir, '*.jsonl', false);
        if (projSessions.length > 0) {
          sessionFiles = [];
          for (const pd of projectDirs) {
            const files = globFiles(pd, '*.jsonl', false)
              .filter(f => !path.basename(f).includes('sessions-index'));
            sessionFiles.push(...files);
          }
          break;
        }
      }
    }
  }

  if (sessionFiles.length === 0) {
    console.log(`No sessions found in ${inputPath}`);
    return 1;
  }

  // Create output dir
  const outputDir = '.factory/friction';
  fs.mkdirSync(outputDir, { recursive: true });

  // Process each session
  const analyses = [];
  const allSignals = [];
  const errors = [];

  const projectParents = new Set(sessionFiles.map(f => path.basename(path.dirname(f))));
  const multiProject = projectParents.size > 1;

  if (multiProject) {
    console.log(`Found sessions from ${projectParents.size} projects\n`);
  }

  for (const sessionFile of sessionFiles) {
    try {
      const [signals, metadata] = extractSignals(sessionFile);
      const sessionName = deriveSessionName(sessionFile, metadata);

      for (const sig of signals) {
        sig.session = sessionName;
        allSignals.push(sig);
      }

      const analysis = analyzeSession(sessionName, signals, metadata, config);
      analyses.push(analysis);
    } catch (e) {
      errors.push([path.basename(sessionFile).slice(0, 12), String(e).slice(0, 40)]);
    }
  }

  // Write consolidated raw signals
  const rawLines = allSignals.map(sig => JSON.stringify(sig)).join('\n') + (allSignals.length > 0 ? '\n' : '');
  fs.writeFileSync(path.join(outputDir, 'friction_raw.jsonl'), rawLines);

  // Write consolidated analysis
  fs.writeFileSync(path.join(outputDir, 'friction_analysis.json'), JSON.stringify(analyses, null, 2));

  if (analyses.length === 0) {
    console.log('\nNo sessions could be analyzed');
    return 1;
  }

  // Aggregate
  const summary = aggregateSessions(analyses, config);
  fs.writeFileSync(path.join(outputDir, 'friction_summary.json'), JSON.stringify(summary, null, 2));

  // === CONCISE TERMINAL OUTPUT ===
  console.log();
  console.log('='.repeat(60));
  console.log('FRICTION ANALYSIS');
  console.log('='.repeat(60));
  console.log();

  const agg = summary.aggregate_by_source;
  const corr = summary.correlations;
  const overall = summary.overall;

  const interactive = overall.interactive_sessions;
  const badCount = overall.bad_sessions;
  const badRateVal = overall.bad_rate;

  const projectsCount = Object.keys(summary.by_project || {}).length;
  console.log(`Analyzed: ${analyses.length} sessions (${interactive} interactive*) from ${projectsCount} project${projectsCount !== 1 ? 's' : ''}`);
  console.log('  *interactive = multi-turn conversations (>1 turn)');

  const emoji = badRateVal > 0.5 ? '\uD83D\uDD34' : badRateVal > 0.3 ? '\uD83D\uDFE1' : '\u2705';
  console.log(`BAD Rate: ${Math.round(badRateVal * 100)}% (${badCount}/${interactive} interactive) ${emoji}`);
  console.log();

  // Top signals
  const signalCounts = {};
  for (const sourceData of Object.values(agg)) {
    for (const [sigType, count] of Object.entries(sourceData.top_signals || {})) {
      signalCounts[sigType] = (signalCounts[sigType] || 0) + count;
    }
  }

  if (Object.keys(signalCounts).length > 0) {
    console.log('Top Signals:');
    const topSigs = sortedEntries(signalCounts).slice(0, 5);
    for (const [sigType, count] of topSigs) {
      const weight = config.weights[sigType] || 0;
      const totalFriction = count * weight;
      const sign = totalFriction >= 0 ? '+' : '';
      console.log(`  ${sigType.padEnd(20)} ${String(count).padStart(3)}   (${sign}${Math.round(totalFriction)} friction)`);
    }
    console.log();
  }

  // Per-project stats
  if (summary.by_project && Object.keys(summary.by_project).length > 0) {
    console.log('Per-Project:');
    for (const proj of Object.keys(summary.by_project).sort()) {
      const stats = summary.by_project[proj];
      const projBadRate = stats.bad_rate;
      const projEmoji = projBadRate > 0.5 ? '\uD83D\uDD34' : projBadRate > 0.3 ? '\uD83D\uDFE1' : '\u2705';
      const badPct = stats.interactive_sessions > 0 ? `${Math.round(projBadRate * 100)}%` : '-';

      const projSessions = analyses.filter(a => a.session_id.startsWith(`${proj}/`));
      const interactiveSessions = projSessions.filter(a => (a.session_metadata || {}).turn_count > 1);
      if (interactiveSessions.length > 0) {
        const frictions = interactiveSessions.map(a => a.friction_summary.peak).sort((a, b) => a - b);
        const median = frictions[Math.floor(frictions.length / 2)];
        console.log(`  ${proj.padEnd(12)} ${badPct.padStart(4)} BAD (${stats.bad_sessions}/${stats.interactive_sessions})  median: ${median.toFixed(1)}  ${projEmoji}`);
      } else {
        console.log(`  ${proj.padEnd(12)} ${badPct.padStart(4)} BAD (${stats.bad_sessions}/${stats.interactive_sessions})  ${projEmoji}`);
      }
    }
    console.log();
  }

  // Best and worst
  if (summary.best_session && summary.worst_session) {
    const ws = summary.worst_session;
    const bs = summary.best_session;
    console.log('Session Extremes:');

    const wsId = multiProject ? ws.session_id : (ws.session_id.includes('/') ? ws.session_id.split('/').slice(-1)[0] : ws.session_id);
    console.log(`  WORST: ${wsId}  peak=${ws.peak_friction}  turns=${ws.turns}`);

    const bsId = multiProject ? bs.session_id : (bs.session_id.includes('/') ? bs.session_id.split('/').slice(-1)[0] : bs.session_id);
    console.log(`  BEST:  ${bsId}  peak=${bs.peak_friction}  turns=${bs.turns}`);
    console.log();
  }

  // Last 2 weeks trend
  if (summary.daily_stats && summary.daily_stats.length > 0) {
    console.log('Last 2 Weeks:');
    for (const day of summary.daily_stats.slice(-14)) {
      if (day.interactive === 0) continue;
      const dayBadRate = day.bad_rate;
      const barLen = Math.round(dayBadRate * 10);
      const bar = '\u2588'.repeat(barLen) + '\u2591'.repeat(10 - barLen);
      console.log(`  ${day.date}  ${String(day.interactive).padStart(2)} sessions  ${String(day.bad).padStart(2)} BAD  ${bar}  ${Math.round(dayBadRate * 100)}%`);
    }
    console.log();
  }

  // Verdict
  const verdict = summary.verdict;
  const statusEmoji = { USEFUL: '\u2713', INCONCLUSIVE: '?', BLOAT: '\u2717' };
  const statusVal = verdict.status;
  console.log(`Verdict: ${statusEmoji[statusVal] || '?'} ${statusVal}`);

  const predictability = corr.intervention_predictability || 0;
  console.log(`  Intervention predictability: ${Math.round(predictability * 100)}%`);
  if ('signal_noise_ratio' in summary) {
    console.log(`  Signal/noise ratio: ${summary.signal_noise_ratio.toFixed(1)}`);
  }
  console.log();

  // Generate detailed report
  generateDetailedReport(outputDir, analyses, summary, config, signalCounts, multiProject);

  // Output files
  console.log('Outputs:');
  console.log('  \uD83D\uDCCA .factory/friction/report.md (detailed analysis)');
  console.log('  \uD83D\uDCCB .factory/friction/antigen_review.md (clustered failure patterns)');
  console.log(`  \uD83D\uDCC1 .factory/friction/*.json (raw data: ${allSignals.length} signals, ${analyses.length} sessions)`);
  console.log();

  console.log('Next: Review .factory/friction/report.md');
  console.log('='.repeat(60));

  if (errors.length > 0) {
    console.log(`\n\u26A0  ${errors.length} sessions failed to parse`);
  }

  return statusVal === 'USEFUL' ? 0 : 1;
}

// =============================================================================
// ANTIGEN EXTRACT - find_session_file
// =============================================================================

function findSessionFile(sessionsDir, sessionId) {
  let projectName = null;
  let shortId;

  if (sessionId.includes('/')) {
    projectName = sessionId.split('/')[0];
    shortId = sessionId.split('/').slice(-1)[0].split('-').slice(-1)[0];
  } else {
    shortId = sessionId;
  }

  const sessionsPath = sessionsDir;

  // First try direct search
  const directFiles = globFiles(sessionsPath, '*.jsonl', false);
  for (const f of directFiles) {
    if (path.basename(f).includes(shortId)) return f;
  }

  // Search in subdirectories for project match
  if (projectName) {
    const subdirs = listDirs(sessionsPath);
    for (const subdir of subdirs) {
      if (path.basename(subdir).endsWith(projectName)) {
        const files = globFiles(subdir, '*.jsonl', false);
        for (const f of files) {
          if (path.basename(f).includes(shortId)) return f;
        }
      }
    }
  }

  // Fallback: recursive search
  const allFiles = globFiles(sessionsPath, '*.jsonl', true);
  for (const f of allFiles) {
    if (path.basename(f).includes(shortId) && !path.basename(f).includes('sessions-index')) {
      return f;
    }
  }

  return null;
}

// =============================================================================
// ANTIGEN EXTRACT - extract helpers
// =============================================================================

function extractContextWindow(sessionFile, anchorTs, windowSize) {
  windowSize = windowSize || 5;

  const raw = fs.readFileSync(sessionFile, 'utf-8');
  const events = raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

  const turns = [];
  for (const event of events) {
    if (event.type === 'user' || event.type === 'assistant') {
      const ts = event.timestamp || '';
      turns.push({ ts, type: event.type, event });
    }
  }

  // Find anchor position
  let anchorIdx = null;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].ts === anchorTs) {
      anchorIdx = i;
      break;
    }
  }

  // If exact match not found, find closest before
  if (anchorIdx === null) {
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].ts && anchorTs && turns[i].ts <= anchorTs) {
        anchorIdx = i;
      }
    }
  }

  if (anchorIdx === null) return [];

  const startIdx = Math.max(0, anchorIdx - windowSize);
  return turns.slice(startIdx, anchorIdx + 1);
}

function extractFilesFromTurn(event) {
  const files = new Set();
  const content = (event.message || {}).content || '';
  const filePattern = /[\w/.-]+\.(?:py|js|ts|md|json|yaml|yml)/g;

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        if (block.type === 'tool_use') {
          const inp = block.input || {};
          if (inp.file_path) files.add(inp.file_path);
          if (inp.path) files.add(inp.path);
          if (inp.command) {
            const matches = inp.command.match(filePattern) || [];
            for (const m of matches) files.add(m);
          }
        } else if (block.type === 'tool_result') {
          const text = String(block.content || '');
          const matches = text.match(filePattern) || [];
          for (const m of matches) files.add(m);
        } else if (block.type === 'text') {
          const text = block.text || '';
          const matches = text.match(filePattern) || [];
          for (const m of matches) files.add(m);
        }
      }
    }
  } else if (typeof content === 'string') {
    const matches = content.match(filePattern) || [];
    for (const m of matches) files.add(m);
  }

  return files;
}

function extractToolsFromTurn(event) {
  const tools = [];
  const content = (event.message || {}).content || '';

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        if (block.type === 'tool_use') {
          const toolName = block.name || 'unknown';
          tools.push({ tool: toolName, action: 'call' });
        } else if (block.type === 'tool_result') {
          const result = String(block.content || '');
          if (result.includes('Exit code 0')) {
            tools.push({ tool: 'result', action: 'success' });
          } else if (/Exit code [1-9]|Traceback|Error/.test(result)) {
            tools.push({ tool: 'result', action: 'error' });
          }
        }
      }
    }
  }

  return tools;
}

function extractErrorsFromTurn(event) {
  const errors = [];
  const content = (event.message || {}).content || '';

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null && block.type === 'tool_result') {
        const result = String(block.content || '');
        if (/Exit code [1-9]|Traceback|Error|error:/i.test(result)) {
          const lines = result.split('\n');
          for (const line of lines.slice(0, 5)) {
            if (/Error|error:|Traceback|Exit code [1-9]/i.test(line)) {
              errors.push(line.trim().slice(0, 200));
              break;
            }
          }
        }
      }
    }
  }

  return errors;
}

function extractUserMessage(event) {
  const content = (event.message || {}).content || '';

  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null && block.type === 'text') {
        text = block.text || '';
        break;
      }
    }
  }

  // Filter out system-injected markup (not real user messages)
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.startsWith('<local-command-caveat>')) return '';
  if (trimmed.startsWith('<command-message>')) return '';
  if (trimmed.startsWith('<command-name>')) return '';
  if (trimmed.startsWith('<system-reminder>')) return '';
  if (trimmed.startsWith('<local-command-stdout>')) return '';

  return text.slice(0, 500);
}

// =============================================================================
// ANTIGEN EXTRACT - analyze_bad_session
// =============================================================================

function analyzeBadSession(sessionFile, analysis, signals) {
  const sessionId = analysis.session_id;

  const anchorSignals = [
    'user_intervention',
    'session_abandoned',
    'false_success',
    'interrupt_cascade',
  ];

  let anchors = signals.filter(s => s.session === sessionId && anchorSignals.includes(s.signal));

  if (anchors.length === 0) {
    const sessionSignals = signals.filter(s => s.session === sessionId);
    if (sessionSignals.length > 0) {
      anchors = [sessionSignals[sessionSignals.length - 1]];
    }
  }

  const candidates = [];

  for (const anchor of anchors) {
    const anchorTs = anchor.ts || '';
    const anchorSignal = anchor.signal || 'unknown';

    const window = extractContextWindow(sessionFile, anchorTs, 5);
    if (window.length === 0) continue;

    const allFiles = new Set();
    const allTools = [];
    const allErrors = [];
    const userMessagesArr = [];

    for (const turn of window) {
      const event = turn.event;
      for (const f of extractFilesFromTurn(event)) allFiles.add(f);
      allTools.push(...extractToolsFromTurn(event));
      allErrors.push(...extractErrorsFromTurn(event));
      if (turn.type === 'user') {
        const msg = extractUserMessage(event);
        if (msg && !msg.startsWith('[Request interrupted')) {
          userMessagesArr.push(msg);
        }
      }
    }

    // Build tool sequence string
    const toolSeq = [];
    for (const t of allTools) {
      if (t.action === 'call') {
        toolSeq.push(t.tool);
      } else if (t.action === 'error') {
        if (toolSeq.length > 0) toolSeq[toolSeq.length - 1] += ':error';
      } else if (t.action === 'success') {
        if (toolSeq.length > 0) toolSeq[toolSeq.length - 1] += ':ok';
      }
    }

    // Extract keywords
    const keywords = new Set();
    for (const msg of userMessagesArr) {
      const words = (msg.toLowerCase().match(/\b[a-z]{4,}\b/g) || []).slice(0, 20);
      for (const w of words) keywords.add(w);
    }

    const common = new Set([
      'this', 'that', 'with', 'from', 'have', 'what', 'when', 'where',
      'which', 'there', 'their', 'would', 'could', 'should', 'about',
      'been', 'were', 'they', 'them', 'then', 'than', 'these', 'those',
      'some', 'into', 'only', 'other', 'also', 'just', 'more', 'very',
      'here', 'after', 'before', 'being', 'doing', 'make', 'made',
      'like', 'want', 'need', 'file', 'code',
    ]);
    for (const c of common) keywords.delete(c);

    const candidate = {
      session_id: sessionId,
      anchor_signal: anchorSignal,
      anchor_ts: anchorTs,
      peak_friction: (analysis.friction_summary || {}).peak || 0,
      turns_in_window: window.length,
      files: Array.from(allFiles).sort().slice(0, 10),
      tool_sequence: toolSeq.slice(0, 15),
      errors: allErrors.slice(0, 5),
      keywords: Array.from(keywords).sort().slice(0, 15),
      user_context: userMessagesArr.slice(0, 3),
      inhibitory_instruction: '# TODO: Write prevention instruction based on pattern above',
    };

    candidates.push(candidate);
  }

  return candidates;
}

// =============================================================================
// ANTIGEN EXTRACT - clusterCandidates
// =============================================================================

function clusterCandidates(allCandidates) {
  const signalWeights = {
    user_intervention: 10,
    session_abandoned: 10,
    false_success: 8,
    no_resolution: 8,
    interrupt_cascade: 5,
    tool_loop: 6,
    rapid_exit: 6,
  };

  const clusterMap = {};

  for (const c of allCandidates) {
    // Normalize tool sequence: strip :error/:ok suffixes for grouping
    const toolNorm = c.tool_sequence
      .map(t => t.replace(/:error|:ok/g, ''))
      .join(',') || '(none)';
    const key = c.anchor_signal + '|' + toolNorm;

    if (!(key in clusterMap)) {
      clusterMap[key] = {
        anchor_signal: c.anchor_signal,
        tool_pattern: toolNorm,
        count: 0,
        sessions: {},
        contexts: [],
        errors: [],
        files: {},
        keywords: {},
        peaks: [],
      };
    }

    const cl = clusterMap[key];
    cl.count++;
    cl.sessions[c.session_id] = true;
    cl.peaks.push(c.peak_friction);

    // Collect unique user contexts (up to 5 per cluster, deduplicated)
    if (c.user_context.length > 0 && cl.contexts.length < 5) {
      for (const ctx of c.user_context.slice(0, 1)) {
        if (ctx.length > 10 && !cl.contexts.includes(ctx)) cl.contexts.push(ctx);
      }
    }

    // Collect unique errors (up to 5 per cluster)
    if (c.errors.length > 0 && cl.errors.length < 5) {
      for (const err of c.errors.slice(0, 1)) {
        if (!cl.errors.includes(err)) cl.errors.push(err);
      }
    }

    // Tally files and keywords
    for (const f of c.files) cl.files[f] = (cl.files[f] || 0) + 1;
    for (const kw of c.keywords) cl.keywords[kw] = (cl.keywords[kw] || 0) + 1;
  }

  // Score and sort clusters
  const clusters = Object.values(clusterMap).map(cl => {
    const weight = signalWeights[cl.anchor_signal] || 1;
    const peaks = cl.peaks.sort((a, b) => a - b);
    // Session IDs follow "project/dateStr-shortId", so the first segment is
    // the project. Preserve both the ID list and the deduped project set so
    // downstream renderers can surface which repos produced the cluster.
    const sessionIds = Object.keys(cl.sessions);
    const projects = [...new Set(
      sessionIds.map(s => s.includes('/') ? s.split('/')[0] : 'unknown')
    )].sort();
    return {
      anchor_signal: cl.anchor_signal,
      tool_pattern: cl.tool_pattern,
      count: cl.count,
      score: cl.count * weight,
      sessions: sessionIds.length,
      session_ids: sessionIds,
      projects: projects,
      median_peak: peaks[Math.floor(peaks.length / 2)],
      max_peak: peaks[peaks.length - 1],
      contexts: cl.contexts,
      errors: cl.errors,
      top_files: sortedEntries(cl.files).slice(0, 5).map(([f]) => f),
      top_keywords: sortedEntries(cl.keywords).slice(0, 10).map(([k]) => k),
    };
  });

  clusters.sort((a, b) => b.score - a.score);
  return clusters;
}

// =============================================================================
// ANTIGEN EXTRACT - main
// =============================================================================

function extractMain(sessionsDir) {
  // Load friction analysis
  const analysisFile = '.factory/friction/friction_analysis.json';
  if (!fs.existsSync(analysisFile)) {
    console.log('Error: Run friction analysis first to generate .factory/friction/friction_analysis.json');
    return 1;
  }

  const analyses = JSON.parse(fs.readFileSync(analysisFile, 'utf-8'));

  // Load raw signals
  const rawFile = '.factory/friction/friction_raw.jsonl';
  let signals = [];
  if (fs.existsSync(rawFile)) {
    const rawContent = fs.readFileSync(rawFile, 'utf-8');
    signals = rawContent.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  }

  // Find BAD sessions
  const badSessions = analyses.filter(a => a.quality === 'BAD');

  if (badSessions.length === 0) {
    console.log('No BAD sessions found. Nothing to extract.');
    return 0;
  }

  console.log(`Extracting antigens from ${badSessions.length} BAD sessions...\n`);

  // Extract antigens
  const allCandidates = [];
  const failed = [];

  const sortedBad = badSessions.slice().sort((a, b) =>
    ((b.friction_summary || {}).peak || 0) - ((a.friction_summary || {}).peak || 0)
  );

  for (const analysis of sortedBad) {
    const sessionId = analysis.session_id;
    const sessionFile = findSessionFile(sessionsDir, sessionId);

    if (!sessionFile) {
      failed.push(sessionId);
      continue;
    }

    const candidates = analyzeBadSession(sessionFile, analysis, signals);
    allCandidates.push(...candidates);
  }

  // Cluster candidates by (anchor_signal, tool_pattern)
  const clusters = clusterCandidates(allCandidates);

  // Terminal output
  console.log(`\u2713 ${allCandidates.length} raw candidates \u2192 ${clusters.length} clusters`);
  const top5 = clusters.slice(0, 5);
  for (const cl of top5) {
    console.log(`  ${String(cl.count).padStart(3)}x ${cl.anchor_signal} | ${cl.tool_pattern} (${cl.sessions} sessions, score: ${cl.score})`);
  }

  if (failed.length > 0) {
    console.log(`\n\u26A0  Could not find session files for ${failed.length} sessions`);
  }
  console.log();

  // Save outputs
  const outputDir = '.factory/friction';
  fs.mkdirSync(outputDir, { recursive: true });

  // Raw candidates (kept for debugging)
  fs.writeFileSync(path.join(outputDir, 'antigen_candidates.json'), JSON.stringify(allCandidates, null, 2));

  // Clustered output (primary artifact)
  fs.writeFileSync(path.join(outputDir, 'antigen_clusters.json'), JSON.stringify(clusters, null, 2));

  // Clustered review markdown (top 25)
  const maxClusters = 25;
  const reviewClusters = clusters.slice(0, maxClusters);
  const reviewLines = [];

  reviewLines.push('# Friction Antigen Clusters\n\n');
  reviewLines.push(`Generated: ${new Date().toISOString()}\n`);
  reviewLines.push(`BAD sessions: ${badSessions.length} | Raw candidates: ${allCandidates.length} | Clusters: ${clusters.length}\n\n`);

  // Summary table
  reviewLines.push('## Cluster Summary\n\n');
  reviewLines.push('| # | Signal | Tool Pattern | Count | Sessions | Projects | Score | Median Peak |\n');
  reviewLines.push('|---|--------|-------------|-------|----------|----------|-------|-------------|\n');
  reviewClusters.forEach((cl, idx) => {
    const projs = cl.projects || [];
    const projectsShort = projs.slice(0, 3).join(', ') +
      (projs.length > 3 ? `, +${projs.length - 3}` : '');
    reviewLines.push(`| ${idx + 1} | ${cl.anchor_signal} | ${cl.tool_pattern} | ${cl.count} | ${cl.sessions} | ${projectsShort || '-'} | ${cl.score} | ${cl.median_peak} |\n`);
  });
  reviewLines.push('\n---\n\n');

  // Detailed clusters
  reviewClusters.forEach((cl, idx) => {
    reviewLines.push(`## Cluster ${idx + 1}: ${cl.anchor_signal} | ${cl.tool_pattern}\n\n`);
    reviewLines.push(`**Occurrences:** ${cl.count} across ${cl.sessions} sessions | **Score:** ${cl.score} | **Median peak:** ${cl.median_peak} | **Max peak:** ${cl.max_peak}\n\n`);
    if (cl.projects && cl.projects.length > 0) {
      reviewLines.push(`**Projects:** ${cl.projects.join(', ')}\n\n`);
    }

    if (cl.contexts.length > 0) {
      reviewLines.push('### User Context (what the user said)\n\n');
      for (const ctx of cl.contexts.slice(0, 3)) {
        const truncated = ctx.length > 300 ? ctx.slice(0, 300) + '...' : ctx;
        reviewLines.push(`> ${truncated}\n\n`);
      }
    }

    if (cl.errors.length > 0) {
      reviewLines.push('### Errors\n\n');
      reviewLines.push('```\n');
      for (const err of cl.errors.slice(0, 3)) {
        reviewLines.push(`${err}\n`);
      }
      reviewLines.push('```\n\n');
    }

    if (cl.top_files.length > 0) {
      reviewLines.push('### Files involved\n\n');
      for (const f of cl.top_files) {
        reviewLines.push(`- \`${f}\`\n`);
      }
      reviewLines.push('\n');
    }

    if (cl.top_keywords.length > 0) {
      reviewLines.push(`**Keywords:** ${cl.top_keywords.join(', ')}\n\n`);
    }

    reviewLines.push('---\n\n');
  });

  fs.writeFileSync(path.join(outputDir, 'antigen_review.md'), reviewLines.join(''));
  console.log('Output: .factory/friction/antigen_review.md\n');

  return 0;
}

// =============================================================================
// PIPELINE ENTRY POINT
// =============================================================================

function main() {
  if (process.argv.length < 3) {
    console.log(`
Friction analysis pipeline - analyze sessions and extract antigens.

Usage:
    node friction.js <sessions-directory>
    node friction.js ~/.claude/projects/-home-hamr-PycharmProjects-liteagents/

Outputs (all in .factory/friction/):
    friction_analysis.json   - Per-session analysis
    friction_summary.json    - Aggregate stats
    friction_raw.jsonl       - Raw signals
    antigen_candidates.json  - Raw antigen candidates
    antigen_clusters.json    - Clustered antigen patterns
    antigen_review.md        - Clustered review file
`);
    return 1;
  }

  const sessionsDir = process.argv[2];

  if (!fs.existsSync(sessionsDir)) {
    console.log(`Error: ${sessionsDir} does not exist`);
    return 1;
  }

  console.log('='.repeat(60));
  console.log(' FRICTION ANALYSIS PIPELINE');
  console.log('='.repeat(60));

  // Step 1: Analyze sessions
  console.log('\n[1/2] Analyzing sessions...\n');
  analyzeMain(sessionsDir);

  // Check if analysis produced output
  const analysisFile = '.factory/friction/friction_analysis.json';
  if (!fs.existsSync(analysisFile)) {
    console.log('\nNo analysis output. Check session directory.');
    return 1;
  }

  // Step 2: Extract antigens
  console.log('\n' + '='.repeat(60));
  console.log('\n[2/2] Extracting antigens from BAD sessions...\n');
  extractMain(sessionsDir);

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log(' DONE');
  console.log('='.repeat(60));

  const reviewFile = '.factory/friction/antigen_review.md';
  if (fs.existsSync(reviewFile)) {
    console.log('\nReview your antigens:');
    console.log(`  cat ${reviewFile}`);
    console.log('\nOr feed to LLM:');
    console.log(`  cat ${reviewFile} | claude "write CLAUDE.md rules to prevent these patterns"`);
  }

  return 0;
}

process.exit(main());
