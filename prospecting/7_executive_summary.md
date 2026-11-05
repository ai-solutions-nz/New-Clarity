# Executive Summary: STATUS BLOCKED, NO PROSPECT DATA COLLECTED
Research date: 2026-11-05

## Counts
Raw: 0 | Unique: 0 | Qualified: 0 | A/B/C: 0/0/0 | Apify spend: $0. Nothing was fabricated; all data tabs are header-only.

## What blocked the work
1. Apify: no Apify MCP server or APIFY_TOKEN in this session; api.apify.com returns 403 at the proxy (network policy). Google Maps discovery (compass/crawler-google-places) could not run.
2. Stats NZ: www.stats.govt.nz does not resolve (not in allowed domains). WebSearch returned only figure.nz regional age/sex charts, no verified city/TA totals (30 June 2025 subnational release dated 29 Oct 2025 exists per search result; figures not retrieved, so none are stated).
3. Also untested: Companies Office, LinkedIn, business websites, Google SERPs (all outside reachable network).

## To unblock
- Environment network settings: allow api.apify.com, www.stats.govt.nz, and (for evidence) general web / companiesoffice.govt.nz / target business sites.
- Provide APIFY_TOKEN as an environment secret (or attach Apify MCP). Set a spend cap and confirm remaining credit.

## Plan once unblocked
Step 1 market/industry intelligence (Stats NZ + sourced demand data); Step 2 test batch Auckland+Christchurch x roofing+HVAC (3-5 query variants, ~15 unique each; check input schema/pricing first); controlled batches with commits after each; then enrichment, visibility checks (separate Maps/organic/ads/AI Overviews), scoring, shortlist, xlsx.
