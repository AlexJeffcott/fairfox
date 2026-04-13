import db from '../db';
import { broadcast } from '../ws';

const listConversations = db.query('SELECT * FROM conversations ORDER BY updated_at DESC');
const getConversation = db.query('SELECT * FROM conversations WHERE id = ?');
const insertConversation = db.query(`
  INSERT INTO conversations (title, context_type, context_id)
  VALUES ($title, $context_type, $context_id)
`);

const getMessages = db.query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id');
const insertMessage = db.query(`
  INSERT INTO messages (conversation_id, sender, text, pending)
  VALUES ($conversation_id, $sender, $text, $pending)
`);
const getMessage = db.query('SELECT * FROM messages WHERE id = ?');
const getPending = db.query(
  'SELECT m.*, c.title as conversation_title, c.context_type, c.context_id FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE m.pending = 1 ORDER BY m.id'
);
const markResponded = db.query('UPDATE messages SET pending = 0 WHERE id = ?');
const updateConversationTime = db.query(
  "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
);

export const chatRoutes = {
  '/api/conversations': {
    GET: () => Response.json(listConversations.all()),
    POST: async (req: Request) => {
      const body = await req.json();
      try {
        const result = insertConversation.run({
          $title: body.title || '',
          $context_type: body.context_type || '',
          $context_id: body.context_id || '',
        });
        const conv = getConversation.get(result.lastInsertRowid);
        broadcast({ type: 'conversation_created', conversation: conv });
        return Response.json(conv, { status: 201 });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
  },
  '/api/conversations/:id': {
    GET: (req: Request & { params: { id: string } }) => {
      const conv = getConversation.get(Number(req.params.id));
      if (!conv) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(conv);
    },
  },
  '/api/conversations/:id/messages': {
    GET: (req: Request & { params: { id: string } }) => {
      return Response.json(getMessages.all(Number(req.params.id)));
    },
    POST: async (req: Request & { params: { id: string } }) => {
      const convId = Number(req.params.id);
      const conv = getConversation.get(convId);
      if (!conv) return Response.json({ error: 'conversation not found' }, { status: 404 });

      const body = await req.json();
      const sender = body.sender || 'user';
      const pending = sender === 'user' ? 1 : 0;

      try {
        const result = insertMessage.run({
          $conversation_id: convId,
          $sender: sender,
          $text: body.text,
          $pending: pending,
        });
        updateConversationTime.run(convId);
        const msg = getMessage.get(result.lastInsertRowid);
        broadcast({ type: 'new_message', message: msg });
        return Response.json(msg, { status: 201 });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    },
  },
  '/api/messages/pending': {
    GET: () => Response.json(getPending.all()),
  },
  '/api/messages/:id/responded': {
    POST: (req: Request & { params: { id: string } }) => {
      markResponded.run(Number(req.params.id));
      return Response.json({ ok: true });
    },
  },
  '/api/messages/:id/cancel': {
    POST: (req: Request & { params: { id: string } }) => {
      markResponded.run(Number(req.params.id));
      const msg = getMessage.get(Number(req.params.id));
      broadcast({ type: 'message_cancelled', message: msg });
      return Response.json({ ok: true });
    },
  },
};
