import { app } from './api';
import { emailHandler } from './email-handler';
import AlertWorkflow from './workflow';

export default {
	fetch: app.fetch,
	email: emailHandler,
	workflow: AlertWorkflow,
}
