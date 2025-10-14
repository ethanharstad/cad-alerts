import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception';

export interface Env {
	db: D1Database;
}

const app = new Hono<{ Bindings: Env }>().basePath('/api/');

app.get('/org/:organizationKey', async (c) => {
	const organizationKey = await c.req.param('organizationKey');
	const db = c.env.db;
	const stmt = db
		.prepare("SELECT * FROM organizations WHERE org_key = ?")
		.bind(organizationKey);
	const organization = await stmt.first();
	if (!organization) {
		throw new HTTPException(404);
	}
	return c.json(organization);
});
app.get('/org/:organizationKey/alerts', async (c) => {
	const organizationKey = await c.req.param('organizationKey');
	const db = c.env.db;
	const stmt = db
		.prepare("SELECT alerts.* FROM organizations INNER JOIN alerts ON alerts.organization=organizations.org_id WHERE organizations.org_key = ?;")
		.bind(organizationKey);
	const alerts = await stmt.all();
	if (!alerts) {
		throw new HTTPException(404);
	}
	return c.json(alerts);
});

export default app