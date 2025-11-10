DROP TABLE IF EXISTS organizations;
CREATE TABLE IF NOT EXISTS organizations (
    org_id TEXT PRIMARY KEY,
    org_key TEXT,
    access_key TEXT,
    name TEXT
);
CREATE INDEX idx_organization_key on organizations(org_key);

DROP TABLE IF EXISTS alerts;
CREATE TABLE IF NOT EXISTS alerts (
    alert_id TEXT PRIMARY KEY,
    organization TEXT,
    body TEXT,
    audio_url TEXT,
    timestamp INTEGER,
    source TEXT,
    address TEXT,
    city TEXT,
    nature TEXT,
    latitude REAL,
    longitude REAL,
    FOREIGN KEY(organization) REFERENCES organizations(org_id)
);
CREATE INDEX idx_latest_alerts_for_org ON alerts(organization, timestamp DESC);