# Stage 1–2: Research paper analysis & market research

## 1. The uploaded paper — what it is
*"Lowest-Cost Air and Sea Freight Strategy for High Tower Engineering (Singapore to Oman)"* — a landed-freight model for SMC invoice 18000802 (265 kg gross, 1.76 m³, 2 pallets, USD 11,163.97) from Tuas, Singapore to Southern Ghubrah, Muscat, with benchmarks as of 13 Nov 2026. Its own caveat matters: none of the five providers published binding SIN→Oman spot rates without login/RFQ, so its figures are **scenario models anchored to official tariffs** — they are imported into the app as **Market Benchmarks**, never as quotations.

## 2. Findings carried into the application

| Paper finding | Where it lives in the app |
|---|---|
| Sea LCL direct to Sohar is lowest cost (USD 747–1,405, 18–28 d); consolidated air USD 1,169–1,880 (3–6 d); express as-is pallets costliest | `src/data/benchmarks.seed.js` (4 lane benchmarks with itemised charge layers) |
| Chargeable rules: air ÷6000, express ÷5000 (verify contract divisor), LCL 1 m³ = 1 t with 1 RT minimum | `src/engine/shipment.js` |
| Base ocean rate is only ~18% of LCL total; fixed CFS/D/O/Bayan/LTL dominate small shipments | Coverage check: a quote is "like-for-like" only if it covers every category the requested scope needs (`compare.requiredCategories`) |
| Express pallet traps: DHL Oman OMR 125/non-stackable pallet, OMR 8.25/overweight piece | Advisory triggered by >70 kg or palletised pieces |
| Volumetric waste below 166.67 kg/m³ | Density advisory |
| Port Sultan Qaboos closed to commercial cargo since 2014; Hormuz disruption → route via Sohar/Salalah, not Jebel Ali/Khalifa | Oman advisories + admin toggle `hormuz_advisory_active` |
| Maersk Sohar IMP fee USD 500/20', 1,000/40' (from 15 Sep 2026) | FCL advisory; RFQ template asks for Oman charges in OMR |
| Landed tax: duty (0%/5%) on CIF, 5% VAT on CIF+duty (recoverable), Bayan OMR 15, OMR 10/amendment | Landed-cost calculator + advisory |
| GSFTA Form No. 1 only worthwhile if SG-origin value × duty > ~USD 60 | SG→OM advisory |
| Size break-evens: <45 kg express; ~45–180 kg air; 1.2–15 m³ LCL; ≥15.5 m³ 20' FCL (lane-specific) | Mode break-even advisory (labelled as lane model) |
| Business-model mismatch (sending pallets to DHL Express instead of DGF) explains price swings | Provider types are separated; RFQs routed per type |
| Integration blueprint: MyDHL API, Aramex Rate Calculator, Maersk developer portal; FLG/ABRECO/DGF need RFQ | Implemented adapters + RFQ generator with FLG/ABRECO RFQ emails |
| Itemise destination D/O, CFS, THC, Bayan in OMR | Built into every RFQ draft for Oman |

**Treated as possibly stale:** fuel-surcharge levels (50% DHL FSC for 9–22 Nov 2026), Hormuz status, Maersk advisories, carrier tariffs. These are dated in the UI and the Hormuz advisory can be switched off.

## 3. Market & integration research (14 Nov 2026)

| Platform / source | What it really provides | Access | Status in app |
|---|---|---|---|
| Freightos | Marketplace bookable quotes; developer-portal Rate Estimator (beta) returns **min–max ranges** → indicative | Registered developer / partner | Adapter implemented (INDICATIVE_ONLINE) |
| WebCargo by Freightos | Forwarder rate management & airline eBooking | Enterprise | Activation module |
| SeaRates | Logistics Explorer API (FCL/LCL/air/land rates from forwarders on its RMS); Freight Index API | Paid API key | Activation module |
| Xeneta | Ocean & air **market intelligence** (benchmarks, spreads) — not bookable | Customers only | Activation module (MARKET_BENCHMARK) |
| cargo.one | Live airline buy-rates & e-booking (75+ airlines) **for forwarders** | Enterprise API | Activation module; airlines hidden unless "operator is forwarder" |
| Freightify | Forwarder rate management/quoting SaaS | Subscriber | Activation module |
| Maersk | Offers API (Maersk Spot, dynamic pricing); terms forbid marketplace display without the customer's own credentials | Maersk customer account | Adapter implemented |
| Hapag-Lloyd | Quick Quotes (binding after login); API via developer portal | Approved customers | Activation module |
| DHL Express | MyDHL API rates/landed cost | Account credentials | Adapter implemented & mock-tested |
| Aramex | Rate Calculator API | Account credentials | Adapter implemented |

Corporate changes verified and reflected in the directory: **DSV completed the Schenker acquisition on 30 Apr 2025** (DB Schenker kept as legacy record → DSV); **Bolloré Logistics** acquired by CMA CGM (29 Feb 2024) and rebranded into **CEVA Logistics**. Oman presence verified for DSV (Muscat, Sohar, Nizwa, Salalah), Asyad Logistics (incl. India→Oman LCL via Khazaen Dry Port), Khimji Ramdas Shipping (offices at Omani ports), FLG, ABRECO, Aramex, Maersk, OOCL, RCL.

## 4. Provider database policy
Carriers, forwarders, NVOCCs, integrators, brokers and platforms are separate `provider_type`s. Only facts with an evidence URL are marked evidenced; global-network marketing claims never create lane coverage — the RFQ says "coverage of this lane is not evidenced — confirm". Administrators add evidenced lanes (URL mandatory).
