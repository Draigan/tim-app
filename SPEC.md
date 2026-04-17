# Tim App — Asset Tracking Specification

## Overview

A PWA map application for tracking physical assets (dumpsters, portable storage, etc.) across job sites. Assets live in a yard inventory and can be deployed to job sites where they appear on a map with customer and expiry info.

## Stack

- Vite + React (PWA)
- Supabase (Postgres DB + JS client — no Express)
- Mapbox GL JS (map + geocoding)

---

## Core Concepts

### Asset States
- **In Yard** — exists in inventory, not currently deployed, not shown on map
- **Deployed** — placed at a job site, visible on map as a marker

### Asset Types
Predefined list stored in DB, user can add new types at any time.

Default seed types:
- Dumpster
- Portable Storage
- Portable Toilet
- Trailer

---

## Database Schema

### `asset_types`
| column | type | notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | e.g. "Dumpster" |

### `assets`
The physical inventory — each row is a real-world unit.

| column | type | notes |
|--------|------|-------|
| id | uuid | PK |
| type | text | references asset_types.name |
| size | text | free text (e.g. "20yd", "40ft") |
| label | text | identifier for the unit (e.g. "BIN-04") |
| notes | text | permanent notes about this unit |
| created_at | timestamptz | default now() |

### `deployments`
One row per job site placement. An asset with no active deployment (no `picked_up_at`) is considered deployed.

| column | type | notes |
|--------|------|-------|
| id | uuid | PK |
| asset_id | uuid | FK → assets.id |
| address | text | human-readable address |
| lat | float | geocoded latitude |
| lng | float | geocoded longitude |
| customer_name | text | |
| customer_phone | text | |
| notes | text | job-specific notes |
| dropped_at | timestamptz | when asset was placed |
| expires_at | date | expected pick up / job end date |
| picked_up_at | timestamptz | null = still deployed |

---

## User Flows

### 1. View Map
- Opens to map showing all currently deployed assets as markers
- Markers color-coded by expiry status:
  - Green = active
  - Yellow = expiring within X days
  - Red = expired
- Click marker → side panel with full deployment details

### 2. Add Asset to Inventory
- Form: type (select from list), size (text), label (text), notes (text)
- Asset type list has an "Add new type" option
- Created asset lands in yard (no deployment)

### 3. Deploy Asset
- Pick from yard inventory (list of undeployed assets)
- Enter: address, customer name, customer phone, expiry date, notes
- Address is geocoded to lat/lng via Mapbox
- Asset appears on map

### 4. Pick Up Asset
- From map marker or asset detail, mark as picked up
- Sets `picked_up_at` timestamp
- Asset removed from map, returns to yard inventory

### 5. View Inventory (Yard)
- List of all assets currently in yard (no active deployment)
- Can deploy from here

### 6. Deployment History
- Each asset retains full history of past deployments

---

## Pages / Screens

| Route | Description |
|-------|-------------|
| `/` | Map view — all deployed assets |
| `/inventory` | Yard inventory list |
| `/assets/new` | Add new asset to inventory |
| `/assets/:id` | Asset detail + deployment history |
| `/deploy/:assetId` | Deploy an asset form |
| `/settings` | Manage asset types |
