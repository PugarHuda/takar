### App / mission / integration

Takar — Season II Apps & Agents, Mission 11 Autonomous Systems (fleet units that buy a storm check before they fly or drive). Code and full purchase ledger: https://github.com/PugarHuda/takar (`receipts/ledger.jsonl`).

### What is supposed to work?

Before a drone or rover starts a task, Takar buys a storm check for the task's place and window with a canonical ask:

```
POST /engine/v1/ask
{"intent":"STORM_ALERT_GENERAL","params":{"location":"Makassar","window_hours":3}}
```

It expects an answer about that place in the intent's format (`risk_level`, `risk_score`, `peak_gust_kmh`, `precipitation_mm`, `window`) and decides GO / HOLD from it.

Instead, routed asks for three Indonesian locations went to miner 37007 (GDACS Tropical Cyclone Events), which returns the global GDACS event feed whatever location is asked. Every answer described Tropical Cyclone AKVAN-26 in India.

### What blocks it?

- **The location is lost.** Miner 37007's endpoint lists current GDACS cyclone events and does not take a place, so the `location` param has no effect on the answer.
- **The answer can look valid.** Usually it comes back `result_shape: "raw"`. But in one case it was shaped into the intent's format with `peak_gust_kmh: 296` and every other field null. 296 km/h is the Indian cyclone's wind. An app that reads only `peak_gust_kmh` would act on a storm in another country.
- **The next-ranked miner was not usable either.** Routed asks to 20260828 (PREFLIGHT) for Palangka Raya came back in the intent's shape with every field null, and were charged.
- **No fallback.** Direct canonical asks to 37004 and 37008 returned `503 no_compatible_miner` (not charged, which is right).

Takar fails closed (HOLD) on unusable answers and re-buys from the next-ranked miner. Any app trusting the routed answer gets another country's storm.

### Public-safe evidence / reproduction

17 Nov 2026, Ethereum Sepolia, canonical asks at $0.01 each, payer 0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E.

| location (window) | miner | shape | signal | settlement tx |
|---|---|---|---|---|
| Palangka Raya (4h) | 37007 | raw — AKVAN-26, India | 0xe521a8231c2d72fc91f3d3dd637e2e23acc14300b8fbe6e61b9a86266e0519d2 | 0xbca4fcedd8760bf13f012e6145e60746ad6c45e83ad8f912669eef81af2607a3 |
| Makassar (3h) | 37007 | raw — AKVAN-26, India | 0x89d110091336cca74cf2562f74c6bb27d2452802a554c0e5d43cea00a3f0b76f | 0x336113d16f73268fb76dc7d8a43a22665d3057a33d6e50f9d3ca07c752019b24 |
| Bandung (5h) | 37007 | raw — AKVAN-26, India | 0xd4303bc80f955a3e7572ce818deb2022eef9760a0a83856d8ee4b1e75e519d5d | 0x42a7ecc0d6158b56001f00b1fe0d04fb7d98773672c06c8a904979e6007e70d8 |
| Bandung (5h) | 37007 | intent — `peak_gust_kmh: 296`, rest null | 0x8cfd7256774565a46c71ef14e88c64922ed9b0d472141108bfc8327d47b50091 | 0x268302565be7285a507096282861f1e2b72639bc2208219396016aab6f5a34a8 |
| Palangka Raya (4h) | 20260828 | intent — all fields null | 0xeddc87c0a681490a68f81d530c417e624186d31fd38de8a583bb04d05ca33917 | 0x80a40d1789367501932eaa94f05b116257913de0a4d6e3938ce01dad60453587 |

For comparison, these asks were answered correctly:
- Routed ask for Makassar served by 20260828: `risk_level LOW`, `peak_gust_kmh 22.3`. The Makassar airport station (METAR WAAA) measured 17 km/h at the same hour, so the two agree. Signal 0xb9315bb124dd1e28d459f9b71f01b74001bc030c6985f8b33bb4dc51c58fcf94.
- Direct canonical ask for Bandung to 20260828: an intent-shaped answer about Bandung. Signal 0x60a0f8895078a32c9a870273df7aa238b23e6fa98f1d6de52513129ff31fa9de.

Each signal can be checked at `GET /engine/v1/signal/{hash}`; the stored `request` field shows the location that was asked.

Disclosure: I'm a Season II participant (Takar, Mission 11). I don't run a miner on this intent.

### What observable result would make the App unblocked?

A canonical `STORM_ALERT_GENERAL` ask with a `location` returns, from whichever miner is chosen, an answer about that location in the intent's format. Or the node returns `no_compatible_miner` instead of an answer that ignores the input.

Two changes would each fix it:
- Keep miners whose endpoint cannot take a location out of canonical routing for this intent.
- Have the shaper refuse a field it read from an event that is not at the requested place.
