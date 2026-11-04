# Database diagram

Tables in the migrations (`supabase/migrations/`). Planned tables are in `docs/database-design.md`, not here, because they are not in a migration yet.

`auth.users` is Supabase's sign-in table. It is shown for the links only.

```mermaid
erDiagram
    AUTH_USERS ||--o| USER_ROLES : "has one role"
    AUTH_USERS ||--o{ BATCH_MEMBERS : "is a member of"
    BATCHES ||--o{ BATCH_MEMBERS : "has members"
    BATCHES ||--o{ DECISION_EVENTS : "holds"
    DECISION_EVENTS ||--o{ DECISION_EVENTS : "is corrected by"
    AUTH_USERS ||--o{ DECISION_EVENTS : "records"
    AUTH_USERS ||--o{ AUDIT_EVENTS : "acts in"
    BATCHES ||--o{ SOURCE_SNAPSHOTS : "receives"
    BATCHES ||--o{ RECORDS : "contains"
    SOURCE_SNAPSHOTS ||--o{ RECORDS : "is the upload of"
    AUTH_USERS ||--o{ SOURCE_SNAPSHOTS : "uploads"

    AUTH_USERS {
        uuid id PK
    }
    USER_ROLES {
        uuid user_id PK, FK
        text user_type
        text permission_level
        uuid assigned_by FK
        timestamptz assigned_at
    }
    BATCHES {
        uuid id PK
        text name
        text source_label
        text status
        uuid created_by FK
        timestamptz created_at
    }
    BATCH_MEMBERS {
        uuid batch_id PK, FK
        uuid user_id PK, FK
    }
    DECISION_EVENTS {
        uuid id PK
        uuid batch_id FK
        text record_pmid
        text kind
        text outcome
        text reason_code
        text free_text
        text criteria_version
        uuid corrects_event_id FK
        uuid actor_id FK
        timestamptz recorded_at
    }
    SOURCE_SNAPSHOTS {
        uuid id PK
        uuid batch_id FK
        text file_name
        text file_text
        text checksum
        uuid uploaded_by FK
        timestamptz uploaded_at
    }
    RECORDS {
        uuid id PK
        uuid batch_id FK
        uuid source_snapshot_id FK
        text pmid
        text doi
        text title
        text abstract
        text authors
        text journal
        integer year
        timestamptz created_at
    }
    AUDIT_EVENTS {
        uuid id PK
        uuid actor_id FK
        text action
        text target
        boolean allowed
        timestamptz occurred_at
    }
```

Rules shown in the diagram:
- A correction or resolution must point to an event in the same batch (`corrects_event_id`).
- A new batch's creator is added to the batch's members automatically.
- Decision events, audit events, source files, and records are never updated or deleted (enforced by the database).
- A record's source file must be in the same batch (`source_snapshot_id`).
- Each PubMed ID appears once per batch (`pmid` within `batch_id`).
- Each person has at most one role row.
