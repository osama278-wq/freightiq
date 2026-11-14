'use strict';
// Lane benchmarks extracted from the uploaded research paper (Singapore → Muscat, Oman,
// modelled 2026-11-13). These are MARKET BENCHMARKS — scenario models anchored to official
// tariffs and vendor-published ranges — never quotations. They only apply to the lane and
// size bands below; outside those bands the engine does not extrapolate.
//
// Charge basis:
//   fixed              amount_min/max per shipment
//   per_kg_chargeable  rate × chargeable kg (IATA ÷6000 for air, ÷5000 for express)
//   per_rt             rate × LCL revenue tons = max(1, CBM, tonnes)

const SRC = 'Research paper — Oman Industrial Freight Optimization (HTE, SIN→MCT lane model)';
const AS_OF = '2026-11-13';
const c = (category, label, basis, min, max, inclusion = 'amount') => ({ category, label, basis, amount_min: min, amount_max: max, currency: 'USD', inclusion });

module.exports = [
  {
    origin_country: 'SG', dest_country: 'OM', origin_point: 'SGSIN', dest_point: 'OMSOH', mode: 'sea_lcl', service_type: 'Sea LCL direct to Sohar', scope: 'door_to_door',
    applies_min_cbm: 0.5, applies_max_cbm: 15, transit_min: 18, transit_max: 28, currency: 'USD', source_name: SRC, as_of: AS_OF,
    notes: 'Excludes customs duty and recoverable 5% VAT. Avoids Strait of Hormuz; one Bayan clearance. Sohar post-discharge congestion risk.',
    charges: [
      c('pickup', 'Origin pickup, TradeNet export & CFS', 'fixed', 180, 280),
      c('origin', 'Included in origin pickup/export line', 'fixed', null, null, 'included'),
      c('freight', 'Ocean freight (USD 65–140 / RT)', 'per_rt', 65, 140),
      c('fuel', 'Fuel / PSS / import surcharges (pro-rata)', 'fixed', 40, 120),
      c('destination', 'Sohar D/O, CFS, THC', 'fixed', 200, 340),
      c('customs', 'Brokerage & ROP Bayan filing (incl. OMR 15)', 'fixed', 80, 145),
      c('delivery', 'Sohar → Muscat LTL delivery', 'fixed', 130, 240),
      c('insurance', 'Cargo insurance', 'fixed', null, null, 'excluded'),
    ],
  },
  {
    origin_country: 'SG', dest_country: 'OM', origin_point: 'SGSIN', dest_point: 'AEKLF', mode: 'sea_lcl', service_type: 'Sea–road multimodal via UAE (Khor Fakkan / Jebel Ali)', scope: 'door_to_door',
    applies_min_cbm: 0.5, applies_max_cbm: 15, transit_min: 16, transit_max: 25, currency: 'USD', source_name: SRC, as_of: AS_OF,
    notes: 'Dual-country customs (UAE transit + Oman Bayan) and cross-border trucking. Jebel Ali sits inside Hormuz — volatile transit.',
    charges: [
      c('pickup', 'Origin pickup, export & CFS', 'fixed', 180, 280),
      c('origin', 'Included in origin pickup/export line', 'fixed', null, null, 'included'),
      c('freight', 'Ocean freight (USD 55–120 / RT)', 'per_rt', 55, 120),
      c('fuel', 'UAE diversion / Hormuz surcharges', 'fixed', 60, 180),
      c('destination', 'UAE D/O + CFS + THC', 'fixed', 180, 310),
      c('customs', 'UAE transit + Oman Bayan', 'fixed', 120, 210),
      c('delivery', 'UAE → Muscat LTL trucking', 'fixed', 250, 450),
      c('insurance', 'Cargo insurance', 'fixed', null, null, 'excluded'),
    ],
  },
  {
    origin_country: 'SG', dest_country: 'OM', origin_point: 'SIN', dest_point: 'MCT', mode: 'air', service_type: 'Consolidated air freight SIN → MCT', scope: 'door_to_door',
    applies_min_kg: 250, applies_max_kg: 1000, transit_min: 3, transit_max: 6, currency: 'USD', source_name: SRC, as_of: AS_OF,
    notes: 'Rate band 2.50–3.80 USD/kg applies to the ~300 kg+ weight break; not extrapolated below 250 kg. TRANSOM MCT statutory terminal subtotal ≈ OMR 19.30. 48 h free storage at MCT.',
    charges: [
      c('pickup', 'Origin pickup & export handling', 'fixed', 130, 210),
      c('origin', 'Included in origin pickup/export line', 'fixed', null, null, 'included'),
      c('freight', 'Air freight (USD 2.50–3.80 / chargeable kg)', 'per_kg_chargeable', 2.5, 3.8),
      c('fuel', 'Fuel & security surcharges (FSC/SSC)', 'per_kg_chargeable', 0.37, 0.68),
      c('destination', 'TRANSOM terminal (≈OMR 19.30) + forwarder D/O', 'fixed', 65, 115),
      c('customs', 'Brokerage & Bayan (incl. OMR 15)', 'fixed', 75, 130),
      c('delivery', 'MCT → Muscat local delivery', 'fixed', 55, 110),
      c('insurance', 'Cargo insurance', 'fixed', null, null, 'excluded'),
    ],
  },
  {
    origin_country: 'SG', dest_country: 'OM', origin_point: 'SIN', dest_point: 'MCT', mode: 'express', service_type: 'Express courier — cartonised (<70 kg/piece)', scope: 'door_to_door',
    applies_min_kg: 20, applies_max_kg: 400, transit_min: 2, transit_max: 4, currency: 'USD', source_name: SRC, as_of: AS_OF,
    notes: 'Assumes ÷5000 express divisor (verify contract divisor). Pallets trigger DHL Oman non-stackable (OMR 125/pallet) and overweight (OMR 8.25/pc) fees — not included here.',
    charges: [
      c('pickup', 'Pickup & export', 'fixed', 50, 90),
      c('origin', 'Included in origin pickup/export line', 'fixed', null, null, 'included'),
      c('freight', 'Express freight (USD 5.80–8.50 / kg)', 'per_kg_chargeable', 5.8, 8.5),
      c('fuel', 'Fuel surcharge & handling', 'fixed', 0, 120),
      c('destination', 'Destination handling (bundled/multiline)', 'fixed', 30, 80),
      c('customs', 'Clearance incl. OMR 15 Bayan', 'fixed', 40, 85),
      c('delivery', 'Door delivery', 'fixed', null, null, 'included'),
      c('insurance', 'Cargo insurance', 'fixed', null, null, 'excluded'),
    ],
  },
];
