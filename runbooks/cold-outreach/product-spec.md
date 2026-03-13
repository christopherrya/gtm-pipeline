# Cold Outreach Product Spec

This document is the master overview for the cold outreach system.

It describes a fully automated cold outreach pipeline that is operated through the CLI. The pipeline takes raw lead data, enriches it, scores it, personalizes outreach, pushes campaigns into Instantly, and syncs engagement data back into the CRM.

## Stack

`Clay -> Apify -> SQLite -> Instantly -> TwentyCRM`

## System Overview

1. Clay provides the base lead list.
2. Apify enriches each lead with external context like LinkedIn and Instagram data.
3. SQLite acts as the operational store for deduping, queueing, suppression rules, funnel state, and send metadata.
4. Instantly handles campaign routing and outbound cold email delivery.
5. TwentyCRM stays in sync as the dashboard and CRM layer for reviewing contacts, statuses, and downstream follow-up.

## What Was Built

- A modular CLI pipeline where each step can run independently or as part of a full end-to-end workflow
- Automated lead selection, enrichment, import, personalization, sending, and status sync
- Centralized operational state in SQLite so the hot path is not blocked on the CRM
- Rehearsal and dry-run modes for testing without sending live email
- CRM synchronization so outbound execution and team visibility stay aligned

## Architecture Rationale

The system is intentionally modular so components can be changed without rebuilding the full workflow. Clay is the source feed, Apify handles enrichment, SQLite owns operational decision-making, Instantly owns delivery, and TwentyCRM remains the system of record for review and follow-up.

That separation makes the workflow easier to automate through the CLI while keeping each stage independently debuggable.

## One-Paragraph Summary

The cold outreach pipeline is a CLI-accessible system that automates lead intake, enrichment, scoring, personalization, campaign delivery, and CRM sync. The stack is `Clay -> Apify -> SQLite -> Instantly -> TwentyCRM`, with SQLite serving as the operational control layer and Instantly handling outbound delivery.
