import { app } from './api';
import { emailHandler } from './email-handler';

export default {
	fetch: app.fetch,
	email: emailHandler,
}
