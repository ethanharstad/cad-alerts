import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception';
import { WorkerEntrypoint, WorkflowStep, WorkflowEvent, WorkflowEntrypoint } from 'cloudflare:workers';

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

export function email(message: ForwardableEmailMessage, env: Env, ctx: Object) {
	console.log(message);
}

export class AlertWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		let a = await step.do("first step", async () => { });
	}
}

export default app