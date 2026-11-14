'use strict';
// Reference geography. Regions are used to match providers to lanes.
// insideGulf marks ports inside the Strait of Hormuz (relevant to the 2026 disruption
// documented in the uploaded research paper).

const C = (iso, name, region, currency) => ({ iso, name, region, currency });
const COUNTRIES = [
  C('OM', 'Oman', 'GCC', 'OMR'), C('AE', 'United Arab Emirates', 'GCC', 'AED'), C('SA', 'Saudi Arabia', 'GCC', 'SAR'),
  C('QA', 'Qatar', 'GCC', 'QAR'), C('BH', 'Bahrain', 'GCC', 'BHD'), C('KW', 'Kuwait', 'GCC', 'KWD'),
  C('IQ', 'Iraq', 'Middle East', 'USD'), C('JO', 'Jordan', 'Middle East', 'USD'), C('EG', 'Egypt', 'Middle East', 'EGP'),
  C('TR', 'Türkiye', 'Europe', 'TRY'), C('IR', 'Iran', 'Middle East', 'USD'), C('YE', 'Yemen', 'Middle East', 'USD'),
  C('CN', 'China', 'East Asia', 'CNY'), C('HK', 'Hong Kong SAR', 'East Asia', 'HKD'), C('TW', 'Taiwan', 'East Asia', 'TWD'),
  C('JP', 'Japan', 'East Asia', 'JPY'), C('KR', 'South Korea', 'East Asia', 'KRW'),
  C('SG', 'Singapore', 'Southeast Asia', 'SGD'), C('MY', 'Malaysia', 'Southeast Asia', 'MYR'), C('TH', 'Thailand', 'Southeast Asia', 'THB'),
  C('VN', 'Vietnam', 'Southeast Asia', 'VND'), C('ID', 'Indonesia', 'Southeast Asia', 'USD'), C('PH', 'Philippines', 'Southeast Asia', 'USD'),
  C('IN', 'India', 'South Asia', 'INR'), C('PK', 'Pakistan', 'South Asia', 'PKR'), C('BD', 'Bangladesh', 'South Asia', 'USD'), C('LK', 'Sri Lanka', 'South Asia', 'USD'),
  C('DE', 'Germany', 'Europe', 'EUR'), C('NL', 'Netherlands', 'Europe', 'EUR'), C('BE', 'Belgium', 'Europe', 'EUR'), C('FR', 'France', 'Europe', 'EUR'),
  C('IT', 'Italy', 'Europe', 'EUR'), C('ES', 'Spain', 'Europe', 'EUR'), C('GB', 'United Kingdom', 'Europe', 'GBP'), C('CH', 'Switzerland', 'Europe', 'CHF'),
  C('PL', 'Poland', 'Europe', 'EUR'), C('SE', 'Sweden', 'Europe', 'EUR'), C('DK', 'Denmark', 'Europe', 'EUR'), C('AT', 'Austria', 'Europe', 'EUR'),
  C('US', 'United States', 'North America', 'USD'), C('CA', 'Canada', 'North America', 'CAD'), C('MX', 'Mexico', 'Latin America', 'USD'),
  C('BR', 'Brazil', 'Latin America', 'USD'), C('AU', 'Australia', 'Oceania', 'AUD'), C('ZA', 'South Africa', 'Africa', 'ZAR'),
  C('KE', 'Kenya', 'Africa', 'USD'), C('TZ', 'Tanzania', 'Africa', 'USD'), C('NG', 'Nigeria', 'Africa', 'USD'),
];

const SEAPORTS = [
  { code: 'OMSOH', name: 'Sohar', country: 'OM' }, { code: 'OMSLL', name: 'Salalah', country: 'OM' }, { code: 'OMDQM', name: 'Duqm', country: 'OM' },
  { code: 'AEJEA', name: 'Jebel Ali', country: 'AE', insideGulf: true }, { code: 'AEKHL', name: 'Khalifa Port (Abu Dhabi)', country: 'AE', insideGulf: true },
  { code: 'AEKLF', name: 'Khor Fakkan', country: 'AE' }, { code: 'AEFJR', name: 'Fujairah', country: 'AE' },
  { code: 'SADMM', name: 'Dammam', country: 'SA', insideGulf: true }, { code: 'SAJED', name: 'Jeddah', country: 'SA' },
  { code: 'QAHMD', name: 'Hamad Port', country: 'QA', insideGulf: true }, { code: 'BHKBS', name: 'Khalifa Bin Salman', country: 'BH', insideGulf: true }, { code: 'KWSWK', name: 'Shuwaikh', country: 'KW', insideGulf: true },
  { code: 'CNSHA', name: 'Shanghai', country: 'CN' }, { code: 'CNNGB', name: 'Ningbo-Zhoushan', country: 'CN' }, { code: 'CNYTN', name: 'Shenzhen Yantian', country: 'CN' },
  { code: 'CNSHK', name: 'Shenzhen Shekou', country: 'CN' }, { code: 'CNNSA', name: 'Guangzhou Nansha', country: 'CN' }, { code: 'CNTAO', name: 'Qingdao', country: 'CN' }, { code: 'CNXMN', name: 'Xiamen', country: 'CN' },
  { code: 'HKHKG', name: 'Hong Kong', country: 'HK' }, { code: 'SGSIN', name: 'Singapore', country: 'SG' }, { code: 'MYPKG', name: 'Port Klang', country: 'MY' },
  { code: 'INNSA', name: 'Nhava Sheva (JNPT)', country: 'IN' }, { code: 'INMUN', name: 'Mundra', country: 'IN' }, { code: 'INMAA', name: 'Chennai', country: 'IN' }, { code: 'INCOK', name: 'Cochin', country: 'IN' },
  { code: 'PKKHI', name: 'Karachi', country: 'PK' }, { code: 'LKCMB', name: 'Colombo', country: 'LK' },
  { code: 'NLRTM', name: 'Rotterdam', country: 'NL' }, { code: 'DEHAM', name: 'Hamburg', country: 'DE' }, { code: 'BEANR', name: 'Antwerp-Bruges', country: 'BE' },
  { code: 'GBFXT', name: 'Felixstowe', country: 'GB' }, { code: 'GBSOU', name: 'Southampton', country: 'GB' }, { code: 'FRLEH', name: 'Le Havre', country: 'FR' },
  { code: 'ESVLC', name: 'Valencia', country: 'ES' }, { code: 'ITGOA', name: 'Genoa', country: 'IT' }, { code: 'TRMER', name: 'Mersin', country: 'TR' },
  { code: 'USNYC', name: 'New York / New Jersey', country: 'US' }, { code: 'USSAV', name: 'Savannah', country: 'US' }, { code: 'USHOU', name: 'Houston', country: 'US' },
  { code: 'USLAX', name: 'Los Angeles', country: 'US' }, { code: 'USLGB', name: 'Long Beach', country: 'US' }, { code: 'USORF', name: 'Norfolk', country: 'US' },
  { code: 'JPTYO', name: 'Tokyo', country: 'JP' }, { code: 'KRPUS', name: 'Busan', country: 'KR' }, { code: 'VNSGN', name: 'Ho Chi Minh City', country: 'VN' },
];

const AIRPORTS = [
  { code: 'MCT', name: 'Muscat International', country: 'OM' }, { code: 'SLL', name: 'Salalah', country: 'OM' }, { code: 'OHS', name: 'Sohar', country: 'OM' }, { code: 'DQM', name: 'Duqm', country: 'OM' },
  { code: 'DXB', name: 'Dubai International', country: 'AE' }, { code: 'DWC', name: 'Dubai World Central', country: 'AE' }, { code: 'AUH', name: 'Abu Dhabi', country: 'AE' }, { code: 'SHJ', name: 'Sharjah', country: 'AE' },
  { code: 'DOH', name: 'Doha Hamad', country: 'QA' }, { code: 'RUH', name: 'Riyadh', country: 'SA' }, { code: 'JED', name: 'Jeddah', country: 'SA' }, { code: 'DMM', name: 'Dammam', country: 'SA' }, { code: 'BAH', name: 'Bahrain', country: 'BH' }, { code: 'KWI', name: 'Kuwait', country: 'KW' },
  { code: 'PVG', name: 'Shanghai Pudong', country: 'CN' }, { code: 'CAN', name: 'Guangzhou Baiyun', country: 'CN' }, { code: 'SZX', name: 'Shenzhen Bao\'an', country: 'CN' }, { code: 'PEK', name: 'Beijing Capital', country: 'CN' }, { code: 'CGO', name: 'Zhengzhou', country: 'CN' },
  { code: 'HKG', name: 'Hong Kong', country: 'HK' }, { code: 'TPE', name: 'Taipei Taoyuan', country: 'TW' }, { code: 'ICN', name: 'Seoul Incheon', country: 'KR' }, { code: 'NRT', name: 'Tokyo Narita', country: 'JP' },
  { code: 'SIN', name: 'Singapore Changi', country: 'SG' }, { code: 'KUL', name: 'Kuala Lumpur', country: 'MY' }, { code: 'BKK', name: 'Bangkok Suvarnabhumi', country: 'TH' }, { code: 'SGN', name: 'Ho Chi Minh City', country: 'VN' },
  { code: 'BOM', name: 'Mumbai', country: 'IN' }, { code: 'DEL', name: 'Delhi', country: 'IN' }, { code: 'MAA', name: 'Chennai', country: 'IN' }, { code: 'BLR', name: 'Bengaluru', country: 'IN' }, { code: 'COK', name: 'Kochi', country: 'IN' },
  { code: 'KHI', name: 'Karachi', country: 'PK' }, { code: 'IST', name: 'Istanbul', country: 'TR' },
  { code: 'FRA', name: 'Frankfurt', country: 'DE' }, { code: 'LEJ', name: 'Leipzig/Halle', country: 'DE' }, { code: 'AMS', name: 'Amsterdam Schiphol', country: 'NL' }, { code: 'LGG', name: 'Liège', country: 'BE' },
  { code: 'CDG', name: 'Paris CDG', country: 'FR' }, { code: 'LHR', name: 'London Heathrow', country: 'GB' }, { code: 'MXP', name: 'Milan Malpensa', country: 'IT' }, { code: 'MAD', name: 'Madrid', country: 'ES' }, { code: 'LUX', name: 'Luxembourg', country: 'LU' },
  { code: 'JFK', name: 'New York JFK', country: 'US' }, { code: 'ORD', name: 'Chicago O\'Hare', country: 'US' }, { code: 'LAX', name: 'Los Angeles', country: 'US' }, { code: 'ATL', name: 'Atlanta', country: 'US' }, { code: 'MIA', name: 'Miami', country: 'US' }, { code: 'IAH', name: 'Houston', country: 'US' },
];

const byIso = Object.fromEntries(COUNTRIES.map((c) => [c.iso, c]));
const regionOf = (iso) => (byIso[iso] ? byIso[iso].region : null);
const portByCode = Object.fromEntries(SEAPORTS.map((p) => [p.code, p]));
const airportByCode = Object.fromEntries(AIRPORTS.map((p) => [p.code, p]));

module.exports = { COUNTRIES, SEAPORTS, AIRPORTS, byIso, regionOf, portByCode, airportByCode };
