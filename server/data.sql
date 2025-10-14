INSERT INTO organizations (
    org_id,
    org_key,
    access_key,
    name
) VALUES (
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "boone",
    "abcdef",
    "Boone Fire Department"
);

INSERT INTO alerts (
    alert_id,
    organization,
    body,
    audio_url
) VALUES (
    "11111111-1111-1111-1111-111111111111",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "Fire - Structure Fire - 2004 Benton Street - Boone",
    "111111111111"
);