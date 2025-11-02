import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception';
import { WorkflowStep, WorkflowEvent, WorkflowEntrypoint } from 'cloudflare:workers';
import PostalMime from 'postal-mime';
import OpenAI from "openai";
import { NonRetryableError } from 'cloudflare:workflows';

export interface Env {
	bucket: R2Bucket;
	db: D1Database;
	alert_workflow: Workflow;
	ai: Ai;
	ai_key: SecretsStoreSecret;
}

type OrgRow = {
	org_id: string;
	org_key: string;
	access_key: string;
	name: string;
}

type AlertRow = {
	alert_id: string;
	organization: string;
	body: string;
	audio_url: string;
}

const PREALERT_PROMPT_INSTRUCTIONS = `
# Role and Objective
Parse provided dispatch messages into clear, pre-alert messages for emergency responders. Each pre-alert message should concisely describe the nature and location of the emergency, suitable for text-to-speech delivery.

# Instructions
- Extract and expand abbreviations where confident, particularly for addresses and numerics like 1st 2nd.
- Each message must include:
  - The type of emergency (call type).
  - The full address of the emergency.
- Only include additional information if relevant to responders.
- Repeat the nature of the emergency and the address twice:
  1. **First repetition**: Separate any numbers into individual digits.
  2. **Second repetition**: Group numbers into pairs of digits. If there is an odd number of digits, then lead with a single digit and pair the remaining digits.

After generating the pre-alert message, review it for clarity and adherence to the required structure. If either repetition is missing or unclear, revise before finalizing output.

# Examples
<user_prompt>
HEADACHE | 1116 1ST ST:BOONE | 42.067439,-93.873498
</user_prompt>
<assistant_response>
Medical. Headache. 1 1 1 6 First Street, Boone. 11 16 First Street, Boone.
</assistant_response>

<user_prompt>
FIRE-RESIDENCE | 2004 BENTON ST:BOONE | 42.076317,-93.874821
</user_prompt>
<assistant_response>
Fire. Residential Fire. 2 0 0 4 Benton Street, Boone. Residential Fire. 20 04 Benton Street, Boone.
</assistant_response>

<user_prompt>
BREATHING PROBS | 128 HANCOCK DR #APT 3; HANCOCK APARTMENTS:BOONE | 42.044940,-93.875624
</user_prompt>
<assistant_response>
Medical. Breathing Problems. 1 2 8 Hancock Drive, Apartment 3, Boone. Hancock Apartments. Breathing Problems. 1 28 Hancock Drive, Apartment 3, Boone. Hancock Apartments.
</assistant_response>

# Output Format
- Use clear, complete sentences suitable for text-to-speech.
- Maintain the provided structure

# Verbosity
- Be concise and clear, avoiding unnecessary repetition or irrelevant detail.

# Stop Conditions
- Return when the pre-alert message includes both required repetitions (single and paired digits) for the type and address, plus only relevant details.
`

const TTS_INSTRUCTIONS = `
Speak in a clear tone appropriate for dispatching emergency units over the radio. Pronounce numbers as pairs.
`

// HTTP API
const app = new Hono<{ Bindings: Env }>().basePath('/api/');
app.get('/org/:organizationKey', async (c) => {
	const organizationKey = c.req.param('organizationKey');
	const db = c.env.db;
	const stmt = db
		.prepare("SELECT * FROM organizations WHERE org_key = ?")
		.bind(organizationKey);
	const organization = await stmt.first<OrgRow>();
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
	const alerts = await stmt.all<AlertRow>();
	if (!alerts) {
		throw new HTTPException(404);
	}
	return c.json(alerts);
});

// Workflow
type WorkflowParams = {
	emailTo: string;
	emailFrom: string;
	emailText: string;
};
export class AlertWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		const openai = new OpenAI({
				apiKey: await this.env.ai_key.get(),
				baseURL: await this.env.ai.gateway("sar").getUrl("openai"),
				defaultHeaders: {
					"cf-aig-authorization": "Bearer uVJLoTF5deDPGWmDFuqgOVcxaroehwyBCxVE3ynY",
				}
			});
		const org_id = await step.do('Get Org', async () => {
			const emails = event.payload.emailTo.split(',');
			const org_key = emails[0].split('@')[0];
			const result = await this.env.db
				.prepare('SELECT org_id FROM organizations WHERE org_key = ?')
				.bind(org_key)
				.first<OrgRow>();
			if (!result) {
				throw new NonRetryableError(`Org with key "${org_key}" not found!`);
			}
			return result.org_id;
		});
		const parsed = await step.do('Parse Email', async () => {
			console.log({
				from: event.payload.emailFrom,
				to: event.payload.emailTo,
				text: event.payload.emailText
			});
			const response = await openai.responses.create({
				model: "gpt-4.1-nano",
				instructions: PREALERT_PROMPT_INSTRUCTIONS,
				input: event.payload.emailText,
			});
			return response.output_text;
		});
		const audio = await step.do('Get Audio', async () => {
			const mp3 = await openai.audio.speech.create({
				model: "gpt-4o-mini-tts",
				voice: "nova",
				instructions: TTS_INSTRUCTIONS,
				input: parsed,
			});
			return await mp3.arrayBuffer();
		});
		const audio_url = await step.do('Upload Audio', async () => {
			const obj = await this.env.bucket.put(
				`${event.instanceId}.mp3`,
				audio,
				{
					httpMetadata: {
						contentType: "audio/mpeg"
					}
				}
			);
			return obj.key;
		});
		await step.do('Save Record', async () => {
			await this.env.db
				.prepare('INSERT INTO alerts (alert_id, organization, body, audio_url) VALUES (?1, ?2, ?3, ?4)')
				.bind(event.instanceId, org_id, parsed, audio_url)
				.run();
		});
	}
}

// Email Handler
async function email(message: ForwardableEmailMessage, env: Env, _ctx: any) {
	const msg = await PostalMime.parse(message.raw);
    console.log({
      message: msg
    });
    
    let instance = await env.alert_workflow.create({
      params: {
        emailFrom: msg.from?.address,
        emailTo: msg.to?.map((x) => x.address).join(','),
        emailText: msg.text?.trim()
      }
    });
}

export default {
	fetch: app.fetch,
	email: email,
}
