# Mount Morgan: Gold Rush dossier

Built by Takar from Telegraph miners on 2026-11-21T16:14:19.801Z. Every finding names its record; figures are never merged or estimated; conflicts are shown side by side. Signed with Ed25519 (see the JSON).

## Identity

- GSQ site 494270 (goldrush-qld-history) and 494270 (OathCast, live MINOCC): **same site**.
- ABANDONED MINE, 36 KM SOUTH-WEST OF ROCKHAMPTON, 90KM WNW OF GLADSTONE..

## Gold production

| Tonnes | As recorded | Period | Working | Source | Quote |
|---|---|---|---|---|---|
| 250 | 250 t | 1882–1990 | Mount Morgan mine (site\_total) | [QLDGOV-MM](https://www.qld.gov.au/environment/land/management/abandoned-mines/remediation-projects/mount-morgan) |  "with about 250 tonnes of gold and 360,000 tonnes of copper extracted from the mine" |
| 262 | 262 t | 1882–1981 | Mount Morgan mine (site\_total) | [WP-MM](https://en.wikipedia.org/w/index.php?title=Mount_Morgan_Mine&oldid=1368226293) |  "the mine yielded approximately 262 metric tons" |
| 294.1 | 294056 kg | ?–1990 (end year from its dated rows) | Mount Morgan (site\_total) | [MINOCC-2017:Total\_Ores\_Prod:494270](https://geoscience.data.qld.gov.au/dataset/ds000004) |  "Total\_Ores\_Prod: 294056 KG Au 36842 KG Ag 360616 T Cu \(Ore Amount 102000000 tonnes\)" |
| 1.8 | 1835 kg | ?–? | Mount Morgan (period) | [MINOCC-2017:Production:494270:1](https://geoscience.data.qld.gov.au/dataset/ds000004) |  "Production: 1835 KG GOLD BULLION \(Ore Amount T; Ore Type OXIDE ORE\)" |
| 157.3 | 157273 kg | ?–1927 | Mount Morgan (period) | [MINOCC-2017:Production:494270:2](https://geoscience.data.qld.gov.au/dataset/ds000004) |  "Production: 157273 KG GOLD BULLION 116175 T COPPER MATTE \(Ore Amount 8600000 T; Ore Type SULPHIDE ORE\)" |
| 78.8 | 78788 kg | 1929–1982 | Mount Morgan (period) | [MINOCC-2017:Production:494270:3](https://geoscience.data.qld.gov.au/dataset/ds000004) |  "Production: 78788 KG GOLD FINE 244441 T COPPER MATTE 36842 KG SILVER METAL 568000 T PYRITE METALLURGICAL ORE \(Ore Amount 41400000 T; Ore Type SULPHIDE ORE\)" |
| 56.2 | 56160 kg | 1983–1990 | Mount Morgan (period) | [MINOCC-2017:Production:494270:4](https://geoscience.data.qld.gov.au/dataset/ds000004) |  "Production: 56160 KG GOLD BULLION 1.08 G/T \(Ore Amount 52000000 T; Ore Type DUMP\)" |

- **Sum check (MINOCC-2017):** 4 dated rows add up to 294.1 t; the register's site total is 294.1 t: consistent.
- **close:** QLDGOV-MM vs WP-MM: within 5% (250 t and 262 t) over different periods (1882–1990 and 1882–1981); the shorter period reports slightly more, so they may count differently.
- **conflict:** QLDGOV-MM vs MINOCC-2017:Total_Ores_Prod:494270: same period (1882–1990), 250 t against 294.1 t, 15% apart. Candidate explanation: MINOCC-2017 includes 56.2 t from dumps or tailings (1983–1990); without it, 237.9 t, 5% from 250 t. Needs the record to confirm.
- **not comparable:** WP-MM vs MINOCC-2017:Total_Ores_Prod:494270: different periods (1882–1981 and ?–1990).
- Like for like: MINOCC-2017's dated rows to 1990 sum to 294.1 t, against 250 t in QLDGOV-MM.
- Like for like: MINOCC-2017's dated rows to 1982 sum to 237.9 t, against 262 t in WP-MM.
- **Size band** (OathCast (live MINOCC)): giant, over 150 t; the register's total 294.1 t is inside it.

## Why it stopped

- **1927** (single source): The Mount Morgan Gold Mining Company Limited operated using underground mining methods until 1927 when fire destroyed underground workings. The company deliberately flooded its underground workings in response to the fire and went into liquidation. *[not geological (fire), WP-MM]*
  - [WP-MM](https://en.wikipedia.org/w/index.php?title=Mount_Morgan_Mine&oldid=1368226293) on Mount Morgan Gold Mining Company underground workings: "until 1927 when fire destroyed underground workings"
- **1981** (single source): Mount Morgan Limited progressively scaled back its workforce and operations until it reached the end of its ore body in 1981. *[geological exhaustion, WP-MM]*
  - [WP-MM](https://en.wikipedia.org/w/index.php?title=Mount_Morgan_Mine&oldid=1368226293) on Mount Morgan mine: "until it reached the end of its ore body in 1981"
- **1990** (two sources): *no source states a reason*
  - [QLDGOV-MM](https://www.qld.gov.au/environment/land/management/abandoned-mines/remediation-projects/mount-morgan) on Mount Morgan mine: "with its mining operations continuing until November 1990"
  - [MINOCC-2017:MineHist:494270:6](https://geoscience.data.qld.gov.au/dataset/ds000004) on Mount Morgan: "MineHist \#6: Start Year 1981, End Year 1990, Tailings retreated by Mount Morgan Ltd."

### What research miners say about the unexplained closures (not records)

- **1990**: single source.
  - TxLens, naming ore exhausted, price, cost or capital: "The Mount Morgan gold mine in Queensland ceased operations in 1990 because its ore bodies were largely exhausted and the remaining reserves could not be mined profitably. By the late 1980s production had fallen sharply, and falling gold prices combined with high operating costs made further extracti" [signal 0x128ce8b5…](https://devnode.telegraphprotocol.com/engine/v1/signal/0x128ce8b5180d6e1c20cdc0b2edf46545e7ee0987aa467798062dbc977f8bafed)

Two research answers naming the same kind of cause is a lead to check in the record, not a finding.

## Gold price then and now

- At the last closure year (1990): US$410 per ounce (Gold, monthly average per troy ounce (World Bank Pink Sheet, nominal US dollars) from 1960).
- Latest: US$4105 per ounce in October 2026 (Gold, monthly average per troy ounce (World Bank Pink Sheet, nominal US dollars) from 1960), single source.
- About 10x the closure-year price. Nominal dollars, not adjusted for inflation; the closure-year figure may be an official price rather than a market one (see its text).
- In real terms (US CPI, [FRED CPIAUCNS](https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS); prices rose 2.58x since 1990): about **3.88x**.

## Who controls it today (company registers)

- **Norton Gold Fields Limited**: not established (fewer than two usable answers).
- **Heritage Minerals Pty Ltd**: active, per two registers from different operators (20260828 and 6110114), registered as HERITAGE MINERALS PTY LTD.
- **Mount Morgan Limited**: not established (fewer than two usable answers).

A register's status is not a mining tenure: who holds the lease today needs the tenure register.

## Who held it

- Norton Gold Fields Limited (?–?, principal holder of mining lease 5589, mining lease 5602, mining lease 5608, mining lease 5609, mining lease 5612, mining lease 5613, mining lease 5616, mining lease 5618, mining lease 5620, mining lease 5623, mining lease 5624, mining lease 5625, mining lease 5633, mining lease 5634, mining lease 5659, mining lease 5660, mining lease 6692 \(MINOCC Tenure table, as at the 2017 release; no dates recorded\)) [MINOCC-2017:Tenure:494270] "Tenure: Principal Holder Name NORTON GOLD FIELDS LIMITED; MINING LEASE 5589, MINING LEASE 5602, MINING LEASE 5608, MINING LEASE 5609, MINING LEASE 5612, MINING LEASE 5613, MINING LEASE 5616, MINING LEASE 5618, MINING LEASE 5620, MINING LEASE 5623, MINING LEASE 5624, MINING LEASE 5625, MINING LEASE 5633, MINING LEASE 5634, MINING LEASE 5659, MINING LEASE 5660, MINING LEASE 6692"
- Heritage Minerals Pty Ltd (?–?, company listed by Geoscience Australia \(status: historic mine\)) [GA-MINERALDEPOSITS-333486] "COMPANIES: Heritage Minerals Pty Ltd"
- Heritage Minerals Pty Ltd (2020–?, mining lease holder \(transfer of mining leases in 2020\)) [QLDGOV-MM] "as part of the transfer of mining leases to Heritage Minerals in 2020"
- Norton Gold Fields (2007–?, lease holder) [WP-MM] "Since 2007 the mine and mining leases have been owned by Norton Gold Fields"
- Queensland Government \(legacy site management\) (1993–?, site manager) [QLDGOV-MM] "We subsequently took over management of the legacy issues at the mine in January 1993"
- Peko-Wallsend \(parent of Mount Morgan Limited\) (1968–?, parent company) [WP-MM] "Mount Morgan Limited became a subsidiary of Peko-Wallsend in 1968"
- Mount Morgan Limited (1928–1990, operator) [WP-MM] "operating as Mount Morgan Limited"
- Mount Morgan Gold Mining Company Limited (1886–1928, operator) [WP-MM] "In October 1886, the syndicate became the Mount Morgan Gold Mining Company Limited"

## Open questions (what the records do not settle)

- why it stopped in 1990: no source quotes a reason; do not assume exhaustion
- who controls it: Norton Gold Fields Limited could not be confirmed in two company registers \(fewer than two usable answers\); check ASIC directly
- who controls it: Mount Morgan Limited could not be confirmed in two company registers \(fewer than two usable answers\); check ASIC directly
- production: QLDGOV-MM and MINOCC-2017:Total\_Ores\_Prod:494270 conflict \(same period \(1882–1990\), 250 t against 294.1 t, 15% apart. Candidate explanation: MINOCC-2017 includes 56.2 t from dumps or tailings \(1983–1990\); without it, 237.9 t, 5% from 250 t. Needs the record to confirm\); check whether they count recovered or contained gold, and whether tailings retreatment is included

## Receipts

3 of 7 production figures from the miner's structured record also appear word for word in the answer bought through Telegraph.

- Gold Rush Queensland Mine History (7310050), RESEARCH_QUERY_GENERAL: [Telegraph signal 0x15762118…](https://devnode.telegraphprotocol.com/engine/v1/signal/0x1576211842e39f4e3a2d12374953e30e387ec32cbac6342799c208982d37a296), $0.01; node rank for the intent: #13 of 30
- OathCast Queensland Gold Mines (64176), RESEARCH_QUERY_GENERAL: [Telegraph signal 0xbfcb0d3c…](https://devnode.telegraphprotocol.com/engine/v1/signal/0xbfcb0d3c2b0e8a72b9a2fda9e599ad4a1da0d0f774b79c19af8e2779d9207010), $0.01; node rank for the intent: #15 of 30
- Gold Rush Queensland Mine History (7310050), RESEARCH_QUERY_GENERAL: [Telegraph signal 0x8d880417…](https://devnode.telegraphprotocol.com/engine/v1/signal/0x8d880417bb026548a329097fe1e82c85ff27d297ed828fd4f913bd40eb7fad94), $0.01; node rank for the intent: #13 of 30
- Gold Rush Queensland Mine History (7310050), RESEARCH_QUERY_GENERAL: [Telegraph signal 0x537da18e…](https://devnode.telegraphprotocol.com/engine/v1/signal/0x537da18e8c257b3ff46e883578d1bb18e97e5af07c77c2dcd2947d9069e1cb58), $0.01; node rank for the intent: #13 of 30

Rank is shown next to the evidence, never in place of it.
