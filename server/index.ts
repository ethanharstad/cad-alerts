import PostalMime from 'postal-mime';
import { WorkflowStep, WorkflowEvent, WorkflowEntrypoint } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import OpenAI from "openai";
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { app } from './api';
import { organizations, alerts, type Organization, type Alert } from './schema';

const PREALERT_PROMPT_INSTRUCTIONS = `
Parse provided json into a message that will be utilized in a text to speech announcement for emergency responders.
The format of the message should be the nature of the call, followed by the address repeated twice, followed by the city.
Common textual abbreviations should be expanded into their full spelling.

Do not precede the nature of the call with any text.

## Nature Examples
- FIRE-RESIDENCE = Fire - Residence
- FIRE-VEHICLE = Fire - Vehicle
- BREATHING PROBS = Breathing Problems
- MVC-PI = Motor Vehicle Collision with injury
- MVC-PD = Motor Vehicle Collision with property damage

The address can take the form of a numbered street address, a numbered hundred block, or a street intersection.
There may be clarifying information such as an apartment number or a business name.
Handle the numbered address and the street independently. Example: 327 6th St should be parsed as 327 and 6th Street, resulting in three twenty seven sixth street.
Numbered address longer 3 digits or longer should be paired. Examples: 320 = three twenty, 1234 = twelve thirty-four, 2003 = twenty oh three.
Numbered streets should be spelled out. Examples: 230th St = two thirtieth street, 16th St = sixteenth street.
Ensure that the address is repeated twice.

Precede the city with "in" to make the message sound more natural. Only mention the city once.

## Address Examples
- 1900BLK 230TH ST = nineteen hundred block of two hundred thirtieth street
- 16TH ST & LINN ST = intersection of sixteenth street and linn street
- 1202 8TH ST = twelve oh-two eighth street

## Complete Examples
- {"nature":"BACK PAIN", "address": "1400 22nd St ##6", "city":"BOONE"} = Back Pain. Fourteen hundred twenty second street. Fourteen hundred twenty second street. In Boone.
- {"nature": "HEMORRHAGE", "address": "915 W MAMIE EISENHOWER AVE; ADOBE LOUNGE", "city": "BOONE"} = Hemorrhage. Nine fifteen west mamie eisenhower avenue. Nine fifteen west mamie eisenhower avenue. Adobe Lounge. In Boone.

Ensure that the address matches the address that was provided.
`

const TTS_INSTRUCTIONS = `
Speak in a clear tone appropriate for dispatching emergency units over the radio. Pronounce numbers as pairs.
`

const PreAlert = z.object({
	nature: z.string(),
	address: z.string(),
	city: z.string(),
	longitude: z.number(),
	latitude: z.number(),
});

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
				"cf-aig-authorization": `Bearer ${this.env.AI_GATEWAY_TOKEN}`,
			}
		});
		const org_id = await step.do('Get Org', async () => {
			const emails = event.payload.emailTo.split(',');
			const org_key = emails[0].split('@')[0];
			const db = drizzle(this.env.db);
			const result = await db
				.select({ org_id: organizations.org_id })
				.from(organizations)
				.where(eq(organizations.org_key, org_key))
				.get();
			if (!result) {
				throw new NonRetryableError(`Org with key "${org_key}" not found!`);
			}
			return result.org_id;
		});
		const parsedEvent = await step.do('Parse Email', async () => {
			const segments = event.payload.emailText.split('|');
			const nature = segments[0];
			const [address, city] = segments[1].split(':');
			const [latitude, longitude] = segments[segments.length - 1].split(',');
			return PreAlert.parse({
				nature: nature.trim(),
				address: address.trim(),
				city: city.trim(),
				latitude: Number(latitude.trim()),
				longitude: Number(longitude.trim()),
			});
		});
		const ttsText = await step.do('Generate Text', async () => {
			console.log({
				from: event.payload.emailFrom,
				to: event.payload.emailTo,
				text: event.payload.emailText
			});
			const response = await openai.responses.create({
				model: "gpt-4.1-nano",
				instructions: PREALERT_PROMPT_INSTRUCTIONS,
				input: JSON.stringify({
					nature: parsedEvent.nature,
					address: parsedEvent.address,
					city: parsedEvent.city,
				}),
			});
			return response.output_text;
		});
		const audio = await step.do('Get Audio', async () => {
			const mp3 = await openai.audio.speech.create({
				model: "gpt-4o-mini-tts",
				voice: "nova",
				instructions: TTS_INSTRUCTIONS,
				input: ttsText,
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
			const db = drizzle(this.env.db);
			await db.insert(alerts).values({
				alert_id: event.instanceId,
				organization: org_id,
				body: ttsText,
				audio_url: audio_url,
				timestamp: Date.now(),
				source: event.payload.emailText,
				address: parsedEvent?.address || '',
				city: parsedEvent?.city || '',
				nature: parsedEvent?.nature || '',
				latitude: parsedEvent.latitude,
				longitude: parsedEvent.longitude,
			});
		});
	}
}

export async function emailHandler(message: ForwardableEmailMessage, env: Env, _ctx: any) {
	const msg = await PostalMime.parse(message.raw);
	console.log({
		message: msg
	});
	const subject = msg.subject || "";
	if (subject.toLowerCase().includes("pre-alert")) {
		let instance = await env.alert_workflow.create({
			params: {
				emailFrom: msg.from?.address,
				emailTo: message.to,
				emailText: msg.text?.trim()
			}
		});
	}
}


export default {
	fetch: app.fetch,
	email: emailHandler
}
