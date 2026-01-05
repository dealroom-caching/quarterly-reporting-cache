# Quarterly Report Data Cache

This repository contains the data caching pipeline for the Quarterly Ecosystem Reporter.

## Overview

The pipeline fetches raw data from Google Sheets and stores it as a static JSON file in the `public/` directory. This JSON is then consumed by the web application.

## Repository Structure

- `public/report-data.json`: The cached data (generated).
- `scripts/build-report-data.ts`: The script that performs the fetch and cache operation.
- `.github/workflows/build-data.yml`: GitHub Action to automate the caching (managed manually).

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   - `GOOGLE_SERVICE_ACCOUNT_KEY`: Base64-encoded Google Service Account JSON key.
   - `GOOGLE_SHEET_ID`: The ID of the source Google Sheet.

3. Run the build script locally:
   ```bash
   npm run build
   ```

## Data Source

- **Google Sheet ID:** `120IXe10QWLsOjMwK1beu2pY-jlSLQjaO-kfc10q9J04`
- **Sheets fetched:**
  - Locations Metadata
  - Yearly Funding Data
  - Quarterly Funding Data
  - Yearly Enterprise Value
  - Top Industries and Tags
  - Top Rounds
  - Regional Comparison

