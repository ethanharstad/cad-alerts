DROP TABLE IF EXISTS organizations;
CREATE TABLE IF NOT EXISTS organizations (
    org_id TEXT PRIMARY KEY,
    org_key TEXT,
    access_key TEXT,
    name TEXT
);

DROP TABLE IF EXISTS alerts;
CREATE TABLE IF NOT EXISTS alerts (
    alert_id TEXT PRIMARY KEY,
    organization TEXT,
    body TEXT,
    audio_url TEXT,
    timestamp INTEGER,
    source TEXT,
    FOREIGN KEY(organization) REFERENCES organizations(org_id)
);