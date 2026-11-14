'use strict';
// Seed database of freight providers.
//
// Data policy (enforced in the UI):
//  * provider_type distinguishes: ocean_carrier | air_carrier | integrator (express) |
//    forwarder | nvocc | broker | platform. They are commercially different.
//  * Only facts with an evidence URL are marked as evidenced. Everything else is
//    "company-stated / unverified" and must be confirmed by an administrator.
//  * Route coverage is NOT inferred from "global network" marketing claims; lane-specific
//    coverage lives in provider_routes and requires evidence.
//  * last_verified = date the record was researched for this build (2026-11-14) where an
//    evidence URL exists; null otherwise.

const PAPER = 'Research paper: "Lowest-Cost Air and Sea Freight Strategy for High Tower Engineering (Singapore to Oman)", benchmarks as of 2026-11-13';
const V = '2026-11-14';
const ev = (claim, url) => ({ claim, url });

const P = (o) => ({
  regions_served: ['Global (company-stated)'], countries_served: [], modes: [], main_hubs: [], contact: {},
  online_quote: 'unknown', api_availability: 'unknown', oman_presence: 'unverified', evidence: [], last_verified: null, ...o,
});

module.exports = [
  // ───────────── A. Global freight forwarders ─────────────
  P({ slug: 'dhl-global-forwarding', name: 'DHL Global Forwarding', provider_type: 'forwarder', parent_group: 'DHL Group', website: 'https://www.dhl.com/global-en/home/our-divisions/global-forwarding.html', hq_country: 'DE',
    modes: ['air', 'sea_fcl', 'sea_lcl', 'road'], online_quote: 'login_required', online_quote_url: 'https://www.dhl.com/global-en/home/our-divisions/global-forwarding.html',
    api_availability: 'partner', api_docs_url: 'https://developer.dhl.com/api-catalog', booking_platform: 'myDHLi customer portal',
    service_notes: 'Separate division from DHL Express — send pallet/LCL/air-cargo RFQs to DGF, not Express. Paper: public developer catalog exposes a Document API rather than open instant quoting.',
    oman_presence: 'reported', last_verified: V,
    evidence: [ev('Oman presence (Muscat & Sohar), Middle East crisis updates', 'https://www.dhl.com/sg-en/home/global-forwarding/latest-news-and-webinars/middle-east-crisis-situation-updates.html'), ev('Developer catalog', 'https://developer.dhl.com/api-catalog')] }),
  P({ slug: 'kuehne-nagel', name: 'Kuehne+Nagel', provider_type: 'forwarder', website: 'https://www.kuehne-nagel.com', hq_country: 'CH', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'],
    booking_platform: 'CB Air (in-house air booking platform, integrates cargo.one API)', oman_presence: 'reported', last_verified: V,
    service_notes: 'Oman evidence is dated (2016 Khimji Ramdas associate-company listing) — re-verify current Oman entity.',
    evidence: [ev('Partnership with cargo.one Offer & Book API (CB Air)', 'https://www.ajot.com/news/kuehnenagel-enters-partnership-with-cargo.one-to-digitally-connect-with-dozens-of-airlines-globally'), ev('Kuehne + Nagel LLC listed as Khimji Ramdas associate in Oman (2016)', 'https://issuu.com/oeppa/docs/salalah_2016/59')] }),
  P({ slug: 'dsv', name: 'DSV (incl. former DB Schenker)', provider_type: 'forwarder', website: 'https://www.dsv.com', hq_country: 'DK', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'],
    main_hubs: ['Muscat', 'Sohar', 'Nizwa', 'Salalah (Oman facilities)'], oman_presence: 'verified', last_verified: V,
    service_notes: 'DSV completed the acquisition of Schenker on 30 Apr 2025; dbschenker.com merged into dsv.com.',
    evidence: [ev('Oman: 5 facilities in Muscat, Sohar, Nizwa, Salalah', 'https://www.dsv.com/en-ae/about-dsv/dsv-mena/oman'), ev('Schenker acquisition completed', 'https://dsv.com/en/about-dsv/press/news/com/2025/04/dsv-completes-acquisition-of-schenker')] }),
  P({ slug: 'db-schenker', name: 'DB Schenker (now part of DSV)', provider_type: 'forwarder', parent_group: 'DSV', website: 'https://www.dsv.com', hq_country: 'DE', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'], active: 1,
    service_notes: 'Legacy brand. Route RFQs to DSV. Kept for historical quotations and search matching.', last_verified: V,
    evidence: [ev('dbschenker.com merged into DSV.com', 'https://www.dsv.com/en-za/about-dsv/press/news/dsv-completes-acquisition-of-schenker-2713954')] }),
  P({ slug: 'ceva-logistics', name: 'CEVA Logistics (incl. former Bolloré Logistics)', provider_type: 'forwarder', parent_group: 'CMA CGM Group', website: 'https://www.cevalogistics.com', hq_country: 'FR', modes: ['air', 'sea_fcl', 'sea_lcl', 'road', 'rail'], last_verified: V,
    service_notes: 'Bolloré Logistics acquired by CMA CGM (29 Feb 2024) and rebranded into CEVA.',
    evidence: [ev('Bolloré integrated under CEVA brand', 'https://multimodal.org.uk/article/ceva-logistics-continues-strategic-transformation-grows-core-products-by-integrating-bollore-logistics')] }),
  P({ slug: 'bollore-logistics', name: 'Bolloré Logistics (now CEVA Logistics)', provider_type: 'forwarder', parent_group: 'CMA CGM Group', website: 'https://www.cevalogistics.com', hq_country: 'FR', modes: ['air', 'sea_fcl', 'sea_lcl'],
    service_notes: 'Successor operation: CEVA Logistics. Route RFQs to CEVA.', last_verified: V,
    evidence: [ev('Rebranding into CEVA', 'https://www.automotivelogistics.media/logistics-service-providers/ceva-integrates-bollore-logistics-following-cma-cgm-buyout/45841.article')] }),
  P({ slug: 'expeditors', name: 'Expeditors International', provider_type: 'forwarder', website: 'https://www.expeditors.com', hq_country: 'US', modes: ['air', 'sea_fcl', 'sea_lcl'] }),
  P({ slug: 'ch-robinson', name: 'C.H. Robinson', provider_type: 'forwarder', website: 'https://www.chrobinson.com', hq_country: 'US', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'],
    service_notes: 'Operates both as international forwarder and (North America) freight broker — classify each quote by the entity issuing it.' }),
  P({ slug: 'nippon-express', name: 'Nippon Express (NX Group)', provider_type: 'forwarder', website: 'https://www.nipponexpress-holdings.com', hq_country: 'JP', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'] }),
  P({ slug: 'rhenus', name: 'Rhenus Logistics', provider_type: 'forwarder', website: 'https://www.rhenus.group', hq_country: 'DE', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'] }),
  P({ slug: 'hellmann', name: 'Hellmann Worldwide Logistics', provider_type: 'forwarder', website: 'https://www.hellmann.com', hq_country: 'DE', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'], regions_served: ['Global (company-stated)'],
    service_notes: 'Reported new healthcare hub at Dubai South (regional GCC capability).' }),
  P({ slug: 'geodis', name: 'GEODIS', provider_type: 'forwarder', website: 'https://geodis.com', hq_country: 'FR', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'] }),
  P({ slug: 'sinotrans', name: 'Sinotrans', provider_type: 'forwarder', website: 'https://www.sinotrans.com', hq_country: 'CN', modes: ['air', 'sea_fcl', 'sea_lcl', 'road', 'rail'], regions_served: ['East Asia', 'Global (company-stated)'] }),
  P({ slug: 'yusen-logistics', name: 'Yusen Logistics', provider_type: 'forwarder', website: 'https://www.yusen-logistics.com', hq_country: 'JP', modes: ['air', 'sea_fcl', 'sea_lcl'] }),
  P({ slug: 'kwe', name: 'Kintetsu World Express (KWE)', provider_type: 'forwarder', website: 'https://www.kwe.com', hq_country: 'JP', modes: ['air', 'sea_fcl', 'sea_lcl'] }),
  P({ slug: 'flexport', name: 'Flexport', provider_type: 'forwarder', website: 'https://www.flexport.com', hq_country: 'US', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'],
    online_quote: 'login_required', booking_platform: 'Flexport platform (digital forwarder)', service_notes: 'Digital freight forwarder — quotes issued through its platform account.' }),
  P({ slug: 'ups-scs', name: 'UPS Supply Chain Solutions', provider_type: 'forwarder', parent_group: 'UPS', website: 'https://www.ups.com', hq_country: 'US', modes: ['air', 'sea_fcl', 'sea_lcl'] }),
  P({ slug: 'fedex-logistics', name: 'FedEx Logistics', provider_type: 'forwarder', parent_group: 'FedEx', website: 'https://www.fedex.com', hq_country: 'US', modes: ['air', 'sea_fcl', 'sea_lcl'] }),

  // ───────────── D. Regional / Oman & GCC forwarders ─────────────
  P({ slug: 'flg-shipping', name: 'FLG Shipping & Logistics', provider_type: 'nvocc', website: 'https://www.flg-shipping.com', hq_country: 'OM', regions_served: ['GCC', 'South Asia', 'Southeast Asia (via partners)'], countries_served: ['OM', 'AE'],
    modes: ['air', 'sea_lcl', 'sea_fcl', 'road'], main_hubs: ['Muscat (Azaiba)', 'Sohar', 'Dubai (Al Quoz / JAFZ)'], contact: { email: 'infoom@flgshipping.net', quote_page: 'https://flg-shipping.com/contact.html' },
    online_quote: 'no', api_availability: 'none', oman_presence: 'verified', last_verified: V,
    service_notes: 'Multi-carrier NVOCC, air & LCL consolidator; oil & gas logistics; ISO 9001 & 45001 (company-stated). Paper: best suited for lowest all-in totals on consolidated air and direct Sohar LCL. Manual RFQ only.',
    evidence: [ev('Company site and services', 'https://www.flg-shipping.com/'), ev('Contact & RFQ', 'https://flg-shipping.com/contact.html'), ev(PAPER, null)] }),
  P({ slug: 'abreco-freight', name: 'ABRECO Freight LLC', provider_type: 'forwarder', website: 'https://abrecofreight.com', hq_country: 'AE', regions_served: ['GCC', 'South Asia'], countries_served: ['AE', 'OM', 'IN'],
    modes: ['air', 'sea_lcl', 'sea_fcl', 'road'], main_hubs: ['Jebel Ali Free Zone (HQ & warehouse)', 'Muscat (Ghala office)'], contact: { email: 'business@abrecofreight.com', quote_page: 'https://abrecofreight.com/contact' },
    online_quote: 'no', api_availability: 'none', oman_presence: 'verified', last_verified: V,
    service_notes: 'WCA/WIN network member, ISO 9001 (company-stated). Trade focus skews UAE/India; request direct routing to Sohar/MCT unless consolidating in Dubai.',
    evidence: [ev('Company site', 'https://abrecofreight.com/'), ev('Contact', 'https://abrecofreight.com/contact'), ev(PAPER, null)] }),
  P({ slug: 'aramex', name: 'Aramex', provider_type: 'integrator', website: 'https://www.aramex.com', hq_country: 'AE', regions_served: ['GCC', 'Middle East', 'South Asia', 'Global (company-stated)'], countries_served: ['OM', 'AE', 'SA'],
    modes: ['express', 'air', 'sea_lcl', 'sea_fcl', 'road'], main_hubs: ['Muscat', 'Sohar'], online_quote: 'yes', api_availability: 'public', api_docs_url: 'https://www.aramex.com/ae/en/developers-solution-center/aramex-apis',
    oman_presence: 'verified', last_verified: V,
    service_notes: 'Courier (express) and freight divisions price differently — confirm Aramex Freight vs courier for >100 kg. Rate Calculator API available.',
    evidence: [ev('Aramex APIs incl. Rate Calculator', 'https://www.aramex.com/ae/en/developers-solution-center/aramex-apis'), ev('Rate calculator manual', 'https://www.aramex.com/content/uploads/109/232/42007/aramex-rates-calculator-manual.pdf')] }),
  P({ slug: 'asyad-logistics', name: 'Asyad Logistics (Asyad Group)', provider_type: 'forwarder', parent_group: 'Asyad Group', website: 'https://asyad.om/logistics-solutions/freight-forwarding', hq_country: 'OM', regions_served: ['GCC', 'South Asia', 'East Africa'], countries_served: ['OM', 'IN'],
    modes: ['sea_lcl', 'sea_fcl', 'road', 'air'], main_hubs: ['Khazaen Dry Port (CFS)', 'Sohar', 'Salalah', 'Duqm'], oman_presence: 'verified', last_verified: V,
    service_notes: 'Oman\'s national integrated logistics group. Asyad Logistics acts as LCL consolidator India→Oman via Khazaen Dry Port with Asyad Line. Asyad Express provides last-mile.',
    evidence: [ev('Freight forwarding service', 'https://asyad.om/logistics-solutions/freight-forwarding'), ev('LCL India–Oman via Khazaen (Oman Observer)', 'https://www.omanobserver.om/ampArticle/1142313')] }),
  P({ slug: 'khimji-ramdas-shipping', name: 'Khimji Ramdas Shipping & Multimodal Logistics', provider_type: 'forwarder', parent_group: 'Khimji Ramdas Group', website: 'https://www.kr.om', hq_country: 'OM', regions_served: ['GCC'], countries_served: ['OM', 'AE'],
    modes: ['sea_fcl', 'sea_lcl', 'air', 'road'], main_hubs: ['Muscat', 'Sohar', 'Sur', 'Duqm', 'Salalah', 'Dubai', 'Fujairah'], oman_presence: 'verified', last_verified: V,
    service_notes: 'Ship agency, project cargo, inland logistics, air cargo and freight solutions; partner-investor in Khazaen Dry Port. ISO 9001/14001/45001 (third-party listing).',
    evidence: [ev('Freight forwarder with offices at Omani ports (Breakbulk exhibitor)', 'https://europe.breakbulk.com/exhibitors/khimji-ramdas-shipping-kr'), ev('Services overview', 'https://magicport.ai/ship-agents/oman/khimji-ramdas-shipping-llc')] }),

  // ───────────── B. Ocean carriers ─────────────
  P({ slug: 'maersk', name: 'Maersk', provider_type: 'ocean_carrier', website: 'https://www.maersk.com', hq_country: 'DK', modes: ['sea_fcl', 'sea_lcl', 'air', 'road'], fcl: 1,
    main_hubs: ['Salalah (direct calls)', 'Sohar (weekly feeder)'], online_quote: 'yes', online_quote_url: 'https://www.maersk.com/onlinequote/',
    api_availability: 'partner', api_docs_url: 'https://developer.maersk.com/api-catalogue', booking_platform: 'Maersk Spot / Online Quote', oman_presence: 'verified', last_verified: V,
    service_notes: 'Offers API exposes Maersk Spot (dry 20/40/40HC/45HC; dynamic pricing). API terms prohibit marketplace-style display without customer credentials — each client must use its own Maersk account. Sohar Import Service (IMP) fee USD 500/20\' and USD 1,000/40\' effective 15 Sep 2026.',
    evidence: [ev('Online quote', 'https://www.maersk.com/onlinequote/'), ev('Offers API / Spot product docs', 'https://api-sit.env.productmanagement.maersk.com/offers/docs'), ev('Sohar IMP fee', 'https://www.maersk.com/news/articles/2026/08/14/implementation-of-an-import-service-world-to-oman'), ev('Shipping to/from Oman', 'https://www.maersk.com/local-information/imea/oman')] }),
  P({ slug: 'msc', name: 'MSC Mediterranean Shipping Company', provider_type: 'ocean_carrier', website: 'https://www.msc.com', hq_country: 'CH', modes: ['sea_fcl'] }),
  P({ slug: 'cma-cgm', name: 'CMA CGM', provider_type: 'ocean_carrier', website: 'https://www.cma-cgm.com', hq_country: 'FR', modes: ['sea_fcl'], service_notes: 'Parent group of CEVA Logistics.' }),
  P({ slug: 'hapag-lloyd', name: 'Hapag-Lloyd', provider_type: 'ocean_carrier', website: 'https://www.hapag-lloyd.com', hq_country: 'DE', modes: ['sea_fcl'],
    online_quote: 'login_required', online_quote_url: 'https://www.hapag-lloyd.com/en/online-business/quotation/quick-quotes.html', api_availability: 'partner', api_docs_url: 'https://www.hapag-lloyd.com/en/online-business/api.html',
    booking_platform: 'Quick Quotes / Quick Quotes Spot', last_verified: V,
    service_notes: 'Quick Quotes gives binding online container quotes after login; Quick Quote API integrated by third-party pricing platforms (cargonerds, Descartes, Cargofive).',
    evidence: [ev('Quick Quotes API integration (cargonerds)', 'https://ajot.com/news/cargonerds-expands-global-offering-with-hapag-lloyds-quick-quotes-integration'), ev('API Developer Portal', 'https://www.hapag-lloyd.com/en/company/about-us/newsletter/2021/01/real-time-information-on-sailing-schedules--transport-informatio.html')] }),
  P({ slug: 'cosco', name: 'COSCO Shipping Lines', provider_type: 'ocean_carrier', website: 'https://lines.coscoshipping.com', hq_country: 'CN', modes: ['sea_fcl'] }),
  P({ slug: 'evergreen', name: 'Evergreen Marine', provider_type: 'ocean_carrier', website: 'https://www.evergreen-marine.com', hq_country: 'TW', modes: ['sea_fcl'] }),
  P({ slug: 'one', name: 'Ocean Network Express (ONE)', provider_type: 'ocean_carrier', website: 'https://www.one-line.com', hq_country: 'SG', modes: ['sea_fcl'] }),
  P({ slug: 'yang-ming', name: 'Yang Ming Marine Transport', provider_type: 'ocean_carrier', website: 'https://www.yangming.com', hq_country: 'TW', modes: ['sea_fcl'] }),
  P({ slug: 'zim', name: 'ZIM Integrated Shipping', provider_type: 'ocean_carrier', website: 'https://www.zim.com', hq_country: 'IL', modes: ['sea_fcl'] }),
  P({ slug: 'hmm', name: 'HMM', provider_type: 'ocean_carrier', website: 'https://www.hmm21.com', hq_country: 'KR', modes: ['sea_fcl'] }),
  P({ slug: 'oocl', name: 'OOCL', provider_type: 'ocean_carrier', parent_group: 'COSCO Shipping', website: 'https://www.oocl.com', hq_country: 'HK', modes: ['sea_fcl'], oman_presence: 'verified', last_verified: V,
    service_notes: 'Publishes Oman local surcharges (D/O OMR 50 cited in paper).', evidence: [ev('Oman local surcharges', 'https://www.oocl.com/middleeast/eng/localinformation/localsurcharges/oman/Pages/default.aspx')] }),
  P({ slug: 'rcl', name: 'RCL (Regional Container Lines)', provider_type: 'ocean_carrier', website: 'https://www.rclgroup.com', hq_country: 'TH', regions_served: ['Asia', 'Middle East'], modes: ['sea_fcl'], oman_presence: 'verified', last_verified: V,
    evidence: [ev('Oman import local surcharges', 'https://www-imedia.rclgroup.com/CorpWEB/PDF/Surcharge/LocSurcharge-OM-Imp-20251222.pdf')] }),

  // ───────────── C. Air cargo carriers & integrators ─────────────
  ...[
    ['qatar-cargo', 'Qatar Airways Cargo', 'https://www.qrcargo.com', 'QA', ['DOH'], true],
    ['emirates-skycargo', 'Emirates SkyCargo', 'https://www.skycargo.com', 'AE', ['DXB', 'DWC'], true],
    ['etihad-cargo', 'Etihad Cargo', 'https://www.etihadcargo.com', 'AE', ['AUH'], true],
    ['turkish-cargo', 'Turkish Cargo', 'https://www.turkishcargo.com', 'TR', ['IST'], true],
    ['lufthansa-cargo', 'Lufthansa Cargo', 'https://www.lufthansa-cargo.com', 'DE', ['FRA'], true],
    ['afklm-cargo', 'Air France KLM Martinair Cargo', 'https://www.afklcargo.com', 'FR', ['CDG', 'AMS'], true],
    ['cathay-cargo', 'Cathay Cargo', 'https://www.cathaycargo.com', 'HK', ['HKG'], true],
    ['sia-cargo', 'Singapore Airlines Cargo', 'https://www.siacargo.com', 'SG', ['SIN'], true],
    ['cargolux', 'Cargolux', 'https://www.cargolux.com', 'LU', ['LUX'], false],
    ['korean-air-cargo', 'Korean Air Cargo', 'https://cargo.koreanair.com', 'KR', ['ICN'], false],
    ['china-airlines-cargo', 'China Airlines Cargo', 'https://cargo.china-airlines.com', 'TW', ['TPE'], false],
    ['oman-air-cargo', 'Oman Air Cargo', 'https://www.omanair.com', 'OM', ['MCT'], false],
  ].map(([slug, name, website, hq, hubs, onCargoOne]) => P({
    slug, name, provider_type: 'air_carrier', website, hq_country: hq, modes: ['air'], main_hubs: hubs,
    booking_platform: onCargoOne ? 'Bookable via cargo.one (forwarder platform)' : null,
    service_notes: 'Airline capacity is normally sold to IATA freight forwarders, not directly to shippers. Treat airline rates as carrier buy-rates, not door-to-door quotations.',
    last_verified: onCargoOne ? V : null,
    evidence: onCargoOne ? [ev('Listed as bookable airline on cargo.one', 'https://www.cargo.one/forwarders/solutions/air')] : [],
  })),
  P({ slug: 'dhl-express', name: 'DHL Express (incl. DHL Aviation)', provider_type: 'integrator', parent_group: 'DHL Group', website: 'https://www.dhl.com/express', hq_country: 'DE', modes: ['express', 'air'], main_hubs: ['LEJ', 'CVG', 'HKG'],
    online_quote: 'yes', api_availability: 'public', api_docs_url: 'https://developer.dhl.com/api-reference/dhl-express-mydhl-api', oman_presence: 'verified', last_verified: V,
    service_notes: 'MyDHL API: rates, landed cost, shipment creation, tracking (account credentials required). Oman 2025 tariff: non-stackable pallet OMR 125/pallet, overweight piece OMR 8.25/pc; weekly fuel surcharge (50% Nov 9–22 2026 per paper). Avoid for pallets.',
    evidence: [ev('MyDHL API', 'https://developer.dhl.com/api-reference/dhl-express-mydhl-api'), ev('DHL Express Oman Service & Rate Guide 2025', 'https://mydhl.express.dhl/content/dam/downloads/om/en/rate-guide/service_and_rate_guide_om_en_2025.pdf.coredownload.pdf')] }),
  P({ slug: 'fedex', name: 'FedEx (FedEx Express)', provider_type: 'integrator', website: 'https://www.fedex.com', hq_country: 'US', modes: ['express', 'air'], main_hubs: ['MEM'], online_quote: 'yes', api_availability: 'public', api_docs_url: 'https://developer.fedex.com' }),
  P({ slug: 'ups', name: 'UPS (UPS Airlines)', provider_type: 'integrator', website: 'https://www.ups.com', hq_country: 'US', modes: ['express', 'air'], main_hubs: ['SDF'], online_quote: 'yes', api_availability: 'public', api_docs_url: 'https://developer.ups.com' }),

  // ───────────── Freight platforms (not carriers, not forwarders) ─────────────
  P({ slug: 'freightos', name: 'Freightos Marketplace', provider_type: 'platform', website: 'https://www.freightos.com', hq_country: 'IL', modes: ['air', 'sea_fcl', 'sea_lcl', 'road'],
    online_quote: 'yes', api_availability: 'partner', api_docs_url: 'https://developer.freightos.com', last_verified: V,
    service_notes: 'Marketplace: bookable quotes from forwarders. Developer-portal Freight Rate Estimator (beta, returns min/max price & transit ranges = indicative). WebCargo booking API is enterprise/partner only.',
    evidence: [ev('Freightos developer APIs (estimator beta, partner booking)', 'https://apis.io/plans/freightos/freightos-plans-pricing/')] }),
  P({ slug: 'webcargo', name: 'WebCargo by Freightos', provider_type: 'platform', parent_group: 'Freightos', website: 'https://www.webcargo.co', hq_country: 'ES', modes: ['air', 'sea_fcl', 'sea_lcl'], api_availability: 'enterprise',
    service_notes: 'Rate management and airline eBooking for forwarders and carriers. Requires forwarder account.' }),
  P({ slug: 'searates', name: 'SeaRates (Logistics Explorer)', provider_type: 'platform', website: 'https://www.searates.com', modes: ['sea_fcl', 'sea_lcl', 'air', 'road', 'rail'],
    online_quote: 'yes', api_availability: 'partner', api_docs_url: 'https://docs.searates.com', last_verified: V,
    service_notes: 'Logistics Explorer API: FCL/LCL/Bulk/Air/Land rates from forwarders on its RMS; Freight Index API (market benchmark). Rates commonly synchronised monthly — treat as indicative unless bookable.',
    evidence: [ev('Logistics Explorer API', 'https://www.searates.com/reference/api-logistics-explorer/'), ev('API docs', 'https://docs.searates.com')] }),
  P({ slug: 'xeneta', name: 'Xeneta', provider_type: 'platform', website: 'https://www.xeneta.com', hq_country: 'NO', modes: ['sea_fcl', 'air'], api_availability: 'enterprise', api_docs_url: 'https://help.xeneta.com/reference', last_verified: V,
    service_notes: 'Market intelligence only (benchmarks, not bookable quotes). REST API v3 for subscribed customers.',
    evidence: [ev('Xeneta API overview', 'https://help.xeneta.com/reference')] }),
  P({ slug: 'cargo-one', name: 'cargo.one', provider_type: 'platform', website: 'https://www.cargo.one', hq_country: 'DE', modes: ['air', 'sea_fcl'], api_availability: 'enterprise', last_verified: V,
    service_notes: 'Air cargo e-booking for FREIGHT FORWARDERS (75+ bookable airlines). Live airline buy-rates; enterprise API. Only usable if your company operates as a forwarder.',
    evidence: [ev('cargo.one enterprise API', 'https://www.cargo.one/enterprise'), ev('Bookable airlines', 'https://www.cargo.one/forwarders/solutions/air')] }),
  P({ slug: 'freightify', name: 'Freightify', provider_type: 'platform', website: 'https://www.freightify.com', modes: ['sea_fcl', 'sea_lcl', 'air'], api_availability: 'enterprise',
    service_notes: 'Rate management / quoting SaaS for forwarders; API for live rates & quotes of the subscribing forwarder.' }),
];
