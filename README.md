# RCM Network Management System

A full-stack network management and PV analysis application for maintaining an RCM Associate Buyer (AB) network.

The system combines a manually maintained Sponsor-based network tree with member/report data imported from Smart Report Excel files.

> **Current scope:** Network management, monthly PV, Excel synchronization, member profiles, joining analytics, and network reporting. RCM PIN/level qualification logic is intentionally not implemented yet.

---

## Overview

The application is built around three independent concepts:

```text
AB Number
    │
    └── Member Identity
          │
          ├── Sponsor → Tree / Downline / Group PV
          │
          └── Proposer → Joining / Introduced-By Relationship
```

### Sponsor vs Proposer

**Sponsor**
- Determines an AB's position in the network tree.
- Determines the AB's downline and legs/groups.
- Is used for recursive downline PV calculation.

**Proposer**
- Represents the person associated with the joining.
- Is used for joining history and joining analytics.
- Does **not** determine tree position.

For example:

```text
Rahim
└── Rohan
    └── Salim
```

If:

```text
Salim
Sponsor  = Rohan
Proposer = Rahim
```

Salim remains under Rohan in the tree, while Rahim gets the joining relationship.

---

## Core Features

### 1. Main Leader Account

The application currently has one authenticated Main Leader account.

- Login using AB Number and password.
- The Main Leader is the root of the Sponsor tree.
- Other ABs are members, not login users.
- The Main Leader itself has no Sponsor.

### 2. AB / Member Management

Each AB is uniquely identified by its AB Number.

Member management supports:

- AB Number
- Name
- Sponsor
- Proposer
- KYC status
- Termination status
- Smart Report / Excel-derived information
- Monthly PV
- Joining information

Duplicate AB Numbers are prevented.

### 3. Sponsor-Based Network Tree

The network is a hierarchical Sponsor tree.

One Sponsor can have any number of direct children/legs.

The system does **not** assume a two-leg/binary structure.

Example:

```text
Rohan
├── Mohan
├── Salim
├── Asif
└── Karim
```

Tree features include:

- Expand/collapse
- Node selection
- Search/navigation
- Subtree viewing
- Node profile access
- Desktop and mobile support

### 4. AB Profiles

Every AB has a profile containing relevant information such as:

- Basic member information
- Current-month PV
- Self PV
- PV by direct leg/group
- Total PV
- Month-wise PV
- Excel/Smart Report information
- Total downline
- Active downline
- Terminated downline
- KYC Not OK count
- Joining history
- Own Sponsor-based network

### 5. Monthly PV

Monthly Self PV is stored separately by month.

Historical months remain available.

For example:

```text
April 2026
May 2026
June 2026
...
October 2026
```

The current month's PV can be manually updated.

Manual PV update is an **overwrite**, not an addition.

Example:

```text
Current PV: 1200
New PV:     1850

Result:     1850
```

### 6. Sponsor-Based Downline PV

PV is calculated from the Sponsor hierarchy.

For a selected AB:

```text
Total PV
=
Self PV
+
PV from applicable Sponsor downline
```

Each direct Sponsor child represents a separate leg/group.

An AB can have more than two legs.

PV from unrelated branches is not included.

### 7. Smart Report Excel Import

Smart Report Excel files can be uploaded to update member/report information and monthly PV.

The AB Number is the primary matching key.

The import process:

1. Reads the Excel workbook.
2. Identifies the relevant report data.
3. Matches records by AB Number.
4. Updates matching member/report data.
5. Updates applicable monthly PV.
6. Detects ABs that are not yet present in the application.
7. Displays unmatched records for manual placement.

Excel is an **import/update source**, not the permanent database.

### 8. Sponsor Safety During Excel Import

Excel import does **not** automatically change Sponsor relationships.

This is important because the Smart Report contains Proposer information, but the Sponsor/tree relationship is maintained separately.

The application never treats:

```text
Proposer = Sponsor
```

automatically.

### 9. Unmapped / New ABs

If an AB appears in Excel but does not yet exist in the application, it appears as an Unmapped AB.

The imported information can include:

- AB Number
- Name
- Proposer
- Joining Date
- PV
- Other Smart Report fields

The user must explicitly select the Sponsor before placing the AB into the tree.

Example:

```text
Unmapped AB
     │
     ├── Proposer: Rahim
     │
     └── Select Sponsor: Rohan
                    │
                    ↓
               Create / Place
```

No Sponsor is inferred automatically from the Proposer.

### 10. Repeated Excel Uploads

The same month's report can be uploaded multiple times.

For example:

```text
15th October:
October PV = 1200

Month-end:
October PV = 1850
```

The later import updates October's PV while preserving the Sponsor tree and historical monthly structure.

### 11. Joining Analytics

The Joining section uses:

- Proposer relationship
- Joining Date

The Excel field **Feeding Date** is treated as the member's **Joining Date**.

For each AB, the system can show:

- Total joinings
- Who they proposed
- Joining dates
- Month-wise joining activity

There is also a global Joining section for the Main Leader's network.

### 12. AB Members

The AB Members section provides a searchable/filterable member list.

Filters include:

- PV range
- Active / Terminated
- KYC OK / Not OK
- Month
- Custom PV range where applicable

Example:

```text
October 2026
PV: 0–100
Status: Active
KYC: OK
```

### 13. Network Statistics

The application can calculate network statistics including:

- Total members
- Active members
- Terminated members
- KYC Not OK members
- Current-month network PV
- Current-month joining count
- Unmapped AB count

---

## Technology Stack

### Frontend

- React
- Vite
- Tailwind CSS

### Backend

- Node.js
- Express.js

### Database

- PostgreSQL
- Prisma ORM

### Planned / configured hosting

- Frontend: Vercel
- Backend: Render
- Database: Neon PostgreSQL

### Other important tooling

- Vitest for backend testing
- Excel workbook parsing for Smart Report imports

---

## Architecture

```text
┌──────────────────────────┐
│        React + Vite      │
│      Tailwind CSS UI     │
└────────────┬─────────────┘
             │ REST API
             ▼
┌──────────────────────────┐
│     Node.js + Express    │
│                          │
│ Auth                     │
│ Members                  │
│ Sponsor Tree             │
│ Proposer / Joining       │
│ Monthly PV               │
│ Excel Import             │
│ PV Calculation           │
└────────────┬─────────────┘
             │ Prisma
             ▼
┌──────────────────────────┐
│     PostgreSQL / Neon    │
└──────────────────────────┘
```

---

## Data Relationship Model

Conceptually:

```text
                     AB MEMBER
                         │
             ┌───────────┴───────────┐
             │                       │
          Sponsor                 Proposer
             │                       │
             ▼                       ▼
       Sponsor Tree            Joining History
             │
             ▼
       Downline / Legs
             │
             ▼
       Group / Downline PV
```

AB Number connects imported Smart Report data to the correct member.

---

## Important Business Rules

1. The Main Leader is the root of the Sponsor tree.
2. AB Number is the unique member identity.
3. Sponsor determines tree position.
4. Proposer is independent of Sponsor.
5. One Sponsor can have multiple direct legs.
6. The system does not assume exactly two legs.
7. Excel is not the permanent database.
8. Excel matching is based primarily on AB Number.
9. Excel import must not overwrite Sponsor relationships.
10. Feeding Date is treated as Joining Date.
11. Unmapped Excel ABs remain unmapped until a Sponsor is explicitly selected.
12. Proposer must never automatically become Sponsor.
13. Monthly PV history is preserved.
14. Manual PV updates overwrite the selected month's Self PV.
15. Downline PV follows the Sponsor hierarchy.
16. Unrelated branches do not contribute to an AB's downline PV.
17. RCM PIN/level calculations are not part of the current version.

---

## Security

The application is designed with:

- Password hashing
- Protected API endpoints
- Authentication middleware
- Input validation
- Environment-based secrets
- CORS configuration
- Authentication rate limiting
- Safe production error handling
- Excel upload validation
- Database-level uniqueness for AB Numbers

Never commit production secrets to Git.

---

## Environment Variables

### Backend

Typical variables include:

```env
DATABASE_URL=
JWT_SECRET=
CORS_ORIGIN=
```

### Frontend

The frontend requires the production API base URL, for example:

```env
VITE_API_URL=
```

Use the project's `.env.example` as the source of truth for the exact variables required by the current implementation.

---

## Local Development

Clone the repository:

```bash
git clone <repository-url>
cd rcm-network
```

Install dependencies:

```bash
npm install
```

Install frontend dependencies if the project uses a separate frontend package:

```bash
cd frontend
npm install
```

Configure environment variables using the project's `.env.example` files.

Set up the PostgreSQL database and run Prisma migrations:

```bash
npx prisma migrate dev
npx prisma generate
```

Start the backend and frontend using the project's configured development scripts.

Check the backend health endpoint:

```text
GET /health
```

---

## Production Deployment

### Database — Neon

1. Create a PostgreSQL database in Neon.
2. Copy the production connection string.
3. Set `DATABASE_URL`.
4. Run production Prisma migrations.

### Backend — Render

1. Connect the GitHub repository.
2. Configure the backend service.
3. Add production environment variables.
4. Configure the Neon `DATABASE_URL`.
5. Configure CORS to allow the Vercel frontend.
6. Deploy.
7. Verify `/health`.

### Frontend — Vercel

1. Connect the GitHub repository.
2. Configure the frontend project/root directory as required by the repository.
3. Set the production API URL.
4. Deploy.
5. Verify login and API communication.

---

## Testing

The backend contains automated tests covering critical business logic.

Important areas include:

- Authentication
- Duplicate AB prevention
- Sponsor validation
- Proposer validation
- Sponsor cycle prevention
- Multiple Sponsor legs
- Monthly PV
- Recursive PV calculation
- Manual PV updates
- Excel import
- Unmapped AB detection
- Excel re-import
- Joining analytics
- Member filtering
- Sponsor/Proposer separation

The Sponsor/Proposer separation is especially important.

A valid relationship may be:

```text
Salim
Sponsor  = Rohan
Proposer = Rahim
```

The expected tree is:

```text
Rahim
└── Rohan
    └── Salim
```

not:

```text
Rahim
├── Rohan
└── Salim
```

---

## Current Scope

### Included

- Main Leader authentication
- AB/member management
- Sponsor network tree
- Proposer relationship
- AB profiles
- Monthly PV
- Recursive downline PV
- Manual PV updates
- Smart Report Excel import
- Unmapped AB management
- Joining analytics
- Member filtering
- KYC/termination status
- Responsive UI
- Automated backend tests

### Not Included Yet

The following are intentionally reserved for a future phase:

- RCM PIN level calculation
- Opener / Eagle / Runner / Winner / Star / other level qualification
- Main Group / Other Group qualification logic
- Royalty/Technical/Vital bonus calculations
- Marketing-plan reward calculations

The current application is the foundation required before implementing those calculations.

---

## Project Status

**Stage:** Pre-production / Deployment

The Sponsor/Proposer business-logic correction has been implemented so that:

- Proposer cannot automatically become Sponsor.
- Unmapped ABs require an explicitly selected Sponsor.
- Excel import does not change Sponsor.
- Sponsor and Proposer remain separate relationships.
- Backend tests cover the separation.
- Frontend and backend builds are expected to be production-ready after final deployment validation.

---

## License

Private project.

All rights reserved unless a separate license is provided.
