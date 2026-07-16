# cad-alerts

The domain of turning fire-department CAD dispatch emails into spoken alerts that
an organization's responders can hear. This file is the shared glossary — the
ubiquitous language — for that domain. It is a glossary only: no implementation
detail.

## Language

**Pre-alert**:
An inbound CAD dispatch notification for a single emergency call, arriving as an
email whose subject marks it as a pre-alert. Carries the nature of the call, an
address, a city, and coordinates.
_Avoid_: dispatch, notification, incident, page.

**Alert**:
The spoken announcement produced from a pre-alert — its generated text, its audio,
and the call details — belonging to one organization and shown in that
organization's recent-alerts feed.
_Avoid_: message, announcement, event.

**Nature**:
What the call is — the classification of the emergency (e.g. a residence fire, a
breathing problem, a motor-vehicle collision). Often arrives abbreviated and is
spoken in full.
_Avoid_: type, category, kind.

**Organization**:
A fire department (or comparable responding body) that receives its own alerts.
The tenant of the system; every alert belongs to exactly one.
_Avoid_: tenant, account, agency, department.

**Org key**:
An organization's public identifier, used to address its pre-alert email and to
name it in a URL. Not a secret — revealing whether one exists is harmless.
_Avoid_: slug, org id, tenant id.

**Access key**:
An organization's shared secret, presented by its clients to authenticate as that
organization. Never returned to a client.
_Avoid_: token, password, api key.

**Alert store**:
The durable collection of organizations and their alerts — the single concept
through which the system looks up an organization, reads an organization's recent
alerts, and records a new alert. Where those records physically live is an
implementation detail, not part of this language.
_Avoid_: database, repository, DAO, table.
