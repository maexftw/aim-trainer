# Pro Aim Sens Optimizer

Ein leichtgewichtiger, lokaler Aim-Trainer für Windows zur mathematischen Optimierung deiner Mauseinstellungen (Empfindlichkeit/DPI) für verschiedene Spiele wie **Gray Zone Warfare**, **Helldivers 2**, **Far Cry 6** und **Ready or Not**.

## Features
- **Lokale Ausführung**: Keine Installation oder Web-Server erforderlich – einfach `index.html` im Browser per Doppelklick öffnen.
- **Pointer Lock API**: Sperrt den Mauszeiger, um echte In-Game-Mausbewegungen und Sensitivitäts-Multiplikatoren präzise zu simulieren.
- **Biophysikalische Metriken**: Misst Präzision, Reaktionszeit (ms), Pfad-Effizienz (Geradlinigkeit) sowie Overshoot- (Übersteuern) und Undershoot-Raten (Abbremsen).
- **Leistungskurve (Fitts's Law)**: Berechnet über eine quadratische Regressionsanalyse deinen idealen Sensitivitäts-Multiplikator auf Basis deines motorischen Durchsatzes (Throughput).
- **Direkte In-Game Umrechnung**: Berechnet sofort die Ziel-Sensitivität für deine Spiele (z.B. Gray Zone Warfare, Helldivers 2, Far Cry 6, Ready or Not, CS2/Valorant, Apex, CoD) basierend auf deinen aktuellen Werten.
- **KI-Coach Integration**: Bietet einen Button, um deine Bewegungsstatistiken formatiert zu kopieren, damit ein LLM (wie Deepseek oder ChatGPT) dir mechanische Ratschläge geben kann.

## Verwendung
1. Klicke in der Sidebar auf **Sensitivity Calibration**.
2. Durchlaufe die 5 Testphasen (jede dauert 30 Sekunden) bei simulierten Geschwindigkeiten (0.6x bis 1.4x deines Trainer-Tempos).
3. Sieh dir deine Leistungskurve und die empfohlene In-Game-Sensitivität für dein Zielspiel an.
4. Trage die berechnete Sensitivität in deine Spielkonfiguration ein (z.B. in der `GameUserSettings.ini` bei Gray Zone Warfare oder Ready or Not).

## Technologie
- HTML5 Canvas
- CSS (Vanilla, Dark/Cyberpunk-Theme mit Glassmorphismus)
- JavaScript (100% lokal, offline-fähig, synthesisiert Audio über die Web Audio API)
