/**
 * Biomechanical Motor Control & Sensitivity Analyzer
 * Focuses strictly on physical mouse metrics, trajectory analysis, and game conversion.
 */

const PerformanceAnalyzer = {
    // Calculates metrics for a single round of clicks
    calculateSessionMetrics(runs, gameDuration) {
        if (!runs || runs.length === 0) {
            return {
                precision: 0,
                avgReactionTime: 0,
                avgPathEfficiency: 0,
                overshootRate: 0,
                undershootRate: 0,
                avgThroughput: 0,
                avgJitter: 0,
                totalClicks: 0,
                totalHits: 0
            };
        }

        let totalClicks = runs.length;
        let totalHits = runs.filter(r => r.isHit).length;
        let precision = (totalHits / totalClicks) * 100;

        let totalReactionTime = 0;
        let validReactionCount = 0;
        let totalPathEfficiency = 0;
        let overshootCount = 0;
        let undershootCount = 0;
        let totalThroughput = 0;
        let totalJitter = 0;

        runs.forEach(run => {
            if (run.isHit) {
                const mt = (run.clickTime - run.spawnTime) / 1000;
                if (mt > 0) {
                    totalReactionTime += (run.clickTime - run.spawnTime);
                    validReactionCount++;

                    const dx = run.targetX - run.startX;
                    const dy = run.targetY - run.startY;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    const w = run.targetRadius * 2;

                    if (d > 0 && w > 0) {
                        const id = Math.log2((d / w) + 1);
                        const throughput = id / mt;
                        totalThroughput += throughput;
                    }
                }
            }

            if (run.cursorPath && run.cursorPath.length > 1) {
                const startP = { x: run.startX, y: run.startY };
                const targetP = { x: run.targetX, y: run.targetY };
                
                const dx = targetP.x - startP.x;
                const dy = targetP.y - startP.y;
                const d = Math.sqrt(dx * dx + dy * dy);

                let actualPathLength = 0;
                for (let i = 1; i < run.cursorPath.length; i++) {
                    const px = run.cursorPath[i].x - run.cursorPath[i - 1].x;
                    const py = run.cursorPath[i].y - run.cursorPath[i - 1].y;
                    actualPathLength += Math.sqrt(px * px + py * py);
                }

                if (actualPathLength > 0 && d > 0) {
                    const efficiency = (d / actualPathLength) * 100;
                    totalPathEfficiency += Math.min(100, efficiency);
                }

                if (d > 0) {
                    const ux = dx / d;
                    const uy = dy / d;
                    let maxProjectedDistance = 0;
                    let hasStoppedShort = false;
                    let maxPerpendicularDistance = 0;

                    run.cursorPath.forEach((pt, idx) => {
                        const wx = pt.x - startP.x;
                        const wy = pt.y - startP.y;
                        
                        const proj = wx * ux + wy * uy;
                        maxProjectedDistance = Math.max(maxProjectedDistance, proj);

                        const perpX = wx - proj * ux;
                        const perpY = wy - proj * uy;
                        const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);
                        maxPerpendicularDistance = Math.max(maxPerpendicularDistance, perpDist);

                        if (idx > 0 && idx < run.cursorPath.length - 1) {
                            const prevPt = run.cursorPath[idx - 1];
                            const dt = pt.t - prevPt.t;
                            if (dt > 0) {
                                const stepD = Math.sqrt((pt.x - prevPt.x) ** 2 + (pt.y - prevPt.y) ** 2);
                                const speed = stepD / dt;
                                const distToTarget = Math.sqrt((pt.x - targetP.x) ** 2 + (pt.y - targetP.y) ** 2);
                                if (speed < 0.05 && distToTarget > run.targetRadius * 1.5 && proj > d * 0.3 && proj < d * 0.9) {
                                    hasStoppedShort = true;
                                }
                            }
                        }
                    });

                    if (maxProjectedDistance > d + run.targetRadius) {
                        overshootCount++;
                    } else if (hasStoppedShort) {
                        undershootCount++;
                    }

                    totalJitter += maxPerpendicularDistance;
                }
            } else {
                totalPathEfficiency += 100;
            }
        });

        const avgReaction = validReactionCount > 0 ? (totalReactionTime / validReactionCount) : 0;
        const avgEfficiency = totalClicks > 0 ? (totalPathEfficiency / totalClicks) : 0;
        const overshootRate = totalClicks > 0 ? (overshootCount / totalClicks) * 100 : 0;
        const undershootRate = totalClicks > 0 ? (undershootCount / totalClicks) * 100 : 0;
        const avgThroughput = validReactionCount > 0 ? (totalThroughput / validReactionCount) : 0;
        const avgJitter = totalClicks > 0 ? (totalJitter / totalClicks) : 0;

        return {
            precision: parseFloat(precision.toFixed(1)),
            avgReactionTime: Math.round(avgReaction),
            avgPathEfficiency: parseFloat(avgEfficiency.toFixed(1)),
            overshootRate: parseFloat(overshootRate.toFixed(1)),
            undershootRate: parseFloat(undershootRate.toFixed(1)),
            avgThroughput: parseFloat(avgThroughput.toFixed(2)),
            avgJitter: parseFloat(avgJitter.toFixed(1)),
            totalClicks,
            totalHits
        };
    },

    // Fits a 2nd-degree polynomial curve (Parabola) to 5 calibration runs
    fitPerformanceCurve(calibrationRuns) {
        if (!calibrationRuns || calibrationRuns.length < 3) {
            return { optimalMultiplier: 1.0, coefficients: [0, 0, 1.0], vertexValid: false };
        }

        const n = calibrationRuns.length;
        let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0;
        let sumY = 0, sumXY = 0, sumX2Y = 0;

        calibrationRuns.forEach(run => {
            const x = run.multiplier;
            const y = run.throughput;
            const x2 = x * x;

            sumX += x;
            sumX2 += x2;
            sumX3 += x2 * x;
            sumX4 += x2 * x2;
            sumY += y;
            sumXY += x * y;
            sumX2Y += x2 * y;
        });

        const det = (sumX4 * (sumX2 * n - sumX * sumX)) - 
                    (sumX3 * (sumX3 * n - sumX2 * sumX)) + 
                    (sumX2 * (sumX3 * sumX - sumX2 * sumX2));

        if (Math.abs(det) < 1e-5) {
            let maxThroughput = -1;
            let bestMult = 1.0;
            calibrationRuns.forEach(r => {
                if (r.throughput > maxThroughput) {
                    maxThroughput = r.throughput;
                    bestMult = r.multiplier;
                }
            });
            return { optimalMultiplier: bestMult, coefficients: [0, 0, maxThroughput], vertexValid: false };
        }

        const detA = (sumX2Y * (sumX2 * n - sumX * sumX)) - 
                     (sumX3 * (sumXY * n - sumY * sumX)) + 
                     (sumX2 * (sumXY * sumX - sumY * sumX2));

        const detB = (sumX4 * (sumXY * n - sumY * sumX)) - 
                     (sumX2Y * (sumX3 * n - sumX2 * sumX)) + 
                     (sumX2 * (sumX3 * sumY - sumX2 * sumXY));

        const detC = (sumX4 * (sumX2 * sumY - sumX * sumXY)) - 
                     (sumX3 * (sumX3 * sumY - sumX2 * sumXY)) + 
                     (sumX2Y * (sumX3 * sumX - sumX2 * sumX2));

        const A = detA / det;
        const B = detB / det;
        const C = detC / det;

        let optimalMultiplier = 1.0;
        let vertexValid = false;

        if (A < 0) {
            optimalMultiplier = -B / (2 * A);
            vertexValid = true;
        } else {
            let maxVal = -Infinity;
            let bestX = 1.0;
            for (let x = 0.4; x <= 2.0; x += 0.05) {
                const val = A * x * x + B * x + C;
                if (val > maxVal) {
                    maxVal = val;
                    bestX = x;
                }
            }
            optimalMultiplier = bestX;
        }

        optimalMultiplier = Math.max(0.4, Math.min(2.0, optimalMultiplier));
        optimalMultiplier = parseFloat(optimalMultiplier.toFixed(2));

        return {
            optimalMultiplier,
            coefficients: [A, B, C],
            vertexValid
        };
    },

    // Generates biomechanical coaching feedback in German
    generateCoachingText(metrics, optimalSens, currentSens, dpi) {
        const changePct = Math.round(Math.abs(optimalSens - currentSens) / currentSens * 100);
        let actionWord = optimalSens > currentSens ? "erhöhen" : "verringern";
        
        let analysis = "";
        
        if (Math.abs(optimalSens - currentSens) < 0.05) {
            analysis += `Deine aktuelle Mausempfindlichkeit (${currentSens}x bei ${dpi} DPI) ist mathematisch optimal für deine Handkoordination. `;
        } else {
            analysis += `Die Messungen empfehlen eine Anpassung deiner Sensitivität um ca. <strong>${changePct}% ${actionWord}</strong> (Neuer Multiplikator-Faktor: <strong>${optimalSens}x</strong>). `;
        }

        if (metrics.overshootRate > 25) {
            analysis += `<br><br>Du hast eine <strong>Overshoot-Rate von ${metrics.overshootRate}%</strong>. Das bedeutet, dass der Mauszeiger über das Ziel hinausschießt und zurückgezogen werden muss. 
            Wenn dieser Wert bei <em>niedrigen</em> Geschwindigkeiten auftritt, liegt es meist an der Trägheit des Arms (zu viel Schwungmasse). Bei <em>hohen</em> Geschwindigkeiten fehlt oft die feinmotorische Kontrolle in den Fingern.`;
        } else if (metrics.undershootRate > 25) {
            analysis += `<br><br>Deine <strong>Undershoot-Rate liegt bei ${metrics.undershootRate}%</strong>. Du brachst zu lange, um das Ziel zu erreichen, weil du die Bewegung zu früh stoppst und korrigieren musst. Dies erhöht deine durchschnittliche Reaktionszeit auf ${metrics.avgReactionTime} ms.`;
        }

        if (metrics.avgPathEfficiency < 80) {
            analysis += `<br><br>Deine <strong>Bewegungs-Geradlinigkeit beträgt ${metrics.avgPathEfficiency}%</strong>. Das bedeutet, dass deine Mausbahnen Kurven oder leichtes Zittern aufweisen. Versuche, die Bewegung bewusster aus dem Gelenk heraus zu stabilisieren und das Ziel vor dem Start fest anzuvisieren.`;
        } else {
            analysis += `<br><br>Deine <strong>Bewegungs-Geradlinigkeit ist mit ${metrics.avgPathEfficiency}% sehr stabil und direkt</strong>.`;
        }

        return analysis;
    },

    // Generates text that can be copied into Deepseek/ChatGPT
    generateDeepseekPrompt(metrics, calibrationRuns, currentSens, dpi) {
        let runText = calibrationRuns.map(r => `- Sens-Multiplikator: ${r.multiplier}x -> Durchsatz: ${r.throughput} bits/s, Präzision: ${r.precision}%, Overshoot: ${r.overshootRate}%`).join('\n');
        
        return `Verhalte dich als strategischer Aiming- und E-Sports-Coach. Analysiere mein motorisches Fehlerprofil basierend auf meinen Kalibrierungsdaten kurz, prägnant und lösungsorientiert. 

DATEN:
- Aktuelle Sensitivität: ${currentSens}x bei ${dpi} DPI (Hardware-DPI der Maus)
- Reaktionszeit: ${metrics.avgReactionTime} ms
- Bewegungspfad-Effizienz: ${metrics.avgPathEfficiency}%
- Overshoot-Rate: ${metrics.overshootRate}% (Maus schießt über das Ziel)
- Undershoot-Rate: ${metrics.undershootRate}% (Maus stoppt vor dem Ziel)
- Durchschnittlicher Durchsatz: ${metrics.avgThroughput} bits/s

MESSREIHE DER KALIBRIERUNG:
${runText}

Aufgabe: Welchen konkreten Multiplikator-Wechsel empfiehlst du für meine Spiele? Gib mir 2 direkte, mechanische Trainingstipps zur Mausführung (z.B. Grifftechnik, Handgelenk- vs. Arm-Nutzung), um meinen Overshoot zu senken und die Präzision zu steigern.`;
    }
};
