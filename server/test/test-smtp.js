import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

export function startTestSmtp(port) {
  const inbox = [];
  const server = new SMTPServer({
    authOptional: true,
    hideSTARTTLS: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, session, callback) {
      simpleParser(stream, {}, (err, parsed) => {
        if (!err) inbox.push({ to: parsed.to?.text, subject: parsed.subject, text: parsed.text });
        callback();
      });
    },
  });
  return new Promise(resolve => {
    server.listen(port, () => resolve({ server, inbox }));
  });
}
