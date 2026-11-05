# Methodology

**Source:** all_places_raw.csv (552 rows, 10 NZ cities, 5 sectors). Research only; nobody contacted.

## Major limitation
The session's network policy blocked every business website (also via WebFetch), so **no homepage was read**. Anything website-derived (schema, FAQ, service/suburb pages, public email, booking forms, careers) is **Unknown and earns no points**. Scores use Google listing data only. Hence **0 of 497 rows were verified against the business's own site**, no business reached band A, and "AI visibility" was never tested directly. Re-run after allowing the sites' domains.

## Cleaning
- Dropped 39 rows (excluded_rows.csv): large corporates/manufacturers/retailers, council/charity/non-business, off-sector medical/vet/lab, suppliers. No permanently closed or non-NZ rows existed in the data.
- Merged 16 duplicate listings (same own-domain, phone or name in the same city); aliases kept in notes. Chains (Lumino, Smile Dental, HRV, etc.) were not merged across locations, only flagged.
- Domain normalised to host; yellow.co.nz/facebook/builder-subdomain URLs treated as no own website. Phone to E.164. 25 listings lacked an address, so city is the search city (noted). Category mapped to a normalised label.
- Not checked: electricians/insulation/solar in the heat pump sector were kept because homepages could not confirm heat pump work; treat as unverified fit.

## Scoring (100)
| Dimension | Max | Basis |
|---|---|---|
| Competition/discovery | 20 | Sector-level: tourism 18, dentist 17, plumbing 15, heat pump 15, roofing 13 |
| Customer value | 20 | Sector-level analyst assumption: dentist 17, roofing 17, heat pump 15, plumbing 13, tourism 12 |
| Visibility opportunity | 20 | Listing evidence only: no own website 8; 0 reviews 6, or <50% of city+sector median 6 (<100% 3); rating <4.3 2; <10 photos 2; unclaimed 2; no profile description 1 |
| Readiness | 15 | Website 4, phone 1, reviews>=20 4 (>=5 2), photos 2/1, rating>=4.5 2, claimed 2; 0 if temporarily closed |
| Affordability | 15 | Review volume tiers up to 7, own domain 2, rating>=4.5 2, address 1, tourism >=100 reviews 1 |
| Contactability | 10 | Phone 4, website 2, independent (not chain) 2, address 1; public email 0 (unchecked) |

Medians come from this dataset only (cities with >=5 peers). Size, revenue, founding year: Unknown.

**Bands (my thresholds):** A 78+ top priority; B 68-77 promising, needs qualification; C 55-67 lower; D <55 deprioritise. Sector baselines make scores cluster, so rank within band.

## Compliance
Dental, orthodontic and denture rows: "Check advertising rules before outreach". Emails were never harvested or guessed; the column reads "No public email (website not checked)", not a confirmed absence.
