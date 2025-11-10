import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and } from 'drizzle-orm';

import { organizations, alerts, type Organization, type Alert } from './schema';

export const app = new Hono<{ Bindings: Env }>().basePath('/api/');
app.get('/org/:organizationKey', async (c) => {
	const organizationKey = c.req.param('organizationKey');
	const db = drizzle(c.env.db);
	const organization = await db
		.select()
		.from(organizations)
		.where(eq(organizations.org_key, organizationKey))
		.get();
	if (!organization) {
		throw new HTTPException(404);
	}
	return c.json(organization);
});
app.get('/org/:organizationKey/alerts', async (c) => {
	const organizationKey = await c.req.param('organizationKey');
	const db = drizzle(c.env.db);
	const alertsList = await db
		.select({
			alert_id: alerts.alert_id,
			organization: alerts.organization,
			body: alerts.body,
			audio_url: alerts.audio_url,
			timestamp: alerts.timestamp,
			source: alerts.source,
			nature: alerts.nature,
			address: alerts.address,
			city: alerts.city,
			latitude: alerts.latitude,
			longitude: alerts.longitude,
		})
		.from(alerts)
		.innerJoin(organizations, eq(alerts.organization, organizations.org_id))
		.where(eq(organizations.org_key, organizationKey))
		.orderBy(desc(alerts.timestamp))
		.limit(5);
	return c.json(alertsList);
});

app.get('/org/:organizationKey/alerts/:alertId/audio', async (c) => {
	const organizationKey = c.req.param('organizationKey');
	const alertId = c.req.param('alertId');
	const db = drizzle(c.env.db);

	// Get the alert and verify it belongs to the organization
	const alert = await db
		.select({
			alert_id: alerts.alert_id,
			organization: alerts.organization,
			body: alerts.body,
			audio_url: alerts.audio_url,
			timestamp: alerts.timestamp,
			source: alerts.source,
		})
		.from(alerts)
		.innerJoin(organizations, eq(alerts.organization, organizations.org_id))
		.where(and(
			eq(organizations.org_key, organizationKey),
			eq(alerts.alert_id, alertId)
		))
		.get();

	if (!alert) {
		throw new HTTPException(404, { message: 'Alert not found' });
	}

	if (!alert.audio_url) {
		throw new HTTPException(404, { message: 'Audio file not found for this alert' });
	}

	// Fetch the audio file from R2 bucket
	const audioFile = await c.env.bucket.get(alert.audio_url);

	if (!audioFile) {
		throw new HTTPException(404, { message: 'Audio file not found in storage' });
	}

	// Return the audio file with appropriate headers
	return new Response(audioFile.body, {
		headers: {
			'Content-Type': 'audio/mpeg',
			'Content-Disposition': `inline; filename="${alertId}.mp3"`,
			'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
		},
	});
});
