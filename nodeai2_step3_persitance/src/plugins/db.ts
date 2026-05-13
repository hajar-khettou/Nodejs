import fp from 'fastify-plugin'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import type { FastifyPluginAsync } from 'fastify'

const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data.db')

interface Stmts {
  createConv:  Database.Statement
  listConvs:   Database.Statement
  getConv:     Database.Statement
  deleteConv:  Database.Statement
  getMessages: Database.Statement
  addMessage:  Database.Statement
}

declare module 'fastify' {
  interface FastifyInstance {
    db:    Database.Database
    stmts: Stmts
  }
}

const dbPlugin: FastifyPluginAsync = async (app) => {
  const db = new Database(DB_PATH)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      title     TEXT    NOT NULL,
      createdAt TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      conversationId INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role           TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content        TEXT    NOT NULL,
      createdAt      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `)

  const stmts: Stmts = {
    createConv:  db.prepare('INSERT INTO conversations (title) VALUES (?) RETURNING *'),
    listConvs:   db.prepare(`
      SELECT c.id, c.title, c.createdAt,
             COUNT(m.id) AS messageCount
      FROM conversations c
      LEFT JOIN messages m ON m.conversationId = c.id
      GROUP BY c.id ORDER BY c.createdAt DESC
    `),
    getConv:     db.prepare('SELECT * FROM conversations WHERE id = ?'),
    deleteConv:  db.prepare('DELETE FROM conversations WHERE id = ?'),
    getMessages: db.prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY id'),
    addMessage:  db.prepare('INSERT INTO messages (conversationId, role, content) VALUES (?, ?, ?) RETURNING *'),
  }

  app.decorate('db', db)
  app.decorate('stmts', stmts)

  app.addHook('onClose', () => db.close())
}

export default fp(dbPlugin, { name: 'db' })
