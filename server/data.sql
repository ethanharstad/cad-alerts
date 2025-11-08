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
    audio_url,
    timestamp,
    source
) VALUES (
    "11111111-1111-1111-1111-111111111111",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "Medical. Sick Person. 1 7 0 4 Hawkeye Drive, Apartment 104, Boone. Sick Person. 17 04 Hawkeye Drive, Apartment 104, Boone.",
    "111111111111",
    1762565081144,
    "SICK PERSON | 1704 HAWKEYE DR #APT 104:BOONE | 42.036800,-93.868018"
);

INSERT INTO alerts (
    alert_id,
    organization,
    body,
    audio_url,
    timestamp,
    source
) VALUES (
    "22222222-2222-2222-2222-222222222222",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "Medical. Seizures. 1 3 1 2 South Story Street, Saints Avenue Cafe, Boone. Seizures. 13 12 South Story Street, Saints Avenue Cafe, Boone.",
    "222222222222",
    1762562943454,
    "SEIZURES | 1312 S STORY ST; SAINTS AVENUE CAFE:BOONE | 42.041368,-93.879049"
);