import PostalMime from 'postal-mime';

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
