# Methodology

**Source:** all_places_raw.csv (552 rows, 10 NZ cities, 5 sectors). Research only; nobody contacted.

## Evidence and limits
After network access was allowed, each business homepage (one GET per domain, generic user agent, homepage only, TLS verified) was read. 381 sites were checked; 58 listed sites did not resolve from our network and 48 listings have no own website. On-site signals for the 106 unverified rows are Unknown and earn no points. "AI visibility" was never queried directly: the visibility score uses observable proxies (schema, FAQ, service-area links, thin content, meta/H1, review gap, listing gaps). Service-area detection looks only at homepage link text, so a "no area links" gap means none were visible on the homepage, not that none exist on the site.

## Cleaning
- Dropped 39 rows (excluded_rows.csv): large corporates/manufacturers/retailers, council/charity/non-business, off-sector medical/vet/lab, suppliers. No permanently closed or non-NZ rows existed in the data.
- Merged 16 duplicate listings (same own-domain, phone or name in the same city); aliases kept in notes. Chains (Lumino, Smile Dental, HRV, etc.) were not merged across locations, only flagged.
- Domain normalised to host; yellow.co.nz/facebook/builder-subdomain URLs treated as no own website. Phone to E.164. 25 listings lacked an address, so city is the search city (noted). Category mapped to a normalised label.
- Fit check: electricians/insulation/solar/etc. were kept only if the homepage mentions heat pump/air con/HVAC/heating (or roof/plumbing) at least 8 times (or the site was unreadable). 10 more rows were dropped on this rule, giving 487 scored.

## Scoring (100)
| Dimension | Max | Basis |
|---|---|---|
| Competition/discovery | 20 | Sector-level: tourism 18, dentist 17, plumbing 15, heat pump 15, roofing 13 |
| Customer value | 20 | Sector-level analyst assumption: dentist 17, roofing 17, heat pump 15, plumbing 13, tourism 12 |
| Visibility opportunity | 20 | No own website 10; no schema 4 (non-local schema 2); no FAQ 3; no area links 3 (not tourism); thin <300 words 2; no meta description 1; no H1 1; 0 reviews or <50% of city+sector median 4 (<100% 2); rating <4.3, <10 photos, unclaimed 1 each |
| Readiness | 15 | Live site 3, https 1, mobile viewport 1, booking/quote CTA 3, careers link 2, social links 1, blog/news 1, reviews>=20 2, claimed 1; 0 if temporarily closed |
| Affordability | 15 | Review volume tiers up to 7, own domain 1, rating>=4.5 2, homepage link count (site scale) up to 3, address 1, tourism >=100 reviews 1 |
| Contactability | 10 | Phone 4, role email on own site 3, contact form 1, live site 1, independent 1 |

Medians come from this dataset only (cities with >=5 peers). Size, revenue, founding year: Unknown.

**Bands (my thresholds):** A 78+ top priority; B 68-77 promising, needs qualification; C 55-67 lower; D <55 deprioritise. Sector baselines make scores cluster, so rank within band. Thresholds were set before the enriched rescore.

## Compliance and email
Dental, orthodontic and denture rows: "Check advertising rules before outreach". Emails are recorded only when a role-based address (info, reception, hello, admin, etc.) is published on the business's own homepage and its domain matches the site's domain. 116 rows have one. Nothing was guessed or harvested; "No public email" means none was found on the homepage, not that none exists elsewhere on the site.

## Enrichment columns
site_status, platform, schema_types, faq_on_home, area_links, booking_cta, careers_link, homepage_words, verified, evidence_url (the homepage, else the Google Maps listing).

## Regions
Added `region` and `region_basis` columns (North/South/East/West/Central/Unclear) from the suburb column, falling back to the street address already in the cleaned data; no re-scrape, scores unchanged. See `region_summary.md`.
